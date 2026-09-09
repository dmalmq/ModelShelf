//! Revision comparison over normalized fingerprint snapshots.
//!
//! Matching first, change classification second. Uncertain matches stay visibly
//! uncertain; they are never reported as confirmed adds/removes.
//!
//! The comparison crate performs no database or HTTP work: the service loads and
//! persists [`DerivedSnapshot`] rows, and this module compares them. It never
//! re-quantizes anything — classification reads only digest equality, the
//! caller-supplied [`IdentitySide::origin_m`], and the [`IdentitySide::props`]
//! row join. Quantization lives in `fingerprint::normalized` under an explicit
//! [`FingerprintProfile`](fingerprint::normalized::FingerprintProfile); this
//! module only gates on the resulting `profile_id`.
//!
//! Matching rules:
//! - Every comparison gates on equal `profile_id` across both sides (via
//!   [`require_same_profile`](fingerprint::normalized::require_same_profile)
//!   semantics). Comparing snapshots fingerprinted under different profiles is a
//!   [`ProfileMismatch`], never a silent diff. Empty-vs-empty compares as an
//!   empty diff.
//! - Only GlobalIds unique on **both** sides produce [`MatchConfidence::Exact`]
//!   pairs. Duplicate or missing GlobalIds never do.
//! - Duplicate GlobalIds pair deterministically by ascending `express_id` with
//!   `duplicate GlobalId` notes and [`MatchConfidence::Heuristic`] confidence
//!   (`score: 1.0`, `basis: "type+gid-duplicate"`). Splits/merges (unequal
//!   multiplicities) leave the surplus as unresolved additions/removals.
//! - Leftover objects go through digest-equality heuristic scoring when the
//!   policy allows it (see [`score_pair`]).
//!
//! [`DerivedSnapshot`]: fingerprint::normalized::DerivedSnapshot
//! [`ProfileMismatch`]: fingerprint::normalized::ProfileMismatch

use std::collections::BTreeMap;

use fingerprint::normalized::{DerivedSnapshot, ProfileMismatch};

use super::{
    ChangeKind, MatchConfidence, ModelDiff, ObjectChange, ObjectRef, PropertyChange,
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/// One `(pset, name, value)` property row in canonical string form, as stored
/// in `object_props` (`value` is the scalar projection; `NULL` reads as `""`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PropRow {
    pub pset: String,
    pub name: String,
    pub value: String,
}

/// Caller-supplied identity and observable state for one side of a
/// [`DiffObject`]. The service rebuilds this from its stored `objects` /
/// `object_props` rows; the [`DerivedSnapshot`] it travels with is the
/// ingest-time fingerprint evidence.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IdentitySide {
    /// Opaque occurrence id (`ObjectRef.objectId`), unique within `revision_id`.
    pub object_id: String,
    pub revision_id: String,
    /// Provenance only: STEP order position. Used solely to order duplicate
    /// GlobalId pairs deterministically — never as match evidence.
    pub express_id: u32,
    pub global_id: Option<String>,
    pub ifc_type: String,
    pub name: Option<String>,
    pub storey: Option<String>,
    /// Project-frame origin in metres, read from the stored row-major 3x4
    /// placement (translation column: indices 3, 7, 11). `None` when the
    /// revision has no interpretable placement for this object.
    pub origin_m: Option<[f64; 3]>,
    /// Property rows for the before/after join. Order is insignificant.
    pub props: Vec<PropRow>,
}

/// One comparable object: ingest-time fingerprint evidence plus the identity
/// the service loaded beside it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiffObject {
    pub snapshot: DerivedSnapshot,
    pub id: IdentitySide,
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/// Whether leftover objects (changed/missing/duplicate GlobalIds) may match
/// by digest similarity.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum HeuristicPolicy {
    /// No heuristic matching: every leftover is a pure addition/removal.
    Off,
    /// Match leftovers whose [`score_pair`] score clears `min_score`.
    On { min_score: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MatchPolicy {
    pub heuristic: HeuristicPolicy,
    /// Displacement in metres above which a placement change is `Moved`.
    pub move_threshold_m: f64,
}

impl Default for MatchPolicy {
    fn default() -> Self {
        MatchPolicy { heuristic: HeuristicPolicy::On { min_score: 0.6 }, move_threshold_m: 0.001 }
    }
}

// ---------------------------------------------------------------------------
// Heuristic scoring
// ---------------------------------------------------------------------------

/// Weight model (sums to 1.0):
/// - shape digest equality:      0.40 — strongest signal; a representation-graph
///   hash survives a re-export far more often than a GlobalId does.
/// - placement:                   0.30 — full weight when the placement digests
///   match (i.e. quantized placements agree exactly); when origins differ,
///   graded linearly down to zero at 1 m of displacement. Beyond 1 m a "same
///   object" claim from position alone is no longer credible.
/// - property digest equality:   0.20
/// - name equality:               0.10 — weakest; names are routinely re-generated.
///
/// `ifc_type` equality is a hard gate, not a weight: entity types do not
/// inherit and neither does identity. With the default floor of 0.6, shape +
/// placement agreement alone (0.70) clears it, as do shape + properties + name
/// (0.70) or placement + properties + name (0.60). Shape alone (0.40) or
/// placement alone (0.30) never does.
pub const W_SHAPE: f64 = 0.40;
pub const W_PLACEMENT: f64 = 0.30;
pub const W_PROPERTIES: f64 = 0.20;
pub const W_NAME: f64 = 0.10;

/// Displacement at which the placement component grades to zero.
pub const PLACEMENT_GRADE_RANGE_M: f64 = 1.0;

/// Straight-line distance between two origins in metres.
pub fn origin_distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Score one base/head pair, returning `(score, basis)`. `None` when the hard
/// type gate fails. `basis` names the evidence that contributed, e.g.
/// `type+shape+placement`; `placement~` marks a graded (non-zero but not
/// exact) placement contribution.
pub fn score_pair(base: &DiffObject, head: &DiffObject) -> Option<(f64, String)> {
    if base.id.ifc_type != head.id.ifc_type {
        return None;
    }

    let mut score = 0.0;
    let mut evidence: Vec<&str> = vec!["type"];

    if base.snapshot.fingerprints.shape == head.snapshot.fingerprints.shape {
        score += W_SHAPE;
        evidence.push("shape");
    }

    if base.snapshot.fingerprints.placement == head.snapshot.fingerprints.placement {
        score += W_PLACEMENT;
        evidence.push("placement");
    } else if let (Some(bp), Some(hp)) = (&base.id.origin_m, &head.id.origin_m) {
        let dist = origin_distance(bp, hp);
        if dist < PLACEMENT_GRADE_RANGE_M {
            let partial = W_PLACEMENT * (1.0 - dist / PLACEMENT_GRADE_RANGE_M);
            if partial > 0.0 {
                score += partial;
                evidence.push("placement~");
            }
        }
    }

    if base.snapshot.fingerprints.properties == head.snapshot.fingerprints.properties {
        score += W_PROPERTIES;
        evidence.push("properties");
    }

    if base.id.name.is_some() && base.id.name == head.id.name {
        score += W_NAME;
        evidence.push("name");
    }

    Some((score, evidence.join("+")))
}

/// Greedy one-to-one assignment over every base×head pair that clears
/// `min_score`. Descending score; ties broken by lowest base express id, then
/// lowest head express id, so repeated runs over the same input produce the
/// same pairs. Returns matched `(base_index, head_index, score, basis)` where
/// indices address the input slices.
pub fn resolve(
    base: &[&DiffObject],
    head: &[&DiffObject],
    min_score: f64,
) -> Vec<(usize, usize, f64, String)> {
    let mut candidates: Vec<(f64, usize, usize, String)> = Vec::new();
    for (bi, b) in base.iter().enumerate() {
        for (hi, h) in head.iter().enumerate() {
            if let Some((score, basis)) = score_pair(b, h) {
                if score >= min_score {
                    candidates.push((score, bi, hi, basis));
                }
            }
        }
    }
    candidates.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| base[a.1].id.express_id.cmp(&base[b.1].id.express_id))
            .then_with(|| head[a.2].id.express_id.cmp(&head[b.2].id.express_id))
    });

    let mut used_base = vec![false; base.len()];
    let mut used_head = vec![false; head.len()];
    let mut pairs = Vec::new();
    for (score, bi, hi, basis) in candidates {
        if !used_base[bi] && !used_head[hi] {
            used_base[bi] = true;
            used_head[hi] = true;
            pairs.push((bi, hi, score, basis));
        }
    }
    pairs
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/// Gate every comparison on equal `profile_id` across both sides. Empty-vs-empty
/// compares as an empty diff; a one-sided comparison has a single profile by
/// construction. On mismatch the error names the first profile seen (base side
/// first) as expected and the first diverging one as actual, deterministically.
fn gate_profiles(base: &[DiffObject], head: &[DiffObject]) -> Result<(), ProfileMismatch> {
    let mut ids = base.iter().chain(head.iter()).map(|o| o.snapshot.profile_id.as_str());
    let Some(first) = ids.next() else {
        return Ok(());
    };
    for other in ids {
        if other != first {
            return Err(ProfileMismatch { expected: first.to_owned(), actual: other.to_owned() });
        }
    }
    Ok(())
}

/// Compare two object sets belonging to the same source-model slot.
///
/// Returns [`ProfileMismatch`] when the two sides were fingerprinted under
/// different profiles — the caller must recompute one side, never diff across
/// profiles.
pub fn compare(
    base: &[DiffObject],
    head: &[DiffObject],
    policy: &MatchPolicy,
) -> Result<ModelDiff, ProfileMismatch> {
    gate_profiles(base, head)?;

    // Per-object notes, carried into whichever change the object ends up in.
    let mut base_notes: Vec<Vec<String>> = vec![Vec::new(); base.len()];
    let mut head_notes: Vec<Vec<String>> = vec![Vec::new(); head.len()];

    // Group by GlobalId — a missing id is never identity.
    let mut base_by_gid: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    let mut head_by_gid: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    let mut base_left: Vec<usize> = Vec::new();
    let mut head_left: Vec<usize> = Vec::new();
    for (i, o) in base.iter().enumerate() {
        match &o.id.global_id {
            Some(gid) => base_by_gid.entry(gid.as_str()).or_default().push(i),
            None => base_left.push(i),
        }
    }
    for (i, o) in head.iter().enumerate() {
        match &o.id.global_id {
            Some(gid) => head_by_gid.entry(gid.as_str()).or_default().push(i),
            None => head_left.push(i),
        }
    }

    let mut changes: Vec<ObjectChange> = Vec::new();

    // GlobalId pairs. Only ids unique on BOTH sides are trusted as exact:
    // duplicate GlobalIds are an export defect, so those pairs are matched
    // deterministically by ascending express id but stay explicitly heuristic —
    // STEP order is a tie-breaker, never identity evidence.
    for (_gid, bidxs) in &base_by_gid {
        let Some(hidxs) = head_by_gid.get(_gid) else {
            base_left.extend(bidxs.iter().copied());
            continue;
        };
        let mut bs = bidxs.clone();
        bs.sort_by_key(|&i| base[i].id.express_id);
        let mut hs = hidxs.clone();
        hs.sort_by_key(|&i| head[i].id.express_id);
        let unique = bs.len() == 1 && hs.len() == 1;
        if !unique {
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
        }
        let paired = bs.len().min(hs.len());
        for k in 0..paired {
            let (bi, hi) = (bs[k], hs[k]);
            let mut notes = base_notes[bi].clone();
            notes.extend(head_notes[hi].iter().cloned());
            let confidence = if unique {
                MatchConfidence::Exact
            } else {
                MatchConfidence::Heuristic { score: 1.0, basis: "type+gid-duplicate".to_string() }
            };
            changes.push(classify_pair(&base[bi], &head[hi], confidence, notes, policy));
        }
        base_left.extend(bs[paired..].iter().copied());
        head_left.extend(hs[paired..].iter().copied());
    }
    for (gid, hidxs) in &head_by_gid {
        if !base_by_gid.contains_key(gid) {
            head_left.extend(hidxs.iter().copied());
        }
    }

    if let HeuristicPolicy::On { min_score } = policy.heuristic {
        let brefs: Vec<&DiffObject> = base_left.iter().map(|&i| &base[i]).collect();
        let hrefs: Vec<&DiffObject> = head_left.iter().map(|&i| &head[i]).collect();
        let pairs = resolve(&brefs, &hrefs, min_score);
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
                policy,
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

    // Everything left over has no counterpart. Splits/merges land here as
    // unresolved additions/removals by construction.
    for i in base_left {
        changes.push(ObjectChange {
            kind: ChangeKind::Removed,
            confidence: MatchConfidence::None,
            base: Some(object_ref(base[i].id.clone())),
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
            head: Some(object_ref(head[i].id.clone())),
            property_changes: Vec::new(),
            moved_distance_m: None,
            notes: head_notes[i].clone(),
        });
    }

    changes.sort_by(|a, b| {
        kind_rank(a.kind)
            .cmp(&kind_rank(b.kind))
            .then_with(|| sort_type(a).cmp(sort_type(b)))
            .then_with(|| sort_express_id(a).cmp(&sort_express_id(b)))
    });

    let mut summary = super::DiffSummary::default();
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

    Ok(ModelDiff { summary, changes })
}

fn object_ref(id: IdentitySide) -> ObjectRef {
    ObjectRef {
        revision_id: id.revision_id,
        object_id: id.object_id,
        express_id: id.express_id,
        global_id: id.global_id,
        ifc_type: id.ifc_type,
        name: id.name,
        storey: id.storey,
    }
}

/// Presentation order documented on [`ModelDiff`](super::ModelDiff) via
/// `changes`.
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

/// Full outer join of two property row lists keyed by `(pset, name)`, keeping
/// only entries whose value differs, sorted by key. Added properties have
/// `base: None`, removed have `head: None`.
fn property_changes(base: &IdentitySide, head: &IdentitySide) -> Vec<PropertyChange> {
    let mut joined: BTreeMap<(&str, &str), (Option<&str>, Option<&str>)> = BTreeMap::new();
    for p in &base.props {
        joined.entry((p.pset.as_str(), p.name.as_str())).or_default().0 = Some(p.value.as_str());
    }
    for p in &head.props {
        joined.entry((p.pset.as_str(), p.name.as_str())).or_default().1 = Some(p.value.as_str());
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

/// Classify one matched pair from its three digests.
///
/// A placement change only counts as a move above the policy threshold; below
/// it the pair is unchanged-with-a-note. When the digests differ but a side
/// has no origin we cannot prove the displacement is tiny, so it counts as a
/// move. Note this measures origin-to-origin distance only: a pure rotation
/// about an object's own origin has zero displacement and does not report as
/// moved on its own.
fn classify_pair(
    base: &DiffObject,
    head: &DiffObject,
    confidence: MatchConfidence,
    mut notes: Vec<String>,
    policy: &MatchPolicy,
) -> ObjectChange {
    let shape_diff = base.snapshot.fingerprints.shape != head.snapshot.fingerprints.shape;
    let props_diff =
        base.snapshot.fingerprints.properties != head.snapshot.fingerprints.properties;
    let placement_fp_diff =
        base.snapshot.fingerprints.placement != head.snapshot.fingerprints.placement;

    let moved_distance_m = match (&base.id.origin_m, &head.id.origin_m) {
        (Some(bp), Some(hp)) => Some(origin_distance(bp, hp)),
        _ => None,
    };

    let mut moved = false;
    if placement_fp_diff {
        match moved_distance_m {
            Some(d) if d <= policy.move_threshold_m => {
                notes.push(format!(
                    "sub-threshold displacement {:.6} m (threshold {:.6} m)",
                    d, policy.move_threshold_m
                ));
            }
            Some(_) => moved = true,
            None => {
                moved = true;
                notes.push(
                    "placement changed; distance unknown (missing placement on one side)"
                        .to_string(),
                );
            }
        }
    }

    let property_changes = property_changes(&base.id, &head.id);

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
        base: Some(object_ref(base.id.clone())),
        head: Some(object_ref(head.id.clone())),
        property_changes,
        moved_distance_m,
        notes,
    }
}
