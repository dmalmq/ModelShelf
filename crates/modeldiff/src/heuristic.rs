//! Heuristic candidate scoring for objects whose GlobalId changed or is missing.
//!
//! Weight model (sums to 1.0):
//! - shape fingerprint equality:      0.40 — strongest signal; a representation-graph
//!   hash survives a re-export far more often than a GlobalId does.
//! - placement:                       0.30 — full weight when the placement fingerprints
//!   match (i.e. quantized placements agree exactly); when origins differ, graded
//!   linearly down to zero at 1 m of displacement. Beyond 1 m a "same object" claim from
//!   position alone is no longer credible.
//! - property fingerprint equality:   0.20
//! - name equality:                   0.10 — weakest; names are routinely re-generated.
//!
//! `ifc_type` equality is a hard gate, not a weight: entity types do not inherit and
//! neither does identity. With the default floor of 0.6, shape + placement agreement
//! alone (0.70) clears it, as do shape + properties + name (0.70) or placement +
//! properties + name (0.60). Shape alone (0.40) or placement alone (0.30) never does.

use fingerprint::ObjectSnapshot;

pub const W_SHAPE: f64 = 0.40;
pub const W_PLACEMENT: f64 = 0.30;
pub const W_PROPERTIES: f64 = 0.20;
pub const W_NAME: f64 = 0.10;

/// Displacement at which the placement component grades to zero.
pub const PLACEMENT_GRADE_RANGE_M: f64 = 1.0;

/// Origin translation components of a `schemas/model/v1` placement: a row-major
/// 3x4 matrix, `[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]`, so the
/// translation is the fourth entry of each row.
///
/// This layout is the worker's, and the worker is the only producer now. It is
/// NOT the `[xx,xy,xz, yx,yy,yz, zx,zy,zz, ox,oy,oz]` layout the deleted
/// `ifc_model::Transform::to_array12` used, which put the origin last. Reading
/// one as the other silently returns rotation components as the origin: a pure
/// translation then measures as zero displacement and vanishes from move
/// detection and from this module's placement match scoring.
fn origin(placement: &[f64; 12]) -> [f64; 3] {
    [placement[3], placement[7], placement[11]]
}

/// The 3x3 rotation basis, row-major, with the translation column dropped.
fn basis(placement: &[f64; 12]) -> [f64; 9] {
    [
        placement[0], placement[1], placement[2], placement[4], placement[5], placement[6],
        placement[8], placement[9], placement[10],
    ]
}

/// Largest absolute difference between two rotation bases. Direction cosines are
/// dimensionless and bounded by 1, so a plain max-delta is a sound rotation test
/// and needs no angle reconstruction.
pub fn basis_delta(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    basis(a)
        .iter()
        .zip(basis(b).iter())
        .map(|(x, y)| (x - y).abs())
        .fold(0.0, f64::max)
}

/// Straight-line distance between two placements' origins.
pub fn origin_distance(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    let [ax, ay, az] = origin(a);
    let [bx, by, bz] = origin(b);
    ((ax - bx).powi(2) + (ay - by).powi(2) + (az - bz).powi(2)).sqrt()
}

/// Score one base/head pair, returning `(score, basis)`. `None` when the hard type
/// gate fails. `basis` names the evidence that contributed, e.g. `type+shape+placement`;
/// `placement~` marks a graded (non-zero but not exact) placement contribution.
pub fn score_pair(base: &ObjectSnapshot, head: &ObjectSnapshot) -> Option<(f64, String)> {
    if base.ifc_type != head.ifc_type {
        return None;
    }

    let mut score = 0.0;
    let mut evidence: Vec<&str> = vec!["type"];

    if base.fingerprints.shape == head.fingerprints.shape {
        score += W_SHAPE;
        evidence.push("shape");
    }

    if base.fingerprints.placement == head.fingerprints.placement {
        score += W_PLACEMENT;
        evidence.push("placement");
    } else if let (Some(bp), Some(hp)) = (&base.placement, &head.placement) {
        let dist = origin_distance(bp, hp);
        if dist < PLACEMENT_GRADE_RANGE_M {
            let partial = W_PLACEMENT * (1.0 - dist / PLACEMENT_GRADE_RANGE_M);
            if partial > 0.0 {
                score += partial;
                evidence.push("placement~");
            }
        }
    }

    if base.fingerprints.properties == head.fingerprints.properties {
        score += W_PROPERTIES;
        evidence.push("properties");
    }

    if base.name.is_some() && base.name == head.name {
        score += W_NAME;
        evidence.push("name");
    }

    Some((score, evidence.join("+")))
}

/// Greedy one-to-one assignment over every base×head pair that clears `min_score`.
/// Descending score; ties broken by lowest base express id, then lowest head express id,
/// so repeated runs over the same input produce the same pairs. Returns matched
/// `(base_index, head_index, score, basis)` where indices address the input slices.
pub fn resolve(
    base: &[&ObjectSnapshot],
    head: &[&ObjectSnapshot],
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
            .then_with(|| base[a.1].express_id.cmp(&base[b.1].express_id))
            .then_with(|| head[a.2].express_id.cmp(&head[b.2].express_id))
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
