//! Source models and their immutable revisions. A source model is a persistent,
//! named, project-owned input (e.g. "Architecture East"); discipline is metadata
//! for filtering, never part of its identity, which is why two source models may
//! share a discipline (docs/contracts/http-api.md).
//!
//! Uploading here never touches a delivery: a revision exists independently of any
//! delivery until `POST /api/deliveries/:deliveryId/members` (routes.rs) adds it as
//! a member. That split is what lets a second delivery reuse an unchanged revision
//! without re-uploading or re-parsing its bytes.
//!
//! Uploading itself only stores the bytes and enqueues a job (`jobs.rs`); parsing
//! through the authoritative worker and publishing the revision happens there,
//! asynchronously, once its output is fully validated.

use axum::extract::{Multipart, Path, State};
use axum::http::StatusCode;
use axum::Json;
use sqlx::SqlitePool;

use crate::db::{new_id, now_iso};
use crate::dto::{
    model_revision_summary_json, source_model_json, valid_discipline, CreateSourceModelBody,
    IngestionJob, ModelRevisionRow, ModelRevisionSummary, SourceModel, SourceModelRow,
};
use crate::error::ApiError;
use crate::state::AppState;
use crate::upload::sha256_hex;

pub async fn create_source_model(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateSourceModelBody>,
) -> Result<Json<SourceModel>, ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("source model name must not be empty"));
    }
    let discipline = body.discipline.to_ascii_uppercase();
    if !valid_discipline(&discipline) {
        return Err(ApiError::bad_request(format!(
            "unknown discipline `{discipline}`; expected ARCH, STRUCT, MEP or OTHER"
        )));
    }
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?1")
        .bind(&project_id)
        .fetch_one(&state.pool)
        .await?;
    if exists == 0 {
        return Err(ApiError::not_found("project"));
    }
    let duplicate: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM source_models WHERE project_id = ?1 AND name = ?2")
            .bind(&project_id)
            .bind(name)
            .fetch_one(&state.pool)
            .await?;
    if duplicate > 0 {
        return Err(ApiError::bad_request(format!(
            "project already has a source model named `{name}`"
        )));
    }

    let row = SourceModelRow {
        id: new_id(),
        project_id: project_id.clone(),
        name: name.to_owned(),
        discipline,
        created_at: now_iso(),
    };
    sqlx::query(
        "INSERT INTO source_models (id, project_id, name, discipline, created_at) VALUES (?1,?2,?3,?4,?5)",
    )
    .bind(&row.id)
    .bind(&row.project_id)
    .bind(&row.name)
    .bind(&row.discipline)
    .bind(&row.created_at)
    .execute(&state.pool)
    .await?;
    Ok(Json(source_model_json(row, Vec::new())))
}

pub async fn list_source_models(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<SourceModel>>, ApiError> {
    Ok(Json(load_source_models(&state, &project_id).await?))
}

pub(crate) async fn load_source_models(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<SourceModel>, ApiError> {
    let rows: Vec<SourceModelRow> = sqlx::query_as(
        "SELECT id, project_id, name, discipline, created_at FROM source_models
          WHERE project_id = ?1 ORDER BY discipline, name",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let revisions = load_revisions(&state.pool, &row.id).await?;
        out.push(source_model_json(row, revisions));
    }
    Ok(out)
}

async fn load_revisions(pool: &SqlitePool, source_model_id: &str) -> Result<Vec<ModelRevisionSummary>, ApiError> {
    let rows: Vec<ModelRevisionRow> = sqlx::query_as(&format!(
        "{} WHERE source_model_id = ?1 ORDER BY uploaded_at DESC",
        crate::dto::MODEL_REVISION_SELECT
    ))
    .bind(source_model_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(model_revision_summary_json).collect())
}

/// Stores the uploaded bytes (content-addressed) and enqueues an ingestion job;
/// returns 202 immediately with the job reference. Parsing through the
/// authoritative worker and publishing the revision happens in `jobs.rs`,
/// asynchronously — the client polls `GET /api/jobs/:jobId` until it is ready.
pub async fn upload_revision(
    State(state): State<AppState>,
    Path(source_model_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<IngestionJob>), ApiError> {
    let mut filename: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| ApiError::bad_request(format!("malformed multipart upload: {err}")))?
    {
        if field.name() == Some("file") {
            filename = field.file_name().map(str::to_owned);
            bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|err| ApiError::bad_request(format!("cannot read uploaded file: {err}")))?
                    .to_vec(),
            );
        }
    }
    let bytes = bytes.ok_or_else(|| ApiError::bad_request("no `file` part in the upload"))?;
    let filename = filename.unwrap_or_else(|| "upload.ifc".to_owned());

    let source_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM source_models WHERE id = ?1")
        .bind(&source_model_id)
        .fetch_one(&state.pool)
        .await?;
    if source_exists == 0 {
        return Err(ApiError::not_found("source model"));
    }

    let sha256 = sha256_hex(&bytes);
    let byte_size = bytes.len() as i64;

    // Content-addressed: an identical re-upload (even under a different source
    // model or filename) reuses the stored bytes rather than writing them twice.
    let blob_path = state.blob_path(&sha256);
    if tokio::fs::metadata(&blob_path).await.is_err() {
        tokio::fs::write(&blob_path, &bytes)
            .await
            .map_err(|err| ApiError::internal(format!("cannot write blob: {err}")))?;
    }

    let storage_path = format!("blobs/{sha256}");
    crate::jobs::enqueue_upload(&state, &source_model_id, &filename, sha256, byte_size, storage_path).await
}
