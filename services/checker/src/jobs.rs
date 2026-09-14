use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::db::{new_id, now_iso};
use crate::dto::{IngestionJob, IngestionJobRow, JOB_SELECT, job_json};
use crate::error::ApiError;
use crate::state::{AppState, DataDirLock};
use crate::worker_slot::{WorkerInvocation, WorkerJobId, WorkerOperation};
use fingerprint::normalized::{FingerprintProfile, fingerprint_normalized};

/// `{request}` is substituted with the absolute path to the job's request.json.
/// Run through `sh -c`, same as any override, so there is exactly one code path.
pub const DEFAULT_WORKER_COMMAND: &str =
    "uv run --locked --project services/ifc-worker ifc-worker --request {request}";

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

pub async fn get_job(
    State(state): State<AppState>,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Json<IngestionJob>, ApiError> {
    let row: IngestionJobRow = sqlx::query_as(&format!("{JOB_SELECT} WHERE id = ?1"))
        .bind(&job_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("job"))?;
    Ok(Json(job_json(row)))
}

/// Idempotent: retrying a job that is not `failed` just returns its current
/// state unchanged — queued/running are already progressing on their own, and a
/// completed job has nothing left to redo. A caller can always call this after a
/// timed-out poll without risking double-processing.
pub async fn retry_job(
    State(state): State<AppState>,
    AxumPath(job_id): AxumPath<String>,
) -> Result<Json<IngestionJob>, ApiError> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ingestion_jobs WHERE id = ?1")
        .bind(&job_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(ApiError::not_found("job"));
    }
    sqlx::query(
        "UPDATE ingestion_jobs SET status = 'queued', error = NULL, started_at = NULL,
             finished_at = NULL, attempt_count = attempt_count + 1
         WHERE id = ?1 AND status = 'failed'",
    )
    .bind(&job_id)
    .execute(&state.pool)
    .await?;
    state.job_notify.notify_one();
    get_job(State(state), AxumPath(job_id)).await
}

pub async fn enqueue_upload(
    state: &AppState,
    source_model_id: &str,
    filename: &str,
    content_sha256: String,
    byte_size: i64,
    storage_path: String,
) -> Result<(StatusCode, Json<IngestionJob>), ApiError> {
    let row = IngestionJobRow {
        id: new_id(),
        source_model_id: source_model_id.to_owned(),
        filename: filename.to_owned(),
        content_sha256,
        byte_size,
        storage_path,
        status: "queued".to_owned(),
        model_revision_id: None,
        error: None,
        attempt_count: 0,
        created_at: now_iso(),
        started_at: None,
        finished_at: None,
    };
    sqlx::query(
        "INSERT INTO ingestion_jobs (id, source_model_id, filename, content_sha256, byte_size,
             storage_path, status, attempt_count, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,'queued',0,?7)",
    )
    .bind(&row.id)
    .bind(&row.source_model_id)
    .bind(&row.filename)
    .bind(&row.content_sha256)
    .bind(row.byte_size)
    .bind(&row.storage_path)
    .bind(&row.created_at)
    .execute(&state.pool)
    .await?;
    state.job_notify.notify_one();
    Ok((StatusCode::ACCEPTED, Json(job_json(row))))
}

// ---------------------------------------------------------------------------
// Background worker loop
// ---------------------------------------------------------------------------

pub fn spawn_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            match claim_next_job(&state.pool).await {
                Ok(Some(job)) => process_job(&state, &job).await,
                Ok(None) => {
                    tokio::select! {
                        _ = state.job_notify.notified() => {}
                        _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                    }
                }
                Err(err) => {
                    tracing::error!("ingestion job queue poll failed: {err:#}");
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    });
}

async fn claim_next_job(pool: &SqlitePool) -> anyhow::Result<Option<IngestionJobRow>> {
    let candidate: Option<IngestionJobRow> = sqlx::query_as(&format!(
        "{JOB_SELECT} WHERE status = 'queued' ORDER BY created_at LIMIT 1"
    ))
    .fetch_optional(pool)
    .await?;
    let Some(job) = candidate else {
        return Ok(None);
    };
    let result = sqlx::query(
        "UPDATE ingestion_jobs SET status = 'running', started_at = ?2
         WHERE id = ?1 AND status = 'queued'",
    )
    .bind(&job.id)
    .bind(now_iso())
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        // Lost a race (only possible with more than one worker task, which this
        // service never runs); the next loop iteration will pick up whatever is
        // actually queued.
        return Ok(None);
    }
    Ok(Some(job))
}

async fn process_job(state: &AppState, job: &IngestionJobRow) {
    let job_dir = state.data_dir.join("jobs").join(&job.id);
    let attempt_dir = job_dir.join(format!("attempt-{}", job.attempt_count));
    if let Err(err) = tokio::fs::create_dir_all(&attempt_dir).await {
        fail_job(
            &state.pool,
            &job.id,
            format!("cannot create job directory: {err}"),
        )
        .await;
        return;
    }
    let slot = match state.worker() {
        Ok(slot) => slot,
        Err(err) => return fail_job(&state.pool, &job.id, err.message).await,
    };
    let revision_id = new_id();
    let artifacts = match slot
        .invoke(WorkerInvocation {
            job_id: WorkerJobId::ingest(&job.id),
            revision_id: revision_id.clone(),
            content_sha256: job.content_sha256.clone(),
            output_dir: attempt_dir,
            operation: WorkerOperation::Inspect,
        })
        .await
    {
        Ok(artifacts) => artifacts,
        Err(reason) => return fail_job(&state.pool, &job.id, reason).await,
    };
    if let Err(err) = publish_revision(
        state,
        job,
        &revision_id,
        &artifacts.semantic,
        &artifacts.descriptor,
        &artifacts.geometry_chunks,
    )
    .await
    {
        fail_job(
            &state.pool,
            &job.id,
            format!("failed to publish revision: {err:#}"),
        )
        .await;
    }
}

async fn fail_job(pool: &SqlitePool, job_id: &str, error: String) {
    tracing::warn!(job_id, %error, "ingestion job failed");
    let _ = sqlx::query(
        "UPDATE ingestion_jobs SET status = 'failed', error = ?2, finished_at = ?3 WHERE id = ?1",
    )
    .bind(job_id)
    .bind(&error)
    .bind(now_iso())
    .execute(pool)
    .await;
}

pub(crate) async fn fail_interrupted(
    tx: &mut Transaction<'_, Sqlite>,
    _lock: &DataDirLock,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        "UPDATE ingestion_jobs SET status = 'failed',
             error = 'interrupted: the service restarted while this job was running',
             finished_at = ?1
         WHERE status = 'running'",
    )
    .bind(now_iso())
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected())
}

async fn publish_revision(
    state: &AppState,
    job: &IngestionJobRow,
    revision_id: &str,
    semantic: &model_contracts::SemanticModel,
    descriptor: &model_contracts::ModelDescriptor,
    geometry_chunks: &HashMap<String, model_contracts::GeometryChunk>,
) -> anyhow::Result<()> {
    let header_json = serde_json::json!({
        "format": descriptor.source_provenance.format.as_str(),
        "originalFilename": descriptor.source_provenance.original_filename.as_str(),
        "contentHash": descriptor.source_provenance.content_hash.as_str(),
        "producedBy": descriptor.source_provenance.produced_by,
    });
    let product_count = semantic.objects.len() as i64;
    let row = crate::dto::ModelRevisionRow {
        id: revision_id.to_owned(),
        source_model_id: job.source_model_id.clone(),
        filename: job.filename.clone(),
        content_sha256: job.content_sha256.clone(),
        byte_size: job.byte_size,
        schema_label: descriptor.source_provenance.format.to_string(),
        entity_count: product_count,
        product_count,
        length_to_metre: descriptor.length_to_metre,
        storage_path: job.storage_path.clone(),
        header_json: Some(header_json.to_string()),
        parse_ms: None,
        uploaded_at: now_iso(),
        provenance: "complete".to_owned(),
    };

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
             schema_label, entity_count, product_count, length_to_metre, storage_path,
             header_json, parse_ms, uploaded_at, provenance)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
    )
    .bind(&row.id)
    .bind(&row.source_model_id)
    .bind(&row.filename)
    .bind(&row.content_sha256)
    .bind(row.byte_size)
    .bind(&row.schema_label)
    .bind(row.entity_count)
    .bind(row.product_count)
    .bind(row.length_to_metre)
    .bind(&row.storage_path)
    .bind(&row.header_json)
    .bind(row.parse_ms)
    .bind(&row.uploaded_at)
    .bind(&row.provenance)
    .execute(&mut *tx)
    .await?;

    let profile = FingerprintProfile::v1();
    for record in &semantic.objects {
        let native = record.native_ids.as_ref();
        let express_id = native
            .and_then(|ids| ids.express_id)
            .map(|id| id.get() as i64)
            .unwrap_or(0);
        let global_id = native
            .and_then(|ids| ids.global_id.as_ref())
            .map(|id| id.to_string());
        let object_id = new_id();
        let chunk = geometry_chunks.get(record.ref_.object_id.as_str());
        let snapshot = fingerprint_normalized(record, chunk, &profile);
        let placement_json = record
            .placement
            .as_ref()
            .and_then(|values| serde_json::to_string(values.as_slice()).ok());
        sqlx::query(
            "INSERT INTO objects (id, model_id, express_id, global_id, ifc_type, name,
                 predefined_type, storey, placement_json, fp_properties, fp_placement,
                 fp_shape, fp_combined, ref_object_id, profile_version, profile_id,
                 canonical_properties, canonical_placement, canonical_shape)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        )
        .bind(&object_id)
        .bind(revision_id)
        .bind(express_id)
        .bind(&global_id)
        .bind(record.classification.as_str())
        .bind(&record.name)
        .bind(Option::<String>::None)
        .bind(&record.storey)
        .bind(&placement_json)
        .bind(&snapshot.fingerprints.properties)
        .bind(&snapshot.fingerprints.placement)
        .bind(&snapshot.fingerprints.shape)
        .bind(&snapshot.fingerprints.combined)
        .bind(record.ref_.object_id.as_str())
        .bind(&snapshot.profile_version)
        .bind(&snapshot.profile_id)
        .bind(&snapshot.canonical_properties)
        .bind(&snapshot.canonical_placement)
        .bind(&snapshot.canonical_shape)
        .execute(&mut *tx)
        .await?;

        for prop in &record.properties {
            let inherited = i64::from(prop.origin == model_contracts::PropertyOrigin::Type);
            let first = prop.values.first();
            let record_json = serde_json::to_string(prop).unwrap_or_else(|_| "{}".to_owned());
            sqlx::query(
                "INSERT INTO object_props (object_id, pset, name, value, data_type, unit, numeric, inherited, record_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            )
            .bind(&object_id)
            .bind(prop.pset.as_str())
            .bind(prop.name.as_str())
            .bind(property_values_text(&prop.values))
            .bind(first.and_then(|value| value.dimension.map(|dim| dim.to_string())))
            .bind(first.and_then(|value| value.original_unit.clone()))
            .bind(first.and_then(|value| value.si_value))
            .bind(inherited)
            .bind(&record_json)
            .execute(&mut *tx)
            .await?;
        }
    }

    sqlx::query(
        "UPDATE ingestion_jobs SET status = 'completed', model_revision_id = ?2, finished_at = ?3
         WHERE id = ?1",
    )
    .bind(&job.id)
    .bind(revision_id)
    .bind(now_iso())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// `object_props.data_type` held the IFC measure type name (e.g.
/// `IFCLENGTHMEASURE`) under the old Rust-only extraction; the worker does not
/// expose that concept, only `dimension` (length/area/volume), so this column
/// now holds that instead. Nothing reads it as the old IFC type name: IDS
/// evaluation (`run.rs`) re-parses the raw bytes independently and never
/// touches this table.
fn property_values_text(values: &[model_contracts::PropertyValue]) -> Option<String> {
    if values.is_empty() {
        return None;
    }
    if values.len() == 1 {
        return property_value_text(&values[0].value);
    }
    let raw: Vec<serde_json::Value> = values
        .iter()
        .map(|value| match &value.value {
            model_contracts::PropertyValueValue::String(text) => {
                serde_json::Value::String(text.clone())
            }
            model_contracts::PropertyValueValue::Number(number) => serde_json::json!(number),
            model_contracts::PropertyValueValue::Boolean(flag) => serde_json::Value::Bool(*flag),
            model_contracts::PropertyValueValue::Null => serde_json::Value::Null,
        })
        .collect();
    serde_json::to_string(&raw).ok()
}

fn property_value_text(value: &model_contracts::PropertyValueValue) -> Option<String> {
    match value {
        model_contracts::PropertyValueValue::Null => None,
        model_contracts::PropertyValueValue::String(text) => Some(text.clone()),
        model_contracts::PropertyValueValue::Boolean(flag) => Some(flag.to_string()),
        model_contracts::PropertyValueValue::Number(number) => Some(number.to_string()),
    }
}
