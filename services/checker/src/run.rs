//! Check-run execution and scorecard assembly.
//!
//! A run binds `pack_version + model content hashes + engine/parser versions` and stores
//! findings grouped by distinct violated requirement. Object-level outcomes are folded
//! into those findings, never listed one row per object — a manager reading "124 walls
//! missing a fire rating" needs one line, not 124. IfcTester is the scorer; `crates/ids`
//! is only used here to list specification names for discipline scope.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::db::{new_id, now_iso};
use crate::dto::{
    finding_object_json, model_json, run_summary, severity_rank, spec_outcome_rank, CreateRunBody, DeliveryRow,
    Finding, FindingObject, FindingObjectRow, FindingRow, InputProvenance, ModelInfo, ModelRow,
    PackVersionRow, RunDetail, RunRow, RunSpecRow, SeverityBand, SpecResultRowOut,
    COMPLETE_WITHOUT_SNAPSHOT_REASON, DELIVERY_SELECT, RUN_SUMMARY_SELECT, UNPINNED_REASON,
};
use crate::error::ApiError;
use crate::ids_meta::{finding_key, PackMetadata};
use crate::measured_inputs::{MeasuredEngine, ProcessingVersions};
use crate::scorecard::{build_scorecard, FindingMembership, ObjectIdentity};
use crate::state::{AppState, DataDirLock};
use crate::upload::sha256_hex;
use crate::worker_slot::{IdsInput, WorkerInvocation, WorkerJobId, WorkerOperation};

/// Affected objects embedded directly in the scorecard; the rest are paged.
const SAMPLE_OBJECTS: i64 = 25;

pub async fn create_run(
    State(state): State<AppState>,
    Json(body): Json<CreateRunBody>,
) -> Result<Json<RunDetail>, ApiError> {
    let pinned = PinnedRun::pin(&state, body).await?;
    let run_id = pinned.run_id().to_owned();
    pinned.settle_detached(state.clone()).await?;
    Ok(Json(run_detail(&state.pool, &run_id).await?.into()))
}

pub(crate) struct PinnedRun {
    run_id: String,
    pack_version: PackVersionRow,
    models: Vec<ModelRow>,
    metadata: PackMetadata,
    scope: HashMap<String, Vec<String>>,
}

impl PinnedRun {
    async fn pin(state: &AppState, body: CreateRunBody) -> Result<PinnedRun, ApiError> {
        let mut tx = state.pool.begin_with("BEGIN IMMEDIATE").await?;
        let delivery: DeliveryRow = sqlx::query_as(&format!("{DELIVERY_SELECT} WHERE id = ?1"))
            .bind(&body.delivery_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::not_found("delivery"))?;

        let pack_version: PackVersionRow = sqlx::query_as(
            "SELECT pv.id, pv.pack_id, p.name AS pack_name, pv.version, pv.ids_xml, pv.ids_sha256,
                    pv.metadata_json, pv.notes, pv.spec_count, pv.created_at
               FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id
              WHERE pv.id = ?1",
        )
        .bind(&body.pack_version_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::not_found("pack version"))?;

        let models: Vec<ModelRow> = sqlx::query_as(&format!(
            "{} WHERE dm.delivery_id = ?1 ORDER BY sm.discipline, sm.name",
            crate::dto::DELIVERY_MODEL_ROW_SELECT
        ))
        .bind(&delivery.id)
        .fetch_all(&mut *tx)
        .await?;
        if models.is_empty() {
            tx.rollback().await?;
            return Err(ApiError::bad_request("delivery has no models to check"));
        }

        let parsed_ids = ids::Ids::parse(&pack_version.ids_xml).map_err(|err| {
            ApiError::parse_failed(format!("pack version is not valid IDS: {err}"))
        })?;
        let spec_names: Vec<String> = parsed_ids
            .specifications
            .iter()
            .map(|spec| spec.name.clone())
            .collect();
        let metadata = PackMetadata::parse(pack_version.metadata_json.as_deref());
        let mut scope: HashMap<String, Vec<String>> = HashMap::new();
        for model in &models {
            scope
                .entry(model.discipline.clone())
                .or_insert_with(|| metadata.specification_ids_for(&spec_names, &model.discipline));
        }
        let pack_metadata_sha256 = pack_version
            .metadata_json
            .as_deref()
            .map(|text| sha256_hex(text.as_bytes()));
        let scope_json = serde_json::to_string(&scope).unwrap_or_else(|_| "{}".to_owned());

        let run_id = new_id();
        let started_at = now_iso();
        let provenance = InputProvenance::Complete;
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
        .bind("")
        .bind("")
        .bind(&started_at)
        .bind(provenance.status())
        .bind(provenance.reason())
        .bind(&pack_version.ids_sha256)
        .bind(&pack_metadata_sha256)
        .bind(&scope_json)
        .bind(Option::<String>::None)
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

        Ok(PinnedRun {
            run_id,
            pack_version,
            models,
            metadata,
            scope,
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    /// Settle on a detached task and join it. Dropping a `JoinHandle` does not
    /// cancel its task, so a client disconnect or proxy timeout cannot strand the
    /// row as `running`. A task that dies without settling (panic, abort) is
    /// recorded as a failure here so the handler never answers with a `running`
    /// body. `Err` means the terminal write itself failed.
    async fn settle_detached(self, state: AppState) -> Result<(), ApiError> {
        let run_id = self.run_id.clone();
        let clock = Instant::now();
        match tokio::spawn(self.settle(state.clone())).await {
            Ok(result) => result,
            Err(join) => {
                tracing::error!(%run_id, %join, "run settle task did not finish");
                commit_outcome(
                    &state.pool,
                    &run_id,
                    clock.elapsed(),
                    RunOutcome::Failed(RunFailure::from_text(format!("run task aborted: {join}"))),
                    &[],
                )
                .await
            }
        }
    }

    async fn settle(self, state: AppState) -> Result<(), ApiError> {
        let clock = Instant::now();
        let mut invocation_versions = Vec::new();
        let outcome = match evaluate(&state, &self, &mut invocation_versions).await {
            Ok(evaluated) => RunOutcome::Completed(evaluated),
            Err(err) => RunOutcome::Failed(RunFailure::from_api(&err)),
        };
        commit_outcome(
            &state.pool,
            &self.run_id,
            clock.elapsed(),
            outcome,
            &invocation_versions,
        )
        .await
    }
}

pub(crate) struct EvaluatedRun {
    specs: Vec<SpecAccum>,
    findings: HashMap<String, Accumulated>,
    totals: Totals,
}

pub(crate) enum RunOutcome {
    Completed(EvaluatedRun),
    Failed(RunFailure),
}

pub(crate) struct RunFailure(String);

impl RunFailure {
    pub const INTERRUPTED: &'static str =
        "interrupted: the service restarted while this run was evaluating";
    const UNRECORDED: &'static str = "run failed without a recorded reason";

    pub fn from_api(err: &ApiError) -> RunFailure {
        if err.message.trim().is_empty() {
            RunFailure(err.code.as_str().to_owned())
        } else {
            RunFailure(err.message.clone())
        }
    }

    pub fn from_text(text: impl Into<String>) -> RunFailure {
        let text = text.into();
        if text.trim().is_empty() {
            RunFailure(Self::UNRECORDED.to_owned())
        } else {
            RunFailure(text)
        }
    }

    fn from_row(error: Option<&str>) -> RunFailure {
        Self::from_text(error.unwrap_or_default())
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

async fn evaluate(
    state: &AppState,
    pinned: &PinnedRun,
    invocation_versions: &mut Vec<ProcessingVersions>,
) -> Result<EvaluatedRun, ApiError> {
    let slot = state.worker()?;
    let run_dir = state.data_dir.join("runs").join(&pinned.run_id);
    tokio::fs::create_dir_all(&run_dir)
        .await
        .map_err(|err| ApiError::internal(format!("cannot create run directory: {err}")))?;
    let ids_path = run_dir.join("pack.ids");
    tokio::fs::write(&ids_path, pinned.pack_version.ids_xml.as_bytes())
        .await
        .map_err(|err| ApiError::internal(format!("cannot write pinned IDS: {err}")))?;
    let ids_path = ids_path
        .canonicalize()
        .map_err(|err| ApiError::internal(format!("cannot resolve pinned IDS: {err}")))?;

    let mut totals = Totals::default();
    let mut findings: HashMap<String, Accumulated> = HashMap::new();
    let mut spec_rows: HashMap<String, SpecAccum> = HashMap::new();

    for model_row in &pinned.models {
        let spec_ids = pinned
            .scope
            .get(&model_row.discipline)
            .cloned()
            .unwrap_or_default();
        if spec_ids.is_empty() {
            continue;
        }
        let output_dir = run_dir.join(&model_row.id);
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|err| ApiError::internal(format!("cannot create model output dir: {err}")))?;
        let artifacts = slot
            .invoke(WorkerInvocation {
                job_id: WorkerJobId::evaluate(&pinned.run_id, &model_row.id),
                revision_id: model_row.id.clone(),
                content_sha256: model_row.content_sha256.clone(),
                output_dir,
                operation: WorkerOperation::Validate(IdsInput {
                    path: ids_path.clone(),
                    sha256: pinned.pack_version.ids_sha256.clone(),
                    specification_ids: spec_ids,
                }),
            })
            .await
            .map_err(|err| ApiError::parse_failed(format!("{}: {err}", model_row.filename)))?;
        let versions = ProcessingVersions::from_worker(&artifacts.versions)
            .map_err(|err| ApiError::parse_failed(format!("{}: {err}", model_row.filename)))?;
        invocation_versions.push(versions);

        let outcomes = parse_outcomes(&artifacts.outcomes)
            .map_err(|err| ApiError::parse_failed(format!("{}: {err}", model_row.filename)))?;
        for outcome in outcomes {
            fold_outcome(
                &mut totals,
                &mut findings,
                &mut spec_rows,
                &pinned.metadata,
                model_row,
                outcome,
            );
        }
    }

    if !invocation_versions.is_empty() {
        MeasuredEngine::from_invocations(invocation_versions).map_err(ApiError::internal)?;
    }

    Ok(EvaluatedRun {
        specs: spec_rows.into_values().collect(),
        findings,
        totals,
    })
}

async fn commit_outcome(
    pool: &SqlitePool,
    run_id: &str,
    elapsed: Duration,
    outcome: RunOutcome,
    invocation_versions: &[ProcessingVersions],
) -> Result<(), ApiError> {
    let mut tx = pool.begin().await?;
    let finished_at = now_iso();
    let duration_ms = elapsed.as_millis() as i64;
    let settled = match outcome {
        RunOutcome::Completed(evaluated) => {
            let measured = if invocation_versions.is_empty() {
                None
            } else {
                Some(
                    MeasuredEngine::from_invocations(invocation_versions)
                        .map_err(ApiError::internal)?,
                )
            };
            for spec in evaluated.specs {
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
                .execute(&mut *tx)
                .await?;
            }
            persist_findings(&mut tx, run_id, evaluated.findings).await?;
            sqlx::query(
                "UPDATE runs SET status = 'completed', finished_at = ?2, duration_ms = ?3,
                     pass_count = ?4, fail_count = ?5, not_applicable_count = ?6, incomplete_count = ?7,
                     engine_profile_json = ?8, engine_version = ?9, parser_version = ?10
                   WHERE id = ?1 AND status = 'running'",
            )
            .bind(run_id)
            .bind(&finished_at)
            .bind(duration_ms)
            .bind(evaluated.totals.pass)
            .bind(evaluated.totals.fail)
            .bind(evaluated.totals.not_applicable)
            .bind(evaluated.totals.incomplete)
            .bind(measured.as_ref().map(|engine| engine.to_profile_json()))
            .bind(
                measured
                    .as_ref()
                    .map(|engine| engine.engine_version())
                    .unwrap_or_default(),
            )
            .bind(
                measured
                    .as_ref()
                    .map(|engine| engine.parser_version())
                    .unwrap_or_default(),
            )
            .execute(&mut *tx)
            .await?
        }
        RunOutcome::Failed(failure) => {
            sqlx::query(
                "UPDATE runs SET status = 'failed', error = ?2, finished_at = ?3, duration_ms = ?4,
                     pass_count = 0, fail_count = 0, not_applicable_count = 0, incomplete_count = 0
                   WHERE id = ?1 AND status = 'running'",
            )
            .bind(run_id)
            .bind(failure.as_str())
            .bind(&finished_at)
            .bind(duration_ms)
            .execute(&mut *tx)
            .await?
        }
    };
    if settled.rows_affected() == 0 {
        tracing::warn!(
            run_id,
            "run was already settled; discarding the second outcome"
        );
        tx.rollback().await?;
        return Ok(());
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn fail_interrupted(
    tx: &mut Transaction<'_, Sqlite>,
    _lock: &DataDirLock,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        "UPDATE runs SET status = 'failed', error = ?1, finished_at = ?2, duration_ms = NULL,
             pass_count = 0, fail_count = 0, not_applicable_count = 0, incomplete_count = 0
         WHERE status = 'running'",
    )
    .bind(RunFailure::INTERRUPTED)
    .bind(now_iso())
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected())
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
    let text =
        std::str::from_utf8(bytes).map_err(|err| format!("outcomes are not utf-8: {err}"))?;
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
    let spec = spec_rows
        .entry(spec_key.clone())
        .or_insert_with(|| SpecAccum {
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

    let triage = metadata.triage(
        outcome.specification_id.as_deref(),
        &outcome.specification_name,
    );
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
            incomplete_reason: if incomplete {
                Some(failure.reason)
            } else {
                None
            },
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
    tx: &mut Transaction<'_, Sqlite>,
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
        .execute(&mut **tx)
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
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

pub async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunDetail>, ApiError> {
    Ok(Json(run_detail(&state.pool, &run_id).await?.into()))
}

pub async fn fetch_run_row(pool: &SqlitePool, run_id: &str) -> Result<RunRow, ApiError> {
    sqlx::query_as(&format!("{RUN_SUMMARY_SELECT} WHERE r.id = ?1"))
        .bind(run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("run"))
}

pub async fn run_counts(pool: &SqlitePool, run_id: &str) -> Result<(i64, i64), ApiError> {
    // Single helper: the canonical definition lives in `dto::run_extras` so run
    // detail, run summaries, and diff headers cannot diverge again.
    Ok(crate::dto::run_extras(pool, run_id).await?)
}

enum RunStatus {
    Running,
    Completed,
    Failed,
}

impl RunStatus {
    fn parse(run_id: &str, raw: &str) -> Result<RunStatus, ApiError> {
        match raw {
            "running" => Ok(RunStatus::Running),
            "completed" => Ok(RunStatus::Completed),
            "failed" => Ok(RunStatus::Failed),
            other => Err(ApiError::internal(format!(
                "run {run_id} has unknown status {other:?}"
            ))),
        }
    }
}

pub(crate) enum RunView {
    Running {
        run: RunRow,
        models: Vec<ModelInfo>,
        input_provenance: InputProvenance,
    },
    Failed {
        run: RunRow,
        error: RunFailure,
        models: Vec<ModelInfo>,
        input_provenance: InputProvenance,
    },
    Completed {
        run: RunRow,
        models: Vec<ModelInfo>,
        input_provenance: InputProvenance,
        finding_count: i64,
        failing_object_count: i64,
        scorecard: Vec<SeverityBand>,
        specs: Vec<SpecResultRowOut>,
        review_incomplete: Vec<Finding>,
    },
}

pub enum RunInputs {
    Pinned {
        models: Vec<ModelRow>,
    },
    Reconstructed {
        models: Vec<ModelRow>,
        reason: String,
    },
}

impl RunInputs {
    pub async fn load(pool: &SqlitePool, row: &RunRow) -> Result<Self, ApiError> {
        if row.input_provenance == "complete" {
            let pinned: Vec<ModelRow> = sqlx::query_as(
                "SELECT mr.id, r.delivery_id, rm.discipline, rm.source_model_id, rm.source_model_name,
                        rm.filename, rm.content_sha256, rm.byte_size, mr.schema_label, mr.entity_count,
                        mr.product_count, mr.length_to_metre, mr.storage_path, mr.header_json, mr.parse_ms,
                        mr.uploaded_at, mr.processing_versions_json
                   FROM run_models rm
                   JOIN runs r ON r.id = rm.run_id
                   JOIN model_revisions mr ON mr.id = rm.model_revision_id
                  WHERE rm.run_id = ?1
                  ORDER BY rm.sort_index",
            )
            .bind(&row.id)
            .fetch_all(pool)
            .await?;
            if pinned.is_empty() {
                return Ok(Self::Reconstructed {
                    models: Vec::new(),
                    reason: COMPLETE_WITHOUT_SNAPSHOT_REASON.to_owned(),
                });
            }
            return Ok(Self::Pinned { models: pinned });
        }
        let reason = InputProvenance::from_row(
            &row.input_provenance,
            row.input_provenance_reason.as_deref(),
        )
        .reason()
        .unwrap_or(UNPINNED_REASON)
        .to_owned();
        Ok(Self::Reconstructed {
            models: crate::diff::load_models(pool, &row.delivery_id).await?,
            reason,
        })
    }

    pub fn models(&self) -> &[ModelRow] {
        match self {
            Self::Pinned { models } | Self::Reconstructed { models, .. } => models,
        }
    }

    pub fn provenance(&self) -> InputProvenance {
        match self {
            Self::Pinned { .. } => InputProvenance::Complete,
            Self::Reconstructed { reason, .. } => InputProvenance::Incomplete {
                reason: reason.clone(),
            },
        }
    }
}

pub async fn run_detail(pool: &SqlitePool, run_id: &str) -> Result<RunView, ApiError> {
    let row = fetch_run_row(pool, run_id).await?;
    let inputs = RunInputs::load(pool, &row).await?;
    let models: Vec<ModelInfo> = inputs.models().iter().map(model_json).collect();
    let input_provenance = inputs.provenance();
    match RunStatus::parse(run_id, &row.status)? {
        RunStatus::Running => Ok(RunView::Running {
            run: row,
            models,
            input_provenance,
        }),
        RunStatus::Failed => {
            let error = RunFailure::from_row(row.error.as_deref());
            Ok(RunView::Failed {
                run: row,
                error,
                models,
                input_provenance,
            })
        }
        RunStatus::Completed => {
            let (finding_count, failing_object_count) = run_counts(pool, run_id).await?;
            let (scorecard, review_incomplete) = load_findings(pool, run_id).await?;
            let specs = load_specs(pool, run_id).await?;
            Ok(RunView::Completed {
                run: row,
                models,
                input_provenance,
                finding_count,
                failing_object_count,
                scorecard,
                specs,
                review_incomplete,
            })
        }
    }
}

impl From<RunView> for RunDetail {
    fn from(view: RunView) -> RunDetail {
        let bare = |run: RunRow,
                    models: Vec<ModelInfo>,
                    input_provenance: InputProvenance,
                    finding_count: i64,
                    failing_object_count: i64| {
            RunDetail {
                input_provenance: input_provenance.into(),
                run: run_summary(&run, finding_count, failing_object_count),
                models,
                scorecard: Vec::new(),
                specs: Vec::new(),
                review_incomplete: Vec::new(),
            }
        };
        match view {
            RunView::Running {
                run,
                models,
                input_provenance,
            } => bare(run, models, input_provenance, 0, 0),
            RunView::Failed {
                run,
                error,
                models,
                input_provenance,
            } => {
                let mut detail = bare(run, models, input_provenance, 0, 0);
                detail.run.error = Some(error.as_str().to_owned());
                detail
            }
            RunView::Completed {
                run,
                models,
                input_provenance,
                finding_count,
                failing_object_count,
                scorecard,
                specs,
                review_incomplete,
            } => {
                let mut detail = bare(
                    run,
                    models,
                    input_provenance,
                    finding_count,
                    failing_object_count,
                );
                detail.scorecard = scorecard;
                detail.specs = specs;
                detail.review_incomplete = review_incomplete;
                detail
            }
        }
    }
}

async fn load_findings(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<(Vec<SeverityBand>, Vec<Finding>), ApiError> {
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

    let (incomplete, decided): (Vec<Finding>, Vec<Finding>) =
        findings.into_iter().partition(|f| f.incomplete);
    let mut identities = load_decided_identities(pool, run_id).await?;
    let members: Vec<FindingMembership> = decided
        .into_iter()
        .map(|finding| FindingMembership {
            identities: identities.remove(&finding.id).unwrap_or_default(),
            finding,
        })
        .collect();
    Ok((build_scorecard(members), incomplete))
}

async fn load_decided_identities(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<HashMap<String, HashSet<ObjectIdentity>>, ApiError> {
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT f.id, fo.model_id, fo.express_id
           FROM findings f
           JOIN finding_objects fo ON fo.finding_id = f.id
          WHERE f.run_id = ?1 AND f.incomplete = 0",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<String, HashSet<ObjectIdentity>> = HashMap::new();
    for (finding_id, model_id, express_id) in rows {
        map.entry(finding_id)
            .or_default()
            .insert(ObjectIdentity::new(model_id, express_id));
    }
    Ok(map)
}

async fn load_specs(pool: &SqlitePool, run_id: &str) -> Result<Vec<SpecResultRowOut>, ApiError> {
    let mut specs: Vec<SpecResultRowOut> = sqlx::query_as::<_, RunSpecRow>(
        "SELECT id, run_id, spec_identifier, spec_name, outcome, applicable_count, pass_count,
                fail_count, incomplete_count, notes_json
           FROM run_specs WHERE run_id = ?1",
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
    specs.sort_by(|a, b| {
        spec_outcome_rank(&a.outcome)
            .cmp(&spec_outcome_rank(&b.outcome))
            .then(a.spec_name.cmp(&b.spec_name))
            .then(a.id.cmp(&b.id))
    });
    Ok(specs)
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

    Ok(rows
        .into_iter()
        .map(|row| finding_object_json(&row))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEAD_PID: u32 = 2_147_000_000;

    async fn seed_parents(pool: &SqlitePool) {
        for statement in [
            "INSERT INTO tenants (id, name, created_at) VALUES ('t1','Tenant',datetime())",
            "INSERT INTO projects (id, tenant_id, name, created_at) VALUES ('p1','t1','Project',datetime())",
            "INSERT INTO deliveries (id, project_id, label, created_at) VALUES ('d1','p1','D1',datetime())",
            "INSERT INTO packs (id, tenant_id, name, created_at) VALUES ('pack1','t1','Pack',datetime())",
            "INSERT INTO pack_versions (id, pack_id, version, ids_xml, ids_sha256, spec_count, created_at)
               VALUES ('pv1','pack1',1,'<ids/>','0',1,datetime())",
            "INSERT INTO source_models (id, project_id, name, discipline, created_at)
               VALUES ('s1','p1','Source','ARCH',datetime())",
            "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
                 schema_label, entity_count, product_count, storage_path, uploaded_at)
               VALUES ('m1','s1','a.ifc','0',1,'IFC4',1,1,'blobs/0',datetime())",
        ] {
            sqlx::query(statement).execute(pool).await.unwrap();
        }
    }

    async fn insert_run(pool: &SqlitePool, id: &str, status: &str, pass: i64, fail: i64) {
        sqlx::query(
            "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
                 parser_version, status, started_at, pass_count, fail_count)
             VALUES (?1,'p1','d1','pv1','eng','par',?2,datetime(),?3,?4)",
        )
        .bind(id)
        .bind(status)
        .bind(pass)
        .bind(fail)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_job(pool: &SqlitePool, id: &str, status: &str) {
        sqlx::query(
            "INSERT INTO ingestion_jobs (id, source_model_id, filename, content_sha256, byte_size,
                 storage_path, status, attempt_count, created_at)
             VALUES (?1,'s1','a.ifc','0',1,'blobs/0',?2,0,datetime())",
        )
        .bind(id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn run_row(
        pool: &SqlitePool,
        id: &str,
    ) -> (String, Option<String>, Option<i64>, i64, i64) {
        sqlx::query_as(
            "SELECT status, error, duration_ms, pass_count, fail_count FROM runs WHERE id = ?1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn count(pool: &SqlitePool, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    fn spec(name: &str, pass: i64) -> SpecAccum {
        SpecAccum {
            identifier: None,
            name: name.to_owned(),
            outcome: SpecRollup::Pass,
            applicable_count: pass,
            pass_count: pass,
            fail_count: 0,
            incomplete_count: 0,
            notes: Vec::new(),
        }
    }

    fn wall(express_id: i64) -> AffectedObject {
        AffectedObject {
            model_id: "m1".to_owned(),
            express_id,
            global_id: None,
            actual: None,
            incomplete_reason: None,
        }
    }

    fn accumulated(
        key: &str,
        title: &str,
        severity: &str,
        category_id: &str,
        category_label: &str,
        incomplete: bool,
        express_ids: &[i64],
    ) -> Accumulated {
        Accumulated {
            key: key.to_owned(),
            spec_identifier: None,
            spec_name: title.to_owned(),
            severity: severity.to_owned(),
            category_id: category_id.to_owned(),
            category_label: category_label.to_owned(),
            facet: "property".to_owned(),
            title: title.to_owned(),
            requirement: "must exist".to_owned(),
            expected: None,
            instructions: None,
            incomplete,
            objects: express_ids.iter().copied().map(wall).collect(),
        }
    }

    fn evaluated(
        specs: Vec<SpecAccum>,
        findings: Vec<Accumulated>,
        pass: i64,
        fail: i64,
    ) -> EvaluatedRun {
        EvaluatedRun {
            specs,
            findings: findings.into_iter().map(|f| (f.key.clone(), f)).collect(),
            totals: Totals {
                pass,
                fail,
                not_applicable: 0,
                incomplete: 0,
            },
        }
    }

    #[tokio::test]
    async fn exclusive_open_fails_interrupted_rows_once_and_reports_the_stale_slot() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_job(&pool, "job-live", "running").await;
        insert_job(&pool, "job-queued", "queued").await;
        insert_run(&pool, "run-live", "running", 0, 0).await;
        insert_run(&pool, "run-done", "completed", 5, 1).await;
        sqlx::query(
            "INSERT INTO findings (id, run_id, finding_key, spec_name, severity, category_id, category_label,
                 facet, title, requirement, object_count)
             VALUES ('f1','run-done','key','Spec','high','c','Cat','property','Title','must exist',1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        std::fs::write(
            dir.path().join("worker.slot"),
            format!(r#"{{"pid":{DEAD_PID},"pgid":{DEAD_PID},"kind":"validate","owner":"run-live-m1","started_at":"x"}}"#),
        )
        .unwrap();

        let (state, reconciled) = AppState::open(dir.path(), "true".to_owned()).await.unwrap();
        assert_eq!(
            (reconciled.ingestion_jobs_failed, reconciled.runs_failed),
            (1, 1)
        );
        assert_eq!(
            reconciled.orphan_worker.map(|live| (live.pid, live.kind)),
            Some((DEAD_PID, "validate".to_owned()))
        );
        assert!(
            !dir.path().join("worker.slot").exists(),
            "the stale slot file must be reconciled away"
        );

        let (job_status, job_error): (String, Option<String>) =
            sqlx::query_as("SELECT status, error FROM ingestion_jobs WHERE id = 'job-live'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(job_status, "failed");
        assert_eq!(
            job_error.as_deref(),
            Some("interrupted: the service restarted while this job was running")
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM ingestion_jobs WHERE status = 'queued'"
            )
            .await,
            1
        );

        let (status, error, duration_ms, pass, fail) = run_row(&pool, "run-live").await;
        assert_eq!(
            (status.as_str(), duration_ms, pass, fail),
            ("failed", None, 0, 0)
        );
        assert_eq!(error.as_deref(), Some(RunFailure::INTERRUPTED));
        assert_eq!(run_row(&pool, "run-done").await.0, "completed");
        assert_eq!(run_row(&pool, "run-done").await.3, 5);
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM findings WHERE run_id = 'run-done'"
            )
            .await,
            1
        );

        let detail: RunDetail = run_detail(&pool, "run-live").await.unwrap().into();
        assert_eq!(detail.run.status, "failed");
        assert!(detail
            .run
            .error
            .as_deref()
            .unwrap_or("")
            .contains("restart"));
        assert_eq!(
            (detail.scorecard.len(), detail.specs.len(), detail.run.score),
            (0, 0, None)
        );

        drop(state);
        let (_state, again) = AppState::open(dir.path(), "true".to_owned()).await.unwrap();
        assert_eq!((again.ingestion_jobs_failed, again.runs_failed), (0, 0));
        assert!(again.orphan_worker.is_none());
    }

    #[tokio::test]
    async fn exclusive_open_zeroes_counts_a_running_run_already_carried() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_run(&pool, "run-partial", "running", 12, 3).await;

        let (_state, reconciled) = AppState::open(dir.path(), "true".to_owned()).await.unwrap();
        assert_eq!(reconciled.runs_failed, 1);

        let (status, _, _, pass, fail) = run_row(&pool, "run-partial").await;
        assert_eq!((status.as_str(), pass, fail), ("failed", 0, 0));
        let detail: RunDetail = run_detail(&pool, "run-partial").await.unwrap().into();
        assert_eq!(
            (
                detail.run.pass_count,
                detail.run.fail_count,
                detail.run.score
            ),
            (0, 0, None)
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adopt_kills_orphans_after_the_group_leader_exits() {
        use std::io::{BufRead, BufReader};
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};

        let dir = tempfile::tempdir().unwrap();
        let mut leader = Command::new("sh")
            .args(["-c", "sleep 120 & echo $!; wait"])
            .process_group(0)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let leader_pid = leader.id();
        let mut stdout = BufReader::new(leader.stdout.take().unwrap());
        let mut line = String::new();
        stdout.read_line(&mut line).unwrap();
        let child_pid: u32 = line.trim().parse().expect("sleep pid");
        unsafe {
            libc::kill(leader_pid as libc::pid_t, libc::SIGKILL);
        }
        let _ = leader.wait();
        assert_eq!(
            unsafe { libc::kill(child_pid as libc::pid_t, 0) },
            0,
            "the leftover group member must still be alive after its leader exits"
        );

        std::fs::write(
            dir.path().join("worker.slot"),
            serde_json::json!({
                "pid": leader_pid,
                "pgid": leader_pid,
                "kind": "inspect",
                "owner": "job-1",
                "started_at": "x",
            })
            .to_string(),
        )
        .unwrap();

        let (_state, reconciled) = AppState::open(dir.path(), "true".to_owned()).await.unwrap();
        assert_eq!(
            reconciled.orphan_worker.as_ref().map(|live| live.pid),
            Some(leader_pid)
        );

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut gone = false;
        while Instant::now() < deadline {
            if unsafe { libc::kill(child_pid as libc::pid_t, 0) } != 0 {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            gone,
            "adopt must kill leftover members of the recorded process group, pid={child_pid}"
        );
    }

    #[tokio::test]
    async fn commit_outcome_failed_writes_no_results_and_a_later_outcome_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_run(&pool, "run-1", "running", 0, 0).await;

        let leftover = [ProcessingVersions {
            worker: "9.9.9".to_owned(),
            ifc_open_shell: "1.2.3".to_owned(),
            ifc_tester: "4.5.6".to_owned(),
            extraction: "e".to_owned(),
            scope_semantics: "s".to_owned(),
        }];
        commit_outcome(
            &pool,
            "run-1",
            Duration::from_millis(1234),
            RunOutcome::Failed(RunFailure::from_text("worker exploded")),
            &leftover,
        )
        .await
        .unwrap();
        let (status, error, duration_ms, _, _) = run_row(&pool, "run-1").await;
        assert_eq!(
            (status.as_str(), error.as_deref(), duration_ms),
            ("failed", Some("worker exploded"), Some(1234))
        );
        let (engine, parser, profile) = engine_columns(&pool, "run-1").await;
        assert_eq!((engine.as_str(), parser.as_str(), profile.as_deref()), ("eng", "par", None));
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM run_specs WHERE run_id = 'run-1'"
            )
            .await,
            0
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM findings WHERE run_id = 'run-1'"
            )
            .await,
            0
        );

        commit_outcome(
            &pool,
            "run-1",
            Duration::from_millis(1),
            RunOutcome::Completed(evaluated(vec![spec("Late", 7)], Vec::new(), 7, 0)),
            &[],
        )
        .await
        .unwrap();
        let (status, error, _, pass, _) = run_row(&pool, "run-1").await;
        assert_eq!(
            (status.as_str(), error.as_deref(), pass),
            ("failed", Some("worker exploded"), 0)
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM run_specs WHERE run_id = 'run-1'"
            )
            .await,
            0
        );
    }

    #[tokio::test]
    async fn commit_outcome_completed_writes_results_and_status_together() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_run(&pool, "run-1", "running", 0, 0).await;
        let finding = Accumulated {
            key: "k1".to_owned(),
            spec_identifier: None,
            spec_name: "Wall declares a fire rating".to_owned(),
            severity: "high".to_owned(),
            category_id: "regulatory".to_owned(),
            category_label: "Regulatory".to_owned(),
            facet: "property".to_owned(),
            title: "Fire rating".to_owned(),
            requirement: "FireRating property".to_owned(),
            expected: None,
            instructions: None,
            incomplete: false,
            objects: vec![AffectedObject {
                model_id: "m1".to_owned(),
                express_id: 1,
                global_id: None,
                actual: Some("missing".to_owned()),
                incomplete_reason: None,
            }],
        };

        let completed = evaluated(
            vec![spec("Wall declares a fire rating", 3)],
            vec![finding],
            3,
            1,
        );
        let versions = [ProcessingVersions {
            worker: "9.9.9".to_owned(),
            ifc_open_shell: "1.2.3".to_owned(),
            ifc_tester: "4.5.6".to_owned(),
            extraction: "e".to_owned(),
            scope_semantics: "s".to_owned(),
        }];
        commit_outcome(
            &pool,
            "run-1",
            Duration::from_millis(50),
            RunOutcome::Completed(completed),
            &versions,
        )
        .await
        .unwrap();

        let (status, error, duration_ms, pass, fail) = run_row(&pool, "run-1").await;
        assert_eq!(
            (status.as_str(), error, duration_ms, pass, fail),
            ("completed", None, Some(50), 3, 1)
        );
        let detail: RunDetail = run_detail(&pool, "run-1").await.unwrap().into();
        assert_eq!(detail.run.score, Some(0.75));
        assert_eq!(detail.specs.len(), 1);
        assert_eq!(detail.specs[0].spec_name, "Wall declares a fire rating");
        assert_eq!(detail.scorecard.len(), 1);
        assert_eq!(detail.scorecard[0].severity, "high");
        assert_eq!(
            detail.scorecard[0].categories[0].findings[0].title,
            "Fire rating"
        );
        assert_eq!(
            detail.scorecard[0].categories[0].findings[0].object_count,
            1
        );
        assert_eq!(
            (detail.run.finding_count, detail.run.failing_object_count),
            (1, 1)
        );
        let (engine, parser, profile) = engine_columns(&pool, "run-1").await;
        assert_eq!(engine, "ifctester/4.5.6");
        assert_eq!(parser, "ifcopenshell/1.2.3");
        let profile = profile.expect("completed settle writes engine_profile_json");
        assert!(profile.contains("9.9.9"), "{profile}");
        assert_ne!(
            profile,
            r#"{"worker":"0.1.0","ifcTester":"0.8.5","ifcOpenShell":"0.8.5","operation":"validate"}"#
        );
    }

    #[tokio::test]
    async fn run_detail_counts_distinct_objects_within_a_category() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_run(&pool, "run-overlap", "running", 0, 0).await;
        commit_outcome(
            &pool,
            "run-overlap",
            Duration::from_millis(1),
            RunOutcome::Completed(evaluated(
                vec![spec("Overlap", 0)],
                vec![
                    accumulated(
                        "k-a",
                        "Rule A",
                        "high",
                        "regulatory",
                        "Regulatory",
                        false,
                        &[1, 2],
                    ),
                    accumulated(
                        "k-b",
                        "Rule B",
                        "high",
                        "regulatory",
                        "Regulatory",
                        false,
                        &[1, 3],
                    ),
                    accumulated(
                        "k-inc",
                        "Incomplete sibling",
                        "high",
                        "regulatory",
                        "Regulatory",
                        true,
                        &[4],
                    ),
                ],
                0,
                2,
            )),
            &[],
        )
        .await
        .unwrap();

        let detail: RunDetail = run_detail(&pool, "run-overlap").await.unwrap().into();
        assert_eq!(detail.scorecard.len(), 1);
        let band = &detail.scorecard[0];
        assert_eq!(band.severity, "high");
        assert_eq!(band.finding_count, 2);
        assert_eq!(band.object_count, 3);
        assert_eq!(band.categories.len(), 1);
        assert_eq!(band.categories[0].object_count, 3);
        assert_eq!(band.categories[0].finding_count, 2);
        assert_eq!(band.categories[0].findings[0].object_count, 2);
        assert_eq!(band.categories[0].findings[1].object_count, 2);
        assert_eq!(detail.run.failing_object_count, 3);
        assert_eq!(detail.run.finding_count, 3);
        assert_eq!(detail.review_incomplete.len(), 1);
        assert_eq!(detail.review_incomplete[0].title, "Incomplete sibling");
        assert_eq!(detail.review_incomplete[0].object_count, 1);
    }

    #[tokio::test]
    async fn run_detail_counts_distinct_objects_across_categories_in_a_band() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_run(&pool, "run-cross", "running", 0, 0).await;
        commit_outcome(
            &pool,
            "run-cross",
            Duration::from_millis(1),
            RunOutcome::Completed(evaluated(
                vec![spec("Cross", 0)],
                vec![
                    accumulated("k-data", "Data rule", "high", "data", "Data", false, &[1, 2]),
                    accumulated(
                        "k-safety",
                        "Safety rule",
                        "high",
                        "safety",
                        "Safety",
                        false,
                        &[1, 3],
                    ),
                ],
                0,
                2,
            )),
            &[],
        )
        .await
        .unwrap();

        let detail: RunDetail = run_detail(&pool, "run-cross").await.unwrap().into();
        assert_eq!(detail.scorecard.len(), 1);
        let band = &detail.scorecard[0];
        assert_eq!(band.severity, "high");
        assert_eq!(band.object_count, 3);
        assert_eq!(band.categories.len(), 2);
        assert_eq!(band.categories[0].object_count, 2);
        assert_eq!(band.categories[1].object_count, 2);
        assert!(
            band.object_count < band.categories[0].object_count + band.categories[1].object_count
        );
        assert_eq!(detail.run.failing_object_count, 3);
    }

    #[tokio::test]
    async fn run_detail_orders_fail_specs_before_pass_then_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_run(&pool, "run-specs", "running", 0, 0).await;
        commit_outcome(
            &pool,
            "run-specs",
            Duration::from_millis(1),
            RunOutcome::Completed(evaluated(
                vec![
                    SpecAccum {
                        identifier: None,
                        name: "Zulu".to_owned(),
                        outcome: SpecRollup::Fail,
                        applicable_count: 1,
                        pass_count: 0,
                        fail_count: 1,
                        incomplete_count: 0,
                        notes: Vec::new(),
                    },
                    SpecAccum {
                        identifier: None,
                        name: "Alpha".to_owned(),
                        outcome: SpecRollup::Pass,
                        applicable_count: 1,
                        pass_count: 1,
                        fail_count: 0,
                        incomplete_count: 0,
                        notes: Vec::new(),
                    },
                ],
                Vec::new(),
                1,
                1,
            )),
            &[],
        )
        .await
        .unwrap();

        let detail: RunDetail = run_detail(&pool, "run-specs").await.unwrap().into();
        assert_eq!(detail.specs.len(), 2);
        assert_eq!(detail.specs[0].spec_name, "Zulu");
        assert_eq!(detail.specs[0].outcome, "fail");
        assert_eq!(detail.specs[1].spec_name, "Alpha");
        assert_eq!(detail.specs[1].outcome, "pass");
    }

    async fn insert_member(pool: &SqlitePool, id: &str, source_id: &str, revision_id: &str) {
        sqlx::query(
            "INSERT INTO delivery_members (id, delivery_id, source_model_id, model_revision_id, added_at)
             VALUES (?1,'d1',?2,?3,datetime())",
        )
        .bind(id)
        .bind(source_id)
        .bind(revision_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn engine_columns(pool: &SqlitePool, run_id: &str) -> (String, String, Option<String>) {
        sqlx::query_as(
            "SELECT engine_version, parser_version, engine_profile_json FROM runs WHERE id = ?1",
        )
        .bind(run_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    const MINIMAL_IDS: &str = r#"<ids>
  <specifications>
    <specification name="Everywhere" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements>
        <property dataType="IFCLABEL">
          <propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet>
          <baseName><simpleValue>FireRating</simpleValue></baseName>
        </property>
      </requirements>
    </specification>
  </specifications>
</ids>"#;

    const FAKE_WORKER_PY: &str = r#"
import hashlib, json, pathlib, sys
def sha256(data):
    return hashlib.sha256(data).hexdigest()
request_path = sys.argv[sys.argv.index("--request") + 1]
req = json.loads(pathlib.Path(request_path).read_text())
job_id = req["jobId"]
output_dir = pathlib.Path(req["outputDir"])
output_dir.mkdir(parents=True, exist_ok=True)
revision_id = req["model"]["revisionId"]
model_sha = req["model"]["sha256"]
express_id = 1
object_id = "occ_" + sha256(f"{revision_id}:{express_id}".encode())[:16]
def write(name, text):
    path = output_dir / name
    data = text.encode()
    path.write_bytes(data)
    return {"path": str(path), "sha256": sha256(data), "size": len(data)}
semantic = json.dumps({
    "schemaVersion": "model-v1",
    "revisionId": revision_id,
    "objects": [{
        "ref": {"revisionId": revision_id, "objectId": object_id},
        "nativeIds": {"expressId": express_id},
        "classification": "IfcWall",
        "properties": [],
    }],
}) + "\n"
semantic_info = write("semantic.json", semantic)
semantic_info["recordCount"] = 1
descriptor = json.dumps({
    "schemaVersion": "model-v1",
    "revisionId": revision_id,
    "lengthToMetre": 1,
    "upAxis": "Z_UP",
    "transform": {
        "translation": [0, 0, 0],
        "rotationQuaternion": [0, 0, 0, 1],
        "scale": [1, 1, 1],
    },
    "sourceProvenance": {
        "format": "IFC4",
        "originalFilename": "a.ifc",
        "contentHash": model_sha,
    },
    "artifacts": {
        "semantic": {
            "status": "available",
            "artifactVersion": "1",
            "contentHash": semantic_info["sha256"],
            "objectCount": 1,
        },
        "render": {"status": "unsupported", "reason": "test worker"},
    },
}) + "\n"
descriptor_info = write("descriptor.json", descriptor)
descriptor_info["recordCount"] = 1
outcomes_info = write("outcomes.jsonl", "")
outcomes_info["recordCount"] = 0
manifest = {
    "protocolVersion": 2,
    "jobId": job_id,
    "operation": "validate",
    "revisionId": revision_id,
    "modelSha256": model_sha,
    "idsSha256": None,
    "versions": {
        "worker": "9.9.9-test",
        "ifcOpenShell": "8.8.8",
        "ifcTester": "9.9.9",
        "extraction": "extract-test",
        "scopeSemantics": "scope-test",
    },
    "artifacts": {
        "descriptor": descriptor_info,
        "semantic": semantic_info,
        "renderManifest": None,
        "geometry": None,
        "outcomes": outcomes_info,
    },
    "diagnostics": [],
}
manifest_info = write("manifest.json", json.dumps(manifest))
sys.stdout.write(json.dumps({"protocolVersion": 2, "jobId": job_id, "event": "progress", "stage": "loading"}) + "\n")
sys.stdout.write(json.dumps({"protocolVersion": 2, "jobId": job_id, "event": "result", "manifest": manifest_info}) + "\n")
"#;

    #[tokio::test]
    async fn complete_without_run_models_reports_incomplete_on_get() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::open(dir.path()).await.unwrap();
        seed_parents(&pool).await;
        insert_member(&pool, "dm1", "s1", "m1").await;
        sqlx::query(
            "INSERT INTO source_models (id, project_id, name, discipline, created_at)
             VALUES ('s2','p1','Other','MEP',datetime())",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size,
                 schema_label, entity_count, product_count, storage_path, uploaded_at)
             VALUES ('m2','s2','b.ifc','1',1,'IFC4',1,1,'blobs/1',datetime())",
        )
        .execute(&pool)
        .await
        .unwrap();
        insert_member(&pool, "dm2", "s2", "m2").await;
        sqlx::query(
            "INSERT INTO runs (id, project_id, delivery_id, pack_version_id, engine_version,
                 parser_version, status, started_at, input_provenance)
             VALUES ('run-bare','p1','d1','pv1','eng','par','completed',datetime(),'complete')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let detail: RunDetail = run_detail(&pool, "run-bare").await.unwrap().into();
        assert_eq!(detail.input_provenance.status, "incomplete");
        assert!(
            detail
                .input_provenance
                .reason
                .as_deref()
                .unwrap_or("")
                .contains("run_models snapshot"),
            "{:?}",
            detail.input_provenance.reason
        );
        assert_eq!(
            detail.input_provenance.reason.as_deref(),
            Some(COMPLETE_WITHOUT_SNAPSHOT_REASON)
        );
        let live = crate::diff::load_models(&pool, "d1").await.unwrap();
        assert_eq!(live.len(), 2);
        let ids: Vec<&str> = detail
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect();
        assert!(
            detail.models.is_empty(),
            "must not serve live membership for a complete claim with no run_models: {ids:?}"
        );
        assert_ne!(
            ids.len(),
            live.len(),
            "GET models must not equal current delivery membership"
        );
    }

    #[tokio::test]
    async fn pin_rejects_a_delivery_with_no_models() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = AppState::open(dir.path(), "false".to_owned())
            .await
            .unwrap();
        seed_parents(&state.pool).await;
        let err = match PinnedRun::pin(
            &state,
            CreateRunBody {
                delivery_id: "d1".to_owned(),
                pack_version_id: "pv1".to_owned(),
            },
        )
        .await
        {
            Ok(_) => panic!("empty delivery must not pin"),
            Err(err) => err,
        };
        assert_eq!(err.message, "delivery has no models to check");
        let runs: i64 = count(&state.pool, "SELECT COUNT(*) FROM runs").await;
        assert_eq!(runs, 0);
    }

    #[tokio::test]
    async fn zero_scope_run_leaves_pin_engine_columns() {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = AppState::open(dir.path(), "false".to_owned())
            .await
            .unwrap();
        seed_parents(&state.pool).await;
        insert_member(&state.pool, "dm1", "s1", "m1").await;
        sqlx::query("UPDATE pack_versions SET ids_xml = ?1, metadata_json = ?2 WHERE id = 'pv1'")
            .bind(MINIMAL_IDS)
            .bind(r#"{"specs":{"Everywhere":{"disciplines":["MEP"]}}}"#)
            .execute(&state.pool)
            .await
            .unwrap();

        let pinned = PinnedRun::pin(
            &state,
            CreateRunBody {
                delivery_id: "d1".to_owned(),
                pack_version_id: "pv1".to_owned(),
            },
        )
        .await
        .unwrap();
        let run_id = pinned.run_id().to_owned();
        let (engine, parser, profile) = engine_columns(&state.pool, &run_id).await;
        assert_eq!(
            (engine.as_str(), parser.as_str(), profile.as_deref()),
            ("", "", None)
        );

        pinned.settle(state.clone()).await.unwrap();
        let (engine, parser, profile) = engine_columns(&state.pool, &run_id).await;
        assert_eq!(
            (engine.as_str(), parser.as_str(), profile.as_deref()),
            ("", "", None)
        );
        let detail: RunDetail = run_detail(&state.pool, &run_id).await.unwrap().into();
        assert_eq!(detail.run.status, "completed");
        assert_eq!(detail.input_provenance.status, "complete");
        assert_eq!(detail.run.engine_version, "");
    }

    #[tokio::test]
    async fn settle_writes_measured_engine_not_pin_literal() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fake_worker.py");
        std::fs::write(&script, FAKE_WORKER_PY).unwrap();
        let worker = format!("python3 {} --request {{request}}", script.display());
        let (state, _) = AppState::open(dir.path(), worker).await.unwrap();
        seed_parents(&state.pool).await;
        insert_member(&state.pool, "dm1", "s1", "m1").await;
        sqlx::query("UPDATE pack_versions SET ids_xml = ?1 WHERE id = 'pv1'")
            .bind(MINIMAL_IDS)
            .execute(&state.pool)
            .await
            .unwrap();
        let blob_sha = "0".repeat(64);
        sqlx::query("UPDATE model_revisions SET content_sha256 = ?1 WHERE id = 'm1'")
            .bind(&blob_sha)
            .execute(&state.pool)
            .await
            .unwrap();
        tokio::fs::write(state.data_dir.join("blobs").join(&blob_sha), b"ifc")
            .await
            .unwrap();

        let pinned = PinnedRun::pin(
            &state,
            CreateRunBody {
                delivery_id: "d1".to_owned(),
                pack_version_id: "pv1".to_owned(),
            },
        )
        .await
        .unwrap();
        let run_id = pinned.run_id().to_owned();
        let (engine, parser, profile) = engine_columns(&state.pool, &run_id).await;
        assert_eq!(
            (engine.as_str(), parser.as_str(), profile.as_deref()),
            ("", "", None)
        );

        pinned.settle(state.clone()).await.unwrap();
        let (status, error, _, _, _) = run_row(&state.pool, &run_id).await;
        assert_eq!(
            (status.as_str(), error.as_deref()),
            ("completed", None),
            "settle must complete by invoking the fake worker"
        );
        let (engine, parser, profile) = engine_columns(&state.pool, &run_id).await;
        assert_eq!(engine, "ifctester/9.9.9");
        assert_eq!(parser, "ifcopenshell/8.8.8");
        let profile = profile.expect("settle must write engine_profile_json");
        assert!(profile.contains("9.9.9-test"), "{profile}");
        assert!(profile.contains("extract-test"), "{profile}");
        assert!(
            !profile.contains("0.1.0") && !profile.contains("0.8.5"),
            "{profile}"
        );
        let detail: RunDetail = run_detail(&state.pool, &run_id).await.unwrap().into();
        assert_eq!(detail.run.status, "completed");
        assert_eq!(detail.run.engine_version, "ifctester/9.9.9");
        assert_eq!(detail.input_provenance.status, "complete");
    }
}
