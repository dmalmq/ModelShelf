//! `modeldiff` — revision comparison over `fingerprint::ObjectSnapshot`.
//!
//! Matching first, change classification second. Uncertain matches stay visibly uncertain;
//! they are never reported as confirmed adds/removes.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT: signatures below MUST NOT change.

use fingerprint::ObjectSnapshot;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiffOptions {
    /// Attempt heuristic matching for objects whose GlobalId disappeared.
    pub heuristic_matching: bool,
    /// Minimum heuristic score (0..1) to report a match instead of add+remove.
    pub min_heuristic_score: f64,
    /// Distance in metres above which a placement change is reported as `Moved`.
    pub move_threshold_m: f64,
}

impl Default for DiffOptions {
    fn default() -> Self {
        DiffOptions { heuristic_matching: true, min_heuristic_score: 0.6, move_threshold_m: 0.001 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ChangeKind {
    Added,
    Removed,
    Unchanged,
    Moved,
    ShapeChanged,
    PropertiesChanged,
    /// More than one of moved/shape/properties changed.
    Mixed,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MatchConfidence {
    /// Same source model slot and same IfcGlobalId.
    Exact,
    /// GlobalId changed; matched by type + placement + shape/property similarity.
    Heuristic { score: f64, basis: String },
    /// No counterpart.
    None,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectRef {
    pub express_id: u32,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub storey: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PropertyChange {
    pub pset: String,
    pub name: String,
    pub base: Option<String>,
    pub head: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectChange {
    pub kind: ChangeKind,
    pub confidence: MatchConfidence,
    pub base: Option<ObjectRef>,
    pub head: Option<ObjectRef>,
    pub property_changes: Vec<PropertyChange>,
    /// Straight-line origin displacement in metres when both placements are known.
    pub moved_distance_m: Option<f64>,
    /// Warnings such as `duplicate GlobalId in head revision`.
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DiffSummary {
    pub added: u32,
    pub removed: u32,
    pub unchanged: u32,
    pub moved: u32,
    pub shape_changed: u32,
    pub properties_changed: u32,
    pub mixed: u32,
    pub uncertain_matches: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelDiff {
    pub summary: DiffSummary,
    /// Ordered: changes first (Mixed, ShapeChanged, Moved, PropertiesChanged, Added,
    /// Removed), `Unchanged` last.
    pub changes: Vec<ObjectChange>,
}

/// Compare two snapshot sets belonging to the same source-model slot.
pub fn diff(base: &[ObjectSnapshot], head: &[ObjectSnapshot], opts: &DiffOptions) -> ModelDiff {
    todo!("modeldiff: implement")
}

/// Compare two findings sets between runs of the **same pack version**.
/// `base`/`head` entries are `(finding_key, object_global_ids)`.
pub fn diff_findings(
    base: &[(String, Vec<String>)],
    head: &[(String, Vec<String>)],
) -> FindingDiff {
    todo!("modeldiff: implement")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum FindingDelta {
    Resolved,
    Introduced,
    Persisting,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FindingChange {
    pub finding_key: String,
    pub delta: FindingDelta,
    pub base_object_count: u32,
    pub head_object_count: u32,
    /// GlobalIds newly failing this finding.
    pub introduced_objects: Vec<String>,
    /// GlobalIds no longer failing this finding.
    pub resolved_objects: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct FindingDiff {
    pub resolved: u32,
    pub introduced: u32,
    pub persisting: u32,
    pub changes: Vec<FindingChange>,
}
