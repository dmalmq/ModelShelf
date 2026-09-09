//! `modeldiff` — revision comparison over `fingerprint::ObjectSnapshot`.
//!
//! Matching first, change classification second. Uncertain matches stay visibly uncertain;
//! they are never reported as confirmed adds/removes.
//!
//! PUBLIC API IS A CROSS-CRATE CONTRACT: signatures below MUST NOT change.

use fingerprint::ObjectSnapshot;

mod heuristic;

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
    use std::collections::BTreeMap;

    // Per-snapshot notes, carried into whichever change the snapshot ends up in.
    let mut base_notes: Vec<Vec<String>> = vec![Vec::new(); base.len()];
    let mut head_notes: Vec<Vec<String>> = vec![Vec::new(); head.len()];

    // Exact matching pool: group by GlobalId. Snapshots without a GlobalId skip
    // straight to the heuristic pool.
    let mut base_by_gid: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    let mut head_by_gid: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    let mut base_left: Vec<usize> = Vec::new();
    let mut head_left: Vec<usize> = Vec::new();
    for (i, s) in base.iter().enumerate() {
        match &s.global_id {
            Some(gid) => base_by_gid.entry(gid.as_str()).or_default().push(i),
            None => base_left.push(i),
        }
    }
    for (i, s) in head.iter().enumerate() {
        match &s.global_id {
            Some(gid) => head_by_gid.entry(gid.as_str()).or_default().push(i),
            None => head_left.push(i),
        }
    }

    let mut changes: Vec<ObjectChange> = Vec::new();

    // Exact pairs. Duplicate GlobalIds within one revision are an export defect: pair
    // them deterministically by ascending express id and flag every affected change.
    for (gid, bidxs) in &base_by_gid {
        let Some(hidxs) = head_by_gid.get(gid) else {
            base_left.extend(bidxs.iter().copied());
            continue;
        };
        let mut bs = bidxs.clone();
        bs.sort_by_key(|&i| base[i].express_id);
        let mut hs = hidxs.clone();
        hs.sort_by_key(|&i| head[i].express_id);
        if bs.len() > 1 {
            for &i in &bs {
                base_notes[i].push("duplicate GlobalId in base revision".to_string());
            }
        }
        if hs.len() > 1 {
            for &i in &hs {
                head_notes[i].push("duplicate GlobalId in head revision".to_string());
            }
        }
        let paired = bs.len().min(hs.len());
        for k in 0..paired {
            let (bi, hi) = (bs[k], hs[k]);
            let mut notes = base_notes[bi].clone();
            notes.extend(head_notes[hi].iter().cloned());
            changes.push(classify_pair(&base[bi], &head[hi], MatchConfidence::Exact, notes, opts));
        }
        base_left.extend(bs[paired..].iter().copied());
        head_left.extend(hs[paired..].iter().copied());
    }
    for (gid, hidxs) in &head_by_gid {
        if !base_by_gid.contains_key(gid) {
            head_left.extend(hidxs.iter().copied());
        }
    }

    // Heuristic matching over the leftovers: changed or missing GlobalIds.
    if opts.heuristic_matching {
        let brefs: Vec<&ObjectSnapshot> = base_left.iter().map(|&i| &base[i]).collect();
        let hrefs: Vec<&ObjectSnapshot> = head_left.iter().map(|&i| &head[i]).collect();
        let pairs = heuristic::resolve(&brefs, &hrefs, opts.min_heuristic_score);
        let mut b_matched = vec![false; brefs.len()];
        let mut h_matched = vec![false; hrefs.len()];
        for (bi, hi, score, basis) in pairs {
            b_matched[bi] = true;
            h_matched[hi] = true;
            let b = brefs[bi];
            let h = hrefs[hi];
            let mut notes = base_notes[base_left[bi]].clone();
            notes.extend(head_notes[head_left[hi]].iter().cloned());
            changes.push(classify_pair(
                b,
                h,
                MatchConfidence::Heuristic { score, basis },
                notes,
                opts,
            ));
        }
        base_left = base_left
            .into_iter()
            .enumerate()
            .filter(|(k, _)| !b_matched[*k])
            .map(|(_, i)| i)
            .collect();
        head_left = head_left
            .into_iter()
            .enumerate()
            .filter(|(k, _)| !h_matched[*k])
            .map(|(_, i)| i)
            .collect();
    }

    // Everything left over has no counterpart.
    for i in base_left {
        changes.push(ObjectChange {
            kind: ChangeKind::Removed,
            confidence: MatchConfidence::None,
            base: Some(object_ref(&base[i])),
            head: None,
            property_changes: Vec::new(),
            moved_distance_m: None,
            notes: base_notes[i].clone(),
        });
    }
    for i in head_left {
        changes.push(ObjectChange {
            kind: ChangeKind::Added,
            confidence: MatchConfidence::None,
            base: None,
            head: Some(object_ref(&head[i])),
            property_changes: Vec::new(),
            moved_distance_m: None,
            notes: head_notes[i].clone(),
        });
    }

    // Stable presentation order: most actionable first, then by type and express id.
    changes.sort_by(|a, b| {
        kind_rank(a.kind)
            .cmp(&kind_rank(b.kind))
            .then_with(|| sort_type(a).cmp(sort_type(b)))
            .then_with(|| sort_express_id(a).cmp(&sort_express_id(b)))
    });

    let mut summary = DiffSummary::default();
    for c in &changes {
        match c.kind {
            ChangeKind::Added => summary.added += 1,
            ChangeKind::Removed => summary.removed += 1,
            ChangeKind::Unchanged => summary.unchanged += 1,
            ChangeKind::Moved => summary.moved += 1,
            ChangeKind::ShapeChanged => summary.shape_changed += 1,
            ChangeKind::PropertiesChanged => summary.properties_changed += 1,
            ChangeKind::Mixed => summary.mixed += 1,
        }
        if matches!(c.confidence, MatchConfidence::Heuristic { .. }) {
            summary.uncertain_matches += 1;
        }
    }

    ModelDiff { summary, changes }
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

fn object_ref(s: &ObjectSnapshot) -> ObjectRef {
    ObjectRef {
        express_id: s.express_id,
        global_id: s.global_id.clone(),
        ifc_type: s.ifc_type.clone(),
        name: s.name.clone(),
        storey: s.storey.clone(),
    }
}

/// Presentation order documented on `ModelDiff::changes`.
fn kind_rank(k: ChangeKind) -> u8 {
    match k {
        ChangeKind::Mixed => 0,
        ChangeKind::ShapeChanged => 1,
        ChangeKind::Moved => 2,
        ChangeKind::PropertiesChanged => 3,
        ChangeKind::Added => 4,
        ChangeKind::Removed => 5,
        ChangeKind::Unchanged => 6,
    }
}

fn sort_type(c: &ObjectChange) -> &str {
    &c.base.as_ref().or(c.head.as_ref()).expect("a change always has at least one side").ifc_type
}

fn sort_express_id(c: &ObjectChange) -> u32 {
    c.base.as_ref().or(c.head.as_ref()).expect("a change always has at least one side").express_id
}

/// Full outer join of two property lists keyed by `(pset, name)`, keeping only entries
/// whose value differs, sorted by key. Added properties have `base: None`, removed have
/// `head: None`.
fn property_changes(base: &ObjectSnapshot, head: &ObjectSnapshot) -> Vec<PropertyChange> {
    use std::collections::BTreeMap;
    let mut joined: BTreeMap<(&str, &str), (Option<&str>, Option<&str>)> = BTreeMap::new();
    for p in &base.properties {
        joined.entry((&p.pset, &p.name)).or_default().0 = Some(&p.value);
    }
    for p in &head.properties {
        joined.entry((&p.pset, &p.name)).or_default().1 = Some(&p.value);
    }
    joined
        .into_iter()
        .filter(|(_, (b, h))| b != h)
        .map(|((pset, name), (b, h))| PropertyChange {
            pset: pset.to_string(),
            name: name.to_string(),
            base: b.map(str::to_string),
            head: h.map(str::to_string),
        })
        .collect()
}

/// Classify one matched pair from its three fingerprints.
fn classify_pair(
    base: &ObjectSnapshot,
    head: &ObjectSnapshot,
    confidence: MatchConfidence,
    mut notes: Vec<String>,
    opts: &DiffOptions,
) -> ObjectChange {
    let shape_diff = base.fingerprints.shape != head.fingerprints.shape;
    let props_diff = base.fingerprints.properties != head.fingerprints.properties;
    let placement_fp_diff = base.fingerprints.placement != head.fingerprints.placement;

    let moved_distance_m = match (&base.placement, &head.placement) {
        (Some(bp), Some(hp)) => Some(heuristic::origin_distance(bp, hp)),
        _ => None,
    };

    // A translation change only counts as a move above the threshold; below it the
    // pair is unchanged-with-a-note, which suppresses exporter coordinate noise.
    // A ROTATION is not noise: it displaces no origin, so measuring displacement
    // alone would report a rotated object as unchanged. A differing placement
    // fingerprint is therefore only forgiven when the basis is identical AND the
    // displacement is sub-threshold. When the fingerprints differ but a side has
    // no placement we cannot prove the change is tiny, so it counts.
    let mut moved = false;
    if placement_fp_diff {
        let rotated = match (&base.placement, &head.placement) {
            (Some(bp), Some(hp)) => heuristic::basis_delta(bp, hp) > 0.0,
            _ => false,
        };
        if rotated {
            moved = true;
            notes.push(match moved_distance_m {
                Some(d) if d <= opts.move_threshold_m => {
                    "rotation changed; origin displacement below threshold".to_string()
                }
                _ => "rotation and origin both changed".to_string(),
            });
        } else {
            match moved_distance_m {
                Some(d) if d <= opts.move_threshold_m => {
                    notes.push(format!(
                        "sub-threshold displacement {:.6} m (threshold {:.6} m)",
                        d, opts.move_threshold_m
                    ));
                }
                Some(_) => moved = true,
                None => {
                    moved = true;
                    notes.push("placement changed; distance unknown (missing placement on one side)".to_string());
                }
            }
        }
    }

    let property_changes = property_changes(base, head);

    let kind = match (moved, shape_diff, props_diff) {
        (false, false, false) => ChangeKind::Unchanged,
        (true, false, false) => ChangeKind::Moved,
        (false, true, false) => ChangeKind::ShapeChanged,
        (false, false, true) => ChangeKind::PropertiesChanged,
        _ => ChangeKind::Mixed,
    };

    ObjectChange {
        kind,
        confidence,
        base: Some(object_ref(base)),
        head: Some(object_ref(head)),
        property_changes,
        moved_distance_m,
        notes,
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
