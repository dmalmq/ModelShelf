//! HTTP surface. Paths and payload shapes follow `docs/contracts/http-api.md`.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio_util::io::ReaderStream;

use crate::db::{new_id, now_iso, SCHEMA_VERSION};
use crate::dto::{
    delivery_json, model_json, pack_version_json, project_json, run_summary,
    AddDeliveryMemberBody, CreateDeliveryBody, CreatePackVersionBody, Delivery, DeliveryDetail,
    DeliveryRow, DeliverySummary, Health, ModelInfo, ModelRevisionRow, ObjectDetail,
    ObjectFingerprints, ObjectPage, ObjectProperty, ObjectPropertyValue, ObjectRefOut, ObjectRowDb, ObjectRowOut, Pack,
    PackRow, PackSpecInfo, PackVersion, PackVersionDetail, PackVersionRow, Project, ProjectDetail,
    ProjectRow, PropRow, RunRow, RunSummary, DELIVERY_SELECT, MODEL_REVISION_SELECT,
    RUN_SUMMARY_SELECT,
};
use crate::error::ApiError;
use crate::run::{finding_objects, run_counts};
use crate::state::AppState;
use crate::upload::sha256_hex;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/{project_id}", get(get_project))
        .route("/api/projects/{project_id}/deliveries", post(create_delivery))
        .route(
            "/api/projects/{project_id}/source-models",
            get(crate::sources::list_source_models).post(crate::sources::create_source_model),
        )
        .route(
            "/api/source-models/{source_model_id}/revisions",
            post(crate::sources::upload_revision),
        )
        .route("/api/jobs/{job_id}", get(crate::jobs::get_job))
        .route("/api/jobs/{job_id}/retry", post(crate::jobs::retry_job))
        .route("/api/deliveries/{delivery_id}", get(get_delivery))
        .route("/api/deliveries/{delivery_id}/members", post(add_delivery_member))
        .route("/api/deliveries/{delivery_id}/finalize", post(finalize_delivery))
        .route("/api/models/{model_id}/file", get(model_file))
        .route("/api/models/{model_id}/objects", get(list_objects))
        .route("/api/objects/{object_id}", get(get_object))
        .route("/api/packs", get(list_packs))
        .route("/api/packs/{pack_id}/versions", post(create_pack_version))
        .route("/api/pack-versions/{pack_version_id}", get(get_pack_version))
        .route("/api/runs", post(crate::run::create_run))
        .route("/api/runs/{run_id}", get(crate::run::get_run))
        .route("/api/findings/{finding_id}/objects", get(list_finding_objects))
        .route("/api/diff/models", get(crate::diff::diff_models))
        .route("/api/diff/runs", get(crate::diff::diff_runs))
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        engine_version: crate::ids_meta::CHECK_ENGINE_VERSION.to_owned(),
        parser_version: crate::ids_meta::CHECK_PARSER_VERSION.to_owned(),
        schema_version: SCHEMA_VERSION,
    })
}

const PROJECT_SELECT: &str = "SELECT p.id, p.tenant_id, t.name AS tenant_name, p.name,
        p.created_at
   FROM projects p JOIN tenants t ON t.id = p.tenant_id";

async fn list_projects(State(state): State<AppState>) -> Result<Json<Vec<Project>>, ApiError> {
    let rows: Vec<ProjectRow> =
        sqlx::query_as(&format!("{PROJECT_SELECT} ORDER BY p.created_at"))
            .fetch_all(&state.pool)
            .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let (deliveries, runs) = project_counts(&state, &row.id).await?;
        out.push(project_json(row, deliveries, runs));
    }
    Ok(Json(out))
}

async fn project_counts(state: &AppState, project_id: &str) -> Result<(i64, i64), ApiError> {
    let deliveries: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM deliveries WHERE project_id = ?1")
            .bind(project_id)
            .fetch_one(&state.pool)
            .await?;
    let runs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM runs WHERE project_id = ?1")
        .bind(project_id)
        .fetch_one(&state.pool)
        .await?;
    Ok((deliveries, runs))
}

async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectDetail>, ApiError> {
    let row: ProjectRow = sqlx::query_as(&format!("{PROJECT_SELECT} WHERE p.id = ?1"))
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("project"))?;
    let tenant_id = row.tenant_id.clone();
    let (delivery_count, run_count) = project_counts(&state, &project_id).await?;
    let project = project_json(row, delivery_count, run_count);

    let delivery_rows: Vec<DeliveryRow> = sqlx::query_as(&format!(
        "{DELIVERY_SELECT} WHERE project_id = ?1 ORDER BY created_at DESC"
    ))
    .bind(&project_id)
    .fetch_all(&state.pool)
    .await?;

    let mut deliveries = Vec::with_capacity(delivery_rows.len());
    for row in &delivery_rows {
        let models = load_model_infos(&state, &row.id).await?;
        let latest = latest_run(&state, &row.id).await?;
        deliveries.push(DeliverySummary {
            delivery: delivery_json(&state.pool, row).await?,
            models,
            latest_run: latest,
        });
    }

    let runs = list_run_summaries(&state, "r.project_id = ?1", &project_id).await?;
    let packs = load_packs(&state, Some(&tenant_id)).await?;

    Ok(Json(ProjectDetail { project, deliveries, packs, runs }))
}

async fn load_model_infos(
    state: &AppState,
    delivery_id: &str,
) -> Result<Vec<ModelInfo>, ApiError> {
    let rows = crate::diff::load_models(&state.pool, delivery_id).await?;
    Ok(rows.iter().map(model_json).collect())
}

async fn latest_run(
    state: &AppState,
    delivery_id: &str,
) -> Result<Option<RunSummary>, ApiError> {
    let row: Option<RunRow> = sqlx::query_as(&format!(
        "{RUN_SUMMARY_SELECT} WHERE r.delivery_id = ?1 ORDER BY r.started_at DESC LIMIT 1"
    ))
    .bind(delivery_id)
    .fetch_optional(&state.pool)
    .await?;
    match row {
        Some(row) => {
            let (findings, objects) = run_counts(&state.pool, &row.id).await?;
            Ok(Some(run_summary(&row, findings, objects)))
        }
        None => Ok(None),
    }
}

async fn list_run_summaries(
    state: &AppState,
    where_clause: &str,
    bind: &str,
) -> Result<Vec<RunSummary>, ApiError> {
    let rows: Vec<RunRow> = sqlx::query_as(&format!(
        "{RUN_SUMMARY_SELECT} WHERE {where_clause} ORDER BY r.started_at DESC"
    ))
    .bind(bind)
    .fetch_all(&state.pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let (findings, objects) = run_counts(&state.pool, &row.id).await?;
        out.push(run_summary(&row, findings, objects));
    }
    Ok(out)
}

async fn create_delivery(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateDeliveryBody>,
) -> Result<Json<Delivery>, ApiError> {
    if body.label.trim().is_empty() {
        return Err(ApiError::bad_request("delivery label must not be empty"));
    }
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?1")
        .bind(&project_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(ApiError::not_found("project"));
    }
    let row = DeliveryRow {
        id: new_id(),
        project_id: project_id.clone(),
        label: body.label.trim().to_owned(),
        delivery_date: body.delivery_date.clone(),
        created_at: now_iso(),
        finalized_at: None,
    };
    sqlx::query(
        "INSERT INTO deliveries (id, project_id, label, delivery_date, created_at)
         VALUES (?1,?2,?3,?4,?5)",
    )
    .bind(&row.id)
    .bind(&row.project_id)
    .bind(&row.label)
    .bind(&row.delivery_date)
    .bind(&row.created_at)
    .execute(&state.pool)
    .await?;
    Ok(Json(delivery_json(&state.pool, &row).await?))
}

async fn get_delivery(
    State(state): State<AppState>,
    Path(delivery_id): Path<String>,
) -> Result<Json<DeliveryDetail>, ApiError> {
    let row = crate::diff::load_delivery(&state.pool, &delivery_id).await?;
    let models = load_model_infos(&state, &delivery_id).await?;
    let runs = list_run_summaries(&state, "r.delivery_id = ?1", &delivery_id).await?;
    // finalize (routes::finalize_delivery) is the explicit mechanism; a delivery with
    // a completed run stays locked even without it, preserving the invariant that
    // predates finalization (see migrate_v2::backfill_finalized_deliveries).
    let locked = row.finalized_at.is_some() || runs.iter().any(|r| r.status == "completed");
    Ok(Json(DeliveryDetail {
        delivery: delivery_json(&state.pool, &row).await?,
        models,
        runs,
        locked,
    }))
}

/// Adds a source model's revision to a delivery, replacing any revision already
/// pinned there for that source model (one revision per source model per
/// delivery). The `INSERT OR REPLACE ... SELECT ... WHERE NOT EXISTS (...)` is one
/// atomic statement precisely so a concurrent `finalize_delivery` can never land
/// between "checked not finalized" and "wrote the membership" — SQLite gives a
/// single statement full isolation, which a separate check-then-write pair would not.
async fn add_delivery_member(
    State(state): State<AppState>,
    Path(delivery_id): Path<String>,
    Json(body): Json<AddDeliveryMemberBody>,
) -> Result<Json<DeliveryDetail>, ApiError> {
    let delivery_project: Option<String> = sqlx::query_scalar("SELECT project_id FROM deliveries WHERE id = ?1")
        .bind(&delivery_id)
        .fetch_optional(&state.pool)
        .await?;
    let delivery_project = delivery_project.ok_or_else(|| ApiError::not_found("delivery"))?;

    let source_model_project: Option<String> =
        sqlx::query_scalar("SELECT project_id FROM source_models WHERE id = ?1")
            .bind(&body.source_model_id)
            .fetch_optional(&state.pool)
            .await?;
    let source_model_project = source_model_project.ok_or_else(|| ApiError::not_found("source model"))?;
    if source_model_project != delivery_project {
        return Err(ApiError::bad_request("source model does not belong to this delivery's project"));
    }

    let revision_source: Option<String> =
        sqlx::query_scalar("SELECT source_model_id FROM model_revisions WHERE id = ?1")
            .bind(&body.model_revision_id)
            .fetch_optional(&state.pool)
            .await?;
    let revision_source = revision_source.ok_or_else(|| ApiError::not_found("model revision"))?;
    if revision_source != body.source_model_id {
        return Err(ApiError::bad_request("model revision does not belong to the given source model"));
    }

    let result = sqlx::query(
        "INSERT OR REPLACE INTO delivery_members (id, delivery_id, source_model_id, model_revision_id, added_at)
         SELECT ?1, ?2, ?3, ?4, ?5
          WHERE NOT EXISTS (SELECT 1 FROM deliveries WHERE id = ?2 AND finalized_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM runs WHERE delivery_id = ?2 AND status = 'completed')",
    )
    .bind(new_id())
    .bind(&delivery_id)
    .bind(&body.source_model_id)
    .bind(&body.model_revision_id)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::delivery_locked());
    }

    get_delivery(State(state), Path(delivery_id)).await
}

/// Freezes membership forever. Idempotent: finalizing an already-finalized
/// delivery is a no-op success, not an error — a second caller racing the first
/// (or simply retrying) gets the same frozen state back either way. The `WHERE
/// finalized_at IS NULL` guard is what makes concurrent finalize calls safe: only
/// one of them can actually change the row from NULL to a timestamp.
async fn finalize_delivery(
    State(state): State<AppState>,
    Path(delivery_id): Path<String>,
) -> Result<Json<DeliveryDetail>, ApiError> {
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM deliveries WHERE id = ?1")
        .bind(&delivery_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(ApiError::not_found("delivery"));
    }
    sqlx::query("UPDATE deliveries SET finalized_at = ?2 WHERE id = ?1 AND finalized_at IS NULL")
        .bind(&delivery_id)
        .bind(now_iso())
        .execute(&state.pool)
        .await?;

    get_delivery(State(state), Path(delivery_id)).await
}

/// A revision belongs to a source model, not a delivery, so this is scoped to the
/// revision's own row — it does not answer "which delivery is this in" (a revision
/// can be a member of several, or none). `ModelInfo`/`ModelRow` are the
/// delivery-projected view; this is the revision-only view `/file` and the object
/// endpoints actually need.
async fn load_model_row(state: &AppState, model_id: &str) -> Result<ModelRevisionRow, ApiError> {
    sqlx::query_as(&format!("{MODEL_REVISION_SELECT} WHERE id = ?1"))
        .bind(model_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("model"))
}

/// Stream the immutable IFC bytes to the viewer. The content hash is a strong ETag, so a
/// reload of the same drop is a 304 rather than another 2.5 MB transfer.
async fn model_file(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let row = load_model_row(&state, &model_id).await?;
    let etag = format!("\"{}\"", row.content_sha256);
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(',').any(|candidate| candidate.trim() == etag))
        .unwrap_or(false)
    {
        return Ok(StatusCode::NOT_MODIFIED.into_response());
    }

    let path = state.blob_path(&row.content_sha256);
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|err| ApiError::internal(format!("cannot open {}: {err}", path.display())))?;
    let stream = ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

    let mut response = Response::new(body);
    let response_headers = response.headers_mut();
    response_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response_headers.insert(header::CONTENT_LENGTH, HeaderValue::from(row.byte_size));
    if let Ok(value) = HeaderValue::from_str(&etag) {
        response_headers.insert(header::ETAG, value);
    }
    if let Ok(value) =
        HeaderValue::from_str(&format!("inline; filename=\"{}\"", row.filename))
    {
        response_headers.insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectQuery {
    #[serde(rename = "type")]
    pub ifc_type: Option<String>,
    pub storey: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

async fn list_objects(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
    Query(query): Query<ObjectQuery>,
) -> Result<Json<ObjectPage>, ApiError> {
    load_model_row(&state, &model_id).await?;
    let limit = query.limit.unwrap_or(200).clamp(1, 2_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let ifc_type = query.ifc_type.map(|t| t.to_ascii_uppercase());

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM objects
          WHERE model_id = ?1
            AND (?2 IS NULL OR ifc_type = ?2)
            AND (?3 IS NULL OR storey = ?3)",
    )
    .bind(&model_id)
    .bind(&ifc_type)
    .bind(&query.storey)
    .fetch_one(&state.pool)
    .await?;

    let rows: Vec<ObjectRowDb> = sqlx::query_as(
        "SELECT id, model_id, express_id, global_id, ifc_type, name, predefined_type, storey,
                placement_json, fp_properties, fp_placement, fp_shape, fp_combined, ref_object_id
           FROM objects
          WHERE model_id = ?1
            AND (?2 IS NULL OR ifc_type = ?2)
            AND (?3 IS NULL OR storey = ?3)
          ORDER BY express_id LIMIT ?4 OFFSET ?5",
    )
    .bind(&model_id)
    .bind(&ifc_type)
    .bind(&query.storey)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ObjectPage {
        total,
        limit,
        offset,
        objects: rows.iter().map(object_row_json).collect(),
    }))
}

fn object_row_json(row: &ObjectRowDb) -> ObjectRowOut {
    ObjectRowOut {
        id: row.id.clone(),
        model_id: row.model_id.clone(),
        object_ref: ObjectRefOut {
            revision_id: row.model_id.clone(),
            object_id: row.ref_object_id.clone().unwrap_or_default(),
        },
        express_id: row.express_id,
        global_id: row.global_id.clone(),
        ifc_type: row.ifc_type.clone(),
        name: row.name.clone(),
        predefined_type: row.predefined_type.clone(),
        storey: row.storey.clone(),
        fingerprints: ObjectFingerprints {
            properties: row.fp_properties.clone(),
            placement: row.fp_placement.clone(),
            shape: row.fp_shape.clone(),
            combined: row.fp_combined.clone(),
        },
    }
}

async fn get_object(
    State(state): State<AppState>,
    Path(object_id): Path<String>,
) -> Result<Json<ObjectDetail>, ApiError> {
    let row: ObjectRowDb = sqlx::query_as(
        "SELECT id, model_id, express_id, global_id, ifc_type, name, predefined_type, storey,
                placement_json, fp_properties, fp_placement, fp_shape, fp_combined, ref_object_id
           FROM objects WHERE id = ?1",
    )
    .bind(&object_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("object"))?;

    let props: Vec<PropRow> = sqlx::query_as(
        "SELECT pset, name, value, data_type, unit, numeric, inherited, record_json FROM object_props
          WHERE object_id = ?1 ORDER BY pset, name",
    )
    .bind(&object_id)
    .fetch_all(&state.pool)
    .await?;

    let placement = row
        .placement_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<Vec<f64>>(json).ok());

    Ok(Json(ObjectDetail {
        row: object_row_json(&row),
        placement,
        properties: props.into_iter().map(object_property_from_row).collect(),
    }))
}

fn object_property_from_row(row: PropRow) -> ObjectProperty {
    if let Some(json) = row.record_json.as_deref() {
        if let Ok(property) = serde_json::from_str::<model_contracts::Property>(json) {
            return ObjectProperty {
                pset: property.pset.to_string(),
                name: property.name.to_string(),
                values: property
                    .values
                    .into_iter()
                    .map(|value| ObjectPropertyValue {
                        value: match value.value {
                            model_contracts::PropertyValueValue::String(text) => serde_json::Value::String(text),
                            model_contracts::PropertyValueValue::Number(number) => serde_json::json!(number),
                            model_contracts::PropertyValueValue::Boolean(flag) => serde_json::Value::Bool(flag),
                            model_contracts::PropertyValueValue::Null => serde_json::Value::Null,
                        },
                        original_unit: value.original_unit,
                        si_value: value.si_value,
                        dimension: value.dimension.map(|dim| dim.to_string()),
                    })
                    .collect(),
                ordered: property.ordered,
                origin: property.origin.to_string(),
            };
        }
    }
    ObjectProperty {
        pset: row.pset,
        name: row.name,
        values: vec![ObjectPropertyValue {
            value: row.value.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
            original_unit: row.unit,
            si_value: row.numeric,
            dimension: row.data_type,
        }],
        ordered: true,
        origin: if row.inherited != 0 {
            "type".to_owned()
        } else {
            "occurrence".to_owned()
        },
    }
}

async fn load_packs(state: &AppState, tenant_id: Option<&str>) -> Result<Vec<Pack>, ApiError> {
    let rows: Vec<PackRow> = match tenant_id {
        Some(tenant) => sqlx::query_as(
            "SELECT id, tenant_id, name, description, created_at FROM packs
              WHERE tenant_id = ?1 ORDER BY name",
        )
        .bind(tenant)
        .fetch_all(&state.pool)
        .await?,
        None => sqlx::query_as(
            "SELECT id, tenant_id, name, description, created_at FROM packs ORDER BY name",
        )
        .fetch_all(&state.pool)
        .await?,
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let versions: Vec<PackVersion> = sqlx::query_as::<_, PackVersionRow>(
            "SELECT pv.id, pv.pack_id, p.name AS pack_name, pv.version, pv.ids_xml,
                    pv.ids_sha256, pv.metadata_json, pv.notes, pv.spec_count, pv.created_at
               FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id
              WHERE pv.pack_id = ?1 ORDER BY pv.version",
        )
        .bind(&row.id)
        .fetch_all(&state.pool)
        .await?
        .iter()
        .map(pack_version_json)
        .collect();
        out.push(Pack {
            id: row.id,
            tenant_id: row.tenant_id,
            name: row.name,
            description: row.description,
            created_at: row.created_at,
            versions,
        });
    }
    Ok(out)
}

async fn list_packs(State(state): State<AppState>) -> Result<Json<Vec<Pack>>, ApiError> {
    Ok(Json(load_packs(&state, None).await?))
}

async fn create_pack_version(
    State(state): State<AppState>,
    Path(pack_id): Path<String>,
    Json(body): Json<CreatePackVersionBody>,
) -> Result<Json<PackVersion>, ApiError> {
    let pack: PackRow =
        sqlx::query_as("SELECT id, tenant_id, name, description, created_at FROM packs WHERE id = ?1")
            .bind(&pack_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::not_found("pack"))?;

    let spec_count = crate::ids_meta::validate_ids_with_ifctester(&body.ids_xml)
        .map_err(ApiError::parse_failed)?;
    let metadata_json = match body.metadata.as_ref() {
        None => None,
        Some(value) => {
            let text = value.to_string();
            crate::ids_meta::PackMetadata::try_parse(Some(&text)).map_err(ApiError::bad_request)?;
            Some(text)
        }
    };

    let row = insert_pack_version(
        &state,
        &pack_id,
        &body.ids_xml,
        metadata_json,
        body.notes.clone(),
        spec_count as i64,
    )
    .await?;
    let _ = pack;
    Ok(Json(row))
}

/// Allocate the next version number. Existing rows are never touched: a change to a pack
/// is a new version, so old runs keep meaning exactly what they meant.
pub async fn insert_pack_version(
    state: &AppState,
    pack_id: &str,
    ids_xml: &str,
    metadata_json: Option<String>,
    notes: Option<String>,
    spec_count: i64,
) -> Result<PackVersion, ApiError> {
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM pack_versions WHERE pack_id = ?1",
    )
    .bind(pack_id)
    .fetch_one(&state.pool)
    .await?;
    let id = new_id();
    let sha = sha256_hex(ids_xml.as_bytes());
    sqlx::query(
        "INSERT INTO pack_versions (id, pack_id, version, ids_xml, ids_sha256, metadata_json,
             notes, spec_count, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
    )
    .bind(&id)
    .bind(pack_id)
    .bind(next)
    .bind(ids_xml)
    .bind(&sha)
    .bind(&metadata_json)
    .bind(&notes)
    .bind(spec_count)
    .bind(now_iso())
    .execute(&state.pool)
    .await?;

    let row: PackVersionRow = sqlx::query_as(
        "SELECT pv.id, pv.pack_id, p.name AS pack_name, pv.version, pv.ids_xml, pv.ids_sha256,
                pv.metadata_json, pv.notes, pv.spec_count, pv.created_at
           FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id
          WHERE pv.id = ?1",
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;
    Ok(pack_version_json(&row))
}

async fn get_pack_version(
    State(state): State<AppState>,
    Path(pack_version_id): Path<String>,
) -> Result<Json<PackVersionDetail>, ApiError> {
    let row: PackVersionRow = sqlx::query_as(
        "SELECT pv.id, pv.pack_id, p.name AS pack_name, pv.version, pv.ids_xml, pv.ids_sha256,
                pv.metadata_json, pv.notes, pv.spec_count, pv.created_at
           FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id
          WHERE pv.id = ?1",
    )
    .bind(&pack_version_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("pack version"))?;

    let parsed = ids::Ids::parse(&row.ids_xml)
        .map_err(|err| ApiError::parse_failed(format!("stored IDS is invalid: {err}")))?;
    let metadata = crate::ids_meta::PackMetadata::parse(row.metadata_json.as_deref());

    let specs = parsed
        .specifications
        .iter()
        .map(|spec| {
            let triage = metadata.triage(spec.identifier.as_deref(), &spec.name);
            PackSpecInfo {
                identifier: spec.identifier.clone(),
                name: spec.name.clone(),
                description: spec.description.clone(),
                severity: triage.severity,
                category_id: triage.category_id,
                category_label: triage.category_label,
                ifc_versions: spec.ifc_versions.clone(),
                applicability: spec.applicability.iter().map(|f| f.describe()).collect(),
                requirements: spec.requirements.iter().map(|f| f.describe()).collect(),
            }
        })
        .collect();

    Ok(Json(PackVersionDetail {
        version: pack_version_json(&row),
        ids_xml: row.ids_xml.clone(),
        specs,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

async fn list_finding_objects(
    State(state): State<AppState>,
    Path(finding_id): Path<String>,
    Query(query): Query<PageQuery>,
) -> Result<Json<crate::dto::FindingObjectPage>, ApiError> {
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM finding_objects WHERE finding_id = ?1")
            .bind(&finding_id)
            .fetch_one(&state.pool)
            .await?;
    if total == 0 {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM findings WHERE id = ?1")
            .bind(&finding_id)
            .fetch_one(&state.pool)
            .await?;
        if exists == 0 {
            return Err(ApiError::not_found("finding"));
        }
    }
    let limit = query.limit.unwrap_or(100).clamp(1, 1_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let objects = finding_objects(&state.pool, &finding_id, limit, offset).await?;
    Ok(Json(crate::dto::FindingObjectPage { finding_id, total, limit, offset, objects }))
}
