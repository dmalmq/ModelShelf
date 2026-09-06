//! Parser and semantic-layer facts. The sample model is gitignored, so sample-based
//! assertions skip (not fail) when it is absent — `samples/scripts/fetch-samples.mjs`
//! restores it.

use std::path::PathBuf;
use std::time::Instant;

use ifc_model::{AttributeLookup, IfcModel, SchemaId, Value};

fn sample_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../samples/ifc/AC20-FZK-Haus.ifc")
}

fn load_sample() -> Option<IfcModel> {
    let path = sample_path();
    let bytes = std::fs::read(&path).ok()?;
    let started = Instant::now();
    let model = IfcModel::parse(&bytes).expect("sample model must parse");
    println!(
        "parsed {} bytes / {} entities in {:?}",
        bytes.len(),
        model.entity_count(),
        started.elapsed()
    );
    Some(model)
}

#[test]
fn parses_the_sample_building() {
    let Some(model) = load_sample() else {
        eprintln!("skipping: sample model not present");
        return;
    };
    assert_eq!(model.entity_count(), 44_249);
    assert_eq!(model.schema(), &SchemaId::Ifc4);
    assert_eq!(model.length_to_metre(), 1.0, "sample declares metres");
    assert!(
        model.header().originating_system.as_deref().unwrap_or_default().contains("ARCHICAD"),
        "originating system should be preserved: {:?}",
        model.header().originating_system
    );

    // The ArchiCAD export uses IfcWallStandardCase, not IfcWall. IDS entity matching does
    // not inherit, so these are genuinely distinct buckets and a pack written against
    // IFCWALL finds nothing here — exactly the dual-profile trap this shelf must expose.
    let walls = model.ids_of_type("IFCWALLSTANDARDCASE");
    assert_eq!(walls.len(), 13);
    assert!(model.ids_of_type("IFCWALL").is_empty());
    assert_eq!(model.ids_of_type("IFCSPACE").len(), 7);
    assert!(model.products().len() > walls.len());
}

#[test]
fn resolves_properties_placement_and_storey_for_a_wall() {
    let Some(model) = load_sample() else {
        eprintln!("skipping: sample model not present");
        return;
    };

    // This export's Pset_WallCommon carries only ThermalTransmittance — no FireRating,
    // no IsExternal. That gap is the kind of thing a check pack is supposed to surface.
    let wall_with_pset = model
        .ids_of_type("IFCWALLSTANDARDCASE")
        .iter()
        .copied()
        .find(|id| model.properties(*id).get("Pset_WallCommon", "ThermalTransmittance").is_some())
        .expect("at least one wall carries Pset_WallCommon.ThermalTransmittance");

    let prop =
        model.properties(wall_with_pset).get("Pset_WallCommon", "ThermalTransmittance").unwrap();
    assert_eq!(prop.data_type.as_deref(), Some("IFCTHERMALTRANSMITTANCEMEASURE"));
    assert!(prop.value.as_f64().is_some(), "measure must decode as a number");
    assert!(model.properties(wall_with_pset).get("Pset_WallCommon", "FireRating").is_none());

    let placement = model.placement(wall_with_pset).expect("wall has an absolute placement");
    assert!(placement.origin.iter().all(|v| v.is_finite()));
    let array = placement.to_array12();
    assert_eq!(&array[9..12], &placement.origin[..]);

    let storey = model.storey_of(wall_with_pset).expect("wall sits in a storey");
    assert_eq!(model.entity(storey).map(|e| e.ty.as_str()), Some("IFCBUILDINGSTOREY"));
    assert!(model.name(storey).is_some());

    let guid = model.global_id(wall_with_pset).expect("wall has a GlobalId").to_owned();
    assert_eq!(model.express_id_of_global_id(&guid), Some(wall_with_pset));

    match model.attribute(wall_with_pset, "Name") {
        AttributeLookup::Found(value) => assert!(value.as_str().is_some() || value.is_null()),
        AttributeLookup::Unsupported => panic!("Name must resolve on an IfcRoot"),
    }
    assert!(matches!(
        model.attribute(wall_with_pset, "OverallHeight"),
        AttributeLookup::Unsupported
    ));
}

#[test]
fn spaces_resolve_long_names_and_predefined_types() {
    let Some(model) = load_sample() else {
        eprintln!("skipping: sample model not present");
        return;
    };
    let spaces = model.ids_of_type("IFCSPACE");
    assert!(!spaces.is_empty(), "FZK-Haus contains spaces");
    for space in spaces.iter().copied() {
        // IfcSpace puts CompositionType before PredefinedType: the reader must not report
        // ELEMENT/PARTIAL/COMPLEX as a predefined type.
        if let Some(pt) = model.predefined_type(space) {
            assert!(
                !matches!(pt.as_str(), "ELEMENT" | "PARTIAL" | "COMPLEX"),
                "CompositionType leaked into predefined type: {pt}"
            );
        }
    }
}

#[test]
fn parses_conformance_corpus_without_errors() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/ids-testcases");
    if !dir.is_dir() {
        eprintln!("skipping: conformance corpus not present");
        return;
    }
    let mut parsed = 0usize;
    for facet in std::fs::read_dir(&dir).unwrap().filter_map(Result::ok) {
        if !facet.path().is_dir() {
            continue;
        }
        for case in std::fs::read_dir(facet.path()).unwrap().filter_map(Result::ok) {
            let path = case.path();
            if path.extension().and_then(|e| e.to_str()) != Some("ifc") {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            IfcModel::parse(&bytes)
                .unwrap_or_else(|err| panic!("{} failed to parse: {err}", path.display()));
            parsed += 1;
        }
    }
    assert!(parsed > 100, "expected the full corpus, parsed {parsed}");
    println!("parsed {parsed} conformance models");
}

#[test]
fn malformed_input_is_an_error_not_a_panic() {
    assert!(IfcModel::parse(b"").is_err());
    assert!(IfcModel::parse(b"not a step file at all").is_err());
    assert!(IfcModel::parse(b"ISO-10303-21;HEADER;").is_err(), "missing FILE_SCHEMA");
    let truncated = b"ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCWALL('abc";
    assert!(IfcModel::parse(truncated).is_err());
}

#[test]
fn decodes_step_strings_and_values() {
    let source = concat!(
        "ISO-10303-21;\n",
        "HEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\n",
        "DATA;\n",
        "/* a comment */\n",
        "#1= IFCPROJECT('0abcdefghijklmnopqrstu',$,'Caf\\X2\\00E9\\X0\\ d''Or',$,$,$,$,$,$);\n",
        "#2= IFCPROPERTYSINGLEVALUE('Ratio',$,IFCREAL(1.5E-1),$);\n",
        "#3= IFCPROPERTYSINGLEVALUE('Flag',$,IFCBOOLEAN(.T.),$);\n",
        "ENDSEC;\nEND-ISO-10303-21;\n"
    );
    let model = IfcModel::parse(source.as_bytes()).expect("hand-written file parses");
    assert_eq!(model.entity(1).unwrap().attrs[2].as_str(), Some("Café d'Or"));
    let ratio = model.entity(2).unwrap().attrs[2].clone();
    assert_eq!(ratio.typed_name(), Some("IFCREAL"));
    assert_eq!(ratio.as_f64(), Some(0.15));
    assert_eq!(ratio.to_ids_string().as_deref(), Some("0.15"));
    let flag = model.entity(3).unwrap().attrs[2].clone();
    assert_eq!(flag.as_bool(), Some(true));
    assert_eq!(flag.to_ids_string().as_deref(), Some("true"));
    assert_eq!(Value::Real(42.0).to_ids_string().as_deref(), Some("42"));
    assert_eq!(Value::Logical(None).to_ids_string(), None);
}

#[test]
fn schema_versions_match_by_family_only() {
    assert!(SchemaId::Ifc4.matches_ids_version("IFC4"));
    assert!(SchemaId::Ifc4x3.matches_ids_version("IFC4X3_ADD2"));
    assert!(!SchemaId::Ifc4.matches_ids_version("IFC2X3"));
    assert!(!SchemaId::Ifc2x3.matches_ids_version("IFC4"));
    assert_eq!(SchemaId::from_token("IFC2X3_TC1"), SchemaId::Ifc2x3);
}
