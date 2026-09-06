//! `fingerprint` — deterministic content fingerprints for revision comparison.
//!
//! Identity vs state, the rule this crate exists to enforce:
//! - Persistent identity comes from `(source model slot, IfcGlobalId)`. Fingerprints
//!   NEVER establish identity.
//! - Fingerprints answer "did the information / placement / representation change".
//!
//! The shape fingerprint is a **normalised representation-graph hash**, not a proof of
//! geometric equivalence: two exporters can describe the same solid differently and get
//! different shape fingerprints. Documented limitation, not a bug.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT: signatures below MUST NOT change.

use ifc_model::IfcModel;

/// Normalisation tolerances. Values are rounded to these quanta before hashing.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct FpOptions {
    /// Length quantum in metres (default 1e-4 = 0.1 mm).
    pub length_quantum_m: f64,
    /// Direction-cosine quantum (default 1e-6).
    pub angle_quantum: f64,
    /// Relative quantum for unitless numeric property values (default 1e-9).
    pub numeric_quantum: f64,
    /// Property sets excluded from the property fingerprint (export noise), matched
    /// case-insensitively, e.g. `["Pset_Revit_Identity"]`.
    pub ignored_property_sets: Vec<String>,
}

impl Default for FpOptions {
    fn default() -> Self {
        FpOptions {
            length_quantum_m: 1e-4,
            angle_quantum: 1e-6,
            numeric_quantum: 1e-9,
            ignored_property_sets: Vec::new(),
        }
    }
}

/// Hex blake3 digests, 32 hex chars (128-bit prefix) — enough for change detection and
/// short enough to display.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Fingerprints {
    pub properties: String,
    pub placement: String,
    pub shape: String,
    pub combined: String,
}

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

/// Fingerprint one product occurrence.
pub fn fingerprint_object(model: &IfcModel, express_id: u32, opts: &FpOptions) -> Fingerprints {
    todo!("fingerprint: implement")
}

/// Snapshot every product occurrence in the model, ascending express id.
pub fn snapshot_model(model: &IfcModel, opts: &FpOptions) -> Vec<ObjectSnapshot> {
    todo!("fingerprint: implement")
}

/// Canonical normalised text that feeds the property hash. Exposed so the UI can explain
/// *why* a fingerprint changed and so tests can assert normalisation directly.
pub fn canonical_property_text(model: &IfcModel, express_id: u32, opts: &FpOptions) -> String {
    todo!("fingerprint: implement")
}

/// Canonical normalised text that feeds the shape hash.
pub fn canonical_shape_text(model: &IfcModel, express_id: u32, opts: &FpOptions) -> String {
    todo!("fingerprint: implement")
}

/// Round `value` to a quantum, mapping `-0.0` to `0.0` so signs never flip a hash.
pub fn quantize(value: f64, quantum: f64) -> f64 {
    todo!("fingerprint: implement")
}

/// blake3 of `text`, first 32 hex chars.
pub fn hash_text(text: &str) -> String {
    todo!("fingerprint: implement")
}
