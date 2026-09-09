//! Revision comparison endpoints.
//!
//! Snapshots are rebuilt from the stored `objects`/`object_props` rows rather than by
//! re-parsing IFC: the fingerprints were computed at ingest time and are the evidence.
//! Delivery members pair by persistent `source_model_id`, never by discipline, so two
//! same-discipline sources in one delivery compare strictly within their own source.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use axum::extract::{Query, State};
use axum::Json;
use fingerprint::normalized::{DerivedSnapshot, FingerprintProfile, Fingerprints};
use modeldiff::{ChangeKind, MatchConfidence, MatchPolicy};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::dto::{
    delivery_json, run_summary, DeliveryRow, DiffSummaryOut, FindingChangeOut,
    FindingDiffResponse, MatchConfidenceOut, ModelDiffResponse, ModelPairDiffOut, ModelRow,
    ObjectChangeOut, ObjectChangeRefOut, ObjectRowDb, PropertyChangeOut, RunRow,
    DELIVERY_MODEL_ROW_SELECT, DELIVERY_SELECT,
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
    // Findings only compare under compatible checking settings: same pack version
    // and digests, same specification scope over the same pinned sources, same
    // engine profile, and two completed runs with nothing left review-incomplete.
    // First mismatch wins; anything else would report a settings change as a
    // regression in the model.
    let base_compat = load_compat(&state.pool, &base).await?;
    let head_compat = load_compat(&state.pool, &head).await?;
    check_compat(&base_compat, &head_compat)?;

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

    let mut resolved: i64 = 0;
    let mut introduced: i64 = 0;
    let mut persisting: i64 = 0;
    let changes: Vec<FindingChangeOut> = result
        .changes
        .into_iter()
        .map(|change| {
            // Prefer the head run's metadata; resolved findings only exist in the base.
            let meta = head_findings
                .get(&change.finding_key)
                .or_else(|| base_findings.get(&change.finding_key));
            // The comparison inputs carry confirmed GlobalIds only, so object lists
            // can never contain synthetic `express:` fallbacks; and a finding both
            // runs still list is held as persisting when either side matched
            // objects without a GlobalId rather than claiming a resolution on
            // unproven identity.
            let delta = hold_uncertain(
                change.delta,
                base_findings.get(&change.finding_key),
                head_findings.get(&change.finding_key),
            );
            match delta {
                modeldiff::FindingDelta::Resolved => resolved += 1,
                modeldiff::FindingDelta::Introduced => introduced += 1,
                modeldiff::FindingDelta::Persisting => persisting += 1,
            }
            FindingChangeOut {
                finding_key: change.finding_key,
                delta: match delta {
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
        resolved,
        introduced,
        persisting,
        changes,
    }))
}

struct FindingMeta {
    title: String,
    severity: String,
    category_id: String,
    category_label: String,
    /// Confirmed GlobalIds only: objects without one carry no cross-run identity
    /// and are excluded from the comparison inputs rather than given a synthetic
    /// `express:` id (occurrence ids are never comparable across revisions).
    global_ids: Vec<String>,
    /// True when the finding matched objects with NULL `global_id`: identity on
    /// that side is unproven, so a confirmed-id delta may not claim a resolution.
    has_uncertain: bool,
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
        uncertain_count: i64,
    }
    // GROUP_CONCAT skips NULL global_ids on its own; the uncertain count names
    // the rows it skipped. `fo.id IS NOT NULL` keeps findings with no objects at
    // all (the LEFT JOIN's empty row) out of the uncertain set.
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT f.finding_key, f.title, f.severity, f.category_id, f.category_label,
                GROUP_CONCAT(fo.global_id, char(31)) AS global_ids,
                SUM(CASE WHEN fo.id IS NOT NULL AND fo.global_id IS NULL THEN 1 ELSE 0 END)
                    AS uncertain_count
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
                    has_uncertain: row.uncertain_count > 0,
                },
            )
        })
        .collect())
}

/// Never claim a resolution on unproven identity: when both runs still list the
/// finding but either side matched objects without a GlobalId, the confirmed-id
/// inputs may read "resolved" only because uncertain objects fell out of the
/// comparison. Hold those changes as persisting instead. Findings gained or lost
/// by key presence keep their introduced/resolved delta — the stable requirement
/// identity did not move, only its members did.
fn hold_uncertain(
    delta: modeldiff::FindingDelta,
    base: Option<&FindingMeta>,
    head: Option<&FindingMeta>,
) -> modeldiff::FindingDelta {
    let both_listed = base.is_some() && head.is_some();
    let either_uncertain = base.is_some_and(|m| m.has_uncertain) || head.is_some_and(|m| m.has_uncertain);
    if both_listed && either_uncertain && delta == modeldiff::FindingDelta::Resolved {
        modeldiff::FindingDelta::Persisting
    } else {
        delta
    }
}

/// The checking settings two runs must share before their findings may compare.
/// `members` are the pinned `run_models` source ids — the recorded snapshot of
/// what the run evaluated, never live delivery membership. `scope` and
/// `engine_profile` are the stored JSON parsed at this boundary: missing/NULL
/// becomes `Value::Null`, and unparseable legacy text does too, so old rows
/// refuse via the provenance/digest rows rather than failing with a 500.
struct Compatibility {
    run_id: String,
    pack_version_id: String,
    ids_sha256: Option<String>,
    pack_metadata_sha256: Option<String>,
    scope: serde_json::Value,
    engine_profile: serde_json::Value,
    members: BTreeSet<String>,
    has_pin: bool,
    provenance: String,
    status: String,
    incomplete_count: i64,
}

fn parse_stored_json(raw: Option<&str>) -> serde_json::Value {
    raw.and_then(|text| serde_json::from_str(text).ok()).unwrap_or(serde_json::Value::Null)
}

async fn load_compat(pool: &SqlitePool, row: &RunRow) -> Result<Compatibility, ApiError> {
    let pins: Vec<String> =
        sqlx::query_scalar("SELECT source_model_id FROM run_models WHERE run_id = ?1")
            .bind(&row.id)
            .fetch_all(pool)
            .await?;
    let members: BTreeSet<String> = pins.into_iter().collect();
    Ok(Compatibility {
        run_id: row.id.clone(),
        pack_version_id: row.pack_version_id.clone(),
        ids_sha256: row.ids_sha256.clone(),
        pack_metadata_sha256: row.pack_metadata_sha256.clone(),
        scope: parse_stored_json(row.scope_json.as_deref()),
        engine_profile: parse_stored_json(row.engine_profile_json.as_deref()),
        has_pin: !members.is_empty(),
        members,
        provenance: row.input_provenance.clone(),
        status: row.status.clone(),
        incomplete_count: row.incomplete_count,
    })
}

/// Ordered gate: the first mismatching dimension wins. Provenance and completion
/// come before version identity, and version identity before the checking
/// settings themselves, so the refusal always names the most basic reason the
/// two runs cannot share a comparison.
fn check_compat(base: &Compatibility, head: &Compatibility) -> Result<(), ApiError> {
    let ids = (base.run_id.as_str(), head.run_id.as_str());
    for side in [base, head] {
        if side.provenance != "complete" || !side.has_pin {
            let detail = if side.provenance != "complete" {
                format!("run {} has input_provenance '{}'", side.run_id, side.provenance)
            } else {
                format!("run {} has no pinned input snapshot (run_models is empty)", side.run_id)
            };
            return Err(ApiError::provenance_incomplete(ids.0, ids.1, &detail));
        }
    }
    for side in [base, head] {
        if side.status != "completed" {
            return Err(ApiError::run_not_completed(
                ids.0,
                ids.1,
                &format!("run {} has status '{}'", side.run_id, side.status),
            ));
        }
    }
    for side in [base, head] {
        if side.incomplete_count > 0 {
            return Err(ApiError::run_incomplete(
                ids.0,
                ids.1,
                &format!(
                    "run {} reports {} review-incomplete outcomes",
                    side.run_id, side.incomplete_count
                ),
            ));
        }
    }
    if base.pack_version_id != head.pack_version_id {
        return Err(ApiError::pack_version_mismatch());
    }
    if base.ids_sha256 != head.ids_sha256 {
        return Err(ApiError::pack_digest_mismatch(ids.0, ids.1, "IDS content digest ids_sha256"));
    }
    if base.pack_metadata_sha256 != head.pack_metadata_sha256 {
        return Err(ApiError::pack_digest_mismatch(
            ids.0,
            ids.1,
            "pack metadata digest pack_metadata_sha256",
        ));
    }
    if base.scope != head.scope {
        return Err(ApiError::scope_mismatch(ids.0, ids.1, "specification scope text"));
    }
    if base.members != head.members {
        return Err(ApiError::scope_mismatch(ids.0, ids.1, "source membership"));
    }
    if base.engine_profile != head.engine_profile {
        return Err(ApiError::engine_profile_mismatch(ids.0, ids.1));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use modeldiff::FindingDelta;

    fn compat(run_id: &str) -> Compatibility {
        Compatibility {
            run_id: run_id.to_owned(),
            pack_version_id: "pv1".to_owned(),
            ids_sha256: Some("ids-digest".to_owned()),
            pack_metadata_sha256: Some("meta-digest".to_owned()),
            scope: serde_json::json!({"ARCH": ["Wall declares a fire rating"]}),
            engine_profile: serde_json::json!({"worker": "0.1.0", "operation": "validate"}),
            members: BTreeSet::from(["source-1".to_owned()]),
            has_pin: true,
            provenance: "complete".to_owned(),
            status: "completed".to_owned(),
            incomplete_count: 0,
        }
    }

    fn pair() -> (Compatibility, Compatibility) {
        (compat("run-base"), compat("run-head"))
    }

    fn code_of(result: Result<(), ApiError>) -> ErrorCode {
        result.expect_err("gate must refuse").code
    }

    #[test]
    fn gate_passes_when_every_row_holds() {
        let (base, head) = pair();
        assert!(check_compat(&base, &head).is_ok());
    }

    #[test]
    fn incomplete_provenance_refuses_before_anything_else() {
        let (mut base, head) = pair();
        base.provenance = "incomplete".to_owned();
        base.status = "failed".to_owned();
        let err = check_compat(&base, &head).expect_err("provenance must refuse");
        assert_eq!(err.code, ErrorCode::ProvenanceIncomplete);
        assert!(err.message.contains("run-base"), "{}", err.message);
        assert!(err.message.contains("run-head"), "{}", err.message);
        assert!(err.message.contains("rerun"), "{}", err.message);
    }

    #[test]
    fn missing_pins_refuse_as_provenance_failure() {
        let (mut base, head) = pair();
        base.members.clear();
        base.has_pin = false;
        assert_eq!(code_of(check_compat(&base, &head)), ErrorCode::ProvenanceIncomplete);
        // The head side is checked too: a missing head pin refuses as well.
        let (base, mut head) = pair();
        head.members.clear();
        head.has_pin = false;
        let err = check_compat(&base, &head).expect_err("head pins must refuse");
        assert_eq!(err.code, ErrorCode::ProvenanceIncomplete);
        assert!(err.message.contains("run-head"), "{}", err.message);
    }

    #[test]
    fn non_completed_status_refuses() {
        let (base, mut head) = pair();
        head.status = "failed".to_owned();
        let err = check_compat(&base, &head).expect_err("failed run must refuse");
        assert_eq!(err.code, ErrorCode::RunNotCompleted);
        assert!(err.message.contains("run-head"), "{}", err.message);
        assert!(err.message.contains("failed"), "{}", err.message);
        assert!(err.message.contains("rerun"), "{}", err.message);
    }

    #[test]
    fn review_incomplete_counts_refuse() {
        let (mut base, head) = pair();
        base.incomplete_count = 3;
        let err = check_compat(&base, &head).expect_err("incomplete run must refuse");
        assert_eq!(err.code, ErrorCode::RunIncomplete);
        assert!(err.message.contains("run-base"), "{}", err.message);
    }

    #[test]
    fn pack_version_mismatch_is_preserved() {
        let (base, mut head) = pair();
        head.pack_version_id = "pv2".to_owned();
        let err = check_compat(&base, &head).expect_err("pack version must refuse");
        assert_eq!(err.code, ErrorCode::PackVersionMismatch);
    }

    #[test]
    fn ids_and_metadata_digests_each_refuse() {
        let (base, mut head) = pair();
        head.ids_sha256 = Some("other-digest".to_owned());
        let err = check_compat(&base, &head).expect_err("ids digest must refuse");
        assert_eq!(err.code, ErrorCode::PackDigestMismatch);
        assert!(err.message.contains("ids_sha256"), "{}", err.message);

        let (base, mut head) = pair();
        head.pack_metadata_sha256 = Some("other-meta".to_owned());
        let err = check_compat(&base, &head).expect_err("metadata digest must refuse");
        assert_eq!(err.code, ErrorCode::PackDigestMismatch);
        assert!(err.message.contains("pack_metadata_sha256"), "{}", err.message);
    }

    #[test]
    fn none_vs_some_digest_is_a_mismatch_but_none_vs_none_passes() {
        let (mut base, head) = pair();
        base.ids_sha256 = None;
        assert_eq!(code_of(check_compat(&base, &head)), ErrorCode::PackDigestMismatch);

        let (mut base, mut head) = pair();
        base.ids_sha256 = None;
        head.ids_sha256 = None;
        base.pack_metadata_sha256 = None;
        head.pack_metadata_sha256 = None;
        assert!(check_compat(&base, &head).is_ok());
    }

    #[test]
    fn scope_text_and_membership_drift_share_one_code_with_distinct_messages() {
        let (base, mut head) = pair();
        head.scope = serde_json::json!({"ARCH": ["Another rule"]});
        let err = check_compat(&base, &head).expect_err("scope text must refuse");
        assert_eq!(err.code, ErrorCode::ScopeMismatch);
        assert!(err.message.contains("scope text"), "{}", err.message);

        let (base, mut head) = pair();
        head.members = BTreeSet::from(["source-1".to_owned(), "source-2".to_owned()]);
        let err = check_compat(&base, &head).expect_err("membership must refuse");
        assert_eq!(err.code, ErrorCode::ScopeMismatch);
        assert!(err.message.contains("membership"), "{}", err.message);
    }

    #[test]
    fn engine_profile_drift_refuses() {
        let (base, mut head) = pair();
        head.engine_profile = serde_json::json!({"worker": "0.2.0", "operation": "validate"});
        let err = check_compat(&base, &head).expect_err("engine profile must refuse");
        assert_eq!(err.code, ErrorCode::EngineProfileMismatch);
        assert!(err.message.contains("run-base"), "{}", err.message);
        assert!(err.message.contains("run-head"), "{}", err.message);
    }

    #[test]
    fn legacy_null_and_unparseable_json_never_panics() {
        assert_eq!(parse_stored_json(None), serde_json::Value::Null);
        assert_eq!(parse_stored_json(Some("not json {")), serde_json::Value::Null);
        assert_eq!(
            parse_stored_json(Some("{\"ARCH\":[]}")),
            serde_json::json!({"ARCH": []})
        );
        // Two legacy rows (everything NULL) parse without panicking; the gate
        // decides on the structured rows, never on a parse failure.
        let (mut base, mut head) = pair();
        base.scope = parse_stored_json(None);
        head.scope = parse_stored_json(None);
        base.engine_profile = parse_stored_json(Some("legacy text"));
        head.engine_profile = parse_stored_json(Some("legacy text"));
        base.ids_sha256 = None;
        head.ids_sha256 = None;
        base.pack_metadata_sha256 = None;
        head.pack_metadata_sha256 = None;
        assert!(check_compat(&base, &head).is_ok());
    }

    fn meta(has_uncertain: bool, ids: &[&str]) -> FindingMeta {
        FindingMeta {
            title: "t".to_owned(),
            severity: "high".to_owned(),
            category_id: "regulatory".to_owned(),
            category_label: "Regulatory".to_owned(),
            global_ids: ids.iter().map(|s| s.to_string()).collect(),
            has_uncertain,
        }
    }

    #[test]
    fn confirmed_empty_but_uncertain_on_both_sides_stays_persisting() {
        let base = meta(true, &[]);
        let head = meta(true, &[]);
        assert_eq!(
            hold_uncertain(FindingDelta::Resolved, Some(&base), Some(&head)),
            FindingDelta::Persisting
        );
    }

    #[test]
    fn uncertain_on_one_side_is_enough_to_hold_a_resolution() {
        let base = meta(false, &["G1"]);
        let head = meta(true, &[]);
        assert_eq!(
            hold_uncertain(FindingDelta::Resolved, Some(&base), Some(&head)),
            FindingDelta::Persisting
        );
    }

    #[test]
    fn certain_resolutions_and_key_presence_deltas_are_untouched() {
        let base = meta(false, &["G1"]);
        let head = meta(false, &[]);
        assert_eq!(
            hold_uncertain(FindingDelta::Resolved, Some(&base), Some(&head)),
            FindingDelta::Resolved
        );
        // The head run dropped the finding key entirely: a real resolution by
        // stable requirement identity, not an identity gap.
        assert_eq!(
            hold_uncertain(FindingDelta::Resolved, Some(&base), None),
            FindingDelta::Resolved
        );
        assert_eq!(
            hold_uncertain(FindingDelta::Introduced, None, Some(&head)),
            FindingDelta::Introduced
        );
        assert_eq!(
            hold_uncertain(FindingDelta::Persisting, Some(&base), Some(&head)),
            FindingDelta::Persisting
        );
    }

    async fn finding_test_pool() -> (tempfile::TempDir, sqlx::SqlitePool) {
        let dir = tempfile::tempdir().expect("temp dir");
        let pool = crate::db::open(dir.path()).await.expect("migrated pool");
        for statement in [
            "INSERT INTO tenants (id, name, created_at) VALUES ('t1','Tenant',datetime())",
            "INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','P',datetime())",
            "INSERT INTO deliveries (id, project_id, label, created_at) VALUES ('d1','p1','D',datetime())",
            "INSERT INTO packs (id, tenant_id, name, created_at) VALUES ('pack1','t1','Pack',datetime())",
            "INSERT INTO pack_versions (id, pack_id, version, ids_xml, ids_sha256, spec_count, created_at)
               VALUES ('pv1','pack1',1,'<ids/>','0',1,datetime())",
            "INSERT INTO source_models (id, project_id, name, discipline, created_at)
               VALUES ('s1','p1','S','ARCH',datetime())",
            "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
                 schema_label, entity_count, product_count, storage_path, uploaded_at)
               VALUES ('r1','s1','m.ifc','00',1,'IFC4',1,1,'blobs/m',datetime())",
            "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
                 parser_version, status, started_at, input_provenance)
               VALUES ('run1','p1','d1','pv1','eng','par','completed',datetime(),'complete')",
            "INSERT INTO findings (id, run_id, finding_key, spec_name, severity, category_id,
                 category_label, facet, title, requirement)
               VALUES ('f1','run1','k1','Spec','high','regulatory','Regulatory','property','T','R')",
            "INSERT INTO findings (id, run_id, finding_key, spec_name, severity, category_id,
                 category_label, facet, title, requirement)
               VALUES ('f2','run1','k2','Spec','high','regulatory','Regulatory','property','T','R')",
            "INSERT INTO findings (id, run_id, finding_key, spec_name, severity, category_id,
                 category_label, facet, title, requirement)
               VALUES ('f3','run1','k3','Spec','high','regulatory','Regulatory','property','T','R')",
        ] {
            sqlx::query(statement).execute(&pool).await.expect("parent rows");
        }
        // k1: two confirmed GlobalIds plus one object without any identity.
        // k2: only an object without identity. k3: no objects at all.
        for (finding, express, global) in [
            ("f1", 11, Some("G1")),
            ("f1", 12, Some("G2")),
            ("f1", 13, None),
            ("f2", 21, None),
        ] {
            sqlx::query(
                "INSERT INTO finding_objects (finding_id, model_id, express_id, global_id)
                 VALUES (?1,'r1',?2,?3)",
            )
            .bind(finding)
            .bind(express)
            .bind(global)
            .execute(&pool)
            .await
            .expect("finding objects");
        }
        (dir, pool)
    }

    #[tokio::test]
    async fn load_finding_keys_returns_confirmed_ids_only_and_flags_uncertain() {
        let (_dir, pool) = finding_test_pool().await;
        let keys = load_finding_keys(&pool, "run1").await.expect("load");

        let k1 = keys.get("k1").expect("k1");
        let mut ids = k1.global_ids.clone();
        ids.sort();
        assert_eq!(ids, vec!["G1".to_owned(), "G2".to_owned()]);
        assert!(
            !k1.global_ids.iter().any(|id| id.starts_with("express:")),
            "no synthetic occurrence ids: {:?}",
            k1.global_ids
        );
        assert!(k1.has_uncertain);

        let k2 = keys.get("k2").expect("k2");
        assert!(k2.global_ids.is_empty());
        assert!(k2.has_uncertain);

        let k3 = keys.get("k3").expect("k3");
        assert!(k3.global_ids.is_empty());
        assert!(!k3.has_uncertain, "a finding with no objects is not uncertain");
    }
}
