//! Fingerprint determinism and change-isolation. These are the guarantees the revision
//! compare feature rests on: the same input must hash the same, and a change in one
//! aspect must not disturb the other two.

use std::path::PathBuf;

use fingerprint::{fingerprint_object, quantize, snapshot_model, FpOptions};
use ifc_model::IfcModel;

fn sample() -> Option<IfcModel> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../samples/ifc/AC20-FZK-Haus.ifc");
    let bytes = std::fs::read(path).ok()?;
    Some(IfcModel::parse(&bytes).expect("sample model parses"))
}

/// Minimal hand-written model: one wall with a property set, a placement and a tiny
/// swept-solid representation. `instance_offset` renumbers every instance so the same
/// content emitted with different express ids can be compared.
fn tiny_model(instance_offset: u32, thickness: &str, origin_x: &str, extra_whitespace: bool) -> String {
    let n = |id: u32| id + instance_offset;
    let nl = if extra_whitespace { "\n   " } else { "\n" };
    format!(
        concat!(
            "ISO-10303-21;{nl}HEADER;{nl}FILE_SCHEMA(('IFC4'));{nl}ENDSEC;{nl}DATA;{nl}",
            "#{p1}= IFCCARTESIANPOINT(({ox},0.,0.));{nl}",
            "#{p2}= IFCAXIS2PLACEMENT3D(#{p1},$,$);{nl}",
            "#{p3}= IFCLOCALPLACEMENT($,#{p2});{nl}",
            "#{p4}= IFCCARTESIANPOINT((0.,0.));{nl}",
            "#{p5}= IFCAXIS2PLACEMENT2D(#{p4},$);{nl}",
            "#{p6}= IFCRECTANGLEPROFILEDEF(.AREA.,'wall',#{p5},1000.,{th});{nl}",
            "#{p7}= IFCDIRECTION((0.,0.,1.));{nl}",
            // The solid gets its own object placement: reusing the wall's would couple the
            // shape fingerprint to a move, which is exactly what must not happen.
            "#{p15}= IFCCARTESIANPOINT((0.,0.,0.));{nl}",
            "#{p16}= IFCAXIS2PLACEMENT3D(#{p15},$,$);{nl}",
            "#{p8}= IFCEXTRUDEDAREASOLID(#{p6},#{p16},#{p7},2500.);{nl}",
            "#{p9}= IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#{p8}));{nl}",
            "#{p10}= IFCPRODUCTDEFINITIONSHAPE($,$,(#{p9}));{nl}",
            "#{p11}= IFCWALL('1WallGuid0000000000001',$,'W-1',$,$,#{p3},#{p10},'tag',$);{nl}",
            "#{p12}= IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('60'),$);{nl}",
            "#{p13}= IFCPROPERTYSET('1PsetGuid0000000000001',$,'Pset_WallCommon',$,(#{p12}));{nl}",
            "#{p14}= IFCRELDEFINESBYPROPERTIES('1RelGuid00000000000001',$,$,$,(#{p11}),#{p13});{nl}",
            "ENDSEC;{nl}END-ISO-10303-21;{nl}"
        ),
        nl = nl,
        ox = origin_x,
        th = thickness,
        p1 = n(1),
        p2 = n(2),
        p3 = n(3),
        p4 = n(4),
        p5 = n(5),
        p6 = n(6),
        p7 = n(7),
        p8 = n(8),
        p9 = n(9),
        p10 = n(10),
        p11 = n(11),
        p12 = n(12),
        p13 = n(13),
        p14 = n(14),
        p15 = n(15),
        p16 = n(16),
    )
}

fn wall_fingerprints(source: &str) -> fingerprint::Fingerprints {
    let model = IfcModel::parse(source.as_bytes()).expect("hand-written model parses");
    let wall = *model.ids_of_type("IFCWALL").first().expect("model has a wall");
    fingerprint_object(&model, wall, &FpOptions::default())
}

#[test]
fn quantize_is_symmetric_and_kills_negative_zero() {
    assert_eq!(quantize(-0.00001, 1e-4), 0.0);
    assert!(quantize(-0.00001, 1e-4).is_sign_positive(), "-0.0 must normalise to 0.0");
    // Half-quantum ties round away from zero, symmetrically. Exact ties are only
    // observable at binary-representable quanta; 0.00015/1e-4 is 1.4999… in f64, so
    // asserting on it would test float representation, not the rounding rule.
    assert_eq!(quantize(1.5, 1.0), 2.0);
    assert_eq!(quantize(-1.5, 1.0), -2.0);
    assert_eq!(quantize(2.5, 1.0), 3.0);
    assert!((quantize(1.23456789, 1e-4) - 1.2346).abs() < 1e-12);
    // A zero/negative quantum means "do not round".
    assert_eq!(quantize(1.23456789, 0.0), 1.23456789);
    assert!(quantize(f64::NAN, 1e-4).is_nan());
}

#[test]
fn same_content_hashes_identically_across_formatting_and_numbering() {
    let a = wall_fingerprints(&tiny_model(0, "300.", "0.", false));
    let b = wall_fingerprints(&tiny_model(500, "300.", "0.", true));
    assert_eq!(a, b, "whitespace and instance numbering must not change any fingerprint");
}

#[test]
fn a_property_change_moves_only_the_property_fingerprint() {
    let base = wall_fingerprints(&tiny_model(0, "300.", "0.", false));
    let changed_source =
        tiny_model(0, "300.", "0.", false).replace("IFCLABEL('60')", "IFCLABEL('90')");
    let changed = wall_fingerprints(&changed_source);
    assert_ne!(base.properties, changed.properties);
    assert_eq!(base.placement, changed.placement);
    assert_eq!(base.shape, changed.shape);
    assert_ne!(base.combined, changed.combined);
}

#[test]
fn a_move_changes_only_the_placement_fingerprint() {
    let base = wall_fingerprints(&tiny_model(0, "300.", "0.", false));
    let moved = wall_fingerprints(&tiny_model(0, "300.", "1000.", false));
    assert_eq!(base.properties, moved.properties);
    assert_ne!(base.placement, moved.placement);
    assert_eq!(base.shape, moved.shape);
    assert_ne!(base.combined, moved.combined);
}

#[test]
fn a_profile_change_moves_only_the_shape_fingerprint() {
    let base = wall_fingerprints(&tiny_model(0, "300.", "0.", false));
    let thicker = wall_fingerprints(&tiny_model(0, "400.", "0.", false));
    assert_eq!(base.properties, thicker.properties);
    assert_eq!(base.placement, thicker.placement);
    assert_ne!(base.shape, thicker.shape);
    assert_ne!(base.combined, thicker.combined);
}

#[test]
fn snapshots_of_the_sample_are_deterministic() {
    let Some(first) = sample() else {
        eprintln!("skipping: sample model not present");
        return;
    };
    let second = sample().expect("second parse");
    let opts = FpOptions::default();
    let a = snapshot_model(&first, &opts);
    let b = snapshot_model(&second, &opts);
    assert!(!a.is_empty(), "sample yields product snapshots");
    assert_eq!(a.len(), b.len());
    for (left, right) in a.iter().zip(b.iter()) {
        assert_eq!(left.express_id, right.express_id);
        assert_eq!(left.fingerprints, right.fingerprints, "object {}", left.express_id);
        assert_eq!(left.properties, right.properties);
    }
    // Distinct objects must not collapse onto one fingerprint: that would make the diff
    // report phantom "unchanged" matches.
    let distinct: std::collections::HashSet<&String> =
        a.iter().map(|s| &s.fingerprints.combined).collect();
    assert!(distinct.len() > a.len() / 2, "fingerprints must discriminate objects");
}

#[test]
fn objects_without_geometry_or_placement_get_stable_tokens() {
    let source = concat!(
        "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n",
        "#1= IFCSITE('1SiteGuid0000000000001',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);\n",
        "ENDSEC;\nEND-ISO-10303-21;\n"
    );
    let model = IfcModel::parse(source.as_bytes()).expect("parses");
    let site = *model.ids_of_type("IFCSITE").first().expect("site present");
    let a = fingerprint_object(&model, site, &FpOptions::default());
    let b = fingerprint_object(&model, site, &FpOptions::default());
    assert_eq!(a, b);
    // Absent placement and absent shape must not hash to the same digest as each other.
    assert_ne!(a.placement, a.shape);
}
