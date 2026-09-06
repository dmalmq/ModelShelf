//! Consumes the golden fixtures shared with the Python and TypeScript packages
//! (`schemas/model/v1/fixtures/`). See `scripts/verify-model-contracts.mjs` for the
//! cross-language run of the same fixtures.

use model_contracts::{
    check_distinct_object_ids, parse_geometry_chunk, parse_model_descriptor, parse_object_ref,
    parse_render_manifest, parse_semantic_model, ModelDescriptorError, SemanticModelError,
};
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("schemas")
        .join("model")
        .join("v1")
        .join("fixtures")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|err| panic!("reading {}: {err}", path.display()))
}

#[test]
fn valid_object_ref_parses() {
    let json = read(&fixtures_dir().join("valid").join("object-ref.json"));
    parse_object_ref(&json).expect("valid object-ref should parse");
}

#[test]
fn valid_model_descriptor_semantic_model_render_manifest_all_parse() {
    let dir = fixtures_dir().join("valid");
    parse_model_descriptor(&read(&dir.join("model-descriptor.json"))).expect("descriptor");
    parse_semantic_model(&read(&dir.join("semantic-model.json"))).expect("semantic model");
    parse_render_manifest(&read(&dir.join("render-manifest.json"))).expect("render manifest");
}

#[test]
fn format_neutral_prepared_scene_fixture_parses_without_ifc_metadata() {
    let dir = fixtures_dir().join("valid").join("prepared-scene-non-ifc");
    let descriptor =
        parse_model_descriptor(&read(&dir.join("model-descriptor.json"))).expect("descriptor");
    assert!(matches!(
        descriptor.artifacts.semantic,
        model_contracts::SemanticCapability::Absent
    ));
    parse_render_manifest(&read(&dir.join("render-manifest.json"))).expect("render manifest");
}

#[test]
fn duplicated_global_ids_remain_distinct_occurrences() {
    let json = read(&fixtures_dir().join("valid").join("semantic-model.json"));
    let model = parse_semantic_model(&json).expect("valid semantic model");
    let global_ids: Vec<_> = model
        .objects
        .iter()
        .filter_map(|o| o.native_ids.as_ref().and_then(|n| n.global_id.as_ref()))
        .collect();
    let distinct: std::collections::HashSet<_> = global_ids.iter().collect();
    assert!(distinct.len() < global_ids.len(), "fixture should contain a duplicate globalId");
    check_distinct_object_ids(&model).expect("objectIds must stay distinct despite the duplicate globalId");
}

#[test]
fn every_invalid_schema_fixture_is_rejected() {
    let dir = fixtures_dir().join("invalid").join("schema");
    let mut checked = 0;
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let json = read(&path);
        let rejected = if name.starts_with("object-ref") {
            parse_object_ref(&json).is_err()
        } else if name.starts_with("model-descriptor") {
            parse_model_descriptor(&json).is_err()
        } else if name.starts_with("render-manifest") {
            parse_render_manifest(&json).is_err()
        } else if name.starts_with("geometry-chunk") {
            parse_geometry_chunk(&json).is_err()
        } else {
            matches!(parse_semantic_model(&json), Err(SemanticModelError::Schema(_)))
        };
        assert!(rejected, "expected {name} to be rejected");
        checked += 1;
    }
    assert!(checked > 0, "no invalid/schema fixtures found");
}

#[test]
fn bad_transform_fixture_passes_deserialize_but_fails_the_positive_scale_boundary_check() {
    let json = read(&fixtures_dir().join("invalid").join("schema").join("model-descriptor-bad-transform.json"));
    match parse_model_descriptor(&json) {
        Err(ModelDescriptorError::Boundary(err)) => {
            assert!(err.to_string().contains("is not > 0"));
        }
        other => panic!("expected a boundary rejection, got {other:?}"),
    }
}

#[test]
fn duplicate_objectid_fixture_passes_schema_but_fails_the_boundary_check() {
    let json = read(
        &fixtures_dir()
            .join("invalid")
            .join("boundary")
            .join("semantic-model-duplicate-objectid.json"),
    );
    match parse_semantic_model(&json) {
        Err(SemanticModelError::DuplicateObjectId(err)) => {
            assert!(err.to_string().contains("duplicates"));
        }
        other => panic!("expected a boundary rejection, got {other:?}"),
    }
}

#[test]
fn mismatched_revision_fixture_passes_schema_but_fails_the_boundary_check() {
    let json = read(
        &fixtures_dir()
            .join("invalid")
            .join("boundary")
            .join("semantic-model-mismatched-revision.json"),
    );
    match parse_semantic_model(&json) {
        Err(SemanticModelError::MismatchedRevisionId(err)) => {
            assert!(err.to_string().contains("does not match"));
        }
        other => panic!("expected a mismatched-revision rejection, got {other:?}"),
    }
}
