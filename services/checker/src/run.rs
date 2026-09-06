//! Check-run execution and scorecard assembly.
//!
//! A run binds `pack_version + model content hashes + engine/parser versions` and stores
//! findings grouped by distinct violated requirement. Object-level outcomes are folded
//! into those findings, never listed one row per object — a manager reading "124 walls
//! missing a fire rating" needs one line, not 124.

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::Json;
use ids::{Ids, Outcome};
use ifc_model::IfcModel;
use sqlx::SqlitePool;

use crate::db::{new_id, now_iso};
use crate::dto::{
    model_json, run_summary, severity_rank, CategoryGroup, CreateRunBody, DeliveryRow, Finding,
    FindingObject, FindingObjectRow, FindingRow, ModelInfo, ModelRow, PackVersionRow, RunDetail,
    RunRow, RunSpecRow, SeverityBand, SpecResultRowOut, RUN_SUMMARY_SELECT, SEVERITY_ORDER,
};
use crate::error::ApiError;
use crate::ids_meta::{finding_key, PackMetadata};
use crate::state::AppState;

/// Affected objects embedded directly in the scorecard; the rest are paged.
const SAMPLE_OBJECTS: i64 = 25;

pub async fn create_run(
    State(state): State<AppState>,
    Json(body): Json<CreateRunBody>,
) -> Result<Json<RunDetail>, ApiError> {
    let delivery: DeliveryRow = sqlx::query_as(
        "SELECT id, project_id, label, delivery_date, created_at FROM deliveries WHERE id = ?1",
    )
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

    let models: Vec<ModelRow> = sqlx::query_as(
        "SELECT id, delivery_id, discipline, filename, content_sha256, byte_size, schema_label,
                entity_count, product_count, length_to_metre, storage_path, header_json,
                parse_ms, uploaded_at
           FROM models WHERE delivery_id = ?1 ORDER BY discipline",
    )
    .bind(&delivery.id)
    .fetch_all(&state.pool)
    .await?;
    if models.is_empty() {
        return Err(ApiError::bad_request("delivery has no models to check"));
    }

    let run_id = new_id();
    let started_at = now_iso();
    sqlx::query(
        "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
             parser_version, status, started_at)
         VALUES (?1,?2,?3,?4,?5,?6,'running',?7)",
    )
    .bind(&run_id)
    .bind(&delivery.project_id)
    .bind(&delivery.id)
    .bind(&pack_version.id)
    .bind(ids::ENGINE_VERSION)
    .bind(ifc_model::PARSER_VERSION)
    .bind(&started_at)
    .execute(&state.pool)
    .await?;

    let clock = std::time::Instant::now();
    match execute(&state, &run_id, &pack_version, &models).await {
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

/// Parse every model, evaluate the pinned pack, and persist findings.
async fn execute(
    state: &AppState,
    run_id: &str,
    pack_version: &PackVersionRow,
    models: &[ModelRow],
) -> Result<(), ApiError> {
    let ids = Ids::parse(&pack_version.ids_xml)
        .map_err(|err| ApiError::parse_failed(format!("pack version is not valid IDS: {err}")))?;
    let metadata = PackMetadata::parse(pack_version.metadata_json.as_deref());

    let mut totals = Totals::default();
    // finding_key -> accumulated finding
    let mut findings: HashMap<String, Accumulated> = HashMap::new();

    for model_row in models {
        let bytes = state
            .read_verified_blob(&model_row.storage_path, &model_row.content_sha256)
            .await?;
        let model = IfcModel::parse(&bytes)
            .map_err(|err| ApiError::parse_failed(format!("{}: {err}", model_row.filename)))?;
        let report = ids::evaluate(&model, &ids);

        totals.pass += report.total_pass as i64;
        totals.fail += report.total_fail as i64;
        totals.not_applicable += report.total_not_applicable as i64;
        totals.incomplete += report.total_incomplete as i64;

        for spec in &report.specs {
            sqlx::query(
                "INSERT INTO run_specs (id, run_id, spec_identifier, spec_name, outcome,
                     applicable_count, pass_count, fail_count, incomplete_count, notes_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            )
            .bind(new_id())
            .bind(run_id)
            .bind(spec.identifier.clone())
            .bind(&spec.name)
            .bind(outcome_str(spec.outcome))
            .bind(spec.applicable_count as i64)
            .bind(spec.pass_count as i64)
            .bind(spec.fail_count as i64)
            .bind(spec.incomplete_count as i64)
            .bind(serde_json::to_string(&spec.notes).unwrap_or_else(|_| "[]".to_owned()))
            .execute(&state.pool)
            .await?;

            let spec_key = spec.identifier.clone().unwrap_or_else(|| spec.name.clone());
            let triage = metadata.triage(spec.identifier.as_deref(), &spec.name);

            // A specification that fails as a whole (e.g. nothing matched a required
            // applicability) still needs a finding, or the failure would vanish.
            if spec.outcome == Outcome::Fail && spec.outcomes.is_empty() {
                let requirement = spec
                    .notes
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "specification-level failure".to_owned());
                let key = finding_key(&spec_key, "specification", &requirement);
                findings.entry(key.clone()).or_insert_with(|| Accumulated {
                    key,
                    spec_identifier: spec.identifier.clone(),
                    spec_name: spec.name.clone(),
                    severity: triage.severity.clone(),
                    category_id: triage.category_id.clone(),
                    category_label: triage.category_label.clone(),
                    facet: "entity".to_owned(),
                    title: triage.title.clone(),
                    requirement,
                    expected: None,
                    instructions: spec.instructions.clone(),
                    incomplete: false,
                    objects: Vec::new(),
                });
                continue;
            }

            for outcome in &spec.outcomes {
                let facet = outcome.facet.as_str().to_owned();
                let key = finding_key(&spec_key, &facet, &outcome.requirement);
                let entry = findings.entry(key.clone()).or_insert_with(|| Accumulated {
                    key: key.clone(),
                    spec_identifier: spec.identifier.clone(),
                    spec_name: spec.name.clone(),
                    severity: triage.severity.clone(),
                    category_id: triage.category_id.clone(),
                    category_label: triage.category_label.clone(),
                    facet,
                    title: triage.title.clone(),
                    requirement: outcome.requirement.clone(),
                    expected: outcome.expected.clone(),
                    instructions: spec.instructions.clone(),
                    incomplete: outcome.incomplete_reason.is_some(),
                    objects: Vec::new(),
                });
                entry.objects.push(AffectedObject {
                    model_id: model_row.id.clone(),
                    express_id: outcome.express_id as i64,
                    global_id: outcome.global_id.clone(),
                    actual: outcome.actual.clone(),
                    incomplete_reason: outcome.incomplete_reason.clone(),
                });
            }
        }
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

fn outcome_str(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Pass => "pass",
        Outcome::Fail => "fail",
        Outcome::NotApplicable => "not_applicable",
        Outcome::ReviewIncomplete => "review_incomplete",
    }
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

    let models: Vec<ModelInfo> = sqlx::query_as::<_, ModelRow>(
        "SELECT id, delivery_id, discipline, filename, content_sha256, byte_size, schema_label,
                entity_count, product_count, length_to_metre, storage_path, header_json,
                parse_ms, uploaded_at
           FROM models WHERE delivery_id = ?1 ORDER BY discipline",
    )
    .bind(&row.delivery_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(model_json)
    .collect();

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
        "SELECT fo.finding_id, fo.model_id, fo.object_id, fo.express_id, fo.global_id,
                fo.actual, fo.incomplete_reason,
                m.discipline AS discipline, o.ifc_type AS ifc_type, o.name AS name,
                o.storey AS storey
           FROM finding_objects fo
           JOIN models m ON m.id = fo.model_id
           LEFT JOIN objects o ON o.id = fo.object_id
          WHERE fo.finding_id = ?1
          ORDER BY fo.id LIMIT ?2 OFFSET ?3",
    )
    .bind(finding_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| FindingObject {
            object_id: row.object_id,
            model_id: row.model_id,
            discipline: row.discipline.unwrap_or_else(|| "OTHER".to_owned()),
            express_id: row.express_id,
            global_id: row.global_id,
            ifc_type: row.ifc_type.unwrap_or_else(|| "UNKNOWN".to_owned()),
            name: row.name,
            storey: row.storey,
            actual: row.actual,
            incomplete_reason: row.incomplete_reason,
        })
        .collect())
}
