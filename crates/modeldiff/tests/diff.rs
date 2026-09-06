//! Hand-built `ObjectSnapshot` fixtures — no IFC parsing involved.

use fingerprint::{Fingerprints, ObjectSnapshot, PropSnapshot};
use modeldiff::{diff, diff_findings, ChangeKind, DiffOptions, FindingDelta, MatchConfidence};

fn fp(properties: &str, placement: &str, shape: &str) -> Fingerprints {
    Fingerprints {
        properties: properties.to_string(),
        placement: placement.to_string(),
        shape: shape.to_string(),
        combined: format!("{properties}|{placement}|{shape}"),
    }
}

fn placement_at(x: f64, y: f64, z: f64) -> [f64; 12] {
    [1.0, 0.0, 0.0, x, 0.0, 1.0, 0.0, y, 0.0, 0.0, 1.0, z]
}

fn prop(pset: &str, name: &str, value: &str) -> PropSnapshot {
    PropSnapshot {
        pset: pset.to_string(),
        name: name.to_string(),
        value: value.to_string(),
        data_type: None,
        unit: None,
        numeric: None,
        inherited: false,
    }
}

/// Baseline object: wall at the origin with identical fingerprints everywhere.
fn snap(express_id: u32, gid: Option<&str>, ifc_type: &str) -> ObjectSnapshot {
    ObjectSnapshot {
        express_id,
        global_id: gid.map(str::to_string),
        ifc_type: ifc_type.to_string(),
        name: Some(format!("obj-{express_id}")),
        predefined_type: None,
        storey: None,
        placement: Some(placement_at(0.0, 0.0, 0.0)),
        fingerprints: fp("p", "l", "s"),
        properties: Vec::new(),
    }
}

fn opts() -> DiffOptions {
    DiffOptions::default()
}

#[test]
fn unchanged_pair() {
    let base = vec![snap(10, Some("g1"), "IFCWALL")];
    let head = vec![snap(20, Some("g1"), "IFCWALL")];
    let d = diff(&base, &head, &opts());
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
fn property_change_reports_exact_values() {
    let mut b = snap(10, Some("g1"), "IFCWALL");
    b.properties = vec![
        prop("Pset_WallCommon", "FireRating", "60"),
        prop("Pset_WallCommon", "RemovedProp", "gone"),
        prop("Pset_WallCommon", "SameProp", "same"),
    ];
    b.fingerprints = fp("props-base", "l", "s");
    let mut h = snap(10, Some("g1"), "IFCWALL");
    h.properties = vec![
        prop("Pset_WallCommon", "FireRating", "90"),
        prop("Pset_WallCommon", "NewProp", "fresh"),
        prop("Pset_WallCommon", "SameProp", "same"),
    ];
    h.fingerprints = fp("props-head", "l", "s");

    let d = diff(&[b], &[h], &opts());
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::PropertiesChanged);
    assert_eq!(
        c.property_changes
            .iter()
            .map(|p| (p.pset.as_str(), p.name.as_str(), p.base.as_deref(), p.head.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            ("Pset_WallCommon", "FireRating", Some("60"), Some("90")),
            ("Pset_WallCommon", "NewProp", None, Some("fresh")),
            ("Pset_WallCommon", "RemovedProp", Some("gone"), None),
        ]
    );
    assert_eq!(d.summary.properties_changed, 1);
}

#[test]
fn sub_threshold_move_is_unchanged_with_note() {
    let b = snap(10, Some("g1"), "IFCWALL");
    let mut h = snap(10, Some("g1"), "IFCWALL");
    h.placement = Some(placement_at(0.0005, 0.0, 0.0)); // below the 1 mm threshold
    h.fingerprints = fp("p", "l2", "s");

    let d = diff(&[b], &[h], &opts());
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
    let b = snap(10, Some("g1"), "IFCWALL");
    let mut h = snap(10, Some("g1"), "IFCWALL");
    h.placement = Some(placement_at(0.3, 0.4, 0.0)); // 0.5 m
    h.fingerprints = fp("p", "l2", "s");

    let d = diff(&[b], &[h], &opts());
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Moved);
    assert!((c.moved_distance_m.unwrap() - 0.5).abs() < 1e-9);
    assert!(c.notes.is_empty());
    assert_eq!(d.summary.moved, 1);
}

#[test]
fn shape_change() {
    let b = snap(10, Some("g1"), "IFCWALL");
    let mut h = snap(10, Some("g1"), "IFCWALL");
    h.fingerprints = fp("p", "l", "s2");

    let d = diff(&[b], &[h], &opts());
    assert_eq!(d.changes[0].kind, ChangeKind::ShapeChanged);
    assert_eq!(d.summary.shape_changed, 1);
}

#[test]
fn mixed_change_when_several_aspects_differ() {
    let b = snap(10, Some("g1"), "IFCWALL");
    let mut h = snap(10, Some("g1"), "IFCWALL");
    h.placement = Some(placement_at(2.0, 0.0, 0.0));
    h.properties = vec![prop("Pset_WallCommon", "FireRating", "90")];
    h.fingerprints = fp("p2", "l2", "s2");

    let d = diff(&[b], &[h], &opts());
    let c = &d.changes[0];
    assert_eq!(c.kind, ChangeKind::Mixed);
    assert_eq!(c.property_changes.len(), 1);
    assert_eq!(d.summary.mixed, 1);
}

#[test]
fn added_and_removed() {
    let base = vec![snap(10, Some("g-old"), "IFCWALL")];
    let head = vec![snap(20, Some("g-new"), "IFCDOOR")]; // different type: heuristic refuses
    let d = diff(&base, &head, &opts());
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
fn duplicate_global_ids_pair_by_express_id_and_carry_notes() {
    // Export defect: two base objects share one GlobalId; head has one.
    let mut b1 = snap(10, Some("dup"), "IFCWALL");
    let mut b2 = snap(11, Some("dup"), "IFCWALL");
    b2.placement = Some(placement_at(5.0, 0.0, 0.0));
    b2.fingerprints = fp("p", "lB", "s");
    b1.fingerprints = fp("p", "lA", "s");
    let mut h = snap(50, Some("dup"), "IFCWALL");
    h.fingerprints = fp("p", "lA", "s");

    let d = diff(&[b1, b2], &[h], &opts());
    // b1 (lowest express id) pairs with h; b2 has no counterpart left.
    let paired = d.changes.iter().find(|c| c.base.is_some() && c.head.is_some()).unwrap();
    assert_eq!(paired.base.as_ref().unwrap().express_id, 10);
    assert_eq!(paired.head.as_ref().unwrap().express_id, 50);
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
    let b = snap(10, Some("old-gid"), "IFCWALL");
    let mut h = snap(20, Some("new-gid"), "IFCWALL");
    h.properties = vec![prop("Pset_WallCommon", "FireRating", "90")];
    h.fingerprints = fp("p2", "l", "s"); // properties changed; shape+placement identical

    let d = diff(&[b], &[h], &opts());
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
    let b = snap(10, None, "IFCCOLUMN");
    let h = snap(20, None, "IFCCOLUMN");
    let d = diff(&[b], &[h], &opts());
    assert_eq!(d.changes.len(), 1);
    assert!(matches!(d.changes[0].confidence, MatchConfidence::Heuristic { .. }));
    assert_eq!(d.changes[0].kind, ChangeKind::Unchanged);
}

#[test]
fn heuristic_below_floor_becomes_add_and_remove() {
    // Only the shape fingerprint agrees (0.4 < 0.6): not enough to guess.
    let mut b = snap(10, Some("g1"), "IFCWALL");
    b.placement = Some(placement_at(0.0, 0.0, 0.0));
    b.fingerprints = fp("pb", "lb", "same-shape");
    b.name = Some("wall A".to_string());
    let mut h = snap(20, Some("g2"), "IFCWALL");
    h.placement = Some(placement_at(3.0, 0.0, 0.0)); // 3 m away: no placement credit
    h.fingerprints = fp("ph", "lh", "same-shape");
    h.name = Some("wall B".to_string());

    let d = diff(&[b], &[h], &opts());
    assert_eq!(d.summary.added, 1);
    assert_eq!(d.summary.removed, 1);
    assert_eq!(d.summary.uncertain_matches, 0);
    assert!(d.changes.iter().all(|c| c.confidence == MatchConfidence::None));
}

#[test]
fn heuristic_resolves_competition_greedily_and_deterministically() {
    // Two base walls, one head wall (new GlobalId). Both clear the floor: b_weak via
    // shape equality + graded placement 0.2 m away (0.4 + 0.3*0.8 = 0.64), b_strong via
    // exact shape + placement fingerprints (0.7). The stronger candidate must win.
    let mut b_weak = snap(10, Some("g-weak"), "IFCWALL");
    b_weak.placement = Some(placement_at(0.2, 0.0, 0.0));
    b_weak.fingerprints = fp("pw", "lw", "s");
    let mut b_strong = snap(11, Some("g-strong"), "IFCWALL");
    b_strong.fingerprints = fp("ps", "l", "s");

    let h = snap(20, Some("g-new"), "IFCWALL"); // default placement/fps: matches b_strong

    let d = diff(&[b_weak, b_strong], &[h], &opts());
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
    let opts = opts();
    // One object per kind, fed in scrambled order.
    let mut mixed_b = snap(1, Some("k-mixed"), "IFCWALL");
    mixed_b.fingerprints = fp("p", "l", "s");
    let mut mixed_h = snap(1, Some("k-mixed"), "IFCWALL");
    mixed_h.placement = Some(placement_at(9.0, 0.0, 0.0));
    mixed_h.fingerprints = fp("p2", "l2", "s2");

    let shape_b = snap(2, Some("k-shape"), "IFCDOOR");
    let mut shape_h = snap(2, Some("k-shape"), "IFCDOOR");
    shape_h.fingerprints = fp("p", "l", "s2");

    let moved_b = snap(3, Some("k-moved"), "IFCSLAB");
    let mut moved_h = snap(3, Some("k-moved"), "IFCSLAB");
    moved_h.placement = Some(placement_at(1.0, 0.0, 0.0));
    moved_h.fingerprints = fp("p", "l2", "s");

    let props_b = snap(4, Some("k-props"), "IFCBEAM");
    let mut props_h = snap(4, Some("k-props"), "IFCBEAM");
    props_h.fingerprints = fp("p2", "l", "s");
    props_h.properties = vec![prop("P", "X", "1")];

    let removed = snap(5, Some("k-removed"), "IFCCOLUMN");
    let added = snap(6, Some("k-added"), "IFCWINDOW");
    let unchanged_b = snap(7, Some("k-same"), "IFCSTAIR");
    let unchanged_h = snap(8, Some("k-same"), "IFCSTAIR");

    // Distinct types/gids for add/remove so the heuristic cannot pair them.
    let base = vec![unchanged_b, removed, props_b, moved_b, shape_b, mixed_b];
    let head = vec![mixed_h, shape_h, moved_h, props_h, added, unchanged_h];
    let d = diff(&base, &head, &opts);

    let kinds: Vec<ChangeKind> = d.changes.iter().map(|c| c.kind).collect();
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
    // Summary counts every kind.
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
