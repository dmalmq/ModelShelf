//! Check-run execution and scorecard assembly.
//!
//! A run binds `pack_version + model content hashes + engine/parser versions` and stores
//! findings grouped by distinct violated requirement. Object-level outcomes are folded
//! into those findings, never listed one row per object — a manager reading "124 walls
//! missing a fire rating" needs one line, not 124. IfcTester is the scorer; `crates/ids`
//! is only used here to list specification names for discipline scope.

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::db::{new_id, now_iso};
use crate::dto::{
    finding_object_json, model_json, run_summary, severity_rank, CategoryGroup, CreateRunBody,
    DeliveryRow, Finding, FindingObject, FindingObjectRow, FindingRow, InputProvenance, ModelInfo,
    ModelRow, PackVersionRow, RunDetail, RunRow, RunSpecRow, SeverityBand, SpecResultRowOut,
    DELIVERY_SELECT, RUN_SUMMARY_SELECT, SEVERITY_ORDER,
};
use crate::error::ApiError;
use crate::ids_meta::{finding_key, PackMetadata, CHECK_ENGINE_VERSION, CHECK_PARSER_VERSION};
use crate::jobs::{IdsInput, WorkerInvocation};
use crate::state::AppState;
use crate::upload::sha256_hex;

/// Affected objects embedded directly in the scorecard; the rest are paged.
const SAMPLE_OBJECTS: i64 = 25;

pub async fn create_run(
    State(state): State<AppState>,
    Json(body): Json<CreateRunBody>,
) -> Result<Json<RunDetail>, ApiError> {
    let delivery: DeliveryRow = sqlx::query_as(&format!("{DELIVERY_SELECT} WHERE id = ?1"))
        .bind(&body.delivery_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("delivery"))?;

    let pack_version: PackVersionRow = sqlx::query_as(
        "SELECT pv.id, pv.pack_id, p.name AS pack_name, pv.version, pv.ids_xml, pv.ids_sha256,
                pv.metadata_json, pv.notes, pv.spec_count, pv.created_at
           FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id
          WHERE pv.id = ?1",
    )
    .bind(&body.pack_version_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("pack version"))?;

    let models: Vec<ModelRow> = crate::diff::load_models(&state.pool, &delivery.id).await?;
    if models.is_empty() {
        return Err(ApiError::bad_request("delivery has no models to check"));
    }

    let parsed_ids = ids::Ids::parse(&pack_version.ids_xml)
        .map_err(|err| ApiError::parse_failed(format!("pack version is not valid IDS: {err}")))?;
    let spec_names: Vec<String> = parsed_ids.specifications.iter().map(|spec| spec.name.clone()).collect();
    let metadata = PackMetadata::parse(pack_version.metadata_json.as_deref());
    let mut scope: HashMap<String, Vec<String>> = HashMap::new();
    for model in &models {
        scope
            .entry(model.discipline.clone())
            .or_insert_with(|| metadata.specification_ids_for(&spec_names, &model.discipline));
    }
    let pack_metadata_sha256 = pack_version.metadata_json.as_deref().map(|text| sha256_hex(text.as_bytes()));
    let engine_profile = serde_json::json!({
        "worker": "0.1.0",
        "ifcTester": "0.8.5",
        "ifcOpenShell": "0.8.5",
        "operation": "validate",
    })
    .to_string();
    let scope_json = serde_json::to_string(&scope).unwrap_or_else(|_| "{}".to_owned());

    let run_id = new_id();
    let started_at = now_iso();
    let provenance = InputProvenance::Complete;
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
             parser_version, status, started_at, input_provenance, input_provenance_reason,
             ids_sha256, pack_metadata_sha256, scope_json, engine_profile_json)
         VALUES (?1,?2,?3,?4,?5,?6,'running',?7,?8,?9,?10,?11,?12,?13)",
    )
    .bind(&run_id)
    .bind(&delivery.project_id)
    .bind(&delivery.id)
    .bind(&pack_version.id)
    .bind(CHECK_ENGINE_VERSION)
    .bind(CHECK_PARSER_VERSION)
    .bind(&started_at)
    .bind(provenance.status())
    .bind(provenance.reason())
    .bind(&pack_version.ids_sha256)
    .bind(&pack_metadata_sha256)
    .bind(&scope_json)
    .bind(&engine_profile)
    .execute(&mut *tx)
    .await?;
    for (index, model) in models.iter().enumerate() {
        sqlx::query(
            "INSERT INTO run_models (run_id, model_revision_id, source_model_id, source_model_name,
                 discipline, filename, content_sha256, byte_size, sort_index)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        )
        .bind(&run_id)
        .bind(&model.id)
        .bind(&model.source_model_id)
        .bind(&model.source_model_name)
        .bind(&model.discipline)
        .bind(&model.filename)
        .bind(&model.content_sha256)
        .bind(model.byte_size)
        .bind(index as i64)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let clock = std::time::Instant::now();
    match execute(&state, &run_id, &pack_version, &models, &metadata, &scope).await {
        Ok(()) => {
            sqlx::query(
                "UPDATE runs SET status = 'completed', finished_at = ?2, duration_ms = ?3
                   WHERE id = ?1",
            )
            .bind(&run_id)
            .bind(now_iso())
            .bind(clock.elapsed().as_millis() as i64)
            .execute(&state.pool)
            .await?;
        }
        Err(err) => {
            // A failed run stays visible with its reason: silence would read as "clean".
            sqlx::query(
                "UPDATE runs SET status = 'failed', error = ?2, finished_at = ?3, duration_ms = ?4
                   WHERE id = ?1",
            )
            .bind(&run_id)
            .bind(&err.message)
            .bind(now_iso())
            .bind(clock.elapsed().as_millis() as i64)
            .execute(&state.pool)
            .await?;
        }
    }

    let detail = run_detail(&state.pool, &run_id).await?;
    Ok(Json(detail))
}

/// Invoke IfcTester per pinned model and persist grouped findings.
async fn execute(
    state: &AppState,
    run_id: &str,
    pack_version: &PackVersionRow,
    models: &[ModelRow],
    metadata: &PackMetadata,
    scope: &HashMap<String, Vec<String>>,
) -> Result<(), ApiError> {
    let run_dir = state.data_dir.join("runs").join(run_id);
    tokio::fs::create_dir_all(&run_dir)
        .await
        .map_err(|err| ApiError::internal(format!("cannot create run directory: {err}")))?;
    let ids_path = run_dir.join("pack.ids");
    tokio::fs::write(&ids_path, pack_version.ids_xml.as_bytes())
        .await
        .map_err(|err| ApiError::internal(format!("cannot write pinned IDS: {err}")))?;
    let ids_path = ids_path
        .canonicalize()
        .map_err(|err| ApiError::internal(format!("cannot resolve pinned IDS: {err}")))?;

    let mut totals = Totals::default();
    let mut findings: HashMap<String, Accumulated> = HashMap::new();
    let mut spec_rows: HashMap<String, SpecAccum> = HashMap::new();

    for model_row in models {
        let spec_ids = scope.get(&model_row.discipline).cloned().unwrap_or_default();
        if spec_ids.is_empty() {
            continue;
        }
        let output_dir = run_dir.join(&model_row.id);
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|err| ApiError::internal(format!("cannot create model output dir: {err}")))?;
        let artifacts = crate::jobs::invoke_worker(
            state,
            WorkerInvocation {
                job_id: format!("{run_id}-{}", model_row.id),
                revision_id: model_row.id.clone(),
                content_sha256: model_row.content_sha256.clone(),
                blob_path: state.blob_path(&model_row.content_sha256),
                output_dir,
                operation: "validate",
                ids: Some(IdsInput {
                    path: ids_path.clone(),
                    sha256: pack_version.ids_sha256.clone(),
                    specification_ids: Some(spec_ids),
                }),
                geometry: false,
            },
        )
        .await
        .map_err(|err| ApiError::parse_failed(format!("{}: {err}", model_row.filename)))?;

        let outcomes = parse_outcomes(&artifacts.outcomes)
            .map_err(|err| ApiError::parse_failed(format!("{}: {err}", model_row.filename)))?;
        for outcome in outcomes {
            fold_outcome(
                &mut totals,
                &mut findings,
                &mut spec_rows,
                metadata,
                model_row,
                outcome,
            );
        }
    }

    for spec in spec_rows.into_values() {
        sqlx::query(
            "INSERT INTO run_specs (id, run_id, spec_identifier, spec_name, outcome,
                 applicable_count, pass_count, fail_count, incomplete_count, notes_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )
        .bind(new_id())
        .bind(run_id)
        .bind(spec.identifier)
        .bind(&spec.name)
        .bind(spec.outcome.as_str())
        .bind(spec.applicable_count)
        .bind(spec.pass_count)
        .bind(spec.fail_count)
        .bind(spec.incomplete_count)
        .bind(serde_json::to_string(&spec.notes).unwrap_or_else(|_| "[]".to_owned()))
        .execute(&state.pool)
        .await?;
    }

    persist_findings(&state.pool, run_id, findings).await?;

    sqlx::query(
        "UPDATE runs SET pass_count = ?2, fail_count = ?3, not_applicable_count = ?4,
             incomplete_count = ?5 WHERE id = ?1",
    )
    .bind(run_id)
    .bind(totals.pass)
    .bind(totals.fail)
    .bind(totals.not_applicable)
    .bind(totals.incomplete)
    .execute(&state.pool)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct OutcomeWire {
    #[serde(rename = "specificationId")]
    specification_id: Option<String>,
    #[serde(rename = "specificationName")]
    specification_name: String,
    requirement: String,
    status: String,
    #[serde(rename = "applicableCount")]
    applicable_count: i64,
    #[serde(rename = "passedCount")]
    passed_count: i64,
    #[serde(rename = "failedCount")]
    failed_count: i64,
    failures: Vec<FailureWire>,
}

#[derive(Deserialize)]
struct FailureWire {
    #[serde(rename = "expressId")]
    express_id: i64,
    #[serde(rename = "globalId")]
    global_id: Option<String>,
    reason: String,
}

fn parse_outcomes(bytes: &[u8]) -> Result<Vec<OutcomeWire>, String> {
    let text = std::str::from_utf8(bytes).map_err(|err| format!("outcomes are not utf-8: {err}"))?;
    let mut rows = Vec::new();
    for (index, line) in text.lines().filter(|line| !line.is_empty()).enumerate() {
        let row: OutcomeWire = serde_json::from_str(line)
            .map_err(|err| format!("outcomes.jsonl line {}: {err}", index + 1))?;
        rows.push(row);
    }
    Ok(rows)
}

fn fold_outcome(
    totals: &mut Totals,
    findings: &mut HashMap<String, Accumulated>,
    spec_rows: &mut HashMap<String, SpecAccum>,
    metadata: &PackMetadata,
    model_row: &ModelRow,
    outcome: OutcomeWire,
) {
    match outcome.status.as_str() {
        "passed" => totals.pass += 1,
        "failed" => totals.fail += 1,
        "not_applicable" => totals.not_applicable += 1,
        _ => totals.incomplete += 1,
    }

    let spec_key = outcome
        .specification_id
        .clone()
        .unwrap_or_else(|| outcome.specification_name.clone());
    let spec = spec_rows.entry(spec_key.clone()).or_insert_with(|| SpecAccum {
        identifier: outcome.specification_id.clone(),
        name: outcome.specification_name.clone(),
        outcome: SpecRollup::Pass,
        applicable_count: 0,
        pass_count: 0,
        fail_count: 0,
        incomplete_count: 0,
        notes: Vec::new(),
    });
    spec.applicable_count += outcome.applicable_count;
    spec.pass_count += outcome.passed_count;
    spec.fail_count += outcome.failed_count;
    match outcome.status.as_str() {
        "passed" => {}
        "failed" => spec.outcome.worsen(SpecRollup::Fail),
        "not_applicable" => spec.outcome.worsen(SpecRollup::NotApplicable),
        other => {
            spec.outcome.worsen(SpecRollup::ReviewIncomplete);
            spec.incomplete_count += 1;
            spec.notes.push(format!("{}: {other}", model_row.filename));
        }
    }

    if outcome.status == "passed" || outcome.status == "not_applicable" {
        return;
    }

    let triage = metadata.triage(outcome.specification_id.as_deref(), &outcome.specification_name);
    let incomplete = outcome.status == "incomplete";
    let facet = facet_for(&outcome.requirement);
    let key = finding_key(&spec_key, facet, &outcome.requirement);
    let entry = findings.entry(key.clone()).or_insert_with(|| Accumulated {
        key,
        spec_identifier: outcome.specification_id.clone(),
        spec_name: outcome.specification_name.clone(),
        severity: triage.severity,
        category_id: triage.category_id,
        category_label: triage.category_label,
        facet: facet.to_owned(),
        title: triage.title,
        requirement: outcome.requirement.clone(),
        expected: None,
        instructions: None,
        incomplete,
        objects: Vec::new(),
    });
    entry.incomplete |= incomplete;
    if outcome.failures.is_empty() && outcome.status == "failed" {
        return;
    }
    for failure in outcome.failures {
        entry.objects.push(AffectedObject {
            model_id: model_row.id.clone(),
            express_id: failure.express_id,
            global_id: failure.global_id,
            actual: Some(failure.reason.clone()),
            incomplete_reason: if incomplete { Some(failure.reason) } else { None },
        });
    }
}

fn facet_for(requirement: &str) -> &'static str {
    let text = requirement.to_ascii_lowercase();
    if text.contains("classif") {
        "classification"
    } else if text.contains("material") {
        "material"
    } else if text.contains("part of") {
        "part_of"
    } else if text.contains("property") || text.contains("pset") {
        "property"
    } else if text.contains("attribute") || text.contains("shall be") {
        "attribute"
    } else {
        "entity"
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SpecRollup {
    Pass,
    NotApplicable,
    ReviewIncomplete,
    Fail,
}

impl SpecRollup {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::NotApplicable => "not_applicable",
            Self::ReviewIncomplete => "review_incomplete",
            Self::Fail => "fail",
        }
    }

    fn worsen(&mut self, other: Self) {
        let rank = |value: Self| match value {
            Self::Pass => 0,
            Self::NotApplicable => 1,
            Self::ReviewIncomplete => 2,
            Self::Fail => 3,
        };
        if rank(other) > rank(*self) {
            *self = other;
        }
    }
}

struct SpecAccum {
    identifier: Option<String>,
    name: String,
    outcome: SpecRollup,
    applicable_count: i64,
    pass_count: i64,
    fail_count: i64,
    incomplete_count: i64,
    notes: Vec<String>,
}

#[derive(Default)]
struct Totals {
    pass: i64,
    fail: i64,
    not_applicable: i64,
    incomplete: i64,
}

struct AffectedObject {
    model_id: String,
    express_id: i64,
    global_id: Option<String>,
    actual: Option<String>,
    incomplete_reason: Option<String>,
}

struct Accumulated {
    key: String,
    spec_identifier: Option<String>,
    spec_name: String,
    severity: String,
    category_id: String,
    category_label: String,
    facet: String,
    title: String,
    requirement: String,
    expected: Option<String>,
    instructions: Option<String>,
    incomplete: bool,
    objects: Vec<AffectedObject>,
}

async fn persist_findings(
    pool: &SqlitePool,
    run_id: &str,
    findings: HashMap<String, Accumulated>,
) -> Result<(), ApiError> {
    let mut ordered: Vec<Accumulated> = findings.into_values().collect();
    ordered.sort_by(|a, b| {
        severity_rank(&a.severity)
            .cmp(&severity_rank(&b.severity))
            .then(b.objects.len().cmp(&a.objects.len()))
            .then(a.title.cmp(&b.title))
            .then(a.key.cmp(&b.key))
    });

    let mut tx = pool.begin().await?;
    for (index, finding) in ordered.iter().enumerate() {
        let finding_id = new_id();
        sqlx::query(
            "INSERT INTO findings (id, run_id, finding_key, spec_identifier, spec_name, severity,
                 category_id, category_label, facet, title, requirement, expected, instructions,
                 object_count, incomplete, sort_index)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        )
        .bind(&finding_id)
        .bind(run_id)
        .bind(&finding.key)
        .bind(&finding.spec_identifier)
        .bind(&finding.spec_name)
        .bind(&finding.severity)
        .bind(&finding.category_id)
        .bind(&finding.category_label)
        .bind(&finding.facet)
        .bind(&finding.title)
        .bind(&finding.requirement)
        .bind(&finding.expected)
        .bind(&finding.instructions)
        .bind(finding.objects.len() as i64)
        .bind(i64::from(finding.incomplete))
        .bind(index as i64)
        .execute(&mut *tx)
        .await?;

        for object in &finding.objects {
            sqlx::query(
                "INSERT INTO finding_objects (finding_id, model_id, object_id, express_id,
                     global_id, actual, incomplete_reason)
                 VALUES (?1, ?2,
                         (SELECT id FROM objects WHERE model_id = ?2 AND express_id = ?4),
                         ?4, ?5, ?6, ?7)",
            )
            .bind(&finding_id)
            .bind(&object.model_id)
            .bind(Option::<String>::None)
            .bind(object.express_id)
            .bind(&object.global_id)
            .bind(&object.actual)
            .bind(&object.incomplete_reason)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunDetail>, ApiError> {
    Ok(Json(run_detail(&state.pool, &run_id).await?))
}

pub async fn fetch_run_row(pool: &SqlitePool, run_id: &str) -> Result<RunRow, ApiError> {
    sqlx::query_as(&format!("{RUN_SUMMARY_SELECT} WHERE r.id = ?1"))
        .bind(run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("run"))
}

pub async fn run_counts(pool: &SqlitePool, run_id: &str) -> Result<(i64, i64), ApiError> {
    let finding_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM findings WHERE run_id = ?1")
            .bind(run_id)
            .fetch_one(pool)
            .await?;
    let failing_object_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT fo.model_id || ':' || fo.express_id)
           FROM finding_objects fo JOIN findings f ON f.id = fo.finding_id
          WHERE f.run_id = ?1 AND f.incomplete = 0",
    )
    .bind(run_id)
    .fetch_one(pool)
    .await?;
    Ok((finding_count, failing_object_count))
}

pub async fn run_detail(pool: &SqlitePool, run_id: &str) -> Result<RunDetail, ApiError> {
    let row = fetch_run_row(pool, run_id).await?;
    let (finding_count, failing_object_count) = run_counts(pool, run_id).await?;

    let models: Vec<ModelInfo> = load_run_models(pool, &row).await?.iter().map(model_json).collect();

    let finding_rows: Vec<FindingRow> = sqlx::query_as(
        "SELECT id, run_id, finding_key, spec_identifier, spec_name, severity, category_id,
                category_label, facet, title, requirement, expected, instructions, object_count,
                incomplete, sort_index
           FROM findings WHERE run_id = ?1 ORDER BY sort_index",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    let mut findings: Vec<Finding> = Vec::with_capacity(finding_rows.len());
    for finding in &finding_rows {
        let objects = finding_objects(pool, &finding.id, SAMPLE_OBJECTS, 0).await?;
        findings.push(Finding {
            id: finding.id.clone(),
            finding_key: finding.finding_key.clone(),
            spec_identifier: finding.spec_identifier.clone(),
            spec_name: finding.spec_name.clone(),
            title: finding.title.clone(),
            requirement: finding.requirement.clone(),
            expected: finding.expected.clone(),
            instructions: finding.instructions.clone(),
            facet: finding.facet.clone(),
            severity: finding.severity.clone(),
            category_id: finding.category_id.clone(),
            category_label: finding.category_label.clone(),
            object_count: finding.object_count,
            incomplete: finding.incomplete != 0,
            sample_objects: objects,
        });
    }

    // Review-incomplete findings are reported separately so they cannot hide behind a
    // passing score.
    let (incomplete, decided): (Vec<Finding>, Vec<Finding>) =
        findings.into_iter().partition(|f| f.incomplete);

    let scorecard = build_scorecard(decided);

    let specs: Vec<SpecResultRowOut> = sqlx::query_as::<_, RunSpecRow>(
        "SELECT id, run_id, spec_identifier, spec_name, outcome, applicable_count, pass_count,
                fail_count, incomplete_count, notes_json
           FROM run_specs WHERE run_id = ?1 ORDER BY spec_name",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|spec| SpecResultRowOut {
        id: spec.id,
        spec_identifier: spec.spec_identifier,
        spec_name: spec.spec_name,
        outcome: spec.outcome,
        applicable_count: spec.applicable_count,
        pass_count: spec.pass_count,
        fail_count: spec.fail_count,
        incomplete_count: spec.incomplete_count,
        notes: spec
            .notes_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
            .unwrap_or_default(),
    })
    .collect();

    Ok(RunDetail {
        run: run_summary(&row, finding_count, failing_object_count),
        models,
        scorecard,
        specs,
        review_incomplete: incomplete,
        input_provenance: InputProvenance::from_row(
            &row.input_provenance,
            row.input_provenance_reason.as_deref(),
        )
        .into(),
    })
}

/// Severity bands -> categories -> findings, ordered so the worst, widest problem is first.
fn build_scorecard(findings: Vec<Finding>) -> Vec<SeverityBand> {
    let mut bands: Vec<SeverityBand> = Vec::new();
    for severity in SEVERITY_ORDER {
        let in_band: Vec<Finding> =
            findings.iter().filter(|f| f.severity == severity).map(clone_finding).collect();
        if in_band.is_empty() {
            continue;
        }
        let mut categories: Vec<CategoryGroup> = Vec::new();
        for finding in in_band {
            match categories.iter_mut().find(|c| c.category_id == finding.category_id) {
                Some(group) => {
                    group.finding_count += 1;
                    group.object_count += finding.object_count;
                    group.findings.push(finding);
                }
                None => categories.push(CategoryGroup {
                    category_id: finding.category_id.clone(),
                    category_label: finding.category_label.clone(),
                    finding_count: 1,
                    object_count: finding.object_count,
                    findings: vec![finding],
                }),
            }
        }
        categories.sort_by(|a, b| {
            b.object_count.cmp(&a.object_count).then(a.category_label.cmp(&b.category_label))
        });
        for group in &mut categories {
            group
                .findings
                .sort_by(|a, b| b.object_count.cmp(&a.object_count).then(a.title.cmp(&b.title)));
        }
        bands.push(SeverityBand {
            severity: severity.to_owned(),
            finding_count: categories.iter().map(|c| c.finding_count).sum(),
            object_count: categories.iter().map(|c| c.object_count).sum(),
            categories,
        });
    }
    bands
}

fn clone_finding(finding: &Finding) -> Finding {
    Finding {
        id: finding.id.clone(),
        finding_key: finding.finding_key.clone(),
        spec_identifier: finding.spec_identifier.clone(),
        spec_name: finding.spec_name.clone(),
        title: finding.title.clone(),
        requirement: finding.requirement.clone(),
        expected: finding.expected.clone(),
        instructions: finding.instructions.clone(),
        facet: finding.facet.clone(),
        severity: finding.severity.clone(),
        category_id: finding.category_id.clone(),
        category_label: finding.category_label.clone(),
        object_count: finding.object_count,
        incomplete: finding.incomplete,
        sample_objects: finding
            .sample_objects
            .iter()
            .map(|o| FindingObject {
                object_id: o.object_id.clone(),
                model_id: o.model_id.clone(),
                object_ref: crate::dto::ObjectRefOut {
                    revision_id: o.object_ref.revision_id.clone(),
                    object_id: o.object_ref.object_id.clone(),
                },
                discipline: o.discipline.clone(),
                express_id: o.express_id,
                global_id: o.global_id.clone(),
                ifc_type: o.ifc_type.clone(),
                name: o.name.clone(),
                storey: o.storey.clone(),
                actual: o.actual.clone(),
                incomplete_reason: o.incomplete_reason.clone(),
            })
            .collect(),
    }
}

pub async fn finding_objects(
    pool: &SqlitePool,
    finding_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<FindingObject>, ApiError> {
    let rows: Vec<FindingObjectRow> = sqlx::query_as(
        "SELECT fo.finding_id, fo.model_id, fo.object_id, o.ref_object_id AS ref_object_id,
                fo.express_id, fo.global_id, fo.actual, fo.incomplete_reason,
                sm.discipline AS discipline, o.ifc_type AS ifc_type, o.name AS name,
                o.storey AS storey
           FROM finding_objects fo
           LEFT JOIN model_revisions mr ON mr.id = fo.model_id
           LEFT JOIN source_models sm ON sm.id = mr.source_model_id
           LEFT JOIN objects o ON o.id = fo.object_id
          WHERE fo.finding_id = ?1
          ORDER BY fo.id LIMIT ?2 OFFSET ?3",
    )
    .bind(finding_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|row| finding_object_json(&row)).collect())
}

async fn load_run_models(pool: &SqlitePool, row: &RunRow) -> Result<Vec<ModelRow>, ApiError> {
    if row.input_provenance == "complete" {
        let pinned: Vec<ModelRow> = sqlx::query_as(
            "SELECT mr.id, r.delivery_id, rm.discipline, rm.source_model_id, rm.source_model_name,
                    rm.filename, rm.content_sha256, rm.byte_size, mr.schema_label, mr.entity_count,
                    mr.product_count, mr.length_to_metre, mr.storage_path, mr.header_json, mr.parse_ms,
                    mr.uploaded_at
               FROM run_models rm
               JOIN runs r ON r.id = rm.run_id
               JOIN model_revisions mr ON mr.id = rm.model_revision_id
              WHERE rm.run_id = ?1
              ORDER BY rm.sort_index",
        )
        .bind(&row.id)
        .fetch_all(pool)
        .await?;
        if !pinned.is_empty() {
            return Ok(pinned);
        }
    }
    crate::diff::load_models(pool, &row.delivery_id).await
}
