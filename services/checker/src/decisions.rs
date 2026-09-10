use std::collections::{HashMap, HashSet};

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::db::{new_id, now_iso};
use crate::dto::{InputProvenance, RunInputProvenance, RunRow};
use crate::error::ApiError;
use crate::run::fetch_run_row;
use crate::state::AppState;

const MAX_RATIONALE_CHARS: usize = 20_000;
const MAX_CITED_FINDINGS: usize = 500;

#[derive(FromRow)]
struct DecisionRow {
    id: String,
    run_id: String,
    outcome: String,
    rationale: String,
    cited_finding_ids_json: String,
    created_at: String,
    supersedes_decision_id: Option<String>,
    superseded_by: Option<String>,
}

#[derive(FromRow)]
struct FindingEvidenceRow {
    id: String,
    title: String,
    severity: String,
    category_label: String,
    object_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDecisionBody {
    pub outcome: String,
    pub rationale: String,
    #[serde(default)]
    pub cited_finding_ids: Vec<String>,
    pub supersedes_decision_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecisionFindingEvidence {
    pub id: String,
    pub title: String,
    pub severity: String,
    pub category_label: String,
    pub object_count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecisionEvidence {
    pub run_id: String,
    pub delivery_label: String,
    pub pack_version_id: String,
    pub pack_name: String,
    pub pack_version: i64,
    pub engine_version: String,
    pub parser_version: String,
    pub input_provenance: RunInputProvenance,
    pub incomplete_count: i64,
    pub cited_findings: Vec<DecisionFindingEvidence>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecision {
    pub id: String,
    pub run_id: String,
    pub outcome: String,
    pub rationale: String,
    pub cited_finding_ids: Vec<String>,
    pub created_at: String,
    pub supersedes_decision_id: Option<String>,
    pub superseded_by: Option<String>,
    pub evidence: DecisionEvidence,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionHistory {
    pub current: Option<ReviewDecision>,
    pub history: Vec<ReviewDecision>,
}

pub async fn list_decisions(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<DecisionHistory>, ApiError> {
    Ok(Json(load_history(&state, &run_id).await?))
}

pub async fn create_decision(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(body): Json<CreateDecisionBody>,
) -> Result<Json<ReviewDecision>, ApiError> {
    validate_body(&body)?;
    let run = fetch_run_row(&state.pool, &run_id).await?;
    if run.status != "completed" {
        return Err(ApiError::decision_conflict(format!(
            "a decision requires a completed run; run {run_id} is {}",
            run.status
        )));
    }
    let finding_map = load_finding_evidence(&state.pool, &run_id).await?;
    validate_citations(&body, &finding_map)?;

    let decision_id = new_id();
    let cited_json = serde_json::to_string(&body.cited_finding_ids)
        .map_err(|error| ApiError::internal(format!("serialize cited findings: {error}")))?;
    let mut tx = state.pool.begin().await?;
    let current_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM review_decisions
          WHERE run_id = ?1 AND superseded_by IS NULL
          LIMIT 1",
    )
    .bind(&run_id)
    .fetch_optional(&mut *tx)
    .await?;

    match (&current_id, &body.supersedes_decision_id) {
        (Some(current), Some(requested)) if current == requested => {
            let updated = sqlx::query(
                "UPDATE review_decisions
                    SET superseded_by = ?1
                  WHERE id = ?2 AND run_id = ?3 AND superseded_by IS NULL",
            )
            .bind(&decision_id)
            .bind(current)
            .bind(&run_id)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() != 1 {
                return Err(ApiError::decision_conflict(
                    "the current decision changed; reload before superseding it",
                ));
            }
        }
        (Some(_), _) => {
            return Err(ApiError::decision_conflict(
                "this run already has a current decision; supersede that decision explicitly",
            ));
        }
        (None, Some(_)) => {
            return Err(ApiError::decision_conflict(
                "the decision to supersede is not current for this run",
            ));
        }
        (None, None) => {}
    }

    sqlx::query(
        "INSERT INTO review_decisions
            (id, run_id, outcome, rationale, cited_finding_ids_json, created_at,
             supersedes_decision_id, superseded_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
    )
    .bind(&decision_id)
    .bind(&run_id)
    .bind(&body.outcome)
    .bind(body.rationale.trim())
    .bind(cited_json)
    .bind(now_iso())
    .bind(body.supersedes_decision_id.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let history = load_history(&state, &run_id).await?;
    let decision = history
        .history
        .into_iter()
        .find(|candidate| candidate.id == decision_id)
        .ok_or_else(|| ApiError::internal("new decision was not readable after commit"))?;
    Ok(Json(decision))
}

async fn load_history(state: &AppState, run_id: &str) -> Result<DecisionHistory, ApiError> {
    let run = fetch_run_row(&state.pool, run_id).await?;
    let rows: Vec<DecisionRow> = sqlx::query_as(
        "SELECT id, run_id, outcome, rationale, cited_finding_ids_json, created_at,
                supersedes_decision_id, superseded_by
           FROM review_decisions
          WHERE run_id = ?1
          ORDER BY created_at DESC, id DESC",
    )
    .bind(run_id)
    .fetch_all(&state.pool)
    .await?;

    let finding_map = load_finding_evidence(&state.pool, run_id).await?;
    let mut history = Vec::with_capacity(rows.len());
    for row in rows {
        history.push(decision_json(&run, row, &finding_map)?);
    }
    let current = history
        .iter()
        .find(|decision| decision.superseded_by.is_none())
        .cloned();
    Ok(DecisionHistory { current, history })
}

async fn load_finding_evidence(
    pool: &sqlx::SqlitePool,
    run_id: &str,
) -> Result<HashMap<String, DecisionFindingEvidence>, ApiError> {
    let rows: Vec<FindingEvidenceRow> = sqlx::query_as(
        "SELECT id, title, severity, category_label, object_count
           FROM findings
          WHERE run_id = ?1",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.id.clone(),
                DecisionFindingEvidence {
                    id: row.id,
                    title: row.title,
                    severity: row.severity,
                    category_label: row.category_label,
                    object_count: row.object_count,
                },
            )
        })
        .collect())
}

fn decision_json(
    run: &RunRow,
    row: DecisionRow,
    finding_map: &HashMap<String, DecisionFindingEvidence>,
) -> Result<ReviewDecision, ApiError> {
    let cited_finding_ids: Vec<String> = serde_json::from_str(&row.cited_finding_ids_json)
        .map_err(|error| ApiError::internal(format!("invalid cited finding JSON: {error}")))?;
    let cited_findings = cited_finding_ids
        .iter()
        .filter_map(|id| finding_map.get(id).cloned())
        .collect();
    Ok(ReviewDecision {
        id: row.id,
        run_id: row.run_id,
        outcome: row.outcome,
        rationale: row.rationale,
        cited_finding_ids,
        created_at: row.created_at,
        supersedes_decision_id: row.supersedes_decision_id,
        superseded_by: row.superseded_by,
        evidence: DecisionEvidence {
            run_id: run.id.clone(),
            delivery_label: run.delivery_label.clone(),
            pack_version_id: run.pack_version_id.clone(),
            pack_name: run.pack_name.clone(),
            pack_version: run.pack_version,
            engine_version: run.engine_version.clone(),
            parser_version: run.parser_version.clone(),
            input_provenance: InputProvenance::from_row(
                &run.input_provenance,
                run.input_provenance_reason.as_deref(),
            )
            .into(),
            incomplete_count: run.incomplete_count,
            cited_findings,
        },
    })
}

fn validate_body(body: &CreateDecisionBody) -> Result<(), ApiError> {
    if !matches!(body.outcome.as_str(), "accept" | "reject" | "conditional_accept") {
        return Err(ApiError::bad_request(
            "outcome must be accept, reject, or conditional_accept",
        ));
    }
    let rationale = body.rationale.trim();
    if rationale.is_empty() {
        return Err(ApiError::bad_request("rationale must not be empty"));
    }
    if rationale.chars().count() > MAX_RATIONALE_CHARS {
        return Err(ApiError::bad_request(format!(
            "rationale must be at most {MAX_RATIONALE_CHARS} characters",
        )));
    }
    if body.cited_finding_ids.len() > MAX_CITED_FINDINGS {
        return Err(ApiError::bad_request(format!(
            "at most {MAX_CITED_FINDINGS} findings may be cited",
        )));
    }
    let mut unique = HashSet::with_capacity(body.cited_finding_ids.len());
    for id in &body.cited_finding_ids {
        if id.trim().is_empty() || !unique.insert(id) {
            return Err(ApiError::bad_request(
                "cited finding ids must be non-empty and unique",
            ));
        }
    }
    if body.outcome == "conditional_accept" && body.cited_finding_ids.is_empty() {
        return Err(ApiError::bad_request(
            "conditional_accept requires at least one cited finding",
        ));
    }
    Ok(())
}

fn validate_citations(
    body: &CreateDecisionBody,
    finding_map: &HashMap<String, DecisionFindingEvidence>,
) -> Result<(), ApiError> {
    if let Some(missing) = body
        .cited_finding_ids
        .iter()
        .find(|id| !finding_map.contains_key(*id))
    {
        return Err(ApiError::bad_request(format!(
            "finding {missing} does not belong to run",
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(outcome: &str) -> CreateDecisionBody {
        CreateDecisionBody {
            outcome: outcome.to_owned(),
            rationale: "documented review rationale".to_owned(),
            cited_finding_ids: Vec::new(),
            supersedes_decision_id: None,
        }
    }

    #[test]
    fn conditional_accept_requires_evidence() {
        assert!(validate_body(&body("conditional_accept")).is_err());
    }

    #[test]
    fn rationale_is_required() {
        let mut candidate = body("accept");
        candidate.rationale = "  ".to_owned();
        assert!(validate_body(&candidate).is_err());
    }
}
