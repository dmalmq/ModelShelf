//! Response/response-adjacent types. Field names and enum literals mirror
//! `apps/web/src/lib/types.ts` exactly; that file is the serialisation contract.

use serde::{Deserialize, Serialize};

use crate::db::{new_id, now_iso};

pub const SEVERITY_ORDER: [&str; 4] = ["critical", "high", "medium", "advisory"];

pub fn severity_rank(severity: &str) -> usize {
    SEVERITY_ORDER.iter().position(|s| *s == severity).unwrap_or(SEVERITY_ORDER.len())
}

pub const DISCIPLINES: [&str; 4] = ["ARCH", "STRUCT", "MEP", "OTHER"];

pub fn valid_discipline(value: &str) -> bool {
    DISCIPLINES.contains(&value)
}

// ---------------------------------------------------------------------------
// Rows (internal)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
pub struct ProjectRow {
    pub id: String,
    pub tenant_id: String,
    pub tenant_name: String,
    pub name: String,
    pub created_at: String,
}

#[derive(sqlx::FromRow)]
pub struct PackRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(sqlx::FromRow)]
pub struct PackVersionRow {
    pub id: String,
    pub pack_id: String,
    pub pack_name: String,
    pub version: i64,
    pub ids_xml: String,
    pub ids_sha256: String,
    pub metadata_json: Option<String>,
    pub notes: Option<String>,
    pub spec_count: i64,
    pub created_at: String,
}

#[derive(sqlx::FromRow)]
pub struct DeliveryRow {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub delivery_date: Option<String>,
    pub created_at: String,
}

#[derive(sqlx::FromRow, Clone)]
pub struct ModelRow {
    pub id: String,
    pub delivery_id: String,
    pub discipline: String,
    pub filename: String,
    pub content_sha256: String,
    pub byte_size: i64,
    pub schema_label: String,
    pub entity_count: i64,
    pub product_count: i64,
    pub length_to_metre: f64,
    pub storage_path: String,
    pub header_json: Option<String>,
    pub parse_ms: Option<i64>,
    pub uploaded_at: String,
}

#[derive(sqlx::FromRow)]
pub struct ObjectRowDb {
    pub id: String,
    pub model_id: String,
    pub express_id: i64,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub predefined_type: Option<String>,
    pub storey: Option<String>,
    pub placement_json: Option<String>,
    pub fp_properties: String,
    pub fp_placement: String,
    pub fp_shape: String,
    pub fp_combined: String,
}

#[derive(sqlx::FromRow)]
pub struct PropRow {
    pub pset: String,
    pub name: String,
    pub value: Option<String>,
    pub data_type: Option<String>,
    pub unit: Option<String>,
    pub numeric: Option<f64>,
    pub inherited: i64,
}

#[derive(sqlx::FromRow)]
pub struct RunRow {
    pub id: String,
    pub project_id: String,
    pub delivery_id: String,
    pub delivery_label: String,
    pub pack_version_id: String,
    pub pack_name: String,
    pub pack_version: i64,
    pub engine_version: String,
    pub parser_version: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub pass_count: i64,
    pub fail_count: i64,
    pub not_applicable_count: i64,
    pub incomplete_count: i64,
}

#[derive(sqlx::FromRow)]
pub struct RunSpecRow {
    pub id: String,
    pub run_id: String,
    pub spec_identifier: Option<String>,
    pub spec_name: String,
    pub outcome: String,
    pub applicable_count: i64,
    pub pass_count: i64,
    pub fail_count: i64,
    pub incomplete_count: i64,
    pub notes_json: Option<String>,
}

#[derive(sqlx::FromRow)]
pub struct FindingRow {
    pub id: String,
    pub run_id: String,
    pub finding_key: String,
    pub spec_identifier: Option<String>,
    pub spec_name: String,
    pub severity: String,
    pub category_id: String,
    pub category_label: String,
    pub facet: String,
    pub title: String,
    pub requirement: String,
    pub expected: Option<String>,
    pub instructions: Option<String>,
    pub object_count: i64,
    pub incomplete: i64,
    pub sort_index: i64,
}

#[derive(sqlx::FromRow)]
pub struct FindingObjectRow {
    pub finding_id: String,
    pub model_id: String,
    pub object_id: Option<String>,
    pub express_id: i64,
    pub global_id: Option<String>,
    pub actual: Option<String>,
    pub incomplete_reason: Option<String>,
    pub discipline: Option<String>,
    pub ifc_type: Option<String>,
    pub name: Option<String>,
    pub storey: Option<String>,
}

pub const RUN_SUMMARY_SELECT: &str = "SELECT r.id, r.project_id, r.delivery_id,
        d.label AS delivery_label, r.pack_version_id,
        p.name AS pack_name, pv.version AS pack_version,
        r.engine_version, r.parser_version, r.status, r.error,
        r.started_at, r.finished_at, r.duration_ms,
        r.pass_count, r.fail_count, r.not_applicable_count, r.incomplete_count
   FROM runs r
   JOIN deliveries d ON d.id = r.delivery_id
   JOIN pack_versions pv ON pv.id = r.pack_version_id
   JOIN packs p ON p.id = pv.pack_id";

// ---------------------------------------------------------------------------
// JSON payloads (camelCase, mirror of types.ts)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: &'static str,
    pub engine_version: String,
    pub parser_version: String,
    pub schema_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub tenant_id: String,
    pub tenant_name: String,
    pub name: String,
    pub created_at: String,
    pub delivery_count: i64,
    pub run_count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub delivery_date: Option<String>,
    pub created_at: String,
    pub model_count: i64,
    pub product_count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub delivery_id: String,
    pub discipline: String,
    pub filename: String,
    pub content_sha256: String,
    pub byte_size: i64,
    pub schema_label: String,
    pub entity_count: i64,
    pub product_count: i64,
    pub length_to_metre: f64,
    pub parse_ms: Option<i64>,
    pub uploaded_at: String,
    pub originating_system: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverySummary {
    #[serde(flatten)]
    pub delivery: Delivery,
    pub models: Vec<ModelInfo>,
    pub latest_run: Option<RunSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub deliveries: Vec<DeliverySummary>,
    pub packs: Vec<Pack>,
    pub runs: Vec<RunSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryDetail {
    pub delivery: Delivery,
    pub models: Vec<ModelInfo>,
    pub runs: Vec<RunSummary>,
    pub locked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub versions: Vec<PackVersion>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackVersion {
    pub id: String,
    pub pack_id: String,
    pub pack_name: String,
    pub version: i64,
    pub ids_sha256: String,
    pub notes: Option<String>,
    pub spec_count: i64,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSpecInfo {
    pub identifier: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub severity: String,
    pub category_id: String,
    pub category_label: String,
    pub ifc_versions: Vec<String>,
    pub applicability: Vec<String>,
    pub requirements: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackVersionDetail {
    pub version: PackVersion,
    pub ids_xml: String,
    pub specs: Vec<PackSpecInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub project_id: String,
    pub delivery_id: String,
    pub delivery_label: String,
    pub pack_version_id: String,
    pub pack_name: String,
    pub pack_version: i64,
    pub engine_version: String,
    pub parser_version: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub pass_count: i64,
    pub fail_count: i64,
    pub not_applicable_count: i64,
    pub incomplete_count: i64,
    pub score: Option<f64>,
    pub finding_count: i64,
    pub failing_object_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingObject {
    pub object_id: Option<String>,
    pub model_id: String,
    pub discipline: String,
    pub express_id: i64,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub storey: Option<String>,
    pub actual: Option<String>,
    pub incomplete_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub finding_key: String,
    pub spec_identifier: Option<String>,
    pub spec_name: String,
    pub title: String,
    pub requirement: String,
    pub expected: Option<String>,
    pub instructions: Option<String>,
    pub facet: String,
    pub severity: String,
    pub category_id: String,
    pub category_label: String,
    pub object_count: i64,
    pub incomplete: bool,
    pub sample_objects: Vec<FindingObject>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryGroup {
    pub category_id: String,
    pub category_label: String,
    pub finding_count: i64,
    pub object_count: i64,
    pub findings: Vec<Finding>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeverityBand {
    pub severity: String,
    pub finding_count: i64,
    pub object_count: i64,
    pub categories: Vec<CategoryGroup>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecResultRowOut {
    pub id: String,
    pub spec_identifier: Option<String>,
    pub spec_name: String,
    pub outcome: String,
    pub applicable_count: i64,
    pub pass_count: i64,
    pub fail_count: i64,
    pub incomplete_count: i64,
    pub notes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub run: RunSummary,
    pub models: Vec<ModelInfo>,
    pub scorecard: Vec<SeverityBand>,
    pub specs: Vec<SpecResultRowOut>,
    pub review_incomplete: Vec<Finding>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectFingerprints {
    pub properties: String,
    pub placement: String,
    pub shape: String,
    pub combined: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRowOut {
    pub id: String,
    pub model_id: String,
    pub express_id: i64,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub predefined_type: Option<String>,
    pub storey: Option<String>,
    pub fingerprints: ObjectFingerprints,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPage {
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub objects: Vec<ObjectRowOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectProperty {
    pub pset: String,
    pub name: String,
    pub value: Option<String>,
    pub data_type: Option<String>,
    pub unit: Option<String>,
    pub numeric: Option<f64>,
    pub inherited: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDetail {
    #[serde(flatten)]
    pub row: ObjectRowOut,
    pub placement: Option<Vec<f64>>,
    pub properties: Vec<ObjectProperty>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingObjectPage {
    pub finding_id: String,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub objects: Vec<FindingObject>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MatchConfidenceOut {
    #[serde(rename = "exact")]
    Exact,
    #[serde(rename = "heuristic")]
    Heuristic { score: f64, basis: String },
    #[serde(rename = "none")]
    None,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectChangeRefOut {
    pub express_id: i64,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub storey: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyChangeOut {
    pub pset: String,
    pub name: String,
    pub base: Option<String>,
    pub head: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectChangeOut {
    pub kind: String,
    pub confidence: MatchConfidenceOut,
    pub base: Option<ObjectChangeRefOut>,
    pub head: Option<ObjectChangeRefOut>,
    pub property_changes: Vec<PropertyChangeOut>,
    pub moved_distance_m: Option<f64>,
    pub notes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummaryOut {
    pub added: i64,
    pub removed: i64,
    pub unchanged: i64,
    pub moved: i64,
    pub shape_changed: i64,
    pub properties_changed: i64,
    pub mixed: i64,
    pub uncertain_matches: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPairDiffOut {
    pub discipline: String,
    pub base_model_id: Option<String>,
    pub head_model_id: Option<String>,
    pub base_filename: Option<String>,
    pub head_filename: Option<String>,
    pub summary: DiffSummaryOut,
    pub total: i64,
    pub changes: Vec<ObjectChangeOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDiffResponse {
    pub base: Delivery,
    pub head: Delivery,
    pub pairs: Vec<ModelPairDiffOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingChangeOut {
    pub finding_key: String,
    pub delta: String,
    pub title: String,
    pub severity: String,
    pub category_id: String,
    pub category_label: String,
    pub base_object_count: i64,
    pub head_object_count: i64,
    pub introduced_objects: Vec<String>,
    pub resolved_objects: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingDiffResponse {
    pub base_run: RunSummary,
    pub head_run: RunSummary,
    pub resolved: i64,
    pub introduced: i64,
    pub persisting: i64,
    pub changes: Vec<FindingChangeOut>,
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDeliveryBody {
    pub label: String,
    pub delivery_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePackVersionBody {
    pub ids_xml: String,
    pub metadata: Option<serde_json::Value>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRunBody {
    pub delivery_id: String,
    pub pack_version_id: String,
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

pub fn project_json(
    row: ProjectRow,
    delivery_count: i64,
    run_count: i64,
) -> Project {
    Project {
        id: row.id,
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_name,
        name: row.name,
        created_at: row.created_at,
        delivery_count,
        run_count,
    }
}

pub async fn delivery_json(pool: &sqlx::SqlitePool, row: &DeliveryRow) -> Result<Delivery, sqlx::Error> {
    let (model_count, product_count): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(product_count), 0) FROM models WHERE delivery_id = ?1",
    )
    .bind(&row.id)
    .fetch_one(pool)
    .await?;
    Ok(Delivery {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        label: row.label.clone(),
        delivery_date: row.delivery_date.clone(),
        created_at: row.created_at.clone(),
        model_count,
        product_count,
    })
}

pub fn model_json(row: &ModelRow) -> ModelInfo {
    let originating_system = row
        .header_json
        .as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|header| {
            header
                .get("originatingSystem")
                .or_else(|| header.get("originating_system"))
                .and_then(|v| v.as_str().map(str::to_owned))
        });
    ModelInfo {
        id: row.id.clone(),
        delivery_id: row.delivery_id.clone(),
        discipline: row.discipline.clone(),
        filename: row.filename.clone(),
        content_sha256: row.content_sha256.clone(),
        byte_size: row.byte_size,
        schema_label: row.schema_label.clone(),
        entity_count: row.entity_count,
        product_count: row.product_count,
        length_to_metre: row.length_to_metre,
        parse_ms: row.parse_ms,
        uploaded_at: row.uploaded_at.clone(),
        originating_system,
    }
}

pub fn pack_version_json(row: &PackVersionRow) -> PackVersion {
    PackVersion {
        id: row.id.clone(),
        pack_id: row.pack_id.clone(),
        pack_name: row.pack_name.clone(),
        version: row.version,
        ids_sha256: row.ids_sha256.clone(),
        notes: row.notes.clone(),
        spec_count: row.spec_count,
        created_at: row.created_at.clone(),
    }
}

pub fn run_summary(row: &RunRow, finding_count: i64, failing_object_count: i64) -> RunSummary {
    let score = if row.pass_count + row.fail_count > 0 {
        Some(row.pass_count as f64 / (row.pass_count + row.fail_count) as f64)
    } else {
        None
    };
    RunSummary {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        delivery_id: row.delivery_id.clone(),
        delivery_label: row.delivery_label.clone(),
        pack_version_id: row.pack_version_id.clone(),
        pack_name: row.pack_name.clone(),
        pack_version: row.pack_version,
        engine_version: row.engine_version.clone(),
        parser_version: row.parser_version.clone(),
        status: row.status.clone(),
        error: row.error.clone(),
        started_at: row.started_at.clone(),
        finished_at: row.finished_at.clone(),
        duration_ms: row.duration_ms,
        pass_count: row.pass_count,
        fail_count: row.fail_count,
        not_applicable_count: row.not_applicable_count,
        incomplete_count: row.incomplete_count,
        score,
        finding_count,
        failing_object_count,
    }
}

/// Load `(finding_count, failing_object_count)` for one run.
pub async fn run_extras(pool: &sqlx::SqlitePool, run_id: &str) -> Result<(i64, i64), sqlx::Error> {
    let finding_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM findings WHERE run_id = ?1")
            .bind(run_id)
            .fetch_one(pool)
            .await?;
    let failing_object_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT fo.object_id)
           FROM finding_objects fo
           JOIN findings f ON f.id = fo.finding_id
          WHERE f.run_id = ?1 AND fo.object_id IS NOT NULL",
    )
    .bind(run_id)
    .fetch_one(pool)
    .await?;
    Ok((finding_count, failing_object_count))
}

pub async fn run_summary_for(pool: &sqlx::SqlitePool, row: &RunRow) -> Result<RunSummary, sqlx::Error> {
    let (finding_count, failing_object_count) = run_extras(pool, &row.id).await?;
    Ok(run_summary(row, finding_count, failing_object_count))
}

pub fn object_row_json(row: &ObjectRowDb) -> ObjectRowOut {
    ObjectRowOut {
        id: row.id.clone(),
        model_id: row.model_id.clone(),
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

pub fn finding_object_json(row: &FindingObjectRow) -> FindingObject {
    FindingObject {
        object_id: row.object_id.clone(),
        model_id: row.model_id.clone(),
        discipline: row.discipline.clone().unwrap_or_else(|| "OTHER".to_string()),
        express_id: row.express_id,
        global_id: row.global_id.clone(),
        ifc_type: row.ifc_type.clone().unwrap_or_default(),
        name: row.name.clone(),
        storey: row.storey.clone(),
        actual: row.actual.clone(),
        incomplete_reason: row.incomplete_reason.clone(),
    }
}

pub fn finding_json(row: &FindingRow, sample_objects: Vec<FindingObject>) -> Finding {
    Finding {
        id: row.id.clone(),
        finding_key: row.finding_key.clone(),
        spec_identifier: row.spec_identifier.clone(),
        spec_name: row.spec_name.clone(),
        title: row.title.clone(),
        requirement: row.requirement.clone(),
        expected: row.expected.clone(),
        instructions: row.instructions.clone(),
        facet: row.facet.clone(),
        severity: row.severity.clone(),
        category_id: row.category_id.clone(),
        category_label: row.category_label.clone(),
        object_count: row.object_count,
        incomplete: row.incomplete != 0,
        sample_objects,
    }
}

pub fn spec_row_json(row: &RunSpecRow) -> SpecResultRowOut {
    let notes = row
        .notes_json
        .as_deref()
        .and_then(|text| serde_json::from_str::<Vec<String>>(text).ok())
        .unwrap_or_default();
    SpecResultRowOut {
        id: row.id.clone(),
        spec_identifier: row.spec_identifier.clone(),
        spec_name: row.spec_name.clone(),
        outcome: row.outcome.clone(),
        applicable_count: row.applicable_count,
        pass_count: row.pass_count,
        fail_count: row.fail_count,
        incomplete_count: row.incomplete_count,
        notes,
    }
}

pub fn facet_kind_name(kind: ids::FacetKind) -> &'static str {
    match kind {
        ids::FacetKind::Entity => "entity",
        ids::FacetKind::Attribute => "attribute",
        ids::FacetKind::Classification => "classification",
        ids::FacetKind::Property => "property",
        ids::FacetKind::Material => "material",
        ids::FacetKind::PartOf => "part_of",
    }
}

pub fn outcome_name(outcome: ids::Outcome) -> &'static str {
    match outcome {
        ids::Outcome::Pass => "pass",
        ids::Outcome::Fail => "fail",
        ids::Outcome::NotApplicable => "not_applicable",
        ids::Outcome::ReviewIncomplete => "review_incomplete",
    }
}

pub fn change_kind_name(kind: modeldiff::ChangeKind) -> &'static str {
    match kind {
        modeldiff::ChangeKind::Added => "added",
        modeldiff::ChangeKind::Removed => "removed",
        modeldiff::ChangeKind::Unchanged => "unchanged",
        modeldiff::ChangeKind::Moved => "moved",
        modeldiff::ChangeKind::ShapeChanged => "shape_changed",
        modeldiff::ChangeKind::PropertiesChanged => "properties_changed",
        modeldiff::ChangeKind::Mixed => "mixed",
    }
}

pub fn finding_delta_name(delta: modeldiff::FindingDelta) -> &'static str {
    match delta {
        modeldiff::FindingDelta::Resolved => "resolved",
        modeldiff::FindingDelta::Introduced => "introduced",
        modeldiff::FindingDelta::Persisting => "persisting",
    }
}

/// Stable finding key from the contract: blake3(spec_key \x1f facet \x1f requirement),
/// first 32 hex chars. `spec_key` is the spec identifier when present, else its name.
pub fn finding_key(spec_key: &str, facet: &str, requirement: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(spec_key.as_bytes());
    hasher.update(b"\x1f");
    hasher.update(facet.as_bytes());
    hasher.update(b"\x1f");
    hasher.update(requirement.as_bytes());
    hasher.finalize().to_hex().as_str()[..32].to_string()
}

pub fn make_ids(spec_key_count: usize) -> Vec<String> {
    (0..spec_key_count).map(|_| new_id()).collect()
}

pub fn timestamp_now() -> String {
    now_iso()
}
