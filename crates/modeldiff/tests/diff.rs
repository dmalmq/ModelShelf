//! `DiffObject` fixtures built in code — no IFC parsing, no services.
//!
//! The digests here are opaque short tokens standing in for the 64-hex BLAKE3
//! digests ingest stores; only equality between sides matters to `compare`.

use fingerprint::normalized::{DerivedSnapshot, FingerprintProfile, Fingerprints};
use modeldiff::{
    ChangeKind, DiffObject, FindingDelta, HeuristicPolicy, IdentitySide, MatchConfidence,
    MatchPolicy, PropRow, compare, diff_findings,
};

const PROFILE_ID: &str = "test-profile-id";
const PROFILE_VERSION: &str = "fp-v1";

fn fps(properties: &str, placement: &str, shape: &str) -> Fingerprints {
    Fingerprints {
        properties: properties.to_string(),
        placement: placement.to_string(),
        shape: shape.to_string(),
        combined: format!("{properties}|{placement}|{shape}|{PROFILE_ID}"),
    }
}

fn snapshot(object_id: &str, profile_id: &str, p: &str, l: &str, s: &str) -> DerivedSnapshot {
    DerivedSnapshot {
        object_id: object_id.to_string(),
        profile_version: PROFILE_VERSION.to_string(),
        profile_id: profile_id.to_string(),
        fingerprints: fps(p, l, s),
        canonical_properties: format!("props:{p}"),
        canonical_placement: format!("place:{l}"),
        canonical_shape: format!("shape:{s}"),
    }
}

/// Baseline object: wall at the origin with identical digests everywhere.
fn obj(express_id: u32, gid: Option<&str>, ifc_type: &str) -> DiffObject {
    let object_id = format!("occ-{express_id:04}");
    DiffObject {
        snapshot: snapshot(&object_id, PROFILE_ID, "p", "l", "s"),
        id: IdentitySide {
            object_id,
            revision_id: "rev-test".to_string(),
            express_id,
            global_id: gid.map(str::to_string),
            ifc_type: ifc_type.to_string(),
            name: Some(format!("obj-{express_id}")),
            storey: None,
            origin_m: Some([0.0, 0.0, 0.0]),
            props: Vec::new(),
        },
    }
}

fn obj_with_profile(express_id: u32, gid: Option<&str>, profile_id: &str) -> DiffObject {
    let mut o = obj(express_id, gid, "IFCWALL");
    o.snapshot.profile_id = profile_id.to_string();
    o
}

fn with_origin(mut o: DiffObject, x: f64, y: f64, z: f64) -> DiffObject {
    o.id.origin_m = Some([x, y, z]);
    o
}

fn without_origin(mut o: DiffObject) -> DiffObject {
    o.id.origin_m = None;
    o
}

fn with_fps(mut o: DiffObject, p: &str, l: &str, s: &str) -> DiffObject {
    o.snapshot.fingerprints = fps(p, l, s);
    o
}

fn with_props(mut o: DiffObject, rows: &[(&str, &str, &str)]) -> DiffObject {
    o.id.props = rows
        .iter()
        .map(|(pset, name, value)| PropRow {
            pset: (*pset).to_string(),
            name: (*name).to_string(),
            value: (*value).to_string(),
        })
        .collect();
    o
}

fn with_name(mut o: DiffObject, name: &str) -> DiffObject {
    o.id.name = Some(name.to_string());
    o
}

fn policy() -> MatchPolicy {
    MatchPolicy::default()
}

#[test]
fn unchanged_exact_pair() {
    let base = vec![obj(10, Some("g1"), "IFCWALL")];
    let head = vec![obj(20, Some("g1"), "IFCWALL")];
    let d = compare(&base, &head, &policy()).unwrap();
    assert_eq!(d.changes.len(), 1);
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Unchanged);
    assert_eq!(c.confidence, MatchConfidence::Exact);
    assert_eq!(c.moved_distance_m, Some(0.0));
    assert!(c.property_changes.is_empty());
    assert!(c.notes.is_empty());
    assert_eq!(d.summary.unchanged, 1);
    assert_eq!(d.summary.uncertain_matches, 0);
}

#[test]
fn empty_vs_empty_is_an_empty_diff() {
    let d = compare(&[], &[], &policy()).unwrap();
    assert!(d.changes.is_empty());
    assert_eq!(d.summary.added, 0);
    assert_eq!(d.summary.uncertain_matches, 0);
}

#[test]
fn one_sided_member_is_pure_add_remove() {
    let head = vec![obj(20, Some("g-new"), "IFCWALL")];
    let d = compare(&[], &head, &policy()).unwrap();
    assert_eq!(d.changes.len(), 1);
    assert_eq!(d.changes[0].kind, ChangeKind::Added);
    assert_eq!(d.changes[0].confidence, MatchConfidence::None);

    let base = vec![obj(10, Some("g-old"), "IFCWALL")];
    let d = compare(&base, &[], &policy()).unwrap();
    assert_eq!(d.changes.len(), 1);
    assert_eq!(d.changes[0].kind, ChangeKind::Removed);
    assert_eq!(d.changes[0].confidence, MatchConfidence::None);
}

#[test]
fn profile_mismatch_is_an_error_not_a_diff() {
    let v1 = FingerprintProfile::v1();
    let v1_id = v1.profile_id();
    let mut other = v1.clone();
    other.length_quantum_m = 1e-3;
    let other_id = other.profile_id();
    assert_ne!(v1_id, other_id);

    let base = vec![obj_with_profile(10, Some("g1"), &v1_id)];
    let head = vec![obj_with_profile(20, Some("g1"), &other_id)];
    let err = compare(&base, &head, &policy()).unwrap_err();
    assert_eq!(err.expected, v1_id);
    assert_eq!(err.actual, other_id);
}

#[test]
fn every_profile_dimension_forks_compare() {
    let v1 = FingerprintProfile::v1();
    let v1_id = v1.profile_id();
    let mut forks: Vec<(&str, FingerprintProfile)> = Vec::new();
    let mut p = v1.clone();
    p.profile_version = "fp-v2".to_string();
    forks.push(("profile_version", p));
    let mut p = v1.clone();
    p.extraction = "inspect-v3".to_string();
    forks.push(("extraction", p));
    let mut p = v1.clone();
    p.algorithm = "sha256".to_string();
    forks.push(("algorithm", p));
    let mut p = v1.clone();
    p.units_policy = "si-millimetre".to_string();
    forks.push(("units_policy", p));
    let mut p = v1.clone();
    p.use_world_coords = true;
    forks.push(("use_world_coords", p));
    let mut p = v1.clone();
    p.length_quantum_m = 1e-3;
    forks.push(("length_quantum_m", p));
    let mut p = v1.clone();
    p.area_quantum_m2 = 1e-6;
    forks.push(("area_quantum_m2", p));
    let mut p = v1.clone();
    p.volume_quantum_m3 = 1e-9;
    forks.push(("volume_quantum_m3", p));
    let mut p = v1.clone();
    p.angle_quantum = 1e-5;
    forks.push(("angle_quantum", p));
    let mut p = v1.clone();
    p.numeric_quantum = 1e-6;
    forks.push(("numeric_quantum", p));
    let mut p = v1.clone();
    p.ignored_property_sets = vec!["Pset_Noise".to_string()];
    forks.push(("ignored_property_sets", p));
    assert_eq!(forks.len(), 11, "one fork per profile dimension");

    for (dim, profile) in &forks {
        let fork_id = profile.profile_id();
        assert_ne!(fork_id, v1_id, "mutating {dim} must fork the profile id");
        let base = vec![obj_with_profile(10, Some("g1"), &v1_id)];
        let head = vec![obj_with_profile(20, Some("g1"), &fork_id)];
        let err = compare(&base, &head, &policy()).unwrap_err();
        assert_eq!(err.expected, v1_id, "dimension {dim}");
        assert_eq!(err.actual, fork_id, "dimension {dim}");
    }
}

#[test]
fn mixed_profiles_within_one_side_are_rejected() {
    let v1 = FingerprintProfile::v1();
    let v1_id = v1.profile_id();
    let mut other = v1.clone();
    other.numeric_quantum = 1e-6;
    let other_id = other.profile_id();
    let base =
        vec![obj_with_profile(10, Some("g1"), &v1_id), obj_with_profile(11, Some("g2"), &other_id)];
    let head = vec![obj_with_profile(20, Some("g1"), &v1_id)];
    let err = compare(&base, &head, &policy()).unwrap_err();
    assert_eq!(err.expected, v1_id);
    assert_eq!(err.actual, other_id);
}

#[test]
fn property_change_reports_exact_values() {
    let b = with_props(
        with_fps(obj(10, Some("g1"), "IFCWALL"), "props-base", "l", "s"),
        &[
            ("Pset_WallCommon", "FireRating", "REI30"),
            ("Pset_WallCommon", "RemovedProp", "gone"),
            ("Pset_WallCommon", "SameProp", "same"),
        ],
    );
    let h = with_props(
        with_fps(obj(10, Some("g1"), "IFCWALL"), "props-head", "l", "s"),
        &[
            ("Pset_WallCommon", "FireRating", "REI60"),
            ("Pset_WallCommon", "NewProp", "fresh"),
            ("Pset_WallCommon", "SameProp", "same"),
        ],
    );

    let d = compare(&[b], &[h], &policy()).unwrap();
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::PropertiesChanged);
    assert_eq!(c.confidence, MatchConfidence::Exact);
    assert_eq!(
        c.property_changes
            .iter()
            .map(|p| (p.pset.as_str(), p.name.as_str(), p.base.as_deref(), p.head.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            ("Pset_WallCommon", "FireRating", Some("REI30"), Some("REI60")),
            ("Pset_WallCommon", "NewProp", None, Some("fresh")),
            ("Pset_WallCommon", "RemovedProp", Some("gone"), None),
        ]
    );
    assert_eq!(d.summary.properties_changed, 1);
}

#[test]
fn sub_threshold_move_is_unchanged_with_note() {
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = with_origin(with_fps(obj(10, Some("g1"), "IFCWALL"), "p", "l2", "s"), 0.0005, 0.0, 0.0);

    let d = compare(&[b], &[h], &policy()).unwrap();
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Unchanged);
    assert!((c.moved_distance_m.unwrap() - 0.0005).abs() < 1e-12);
    assert!(
        c.notes.iter().any(|n| n.contains("sub-threshold displacement")),
        "expected a sub-threshold note, got {:?}",
        c.notes
    );
    assert_eq!(d.summary.unchanged, 1);
    assert_eq!(d.summary.moved, 0);
}

#[test]
fn supra_threshold_move_is_moved() {
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = with_origin(with_fps(obj(10, Some("g1"), "IFCWALL"), "p", "l2", "s"), 0.3, 0.4, 0.0);

    let d = compare(&[b], &[h], &policy()).unwrap();
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Moved);
    assert!((c.moved_distance_m.unwrap() - 0.5).abs() < 1e-9);
    assert!(c.notes.is_empty());
    assert_eq!(d.summary.moved, 1);
}

#[test]
fn shape_change() {
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = with_fps(obj(10, Some("g1"), "IFCWALL"), "p", "l", "s2");

    let d = compare(&[b], &[h], &policy()).unwrap();
    assert_eq!(d.changes[0].kind, ChangeKind::ShapeChanged);
    assert_eq!(d.summary.shape_changed, 1);
}

#[test]
fn mixed_change_when_several_aspects_differ() {
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = with_props(
        with_origin(with_fps(obj(10, Some("g1"), "IFCWALL"), "p2", "l2", "s2"), 2.0, 0.0, 0.0),
        &[("Pset_WallCommon", "FireRating", "REI60")],
    );

    let d = compare(&[b], &[h], &policy()).unwrap();
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Mixed);
    assert_eq!(c.property_changes.len(), 1);
    assert_eq!(d.summary.mixed, 1);
}

#[test]
fn core_never_requantizes_floats() {
    // Digests agree while origins differ by half a length quantum: the core
    // reads digest equality, not floats, so this stays Unchanged. The distance
    // is still reported as an observation.
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = with_origin(obj(20, Some("g1"), "IFCWALL"), 0.00005, 0.0, 0.0);
    let d = compare(&[b], &[h], &policy()).unwrap();
    assert_eq!(d.changes[0].kind, ChangeKind::Unchanged);
    assert!((d.changes[0].moved_distance_m.unwrap() - 0.00005).abs() < 1e-12);
}

#[test]
fn pure_rotation_without_translation_is_not_a_move() {
    // A rotation-only edit changes the placement digest while the origin is
    // untouched. Origin-to-origin distance is zero, so this classifies
    // Unchanged with a sub-threshold note — the documented origin-only
    // limitation, pinned here so a future rotation-aware classifier must
    // update this test deliberately.
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = with_fps(obj(10, Some("g1"), "IFCWALL"), "p", "l-rotated", "s");
    let d = compare(&[b], &[h], &policy()).unwrap();
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Unchanged);
    assert_eq!(c.moved_distance_m, Some(0.0));
    assert!(
        c.notes.iter().any(|n| n.contains("sub-threshold displacement")),
        "expected a sub-threshold note, got {:?}",
        c.notes
    );
}

#[test]
fn missing_origin_with_changed_placement_is_a_move_with_note() {
    let b = obj(10, Some("g1"), "IFCWALL");
    let h = without_origin(with_fps(obj(10, Some("g1"), "IFCWALL"), "p", "l2", "s"));
    let d = compare(&[b], &[h], &policy()).unwrap();
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Moved);
    assert_eq!(c.moved_distance_m, None);
    assert!(
        c.notes.iter().any(|n| n.contains("distance unknown")),
        "expected a distance-unknown note, got {:?}",
        c.notes
    );
}

#[test]
fn added_and_removed() {
    let base = vec![obj(10, Some("g-old"), "IFCWALL")];
    let head = vec![obj(20, Some("g-new"), "IFCDOOR")]; // different type: heuristic refuses
    let d = compare(&base, &head, &policy()).unwrap();
    assert_eq!(d.changes.len(), 2);
    let added = d.changes.iter().find(|c| c.kind == ChangeKind::Added).unwrap();
    let removed = d.changes.iter().find(|c| c.kind == ChangeKind::Removed).unwrap();
    assert_eq!(added.confidence, MatchConfidence::None);
    assert_eq!(removed.confidence, MatchConfidence::None);
    assert_eq!(added.head.as_ref().unwrap().express_id, 20);
    assert_eq!(removed.base.as_ref().unwrap().express_id, 10);
    assert_eq!(d.summary.added, 1);
    assert_eq!(d.summary.removed, 1);
}

#[test]
fn duplicate_global_ids_are_heuristic_never_exact() {
    // Export defect: the same GlobalId twice on both sides. Pairs follow
    // ascending express id, but STEP order is not identity: confidence stays
    // heuristic with the duplicate basis, never Exact.
    let base = vec![obj(10, Some("dup"), "IFCWALL"), obj(11, Some("dup"), "IFCWALL")];
    let head = vec![obj(50, Some("dup"), "IFCWALL"), obj(51, Some("dup"), "IFCWALL")];
    let d = compare(&base, &head, &policy()).unwrap();
    assert_eq!(d.changes.len(), 2);
    let mut pairs: Vec<(u32, u32)> = d
        .changes
        .iter()
        .map(|c| (c.base.as_ref().unwrap().express_id, c.head.as_ref().unwrap().express_id))
        .collect();
    pairs.sort();
    assert_eq!(pairs, vec![(10, 50), (11, 51)]);
    for c in &d.changes {
        assert_eq!(
            c.confidence,
            MatchConfidence::Heuristic { score: 1.0, basis: "type+gid-duplicate".to_string() },
            "duplicate GlobalId must never be Exact"
        );
        assert!(
            c.notes.iter().any(|n| n == "duplicate GlobalId in base revision"),
            "missing base duplicate note: {:?}",
            c.notes
        );
        assert!(
            c.notes.iter().any(|n| n == "duplicate GlobalId in head revision"),
            "missing head duplicate note: {:?}",
            c.notes
        );
    }
    assert_eq!(d.summary.uncertain_matches, 2);
    assert_eq!(d.summary.unchanged, 2);
}

#[test]
fn duplicate_surplus_stays_unresolved() {
    // Two base objects share one GlobalId; head has one. The lowest express id
    // pairs heuristically; the surplus is an unresolved removal, not a guess.
    let b1 = with_fps(obj(10, Some("dup"), "IFCWALL"), "p", "lA", "s");
    let b2 = with_origin(with_fps(obj(11, Some("dup"), "IFCWALL"), "p", "lB", "s"), 5.0, 0.0, 0.0);
    let h = with_fps(obj(50, Some("dup"), "IFCWALL"), "p", "lA", "s");

    let d = compare(&[b1, b2], &[h], &policy()).unwrap();
    let paired =
        d.changes.iter().find(|c| c.base.is_some() && c.head.is_some()).expect("one pair");
    assert_eq!(paired.base.as_ref().unwrap().express_id, 10);
    assert_eq!(paired.head.as_ref().unwrap().express_id, 50);
    assert!(
        matches!(paired.confidence, MatchConfidence::Heuristic { .. }),
        "duplicate pair must be heuristic, got {:?}",
        paired.confidence
    );
    assert!(
        paired.notes.iter().any(|n| n == "duplicate GlobalId in base revision"),
        "paired change must carry the duplicate note: {:?}",
        paired.notes
    );
    let removed = d.changes.iter().find(|c| c.kind == ChangeKind::Removed).unwrap();
    assert_eq!(removed.base.as_ref().unwrap().express_id, 11);
    assert!(
        removed.notes.iter().any(|n| n == "duplicate GlobalId in base revision"),
        "leftover duplicate must also carry the note: {:?}",
        removed.notes
    );
}

#[test]
fn heuristic_match_after_global_id_change() {
    // Same wall re-exported under a new GlobalId: shape + placement agree (0.4+0.3=0.7).
    let b = obj(10, Some("old-gid"), "IFCWALL");
    let h = with_props(with_fps(obj(20, Some("new-gid"), "IFCWALL"), "p2", "l", "s"), &[
        ("Pset_WallCommon", "FireRating", "REI60"),
    ]);

    let d = compare(&[b], &[h], &policy()).unwrap();
    assert_eq!(d.changes.len(), 1);
    let c = &d.changes[0];
    match &c.confidence {
        MatchConfidence::Heuristic { score, basis } => {
            assert!((*score - 0.7).abs() < 1e-9, "score {score}");
            assert_eq!(basis, "type+shape+placement");
        }
        other => panic!("expected heuristic match, got {other:?}"),
    }
    assert_eq!(c.kind, ChangeKind::PropertiesChanged);
    assert_eq!(d.summary.uncertain_matches, 1);
    assert_eq!(d.summary.added, 0);
    assert_eq!(d.summary.removed, 0);
}

#[test]
fn heuristic_matches_object_without_global_id() {
    let b = obj(10, None, "IFCCOLUMN");
    let h = with_name(obj(20, None, "IFCCOLUMN"), "obj-10"); // same name: full 1.0
    let d = compare(&[b], &[h], &policy()).unwrap();
    assert_eq!(d.changes.len(), 1);
    assert!(
        matches!(d.changes[0].confidence, MatchConfidence::Heuristic { .. }),
        "missing GlobalId must never be Exact, got {:?}",
        d.changes[0].confidence
    );
    assert_eq!(d.changes[0].kind, ChangeKind::Unchanged);
}

#[test]
fn heuristic_off_becomes_add_and_remove() {
    let b = obj(10, Some("old-gid"), "IFCWALL");
    let h = obj(20, Some("new-gid"), "IFCWALL");
    let off = MatchPolicy { heuristic: HeuristicPolicy::Off, move_threshold_m: 0.001 };
    let d = compare(&[b], &[h], &off).unwrap();
    assert_eq!(d.summary.added, 1);
    assert_eq!(d.summary.removed, 1);
    assert_eq!(d.summary.uncertain_matches, 0);
    assert!(d.changes.iter().all(|c| c.confidence == MatchConfidence::None));
}

#[test]
fn heuristic_below_floor_becomes_add_and_remove() {
    // Only the shape digest agrees (0.4 < 0.6): not enough to guess.
    let b = with_fps(obj(10, Some("g1"), "IFCWALL"), "pb", "lb", "same-shape");
    let mut b = b;
    b.id.name = Some("wall A".to_string());
    let h = with_origin(with_fps(obj(20, Some("g2"), "IFCWALL"), "ph", "lh", "same-shape"), 3.0, 0.0, 0.0);
    let mut h = h;
    h.id.name = Some("wall B".to_string());

    let d = compare(&[b], &[h], &policy()).unwrap();
    assert_eq!(d.summary.added, 1);
    assert_eq!(d.summary.removed, 1);
    assert_eq!(d.summary.uncertain_matches, 0);
    assert!(d.changes.iter().all(|c| c.confidence == MatchConfidence::None));
}

#[test]
fn heuristic_resolves_competition_greedily_and_deterministically() {
    // Two base walls, one head wall (new GlobalId). Both clear the floor: b_weak via
    // shape equality + graded placement 0.2 m away (0.4 + 0.3*0.8 = 0.64), b_strong via
    // exact shape + placement digests (0.7). The stronger candidate must win.
    let b_weak =
        with_origin(with_fps(obj(10, Some("g-weak"), "IFCWALL"), "pw", "lw", "s"), 0.2, 0.0, 0.0);
    let b_strong = with_fps(obj(11, Some("g-strong"), "IFCWALL"), "ps", "l", "s");

    let h = obj(20, Some("g-new"), "IFCWALL"); // default digests: matches b_strong

    let d = compare(&[b_weak, b_strong], &[h], &policy()).unwrap();
    let matched = d
        .changes
        .iter()
        .find(|c| matches!(c.confidence, MatchConfidence::Heuristic { .. }))
        .expect("one heuristic match");
    assert_eq!(matched.base.as_ref().unwrap().express_id, 11);
    let removed = d.changes.iter().find(|c| c.kind == ChangeKind::Removed).unwrap();
    assert_eq!(removed.base.as_ref().unwrap().express_id, 10);
}

#[test]
fn changes_are_sorted_by_kind_then_type_then_express_id() {
    // One object per kind, fed in scrambled order.
    let mixed_b = with_fps(obj(1, Some("k-mixed"), "IFCWALL"), "p", "l", "s");
    let mixed_h =
        with_origin(with_fps(obj(1, Some("k-mixed"), "IFCWALL"), "p2", "l2", "s2"), 9.0, 0.0, 0.0);

    let shape_b = obj(2, Some("k-shape"), "IFCDOOR");
    let shape_h = with_fps(obj(2, Some("k-shape"), "IFCDOOR"), "p", "l", "s2");

    let moved_b = obj(3, Some("k-moved"), "IFCSLAB");
    let moved_h =
        with_origin(with_fps(obj(3, Some("k-moved"), "IFCSLAB"), "p", "l2", "s"), 1.0, 0.0, 0.0);

    let props_b = obj(4, Some("k-props"), "IFCBEAM");
    let props_h = with_props(with_fps(obj(4, Some("k-props"), "IFCBEAM"), "p2", "l", "s"), &[
        ("P", "X", "1"),
    ]);

    let removed = obj(5, Some("k-removed"), "IFCCOLUMN");
    let added = obj(6, Some("k-added"), "IFCWINDOW");
    let unchanged_b = obj(7, Some("k-same"), "IFCSTAIR");
    let unchanged_h = obj(8, Some("k-same"), "IFCSTAIR");

    // Distinct types/gids for add/remove so the heuristic cannot pair them.
    let base = vec![unchanged_b, removed, props_b, moved_b, shape_b, mixed_b];
    let head = vec![mixed_h, shape_h, moved_h, props_h, added, unchanged_h];
    let d = compare(&base, &head, &policy()).unwrap();

    let kinds: Vec<modeldiff::ChangeKind> =
        d.changes.iter().map(|c| c.kind).collect();
    assert_eq!(
        kinds,
        vec![
            ChangeKind::Mixed,
            ChangeKind::ShapeChanged,
            ChangeKind::Moved,
            ChangeKind::PropertiesChanged,
            ChangeKind::Added,
            ChangeKind::Removed,
            ChangeKind::Unchanged,
        ]
    );
    assert_eq!(d.summary.mixed, 1);
    assert_eq!(d.summary.shape_changed, 1);
    assert_eq!(d.summary.moved, 1);
    assert_eq!(d.summary.properties_changed, 1);
    assert_eq!(d.summary.added, 1);
    assert_eq!(d.summary.removed, 1);
    assert_eq!(d.summary.unchanged, 1);
}

#[test]
fn diff_findings_all_deltas() {
    let base: Vec<(String, Vec<String>)> = vec![
        ("k-resolved".into(), vec!["a".into(), "b".into()]),
        ("k-persist".into(), vec!["a".into(), "b".into(), "c".into()]),
        ("k-drained".into(), vec!["x".into()]),
    ];
    let head: Vec<(String, Vec<String>)> = vec![
        ("k-introduced".into(), vec!["n1".into(), "n2".into()]),
        // Same finding, changed object set: b resolved, d introduced.
        ("k-persist".into(), vec!["a".into(), "c".into(), "d".into()]),
        ("k-drained".into(), vec![]),
    ];
    let d = diff_findings(&base, &head);

    assert_eq!(d.introduced, 1);
    assert_eq!(d.resolved, 2); // k-resolved + k-drained (empty head list)
    assert_eq!(d.persisting, 1);
    assert_eq!(d.changes.len(), 4);

    let intro = d.changes.iter().find(|c| c.finding_key == "k-introduced").unwrap();
    assert_eq!(intro.delta, FindingDelta::Introduced);
    assert_eq!(intro.base_object_count, 0);
    assert_eq!(intro.head_object_count, 2);
    assert_eq!(intro.introduced_objects, vec!["n1", "n2"]);
    assert!(intro.resolved_objects.is_empty());

    let persist = d.changes.iter().find(|c| c.finding_key == "k-persist").unwrap();
    assert_eq!(persist.delta, FindingDelta::Persisting);
    assert_eq!(persist.base_object_count, 3);
    assert_eq!(persist.head_object_count, 3);
    assert_eq!(persist.introduced_objects, vec!["d"]);
    assert_eq!(persist.resolved_objects, vec!["b"]);

    let drained = d.changes.iter().find(|c| c.finding_key == "k-drained").unwrap();
    assert_eq!(drained.delta, FindingDelta::Resolved);
    assert_eq!(drained.resolved_objects, vec!["x"]);

    let gone = d.changes.iter().find(|c| c.finding_key == "k-resolved").unwrap();
    assert_eq!(gone.delta, FindingDelta::Resolved);
    assert_eq!(gone.resolved_objects, vec!["a", "b"]);

    // Deterministic order: introduced, then resolved, then persisting.
    let deltas: Vec<FindingDelta> = d.changes.iter().map(|c| c.delta).collect();
    assert_eq!(
        deltas,
        vec![
            FindingDelta::Introduced,
            FindingDelta::Resolved,
            FindingDelta::Resolved,
            FindingDelta::Persisting,
        ]
    );
}
