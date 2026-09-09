//! `modeldiff` — revision comparison over normalized fingerprint snapshots.
//!
//! Matching first, change classification second. Uncertain matches stay visibly uncertain;
//! they are never reported as confirmed adds/removes.
//!
//! Comparison consumes [`normalized::DiffObject`] values (a stored
//! [`DerivedSnapshot`](fingerprint::normalized::DerivedSnapshot) plus caller-loaded
//! identity) under an explicit [`normalized::MatchPolicy`], gated on equal fingerprint
//! profiles. This crate performs no database or HTTP work and declares no
//! parser, database, or HTTP dependencies of its own: fixture comparisons run
//! without services.

pub mod normalized;

pub use fingerprint::normalized::ProfileMismatch;
pub use normalized::{DiffObject, HeuristicPolicy, IdentitySide, MatchPolicy, PropRow, compare};

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
    /// Revision this side was loaded from; always set, so every change carries
    /// its source/revision even when GlobalIds are missing or duplicated.
    pub revision_id: String,
    /// Opaque occurrence id, unique within `revision_id`.
    pub object_id: String,
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

/// Compare two findings sets between runs of the **same pack version**.
/// `base`/`head` entries are `(finding_key, object_global_ids)`.
pub fn diff_findings(
    base: &[(String, Vec<String>)],
    head: &[(String, Vec<String>)],
) -> FindingDiff {
    use std::collections::{BTreeMap, BTreeSet};

    let base_map: BTreeMap<&str, &Vec<String>> =
        base.iter().map(|(k, v)| (k.as_str(), v)).collect();
    let head_map: BTreeMap<&str, &Vec<String>> =
        head.iter().map(|(k, v)| (k.as_str(), v)).collect();

    let mut changes: Vec<FindingChange> = Vec::new();
    for key in base_map.keys().chain(head_map.keys()).copied().collect::<BTreeSet<_>>() {
        let b = base_map.get(key);
        let h = head_map.get(key);
        let base_set: BTreeSet<&str> = b.map_or_else(BTreeSet::new, |v| v.iter().map(String::as_str).collect());
        let head_set: BTreeSet<&str> = h.map_or_else(BTreeSet::new, |v| v.iter().map(String::as_str).collect());
        let delta = match (b, h) {
            (None, Some(_)) => FindingDelta::Introduced,
            (Some(_), None) => FindingDelta::Resolved,
            // A finding whose object list drained to empty is resolved, not persisting.
            (Some(_), Some(hv)) if hv.is_empty() => FindingDelta::Resolved,
            (Some(_), Some(_)) => FindingDelta::Persisting,
            (None, None) => unreachable!("key comes from the union of both maps"),
        };
        changes.push(FindingChange {
            finding_key: key.to_string(),
            delta,
            base_object_count: base_set.len() as u32,
            head_object_count: head_set.len() as u32,
            introduced_objects: head_set.difference(&base_set).map(|s| s.to_string()).collect(),
            resolved_objects: base_set.difference(&head_set).map(|s| s.to_string()).collect(),
        });
    }
    // Introduced first (new problems), then resolved, then persisting; key-sorted within.
    changes.sort_by(|a, b| {
        delta_rank(a.delta)
            .cmp(&delta_rank(b.delta))
            .then_with(|| a.finding_key.cmp(&b.finding_key))
    });

    let mut out = FindingDiff::default();
    for c in &changes {
        match c.delta {
            FindingDelta::Resolved => out.resolved += 1,
            FindingDelta::Introduced => out.introduced += 1,
            FindingDelta::Persisting => out.persisting += 1,
        }
    }
    out.changes = changes;
    out
}

fn delta_rank(d: FindingDelta) -> u8 {
    match d {
        FindingDelta::Introduced => 0,
        FindingDelta::Resolved => 1,
        FindingDelta::Persisting => 2,
    }
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
