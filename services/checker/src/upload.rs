//! Model ingestion: hash, store, parse, fingerprint, persist.
//!
//! A model drop is immutable evidence. The bytes are stored content-addressed under their
//! SHA-256, and every derived row (objects, properties, fingerprints) is written in one
//! transaction so a partially-ingested drop can never be scored.

use axum::extract::{Multipart, Path, State};
use axum::Json;
use fingerprint::{FpOptions, ObjectSnapshot};
use ifc_model::IfcModel;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::db::{new_id, now_iso};
use crate::dto::{model_json, valid_discipline, DeliveryRow, ModelInfo, ModelRow};
use crate::error::ApiError;
use crate::state::AppState;

/// Rows per multi-row INSERT. A 44k-instance model yields thousands of objects and tens
/// of thousands of property rows; one statement per row would dominate ingest time.
const INSERT_CHUNK: usize = 128;

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub async fn upload_model(
    State(state): State<AppState>,
    Path(delivery_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<ModelInfo>, ApiError> {
    let mut discipline: Option<String> = None;
    let mut filename: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(|err| {
        ApiError::bad_request(format!("malformed multipart upload: {err}"))
    })? {
        match field.name().unwrap_or_default() {
            "discipline" => {
                discipline = Some(field.text().await.map_err(|err| {
                    ApiError::bad_request(format!("cannot read discipline: {err}"))
                })?);
            }
            "file" => {
                filename = field.file_name().map(str::to_owned);
                bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|err| {
                            ApiError::bad_request(format!("cannot read uploaded file: {err}"))
                        })?
                        .to_vec(),
                );
            }
            _ => {}
        }
    }

    let discipline = discipline.unwrap_or_else(|| "ARCH".to_owned()).to_ascii_uppercase();
    let bytes = bytes.ok_or_else(|| ApiError::bad_request("no `file` part in the upload"))?;
    let filename = filename.unwrap_or_else(|| "upload.ifc".to_owned());

    let row = store_model(&state, &delivery_id, &discipline, &filename, bytes).await?;
    Ok(Json(model_json(&row)))
}

/// Ingest one IFC file into a delivery. Shared by the HTTP upload and the seeder.
pub async fn store_model(
    state: &AppState,
    delivery_id: &str,
    discipline: &str,
    filename: &str,
    bytes: Vec<u8>,
) -> Result<ModelRow, ApiError> {
    if !valid_discipline(discipline) {
        return Err(ApiError::bad_request(format!(
            "unknown discipline `{discipline}`; expected ARCH, STRUCT, MEP or OTHER"
        )));
    }
    let _delivery: DeliveryRow =
        sqlx::query_as("SELECT id, project_id, label, delivery_date, created_at FROM deliveries WHERE id = ?1")
            .bind(delivery_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::not_found("delivery"))?;

    // A delivery that has been scored is frozen: a new drop needs a new delivery, or the
    // run's evidence would no longer describe what was checked.
    let completed_runs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM runs WHERE delivery_id = ?1 AND status = 'completed'",
    )
    .bind(delivery_id)
    .fetch_one(&state.pool)
    .await?;
    if completed_runs > 0 {
        return Err(ApiError::delivery_locked());
    }

    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM models WHERE delivery_id = ?1 AND discipline = ?2",
    )
    .bind(delivery_id)
    .bind(discipline)
    .fetch_one(&state.pool)
    .await?;
    if existing > 0 {
        return Err(ApiError::duplicate_discipline(discipline));
    }

    let sha256 = sha256_hex(&bytes);
    let byte_size = bytes.len() as i64;

    let started = std::time::Instant::now();
    let model = IfcModel::parse(&bytes)
        .map_err(|err| ApiError::parse_failed(format!("{filename}: {err}")))?;
    let snapshots = fingerprint::snapshot_model(&model, &FpOptions::default());
    let parse_ms = started.elapsed().as_millis() as i64;

    // Content-addressed: an identical re-upload reuses the stored bytes.
    let blob_path = state.blob_path(&sha256);
    if tokio::fs::metadata(&blob_path).await.is_err() {
        tokio::fs::write(&blob_path, &bytes)
            .await
            .map_err(|err| ApiError::internal(format!("cannot write blob: {err}")))?;
    }

    let header_json = serde_json::json!({
        "fileName": model.header().file_name,
        "timeStamp": model.header().time_stamp,
        "authors": model.header().authors,
        "organizations": model.header().organizations,
        "preprocessorVersion": model.header().preprocessor_version,
        "originatingSystem": model.header().originating_system,
        "schemaTokens": model.header().schema_tokens,
        "fileDescription": model.header().file_description,
    });

    let model_id = new_id();
    let row = ModelRow {
        id: model_id.clone(),
        delivery_id: delivery_id.to_owned(),
        discipline: discipline.to_owned(),
        filename: filename.to_owned(),
        content_sha256: sha256.clone(),
        byte_size,
        schema_label: model.schema().label(),
        entity_count: model.entity_count() as i64,
        product_count: snapshots.len() as i64,
        length_to_metre: model.length_to_metre(),
        storage_path: format!("blobs/{sha256}"),
        header_json: Some(header_json.to_string()),
        parse_ms: Some(parse_ms),
        uploaded_at: now_iso(),
    };

    persist_model(&state.pool, &row, &snapshots).await?;
    Ok(row)
}

async fn persist_model(
    pool: &SqlitePool,
    row: &ModelRow,
    snapshots: &[ObjectSnapshot],
) -> Result<(), ApiError> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO models (id, delivery_id, discipline, filename, content_sha256, byte_size,
             schema_label, entity_count, product_count, length_to_metre, storage_path,
             header_json, parse_ms, uploaded_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
    )
    .bind(&row.id)
    .bind(&row.delivery_id)
    .bind(&row.discipline)
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
    .execute(&mut *tx)
    .await?;

    let object_ids: Vec<String> = snapshots.iter().map(|_| new_id()).collect();

    for chunk in snapshots.chunks(INSERT_CHUNK).zip(object_ids.chunks(INSERT_CHUNK)) {
        let (objects, ids) = chunk;
        let placeholders: Vec<String> = (0..objects.len())
            .map(|i| {
                let base = i * 13;
                format!(
                    "(?{},?{},?{},?{},?{},?{},?{},?{},?{},?{},?{},?{},?{})",
                    base + 1,
                    base + 2,
                    base + 3,
                    base + 4,
                    base + 5,
                    base + 6,
                    base + 7,
                    base + 8,
                    base + 9,
                    base + 10,
                    base + 11,
                    base + 12,
                    base + 13
                )
            })
            .collect();
        let sql = format!(
            "INSERT INTO objects (id, model_id, express_id, global_id, ifc_type, name,
                 predefined_type, storey, placement_json, fp_properties, fp_placement,
                 fp_shape, fp_combined) VALUES {}",
            placeholders.join(",")
        );
        let mut query = sqlx::query(&sql);
        for (object, id) in objects.iter().zip(ids.iter()) {
            let placement_json = object
                .placement
                .map(|values| serde_json::to_string(&values).unwrap_or_default());
            query = query
                .bind(id)
                .bind(&row.id)
                .bind(object.express_id as i64)
                .bind(object.global_id.clone())
                .bind(object.ifc_type.clone())
                .bind(object.name.clone())
                .bind(object.predefined_type.clone())
                .bind(object.storey.clone())
                .bind(placement_json)
                .bind(object.fingerprints.properties.clone())
                .bind(object.fingerprints.placement.clone())
                .bind(object.fingerprints.shape.clone())
                .bind(object.fingerprints.combined.clone());
        }
        query.execute(&mut *tx).await?;
    }

    // Flatten (object, property) pairs, then chunk: property counts vary wildly per object.
    let mut props: Vec<(&str, &fingerprint::PropSnapshot)> = Vec::new();
    for (object, id) in snapshots.iter().zip(object_ids.iter()) {
        for prop in &object.properties {
            props.push((id.as_str(), prop));
        }
    }
    for chunk in props.chunks(INSERT_CHUNK) {
        let placeholders: Vec<String> = (0..chunk.len())
            .map(|i| {
                let base = i * 8;
                format!(
                    "(?{},?{},?{},?{},?{},?{},?{},?{})",
                    base + 1,
                    base + 2,
                    base + 3,
                    base + 4,
                    base + 5,
                    base + 6,
                    base + 7,
                    base + 8
                )
            })
            .collect();
        let sql = format!(
            "INSERT INTO object_props (object_id, pset, name, value, data_type, unit, numeric, inherited)
             VALUES {}",
            placeholders.join(",")
        );
        let mut query = sqlx::query(&sql);
        for (object_id, prop) in chunk {
            query = query
                .bind(*object_id)
                .bind(prop.pset.clone())
                .bind(prop.name.clone())
                .bind(prop.value.clone())
                .bind(prop.data_type.clone())
                .bind(prop.unit.clone())
                .bind(prop.numeric)
                .bind(i64::from(prop.inherited));
        }
        query.execute(&mut *tx).await?;
    }

    tx.commit().await?;
    Ok(())
}
