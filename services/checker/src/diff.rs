//! Revision comparison endpoints.
//!
//! Snapshots are rebuilt from the stored `objects`/`object_props` rows rather than by
//! re-parsing IFC: the fingerprints were computed at ingest time and are the evidence.
//! Delivery members pair by persistent `source_model_id`, never by discipline, so two
//! same-discipline sources in one delivery compare strictly within their own source.

use std::collections::{BTreeMap, HashMap};

use axum::extract::{Query, State};
use axum::Json;
use fingerprint::normalized::{DerivedSnapshot, FingerprintProfile, Fingerprints};
use modeldiff::{ChangeKind, MatchConfidence, MatchPolicy};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::dto::{
    delivery_json, run_summary, DeliveryRow, DiffSummaryOut, FindingChangeOut,
    FindingDiffResponse, MatchConfidenceOut, ModelDiffResponse, ModelPairDiffOut, ModelRow,
    ObjectChangeOut, ObjectChangeRefOut, ObjectRowDb, PropertyChangeOut, DELIVERY_MODEL_ROW_SELECT,
    DELIVERY_SELECT,
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

/// Pairs base/head revisions by `source_model_id` — never by discipline, so two
/// same-discipline sources in one delivery can never cross-match. For each source:
/// - present on both sides with the same revision id: short-circuit pair with no
///   comparison, zeroed summary, and `reusedRevision: true` (no snapshot load);
/// - present on both sides with different revisions: full `modeldiff::compare`
///   under the default policy, where a profile mismatch becomes a 409
///   `fingerprint_profile_mismatch`;
/// - present on one side only: pure additions/removals without calling `compare`.
pub async fn diff_models(
    State(state): State<AppState>,
    Query(query): Query<ModelDiffQuery>,
) -> Result<Json<ModelDiffResponse>, ApiError> {
    let base = load_delivery(&state.pool, &query.base_delivery_id).await?;
    let head = load_delivery(&state.pool, &query.head_delivery_id).await?;
    let base_models = load_models(&state.pool, &base.id).await?;
    let head_models = load_models(&state.pool, &head.id).await?;

    let mut base_by_source: BTreeMap<&str, &ModelRow> = BTreeMap::new();
    for model in &base_models {
        base_by_source.insert(model.source_model_id.as_str(), model);
    }
    let mut head_by_source: BTreeMap<&str, &ModelRow> = BTreeMap::new();
    for model in &head_models {
        head_by_source.insert(model.source_model_id.as_str(), model);
    }
    let mut source_ids: Vec<&str> =
        base_by_source.keys().chain(head_by_source.keys()).copied().collect();
    source_ids.sort();
    source_ids.dedup();

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 5_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let policy = MatchPolicy::default();

    let mut pairs = Vec::with_capacity(source_ids.len());
    for source_id in source_ids {
        pairs.push(
            diff_source_pair(
                &state.pool,
                base_by_source.get(source_id).copied(),
                head_by_source.get(source_id).copied(),
                &query.kind,
                &policy,
                limit,
                offset,
            )
            .await?,
        );
    }
    pairs.sort_by(|a: &ModelPairDiffOut, b: &ModelPairDiffOut| {
        a.source_model_name.cmp(&b.source_model_name).then(a.source_model_id.cmp(&b.source_model_id))
    });

    Ok(Json(ModelDiffResponse {
        base: delivery_json(&state.pool, &base).await?,
        head: delivery_json(&state.pool, &head).await?,
        pairs,
    }))
}

async fn diff_source_pair(
    pool: &SqlitePool,
    base_model: Option<&ModelRow>,
    head_model: Option<&ModelRow>,
    kind_filter: &Option<String>,
    policy: &MatchPolicy,
    limit: i64,
    offset: i64,
) -> Result<ModelPairDiffOut, ApiError> {
    let representative =
        base_model.or(head_model).expect("a pair always has at least one side");
    let (discipline, source_model_id, source_model_name) = (
        representative.discipline.clone(),
        representative.source_model_id.clone(),
        representative.source_model_name.clone(),
    );
    let base_model_id = base_model.map(|m| m.id.clone());
    let head_model_id = head_model.map(|m| m.id.clone());
    let base_filename = base_model.map(|m| m.filename.clone());
    let head_filename = head_model.map(|m| m.filename.clone());

    if let (Some(base), Some(head)) = (base_model, head_model) {
        if base.id == head.id {
            return Ok(ModelPairDiffOut {
                discipline,
                source_model_id,
                source_model_name,
                reused_revision: true,
                base_model_id,
                head_model_id,
                base_filename,
                head_filename,
                summary: zero_summary(),
                total: 0,
                changes: Vec::new(),
            });
        }
    }

    let (summary, changes) = match (base_model, head_model) {
        (Some(base), Some(head)) => {
            let base_objects = load_diff_objects(pool, &base.id).await?;
            let head_objects = load_diff_objects(pool, &head.id).await?;
            let result = modeldiff::compare(&base_objects, &head_objects, policy).map_err(|mismatch| {
                ApiError::fingerprint_profile_mismatch(&mismatch.expected, &mismatch.actual)
            })?;
            (summary_json(&result.summary), result.changes)
        }
        (Some(base), None) => {
            let objects = load_diff_objects(pool, &base.id).await?;
            (removed_summary(objects.len() as u32), removed_changes(&objects))
        }
        (None, Some(head)) => {
            let objects = load_diff_objects(pool, &head.id).await?;
            (added_summary(objects.len() as u32), added_changes(&objects))
        }
        (None, None) => unreachable!("a pair always has at least one side"),
    };

    let filtered: Vec<&modeldiff::ObjectChange> = changes
        .iter()
        .filter(|change| match kind_filter.as_deref() {
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

    Ok(ModelPairDiffOut {
        discipline,
        source_model_id,
        source_model_name,
        reused_revision: false,
        base_model_id,
        head_model_id,
        base_filename,
        head_filename,
        summary,
        total,
        changes: page,
    })
}

fn zero_summary() -> DiffSummaryOut {
    DiffSummaryOut {
        added: 0,
        removed: 0,
        unchanged: 0,
        moved: 0,
        shape_changed: 0,
        properties_changed: 0,
        mixed: 0,
        uncertain_matches: 0,
    }
}

fn summary_json(summary: &modeldiff::DiffSummary) -> DiffSummaryOut {
    DiffSummaryOut {
        added: summary.added as i64,
        removed: summary.removed as i64,
        unchanged: summary.unchanged as i64,
        moved: summary.moved as i64,
        shape_changed: summary.shape_changed as i64,
        properties_changed: summary.properties_changed as i64,
        mixed: summary.mixed as i64,
        uncertain_matches: summary.uncertain_matches as i64,
    }
}

fn added_summary(count: u32) -> DiffSummaryOut {
    DiffSummaryOut { added: count as i64, ..zero_summary() }
}

fn removed_summary(count: u32) -> DiffSummaryOut {
    DiffSummaryOut { removed: count as i64, ..zero_summary() }
}

/// One-sided head member: every object is a pure addition. Deterministic order
/// (type, then express id) matching `compare`'s presentation order for a
/// single-kind page.
fn added_changes(objects: &[modeldiff::DiffObject]) -> Vec<modeldiff::ObjectChange> {
    let mut changes: Vec<modeldiff::ObjectChange> = objects
        .iter()
        .map(|object| modeldiff::ObjectChange {
            kind: ChangeKind::Added,
            confidence: MatchConfidence::None,
            base: None,
            head: Some(side_ref(object)),
            property_changes: Vec::new(),
            moved_distance_m: None,
            notes: Vec::new(),
        })
        .collect();
    changes.sort_by(|a, b| {
        side_sort_key(a.head.as_ref()).cmp(&side_sort_key(b.head.as_ref()))
    });
    changes
}

fn removed_changes(objects: &[modeldiff::DiffObject]) -> Vec<modeldiff::ObjectChange> {
    let mut changes: Vec<modeldiff::ObjectChange> = objects
        .iter()
        .map(|object| modeldiff::ObjectChange {
            kind: ChangeKind::Removed,
            confidence: MatchConfidence::None,
            base: Some(side_ref(object)),
            head: None,
            property_changes: Vec::new(),
            moved_distance_m: None,
            notes: Vec::new(),
        })
        .collect();
    changes.sort_by(|a, b| {
        side_sort_key(a.base.as_ref()).cmp(&side_sort_key(b.base.as_ref()))
    });
    changes
}

fn side_ref(object: &modeldiff::DiffObject) -> modeldiff::ObjectRef {
    modeldiff::ObjectRef {
        revision_id: object.id.revision_id.clone(),
        object_id: object.id.object_id.clone(),
        express_id: object.id.express_id,
        global_id: object.id.global_id.clone(),
        ifc_type: object.id.ifc_type.clone(),
        name: object.id.name.clone(),
        storey: object.id.storey.clone(),
    }
}

fn side_sort_key(reference: Option<&modeldiff::ObjectRef>) -> (&str, u32) {
    let reference = reference.expect("a one-sided change always has its side");
    (reference.ifc_type.as_str(), reference.express_id)
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
    sqlx::query_as(&format!("{DELIVERY_SELECT} WHERE id = ?1"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("delivery"))
}

/// The one place "which models are in this delivery" is queried; `run.rs::create_run`
/// calls this too rather than keeping its own copy. Two source models sharing a
/// discipline both appear here, one `ModelRow` each; `diff_models` above pairs them
/// by `source_model_id`, so same-discipline sources never cross-match.
pub async fn load_models(pool: &SqlitePool, delivery_id: &str) -> Result<Vec<ModelRow>, ApiError> {
    Ok(sqlx::query_as(&format!("{DELIVERY_MODEL_ROW_SELECT} WHERE dm.delivery_id = ?1 ORDER BY sm.discipline, sm.name"))
        .bind(delivery_id)
        .fetch_all(pool)
        .await?)
}

/// Rebuild `DiffObject` values from persisted rows: the ingest-time fingerprint
/// evidence plus the identity loaded beside it.
///
/// A row with NULL `profile_id` predates normalized fingerprints and has no
/// trustworthy snapshot: this returns `fingerprint_profile_mismatch` rather than
/// fabricating one. `origin_m` reads the translation column (indices 3, 7, 11)
/// of the stored row-major 3x4 placement in metres
/// (`docs/contracts/worker-v1.md`); an unparseable placement yields `None`.
async fn load_diff_objects(
    pool: &SqlitePool,
    model_id: &str,
) -> Result<Vec<modeldiff::DiffObject>, ApiError> {
    let objects: Vec<ObjectRowDb> = sqlx::query_as(
        "SELECT id, model_id, express_id, global_id, ifc_type, name, predefined_type, storey,
                placement_json, fp_properties, fp_placement, fp_shape, fp_combined,
                ref_object_id, profile_version, profile_id,
                canonical_properties, canonical_placement, canonical_shape
           FROM objects WHERE model_id = ?1 ORDER BY express_id",
    )
    .bind(model_id)
    .fetch_all(pool)
    .await?;

    #[derive(sqlx::FromRow)]
    struct PropValue {
        object_id: String,
        pset: String,
        name: String,
        value: Option<String>,
    }
    let props: Vec<PropValue> = sqlx::query_as(
        "SELECT p.object_id, p.pset, p.name, p.value
           FROM object_props p JOIN objects o ON o.id = p.object_id
          WHERE o.model_id = ?1
          ORDER BY p.pset, p.name",
    )
    .bind(model_id)
    .fetch_all(pool)
    .await?;

    let mut by_object: HashMap<String, Vec<modeldiff::PropRow>> = HashMap::new();
    for prop in props {
        by_object.entry(prop.object_id).or_default().push(modeldiff::PropRow {
            pset: prop.pset,
            name: prop.name,
            value: prop.value.unwrap_or_default(),
        });
    }

    let current_profile = FingerprintProfile::v1().profile_id();
    let mut out = Vec::with_capacity(objects.len());
    for row in objects {
        let (Some(profile_id), Some(ref_object_id)) =
            (row.profile_id.clone(), row.ref_object_id.clone())
        else {
            return Err(ApiError::fingerprint_profile_mismatch(
                &current_profile,
                "legacy (no profile — ingested before normalized fingerprints)",
            ));
        };
        let origin_m = row
            .placement_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<Vec<f64>>(json).ok())
            .and_then(|values| <[f64; 12]>::try_from(values).ok())
            .map(|matrix| [matrix[3], matrix[7], matrix[11]]);
        out.push(modeldiff::DiffObject {
            snapshot: DerivedSnapshot {
                object_id: ref_object_id.clone(),
                profile_version: row.profile_version.clone().unwrap_or_default(),
                profile_id,
                fingerprints: Fingerprints {
                    properties: row.fp_properties.clone(),
                    placement: row.fp_placement.clone(),
                    shape: row.fp_shape.clone(),
                    combined: row.fp_combined.clone(),
                },
                canonical_properties: row.canonical_properties.clone().unwrap_or_default(),
                canonical_placement: row.canonical_placement.clone().unwrap_or_default(),
                canonical_shape: row.canonical_shape.clone().unwrap_or_default(),
            },
            id: modeldiff::IdentitySide {
                object_id: ref_object_id,
                revision_id: model_id.to_string(),
                express_id: row.express_id as u32,
                global_id: row.global_id.clone(),
                ifc_type: row.ifc_type.clone(),
                name: row.name.clone(),
                storey: row.storey.clone(),
                origin_m,
                props: by_object.remove(&row.id).unwrap_or_default(),
            },
        });
    }
    Ok(out)
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
        revision_id: reference.revision_id.clone(),
        object_id: reference.object_id.clone(),
        express_id: reference.express_id as i64,
        global_id: reference.global_id.clone(),
        ifc_type: reference.ifc_type.clone(),
        name: reference.name.clone(),
        storey: reference.storey.clone(),
    }
}
