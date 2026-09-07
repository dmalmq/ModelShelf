//! Durable ingestion job queue: uploading a revision (`sources.rs::upload_revision`)
//! enqueues a job and returns immediately; this module's background worker claims
//! one queued job at a time, invokes the authoritative `ifc-worker` per
//! `docs/contracts/worker-v1.md`, validates every part of its contract before
//! trusting any of it, and only then publishes the immutable revision. Nothing
//! here touches `model-contracts` or `modeldiff` beyond calling their public
//! functions — job/persistence logic stays in this service, per the ticket's
//! boundary.
//!
//! Validation is deliberately paranoid: a real worker never misbehaves, but the
//! caller cannot assume that, so every acceptance-criterion failure mode
//! (malformed/truncated stdout, duplicate terminal results, wrong job id,
//! nonzero exit, bad artifact hash, a path escaping the job's own output
//! directory, a protocol version this build does not understand) is checked
//! explicitly and fails the job rather than publishing anything.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::db::{new_id, now_iso};
use crate::dto::{job_json, IngestionJob, IngestionJobRow, JOB_SELECT};
use crate::error::ApiError;
use crate::state::AppState;

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

/// One task per process, processing claimed jobs strictly one after another —
/// that sequencing, not a lock, is what guarantees at most one heavy worker
/// invocation is ever in flight.
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
    if let Err(err) = tokio::fs::create_dir_all(&job_dir).await {
        fail_job(&state.pool, &job.id, format!("cannot create job directory: {err}")).await;
        return;
    }
    let revision_id = new_id();
    match run_and_validate(state, job, &job_dir, &revision_id).await {
        Ok(semantic) => {
            if let Err(err) = publish_revision(state, job, &revision_id, &semantic).await {
                fail_job(&state.pool, &job.id, format!("failed to publish revision: {err:#}")).await;
            }
        }
        Err(reason) => fail_job(&state.pool, &job.id, reason).await,
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

// ---------------------------------------------------------------------------
// Worker protocol wire types (docs/contracts/worker-v1.md)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct EventEnvelope {
    #[serde(rename = "protocolVersion")]
    protocol_version: i64,
    #[serde(rename = "jobId")]
    job_id: String,
    event: String,
}

#[derive(Deserialize)]
struct ManifestPointer {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Deserialize)]
struct ResultEvent {
    manifest: ManifestPointer,
}

#[derive(Deserialize)]
struct ArtifactRef {
    path: String,
    sha256: String,
    size: u64,
    #[serde(rename = "recordCount")]
    record_count: Option<u64>,
}

#[derive(Deserialize)]
struct Artifacts {
    descriptor: ArtifactRef,
    semantic: ArtifactRef,
    #[serde(rename = "renderManifest")]
    render_manifest: Option<ArtifactRef>,
    geometry: Option<ArtifactRef>,
    outcomes: ArtifactRef,
}

#[derive(Deserialize)]
struct Manifest {
    #[serde(rename = "protocolVersion")]
    protocol_version: i64,
    #[serde(rename = "jobId")]
    job_id: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
    #[serde(rename = "modelSha256")]
    model_sha256: String,
    artifacts: Artifacts,
}



// ---------------------------------------------------------------------------
// Invocation and validation
// ---------------------------------------------------------------------------

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn worker_command(template: &str, request_path: &Path) -> (String, Vec<String>) {
    let cmd = template.replace("{request}", &shell_quote(&request_path.to_string_lossy()));
    ("sh".to_owned(), vec!["-c".to_owned(), cmd])
}

/// Lexical containment: both paths are documented as absolute, so this
/// normalises `.`/`..` components without touching the filesystem (a malicious
/// or buggy manifest may point somewhere that never gets created) and compares
/// the resulting component sequences. `base` must already be normalised.
fn is_within(base: &[std::path::Component], candidate: &Path) -> bool {
    if !candidate.is_absolute() {
        return false;
    }
    let mut normalized: Vec<std::path::Component> = Vec::new();
    for component in candidate.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized.len() > base.len() && normalized[..base.len()] == *base
}

fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Runs the worker for `job`, validates every part of its contract, and returns
/// the fully-verified object records — or a human-readable reason the job
/// failed. Nothing is published to the database from here; the caller decides
/// what "verified" is trusted enough to persist.
async fn run_and_validate(
    state: &AppState,
    job: &IngestionJobRow,
    job_dir: &Path,
    revision_id: &str,
) -> Result<model_contracts::SemanticModel, String> {
    let job_dir_canonical = job_dir
        .canonicalize()
        .map_err(|err| format!("cannot resolve job directory: {err}"))?;
    let base_components: Vec<std::path::Component> = job_dir_canonical.components().collect();

    let blob_path = state.blob_path(&job.content_sha256);
    let blob_path_canonical = blob_path
        .canonicalize()
        .map_err(|err| format!("cannot resolve uploaded blob: {err}"))?;

    let request = serde_json::json!({
        "protocolVersion": 2,
        "jobId": job.id,
        "operation": "inspect",
        "model": {
            "path": blob_path_canonical.to_string_lossy(),
            "sha256": job.content_sha256,
            "revisionId": revision_id,
        },
        "ids": null,
        "outputDir": job_dir_canonical.to_string_lossy(),
        "settings": {"geometry": true},
    });
    let request_path = job_dir.join("request.json");
    tokio::fs::write(&request_path, serde_json::to_vec_pretty(&request).unwrap_or_default())
        .await
        .map_err(|err| format!("cannot write request.json: {err}"))?;

    let (program, args) = worker_command(&state.worker_command, &request_path);
    let output = tokio::process::Command::new(&program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|err| format!("cannot spawn worker: {err}"))?;

    let _ = tokio::fs::write(job_dir.join("stdout.log"), &output.stdout).await;
    let _ = tokio::fs::write(job_dir.join("stderr.log"), &output.stderr).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "worker exited with {}: {}",
            output.status,
            tail_lines(&stderr, 5)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|line| !line.trim().is_empty()).collect();
    if lines.is_empty() {
        return Err("worker exited 0 but produced no NDJSON output".to_owned());
    }

    let mut result_index: Option<usize> = None;
    for (index, line) in lines.iter().enumerate() {
        let envelope: EventEnvelope = serde_json::from_str(line)
            .map_err(|err| format!("malformed NDJSON on line {}: {err}", index + 1))?;
        if envelope.protocol_version != 2 {
            return Err(format!(
                "worker protocol version mismatch on line {}: expected 2, got {}",
                index + 1,
                envelope.protocol_version
            ));
        }
        if envelope.job_id != job.id {
            return Err(format!(
                "worker reported job id {:?} on line {}, expected {:?}",
                envelope.job_id,
                index + 1,
                job.id
            ));
        }
        match envelope.event.as_str() {
            "progress" => {
                if result_index.is_some() {
                    return Err("a progress event followed the terminal result event".to_owned());
                }
            }
            "result" => {
                if result_index.is_some() {
                    return Err("worker emitted more than one terminal result event".to_owned());
                }
                result_index = Some(index);
            }
            other => return Err(format!("unknown NDJSON event kind {other:?} on line {}", index + 1)),
        }
    }
    let Some(result_index) = result_index else {
        return Err("worker exited 0 without ever emitting a terminal result event".to_owned());
    };
    if result_index != lines.len() - 1 {
        return Err("the terminal result event was not the last line of output".to_owned());
    }

    let result: ResultEvent = serde_json::from_str(lines[result_index])
        .map_err(|err| format!("cannot parse the terminal result event: {err}"))?;

    let manifest_path = PathBuf::from(&result.manifest.path);
    if !is_within(&base_components, &manifest_path) {
        return Err(format!(
            "manifest path {} escapes the job's own output directory",
            manifest_path.display()
        ));
    }
    let manifest_bytes = tokio::fs::read(&manifest_path)
        .await
        .map_err(|err| format!("cannot read manifest at {}: {err}", manifest_path.display()))?;
    if crate::upload::sha256_hex(&manifest_bytes) != result.manifest.sha256 {
        return Err("manifest content hash does not match the terminal result event".to_owned());
    }
    if manifest_bytes.len() as u64 != result.manifest.size {
        return Err("manifest size does not match the terminal result event".to_owned());
    }

    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|err| format!("manifest is not valid JSON: {err}"))?;
    if manifest.protocol_version != 2 {
        return Err(format!(
            "manifest protocol version mismatch: expected 2, got {}",
            manifest.protocol_version
        ));
    }
    if manifest.job_id != job.id {
        return Err("manifest job id does not match this job".to_owned());
    }
    if manifest.revision_id != revision_id {
        return Err("manifest revision id does not match the revision this job requested".to_owned());
    }
    if manifest.model_sha256 != job.content_sha256 {
        return Err("manifest model hash does not match the uploaded content".to_owned());
    }

    let descriptor_bytes =
        verify_artifact(&base_components, &manifest.artifacts.descriptor, "descriptor").await?;
    let semantic_bytes =
        verify_artifact(&base_components, &manifest.artifacts.semantic, "semantic").await?;
    verify_artifact(&base_components, &manifest.artifacts.outcomes, "outcomes").await?;
    if let Some(artifact) = &manifest.artifacts.render_manifest {
        verify_artifact(&base_components, artifact, "renderManifest").await?;
    }
    if let Some(artifact) = &manifest.artifacts.geometry {
        verify_artifact(&base_components, artifact, "geometry").await?;
    }

    let descriptor_text = String::from_utf8(descriptor_bytes)
        .map_err(|err| format!("descriptor is not utf-8: {err}"))?;
    model_contracts::parse_model_descriptor(&descriptor_text)
        .map_err(|err| format!("descriptor failed shared-contract validation: {err}"))?;

    let semantic_text = String::from_utf8(semantic_bytes)
        .map_err(|err| format!("semantic artifact is not utf-8: {err}"))?;
    let semantic = model_contracts::parse_semantic_model(&semantic_text)
        .map_err(|err| format!("semantic artifact failed shared-contract validation: {err}"))?;
    if semantic.revision_id.as_str() != revision_id {
        return Err("semantic artifact revision id does not match the revision this job requested".to_owned());
    }
    if let Some(declared) = manifest.artifacts.semantic.record_count {
        if declared != semantic.objects.len() as u64 {
            return Err(format!(
                "semantic artifact declares {declared} record(s) but contains {}",
                semantic.objects.len()
            ));
        }
    }
    for (index, object) in semantic.objects.iter().enumerate() {
        let Some(native) = object.native_ids.as_ref() else {
            return Err(format!("semantic object {index} is missing nativeIds.expressId"));
        };
        let Some(express_id) = native.express_id else {
            return Err(format!("semantic object {index} is missing nativeIds.expressId"));
        };
        let expected_object_id = model_contracts::express_id_to_object_id(revision_id, express_id.get());
        if object.ref_.object_id.as_str() != expected_object_id {
            return Err(format!(
                "semantic object {index} has ref.objectId {:?}, expected {:?} per the shared contract",
                object.ref_.object_id.as_str(),
                expected_object_id
            ));
        }
    }

    Ok(semantic)
}

async fn verify_artifact(
    base_components: &[std::path::Component<'_>],
    artifact: &ArtifactRef,
    which: &str,
) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(&artifact.path);
    if !is_within(base_components, &path) {
        return Err(format!("{which} artifact path escapes the job's own output directory"));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|err| format!("cannot read {which} artifact at {}: {err}", path.display()))?;
    if bytes.len() as u64 != artifact.size {
        return Err(format!("{which} artifact size does not match the manifest"));
    }
    if crate::upload::sha256_hex(&bytes) != artifact.sha256 {
        return Err(format!("{which} artifact content hash does not match the manifest"));
    }
    Ok(bytes)
}

/// Only reachable after `run_and_validate` succeeds: every object record has
/// already been checked against the worker's own manifest and the shared
/// occurrence-id contract. This re-parses the same bytes through `ifc_model` +
/// `fingerprint` only to compute the diff-hash columns (`fp_*`) — the worker's
/// output has no representation-graph data to derive those from, so this is not
/// the "custom-parser ingestion" the ticket replaces, it is the fingerprinting
/// concern `modeldiff` already depends on and this ticket does not touch.
async fn publish_revision(
    state: &AppState,
    job: &IngestionJobRow,
    revision_id: &str,
    semantic: &model_contracts::SemanticModel,
) -> anyhow::Result<()> {
    let bytes = state
        .read_verified_blob(&job.storage_path, &job.content_sha256)
        .await
        .map_err(|err| anyhow::anyhow!(err.message))?;
    let model = ifc_model::IfcModel::parse(&bytes)
        .map_err(|err| anyhow::anyhow!("{}: {err}", job.filename))?;
    let started = std::time::Instant::now();
    let snapshots = fingerprint::snapshot_model(&model, &fingerprint::FpOptions::default());
    let parse_ms = started.elapsed().as_millis() as i64;
    let mut fingerprints_by_express_id: HashMap<u32, fingerprint::Fingerprints> =
        snapshots.into_iter().map(|snapshot| (snapshot.express_id, snapshot.fingerprints)).collect();

    let header = model.header();
    let header_json = serde_json::json!({
        "fileName": header.file_name,
        "timeStamp": header.time_stamp,
        "authors": header.authors,
        "organizations": header.organizations,
        "preprocessorVersion": header.preprocessor_version,
        "originatingSystem": header.originating_system,
        "schemaTokens": header.schema_tokens,
        "fileDescription": header.file_description,
    });

    let row = crate::dto::ModelRevisionRow {
        id: revision_id.to_owned(),
        source_model_id: job.source_model_id.clone(),
        filename: job.filename.clone(),
        content_sha256: job.content_sha256.clone(),
        byte_size: job.byte_size,
        schema_label: model.schema().label(),
        entity_count: model.entity_count() as i64,
        product_count: semantic.objects.len() as i64,
        length_to_metre: model.length_to_metre(),
        storage_path: job.storage_path.clone(),
        header_json: Some(header_json.to_string()),
        parse_ms: Some(parse_ms),
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

    // The worker's object roster is authoritative; a fingerprint pass that
    // genuinely disagrees on which express ids are products would be a real
    // engine divergence worth surfacing, not silently guessing — this sentinel
    // makes a missing fingerprint visible (a distinct, grep-able value) instead
    // of a plausible-looking fake hash.
    const NO_FINGERPRINT: &str = "no-fingerprint:express-id-not-seen-by-rust-parser";
    for record in &semantic.objects {
        let native = record.native_ids.as_ref();
        let express_id = native.and_then(|ids| ids.express_id).map(|id| id.get() as i64).unwrap_or(0);
        let global_id = native.and_then(|ids| ids.global_id.as_ref()).map(|id| id.to_string());
        let object_id = new_id();
        let fingerprints = fingerprints_by_express_id.remove(&(express_id as u32));
        let (fp_properties, fp_placement, fp_shape, fp_combined) = match fingerprints {
            Some(f) => (f.properties, f.placement, f.shape, f.combined),
            None => (
                NO_FINGERPRINT.to_owned(),
                NO_FINGERPRINT.to_owned(),
                NO_FINGERPRINT.to_owned(),
                NO_FINGERPRINT.to_owned(),
            ),
        };
        let placement_json =
            record.placement.as_ref().and_then(|values| serde_json::to_string(values.as_slice()).ok());
        sqlx::query(
            "INSERT INTO objects (id, model_id, express_id, global_id, ifc_type, name,
                 predefined_type, storey, placement_json, fp_properties, fp_placement,
                 fp_shape, fp_combined, ref_object_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
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
        .bind(&fp_properties)
        .bind(&fp_placement)
        .bind(&fp_shape)
        .bind(&fp_combined)
        .bind(record.ref_.object_id.as_str())
        .execute(&mut *tx)
        .await?;

        for prop in &record.properties {
            let inherited = i64::from(prop.origin == model_contracts::PropertyOrigin::Type);
            let first = prop.values.first();
            sqlx::query(
                "INSERT INTO object_props (object_id, pset, name, value, data_type, unit, numeric, inherited)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )
            .bind(&object_id)
            .bind(prop.pset.as_str())
            .bind(prop.name.as_str())
            .bind(property_values_text(&prop.values))
            .bind(first.and_then(|value| value.dimension.map(|dim| dim.to_string())))
            .bind(first.and_then(|value| value.original_unit.clone()))
            .bind(first.and_then(|value| value.si_value))
            .bind(inherited)
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
    let raw: Vec<serde_json::Value> = values.iter().map(|value| match &value.value {
        model_contracts::PropertyValueValue::String(text) => serde_json::Value::String(text.clone()),
        model_contracts::PropertyValueValue::Number(number) => serde_json::json!(number),
        model_contracts::PropertyValueValue::Boolean(flag) => serde_json::Value::Bool(*flag),
        model_contracts::PropertyValueValue::Null => serde_json::Value::Null,
    }).collect();
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
