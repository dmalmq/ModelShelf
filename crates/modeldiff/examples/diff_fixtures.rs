//! Runs `modeldiff::compare` over hand-built `DiffObject` fixtures — no IFC
//! parsing, no service/database involved — printing each change keyed by
//! GlobalId with its confidence. Used to sanity-check the matcher by hand.
//!
//! Usage: cargo run -p modeldiff --example diff_fixtures

use fingerprint::normalized::{DerivedSnapshot, Fingerprints};
use modeldiff::{ChangeKind, DiffObject, IdentitySide, MatchPolicy, PropRow, compare};
use modeldiff::normalized::placement_from_origin;

const PROFILE_ID: &str = "example-profile";
const PROFILE_VERSION: &str = "fp-v1";

fn fps(p: &str, l: &str, s: &str) -> Fingerprints {
    Fingerprints {
        properties: p.to_string(),
        placement: l.to_string(),
        shape: s.to_string(),
        combined: format!("{p}|{l}|{s}|{PROFILE_ID}"),
    }
}

fn obj(
    express_id: u32,
    gid: Option<&str>,
    ifc_type: &str,
    name: &str,
    origin: [f64; 3],
    p: &str,
    l: &str,
    s: &str,
    props: &[(&str, &str, &str)],
) -> DiffObject {
    let object_id = format!("occ-{express_id:04}");
    DiffObject {
        snapshot: DerivedSnapshot {
            object_id: object_id.clone(),
            profile_version: PROFILE_VERSION.to_string(),
            profile_id: PROFILE_ID.to_string(),
            fingerprints: fps(p, l, s),
            canonical_properties: format!("props:{p}"),
            canonical_placement: format!("place:{l}"),
            canonical_shape: format!("shape:{s}"),
        },
        id: IdentitySide {
            object_id,
            revision_id: "rev-example".to_string(),
            express_id,
            global_id: gid.map(str::to_string),
            ifc_type: ifc_type.to_string(),
            name: Some(name.to_string()),
            storey: None,
            placement_3x4: Some(placement_from_origin(origin)),
            props: props
                .iter()
                .map(|(pset, n, v)| PropRow {
                    pset: (*pset).to_string(),
                    name: (*n).to_string(),
                    value: (*v).to_string(),
                })
                .collect(),
        },
    }
}

fn main() {
    // Base: an unchanged wall, a wall whose rating changes, a moved column,
    // and a wall duplicated by a broken exporter.
    let base = vec![
        obj(10, Some("g-same"), "IFCWALL", "Wall-A", [0.0, 0.0, 0.0], "p", "l", "s", &[]),
        obj(
            11,
            Some("g-prop"),
            "IFCWALL",
            "Wall-B",
            [1.0, 0.0, 0.0],
            "p-base",
            "l",
            "s",
            &[("Pset_WallCommon", "FireRating", "REI30")],
        ),
        obj(12, Some("g-move"), "IFCCOLUMN", "Col-A", [0.0, 0.0, 0.0], "p", "l", "s", &[]),
        obj(13, Some("g-dup"), "IFCWALL", "Wall-C", [2.0, 0.0, 0.0], "p", "l", "s", &[]),
        obj(14, Some("g-dup"), "IFCWALL", "Wall-D", [3.0, 0.0, 0.0], "p", "l", "s", &[]),
        obj(15, Some("g-gone"), "IFCWALL", "Wall-E", [4.0, 0.0, 0.0], "p", "l", "s", &[]),
    ];
    // Head: rating bumped, column translated 0.5 m, one duplicate dropped by
    // the exporter (surplus stays an unresolved removal), one wall added.
    let head = vec![
        obj(10, Some("g-same"), "IFCWALL", "Wall-A", [0.0, 0.0, 0.0], "p", "l", "s", &[]),
        obj(
            11,
            Some("g-prop"),
            "IFCWALL",
            "Wall-B",
            [1.0, 0.0, 0.0],
            "p-head",
            "l",
            "s",
            &[("Pset_WallCommon", "FireRating", "REI60")],
        ),
        obj(12, Some("g-move"), "IFCCOLUMN", "Col-A", [0.0, 0.5, 0.0], "p", "l2", "s", &[]),
        obj(13, Some("g-dup"), "IFCWALL", "Wall-C", [2.0, 0.0, 0.0], "p", "l", "s", &[]),
        obj(16, Some("g-new"), "IFCWALL", "Wall-F", [5.0, 0.0, 0.0], "p-new", "l-new", "s-new", &[]),
    ];

    let diff = compare(&base, &head, &MatchPolicy::default()).expect("same profile");
    println!(
        "summary: added={} removed={} unchanged={} moved={} shape_changed={} properties_changed={} mixed={} uncertain_matches={}",
        diff.summary.added,
        diff.summary.removed,
        diff.summary.unchanged,
        diff.summary.moved,
        diff.summary.shape_changed,
        diff.summary.properties_changed,
        diff.summary.mixed,
        diff.summary.uncertain_matches,
    );

    for change in &diff.changes {
        let gid = change
            .head
            .as_ref()
            .or(change.base.as_ref())
            .and_then(|r| r.global_id.clone())
            .unwrap_or_else(|| "(none)".to_owned());
        let kind = match change.kind {
            ChangeKind::Added => "added",
            ChangeKind::Removed => "removed",
            ChangeKind::Unchanged => "unchanged",
            ChangeKind::Moved => "moved",
            ChangeKind::ShapeChanged => "shape_changed",
            ChangeKind::PropertiesChanged => "properties_changed",
            ChangeKind::Mixed => "mixed",
        };
        println!("{kind:20} {gid:12} confidence={:?} notes={:?}", change.confidence, change.notes);
    }
}
