//! `fingerprint` — deterministic content fingerprints for revision comparison.
//!
//! Identity vs state, the rule this crate exists to enforce:
//! - Persistent identity comes from `(source model slot, IfcGlobalId)`. Fingerprints
//!   NEVER establish identity.
//! - Fingerprints answer "did the information / placement / representation change".
//!
//! The shape fingerprint is a **normalised representation hash**, not a proof of
//! geometric equivalence: two exporters can describe the same solid differently and get
//! different shape fingerprints. Documented limitation, not a bug.
//!
//! Hashing lives entirely in [`normalized`], a pure module over the worker's
//! authoritative `SemanticObject` + `GeometryChunk` records and an explicit
//! [`normalized::FingerprintProfile`]. This crate has no IFC parser, database,
//! or HTTP dependency: the worker owns IFC interpretation, and everything here
//! reads its normalized output.
//!
//! The `IfcModel` representation-graph API that used to live here is gone. It
//! interpreted IFC a second time, in parallel with the worker, which is exactly
//! the duplication `docs/adr/0001-reusable-model-modules.md` forbids.

pub mod normalized;

pub use normalized::Fingerprints;

use model_contracts::{GeometryChunk, PropertyOrigin, SemanticObject};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PropSnapshot {
    pub pset: String,
    pub name: String,
    /// Canonical string form after unit normalisation and rounding.
    pub value: String,
    pub data_type: Option<String>,
    pub unit: Option<String>,
    /// SI-normalised numeric value when the property is numeric.
    pub numeric: Option<f64>,
    /// True when inherited from the type object.
    pub inherited: bool,
}

/// Everything the shelf stores per object, per model revision.
///
/// Carries both identity (`global_id`, `ifc_type`) and state (`fingerprints`)
/// because `modeldiff` needs identity to match a pair and fingerprints to
/// classify it. The two roles stay separate fields on purpose: matching must
/// never read a fingerprint, and classification must never read an id.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectSnapshot {
    pub express_id: u32,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub predefined_type: Option<String>,
    pub storey: Option<String>,
    /// Row-major 3x4 absolute placement in metres.
    pub placement: Option<[f64; 12]>,
    pub fingerprints: Fingerprints,
    pub properties: Vec<PropSnapshot>,
}

/// Build a comparison snapshot from the worker's normalized records.
///
/// This is the only way to produce an `ObjectSnapshot` outside the checker's
/// database, and the replacement for the deleted `snapshot_model(&IfcModel)`.
/// Native `expressId`/`globalId` travel as provenance and matching keys; they
/// never enter a hash (see [`normalized`]).
///
/// `chunk` is `None` when the object has no drawable geometry. That is not an
/// error: the shape component hashes an explicit unavailable token, so "shape
/// unknown" stays distinguishable from every real shape rather than colliding
/// with them or with each other's absence.
pub fn snapshot_from_normalized(
    object: &SemanticObject,
    chunk: Option<&GeometryChunk>,
    profile: &normalized::FingerprintProfile,
) -> ObjectSnapshot {
    let derived = normalized::fingerprint_normalized(object, chunk, profile);
    let native = object.native_ids.as_ref();
    ObjectSnapshot {
        express_id: native.and_then(|ids| ids.express_id).map(|id| id.get() as u32).unwrap_or(0),
        global_id: native.and_then(|ids| ids.global_id.as_ref()).map(|id| id.to_string()),
        ifc_type: object.classification.to_string(),
        name: object.name.clone(),
        predefined_type: None,
        storey: object.storey.clone(),
        placement: object
            .placement
            .as_ref()
            .and_then(|values| <[f64; 12]>::try_from(values.as_slice()).ok()),
        fingerprints: derived.fingerprints,
        properties: object
            .properties
            .iter()
            .map(|prop| {
                let first = prop.values.first();
                PropSnapshot {
                    pset: prop.pset.to_string(),
                    name: prop.name.to_string(),
                    value: first
                        .map(|value| format!("{:?}", value.value))
                        .unwrap_or_default(),
                    data_type: first.and_then(|value| value.dimension.map(|dim| dim.to_string())),
                    unit: first.and_then(|value| value.original_unit.clone()),
                    numeric: first.and_then(|value| value.si_value),
                    inherited: prop.origin == PropertyOrigin::Type,
                }
            })
            .collect(),
    }
}
