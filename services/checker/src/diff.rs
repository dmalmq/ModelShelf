//! Revision comparison endpoints.
//!
//! Snapshots are rebuilt from the stored `objects`/`object_props` rows rather than by
//! re-parsing IFC: the fingerprints were computed at ingest time and are the evidence.
//! Model pairs are matched by discipline slot, which is what makes "the services model was
//! updated, the architectural one was not" expressible.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::Json;
use fingerprint::{Fingerprints, ObjectSnapshot, PropSnapshot};
use modeldiff::{ChangeKind, DiffOptions, MatchConfidence};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::dto::{
    delivery_json, run_summary, DeliveryRow, DiffSummaryOut, FindingChangeOut,
    FindingDiffResponse, MatchConfidenceOut, ModelDiffResponse, ModelPairDiffOut, ModelRow,
    ObjectChangeOut, ObjectChangeRefOut, ObjectRowDb, PropertyChangeOut,
};
use crate::error::ApiError;
use crate::run::{fetch_run_row, run_counts};
use crate::state::AppState;

const DEFAULT_LIMIT: i64 = 200;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDiffQuery {
    pub base_delivery_id: String,
    pub head_delivery_id: String,
    /// Optional change-kind filter, e.g. `moved` or `properties_changed`.
    pub kind: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDiffQuery {
    pub base_run_id: String,
    pub head_run_id: String,
}

pub async fn diff_models(
    State(state): State<AppState>,
    Query(query): Query<ModelDiffQuery>,
) -> Result<Json<ModelDiffResponse>, ApiError> {
    let base = load_delivery(&state.pool, &query.base_delivery_id).await?;
    let head = load_delivery(&state.pool, &query.head_delivery_id).await?;
    let base_models = load_models(&state.pool, &base.id).await?;
    let head_models = load_models(&state.pool, &head.id).await?;

    let mut disciplines: Vec<String> = base_models
        .iter()
        .chain(head_models.iter())
        .map(|m| m.discipline.clone())
        .collect();
    disciplines.sort();
    disciplines.dedup();

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 5_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let options = DiffOptions::default();

    let mut pairs = Vec::new();
    for discipline in disciplines {
        let base_model = base_models.iter().find(|m| m.discipline == discipline);
        let head_model = head_models.iter().find(|m| m.discipline == discipline);
        let base_snapshots = match base_model {
            Some(model) => load_snapshots(&state.pool, &model.id).await?,
            None => Vec::new(),
        };
        let head_snapshots = match head_model {
            Some(model) => load_snapshots(&state.pool, &model.id).await?,
            None => Vec::new(),
        };
        let result = modeldiff::diff(&base_snapshots, &head_snapshots, &options);

        let filtered: Vec<&modeldiff::ObjectChange> = result
            .changes
            .iter()
            .filter(|change| match query.kind.as_deref() {
                None | Some("") | Some("all") => true,
                Some(kind) => kind_str(change.kind) == kind,
            })
            .collect();
        let total = filtered.len() as i64;
        let page: Vec<ObjectChangeOut> = filtered
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(change_json)
            .collect();

        pairs.push(ModelPairDiffOut {
            discipline,
            base_model_id: base_model.map(|m| m.id.clone()),
            head_model_id: head_model.map(|m| m.id.clone()),
            base_filename: base_model.map(|m| m.filename.clone()),
            head_filename: head_model.map(|m| m.filename.clone()),
            summary: DiffSummaryOut {
                added: result.summary.added as i64,
                removed: result.summary.removed as i64,
                unchanged: result.summary.unchanged as i64,
                moved: result.summary.moved as i64,
                shape_changed: result.summary.shape_changed as i64,
                properties_changed: result.summary.properties_changed as i64,
                mixed: result.summary.mixed as i64,
                uncertain_matches: result.summary.uncertain_matches as i64,
            },
            total,
            changes: page,
        });
    }

    Ok(Json(ModelDiffResponse {
        base: delivery_json(&state.pool, &base).await?,
        head: delivery_json(&state.pool, &head).await?,
        pairs,
    }))
}

pub async fn diff_runs(
    State(state): State<AppState>,
    Query(query): Query<RunDiffQuery>,
) -> Result<Json<FindingDiffResponse>, ApiError> {
    let base = fetch_run_row(&state.pool, &query.base_run_id).await?;
    let head = fetch_run_row(&state.pool, &query.head_run_id).await?;
    // Comparing findings across pack versions would report a newly added rule as a
    // regression in the model. Refuse instead of misleading the reader.
    if base.pack_version_id != head.pack_version_id {
        return Err(ApiError::pack_version_mismatch());
    }

    let base_findings = load_finding_keys(&state.pool, &base.id).await?;
    let head_findings = load_finding_keys(&state.pool, &head.id).await?;

    let base_input: Vec<(String, Vec<String>)> = base_findings
        .iter()
        .map(|(key, entry)| (key.clone(), entry.global_ids.clone()))
        .collect();
    let head_input: Vec<(String, Vec<String>)> = head_findings
        .iter()
        .map(|(key, entry)| (key.clone(), entry.global_ids.clone()))
        .collect();
    let result = modeldiff::diff_findings(&base_input, &head_input);

    let changes = result
        .changes
        .into_iter()
        .map(|change| {
            // Prefer the head run's metadata; resolved findings only exist in the base.
            let meta = head_findings
                .get(&change.finding_key)
                .or_else(|| base_findings.get(&change.finding_key));
            FindingChangeOut {
                finding_key: change.finding_key,
                delta: match change.delta {
                    modeldiff::FindingDelta::Resolved => "resolved".to_owned(),
                    modeldiff::FindingDelta::Introduced => "introduced".to_owned(),
                    modeldiff::FindingDelta::Persisting => "persisting".to_owned(),
                },
                title: meta.map(|m| m.title.clone()).unwrap_or_default(),
                severity: meta
                    .map(|m| m.severity.clone())
                    .unwrap_or_else(|| crate::ids_meta::DEFAULT_SEVERITY.to_owned()),
                category_id: meta
                    .map(|m| m.category_id.clone())
                    .unwrap_or_else(|| crate::ids_meta::DEFAULT_CATEGORY_ID.to_owned()),
                category_label: meta
                    .map(|m| m.category_label.clone())
                    .unwrap_or_else(|| crate::ids_meta::DEFAULT_CATEGORY_LABEL.to_owned()),
                base_object_count: change.base_object_count as i64,
                head_object_count: change.head_object_count as i64,
                introduced_objects: change.introduced_objects,
                resolved_objects: change.resolved_objects,
            }
        })
        .collect();

    let (base_findings_count, base_objects) = run_counts(&state.pool, &base.id).await?;
    let (head_findings_count, head_objects) = run_counts(&state.pool, &head.id).await?;

    Ok(Json(FindingDiffResponse {
        base_run: run_summary(&base, base_findings_count, base_objects),
        head_run: run_summary(&head, head_findings_count, head_objects),
        resolved: result.resolved as i64,
        introduced: result.introduced as i64,
        persisting: result.persisting as i64,
        changes,
    }))
}

struct FindingMeta {
    title: String,
    severity: String,
    category_id: String,
    category_label: String,
    global_ids: Vec<String>,
}

async fn load_finding_keys(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<HashMap<String, FindingMeta>, ApiError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        finding_key: String,
        title: String,
        severity: String,
        category_id: String,
        category_label: String,
        global_ids: Option<String>,
    }
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT f.finding_key, f.title, f.severity, f.category_id, f.category_label,
                GROUP_CONCAT(COALESCE(fo.global_id, 'express:' || fo.express_id), char(31))
                    AS global_ids
           FROM findings f
           LEFT JOIN finding_objects fo ON fo.finding_id = f.id
          WHERE f.run_id = ?1
          GROUP BY f.id",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let global_ids = row
                .global_ids
                .map(|joined| {
                    joined.split('\u{1f}').filter(|s| !s.is_empty()).map(str::to_owned).collect()
                })
                .unwrap_or_default();
            (
                row.finding_key,
                FindingMeta {
                    title: row.title,
                    severity: row.severity,
                    category_id: row.category_id,
                    category_label: row.category_label,
                    global_ids,
                },
            )
        })
        .collect())
}

pub async fn load_delivery(pool: &SqlitePool, id: &str) -> Result<DeliveryRow, ApiError> {
    sqlx::query_as(
        "SELECT id, project_id, label, delivery_date, created_at FROM deliveries WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("delivery"))
}

pub async fn load_models(pool: &SqlitePool, delivery_id: &str) -> Result<Vec<ModelRow>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT id, delivery_id, discipline, filename, content_sha256, byte_size, schema_label,
                entity_count, product_count, length_to_metre, storage_path, header_json,
                parse_ms, uploaded_at
           FROM models WHERE delivery_id = ?1 ORDER BY discipline",
    )
    .bind(delivery_id)
    .fetch_all(pool)
    .await?)
}

/// Rebuild `ObjectSnapshot` values from persisted rows.
async fn load_snapshots(
    pool: &SqlitePool,
    model_id: &str,
) -> Result<Vec<ObjectSnapshot>, ApiError> {
    let objects: Vec<ObjectRowDb> = sqlx::query_as(
        "SELECT id, model_id, express_id, global_id, ifc_type, name, predefined_type, storey,
                placement_json, fp_properties, fp_placement, fp_shape, fp_combined
           FROM objects WHERE model_id = ?1 ORDER BY express_id",
    )
    .bind(model_id)
    .fetch_all(pool)
    .await?;

    #[derive(sqlx::FromRow)]
    struct PropWithObject {
        object_id: String,
        pset: String,
        name: String,
        value: Option<String>,
        data_type: Option<String>,
        unit: Option<String>,
        numeric: Option<f64>,
        inherited: i64,
    }
    let props: Vec<PropWithObject> = sqlx::query_as(
        "SELECT p.object_id, p.pset, p.name, p.value, p.data_type, p.unit, p.numeric, p.inherited
           FROM object_props p JOIN objects o ON o.id = p.object_id
          WHERE o.model_id = ?1
          ORDER BY p.pset, p.name",
    )
    .bind(model_id)
    .fetch_all(pool)
    .await?;

    let mut by_object: HashMap<String, Vec<PropSnapshot>> = HashMap::new();
    for prop in props {
        by_object.entry(prop.object_id).or_default().push(PropSnapshot {
            pset: prop.pset,
            name: prop.name,
            value: prop.value.unwrap_or_default(),
            data_type: prop.data_type,
            unit: prop.unit,
            numeric: prop.numeric,
            inherited: prop.inherited != 0,
        });
    }

    Ok(objects
        .into_iter()
        .map(|row| {
            let placement = row
                .placement_json
                .as_deref()
                .and_then(|json| serde_json::from_str::<Vec<f64>>(json).ok())
                .and_then(|values| <[f64; 12]>::try_from(values).ok());
            ObjectSnapshot {
                express_id: row.express_id as u32,
                global_id: row.global_id,
                ifc_type: row.ifc_type,
                name: row.name,
                predefined_type: row.predefined_type,
                storey: row.storey,
                placement,
                fingerprints: Fingerprints {
                    properties: row.fp_properties,
                    placement: row.fp_placement,
                    shape: row.fp_shape,
                    combined: row.fp_combined,
                },
                properties: by_object.remove(&row.id).unwrap_or_default(),
            }
        })
        .collect())
}

pub fn kind_str(kind: ChangeKind) -> &'static str {
    match kind {
        ChangeKind::Added => "added",
        ChangeKind::Removed => "removed",
        ChangeKind::Unchanged => "unchanged",
        ChangeKind::Moved => "moved",
        ChangeKind::ShapeChanged => "shape_changed",
        ChangeKind::PropertiesChanged => "properties_changed",
        ChangeKind::Mixed => "mixed",
    }
}

fn change_json(change: &modeldiff::ObjectChange) -> ObjectChangeOut {
    ObjectChangeOut {
        kind: kind_str(change.kind).to_owned(),
        confidence: match &change.confidence {
            MatchConfidence::Exact => MatchConfidenceOut::Exact,
            MatchConfidence::Heuristic { score, basis } => {
                MatchConfidenceOut::Heuristic { score: *score, basis: basis.clone() }
            }
            MatchConfidence::None => MatchConfidenceOut::None,
        },
        base: change.base.as_ref().map(object_ref_json),
        head: change.head.as_ref().map(object_ref_json),
        property_changes: change
            .property_changes
            .iter()
            .map(|p| PropertyChangeOut {
                pset: p.pset.clone(),
                name: p.name.clone(),
                base: p.base.clone(),
                head: p.head.clone(),
            })
            .collect(),
        moved_distance_m: change.moved_distance_m,
        notes: change.notes.clone(),
    }
}

fn object_ref_json(reference: &modeldiff::ObjectRef) -> ObjectChangeRefOut {
    ObjectChangeRefOut {
        express_id: reference.express_id as i64,
        global_id: reference.global_id.clone(),
        ifc_type: reference.ifc_type.clone(),
        name: reference.name.clone(),
        storey: reference.storey.clone(),
    }
}
