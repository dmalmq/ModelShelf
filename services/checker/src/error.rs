//! Error envelope: `{ "error": { "code", "message" } }` with the contract's codes.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    NotFound,
    BadRequest,
    DeliveryLocked,
    PackVersionMismatch,
    PackDigestMismatch,
    ScopeMismatch,
    EngineProfileMismatch,
    ProvenanceIncomplete,
    RunNotCompleted,
    RunIncomplete,
    FingerprintProfileMismatch,
    DuplicateDiscipline,
    ParseFailed,
    Internal,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::NotFound => "not_found",
            ErrorCode::BadRequest => "bad_request",
            ErrorCode::DeliveryLocked => "delivery_locked",
            ErrorCode::PackVersionMismatch => "pack_version_mismatch",
            ErrorCode::PackDigestMismatch => "pack_digest_mismatch",
            ErrorCode::ScopeMismatch => "scope_mismatch",
            ErrorCode::EngineProfileMismatch => "engine_profile_mismatch",
            ErrorCode::ProvenanceIncomplete => "provenance_incomplete",
            ErrorCode::RunNotCompleted => "run_not_completed",
            ErrorCode::RunIncomplete => "run_incomplete",
            ErrorCode::FingerprintProfileMismatch => "fingerprint_profile_mismatch",
            ErrorCode::DuplicateDiscipline => "duplicate_discipline",
            ErrorCode::ParseFailed => "parse_failed",
            ErrorCode::Internal => "internal",
        }
    }
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: ErrorCode,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: ErrorCode, message: impl Into<String>) -> Self {
        ApiError { status, code, message: message.into() }
    }
    pub fn not_found(what: impl Into<String>) -> Self {
        let what = what.into();
        ApiError::new(StatusCode::NOT_FOUND, ErrorCode::NotFound, format!("{what} not found"))
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        ApiError::new(StatusCode::BAD_REQUEST, ErrorCode::BadRequest, message)
    }
    pub fn delivery_locked() -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::DeliveryLocked,
            "delivery already has a completed run; create a new delivery for a new drop",
        )
    }
    pub fn pack_version_mismatch() -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::PackVersionMismatch,
            "runs used different pack versions; findings cannot be compared",
        )
    }
    pub fn pack_digest_mismatch(base_run_id: &str, head_run_id: &str, which: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::PackDigestMismatch,
            format!(
                "pack digest mismatch ({which}) between base run {base_run_id} and head run \
                 {head_run_id}; rerun one or both sides under identical settings before comparing"
            ),
        )
    }
    pub fn scope_mismatch(base_run_id: &str, head_run_id: &str, which: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::ScopeMismatch,
            format!(
                "check scope mismatch ({which} diverged) between base run {base_run_id} and head \
                 run {head_run_id}; rerun one or both sides under identical settings before comparing"
            ),
        )
    }
    pub fn engine_profile_mismatch(base_run_id: &str, head_run_id: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::EngineProfileMismatch,
            format!(
                "engine profile mismatch between base run {base_run_id} and head run {head_run_id}; \
                 rerun one or both sides under identical settings before comparing"
            ),
        )
    }
    pub fn provenance_incomplete(base_run_id: &str, head_run_id: &str, detail: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::ProvenanceIncomplete,
            format!(
                "run input provenance is incomplete ({detail}; base run {base_run_id}, head run \
                 {head_run_id}); rerun one or both sides under identical settings before comparing"
            ),
        )
    }
    pub fn run_not_completed(base_run_id: &str, head_run_id: &str, detail: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::RunNotCompleted,
            format!(
                "run did not complete ({detail}; base run {base_run_id}, head run {head_run_id}); \
                 rerun one or both sides under identical settings before comparing"
            ),
        )
    }
    pub fn run_incomplete(base_run_id: &str, head_run_id: &str, detail: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::RunIncomplete,
            format!(
                "run has review-incomplete outcomes ({detail}; base run {base_run_id}, head run \
                 {head_run_id}); rerun one or both sides under identical settings before comparing"
            ),
        )
    }
    pub fn fingerprint_profile_mismatch(expected: &str, actual: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::FingerprintProfileMismatch,
            format!(
                "fingerprint profile mismatch: expected {expected} but found {actual}; \
                 recompute both revisions under one profile by re-uploading \
                 (history is append-only; stored artifacts are never overwritten)"
            ),
        )
    }
    pub fn duplicate_discipline(discipline: &str) -> Self {
        ApiError::new(
            StatusCode::CONFLICT,
            ErrorCode::DuplicateDiscipline,
            format!("delivery already has a {discipline} model"),
        )
    }
    pub fn parse_failed(message: impl Into<String>) -> Self {
        ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, ErrorCode::ParseFailed, message)
    }
    pub fn internal(err: impl std::fmt::Display) -> Self {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, ErrorCode::Internal, err.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = serde_json::json!({
            "error": { "code": self.code.as_str(), "message": self.message }
        });
        (self.status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::internal(err)
    }
}
