"""Consumes the golden fixtures shared with the Rust and TypeScript packages
(schemas/model/v1/fixtures/). See scripts/verify-model-contracts.mjs for the
cross-language run of the same fixtures.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from model_contracts import (
    GeometryChunk,
    ModelDescriptor,
    ObjectRef,
    RenderManifest,
    SemanticModel,
    check_distinct_object_ids,
    check_revision_ids,
    express_id_to_object_id,
)
from model_contracts.boundary import DuplicateObjectIdError, MismatchedRevisionIdError

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "schemas" / "model" / "v1" / "fixtures"


def load(*parts: str):
    with open(FIXTURES_DIR.joinpath(*parts)) as f:
        return json.load(f)


def test_valid_object_ref_parses():
    ObjectRef.model_validate(load("valid", "object-ref.json"))


def test_valid_model_descriptor_semantic_model_render_manifest_all_parse():
    ModelDescriptor.model_validate(load("valid", "model-descriptor.json"))
    SemanticModel.model_validate(load("valid", "semantic-model.json"))
    RenderManifest.model_validate(load("valid", "render-manifest.json"))


def test_format_neutral_prepared_scene_fixture_parses_without_ifc_metadata():
    descriptor = ModelDescriptor.model_validate(
        load("valid", "prepared-scene-non-ifc", "model-descriptor.json")
    )
    assert descriptor.artifacts.semantic.status == "absent"
    RenderManifest.model_validate(load("valid", "prepared-scene-non-ifc", "render-manifest.json"))


def test_duplicated_global_ids_remain_distinct_occurrences():
    model = SemanticModel.model_validate(load("valid", "semantic-model.json"))
    global_ids = [o.nativeIds.globalId for o in model.objects if o.nativeIds]
    object_ids = [o.ref.objectId for o in model.objects]
    assert len(set(global_ids)) < len(global_ids), "fixture should contain a duplicate globalId"
    assert len(set(object_ids)) == len(object_ids), "objectIds must stay distinct despite the duplicate globalId"
    check_distinct_object_ids(model)  # must not raise


@pytest.mark.parametrize(
    "filename",
    [p.name for p in (FIXTURES_DIR / "invalid" / "schema").iterdir()],
)
def test_every_invalid_schema_fixture_is_rejected(filename: str):
    payload = load("invalid", "schema", filename)
    if filename.startswith("object-ref"):
        model_cls = ObjectRef
    elif filename.startswith("model-descriptor"):
        model_cls = ModelDescriptor
    elif filename.startswith("render-manifest"):
        model_cls = RenderManifest
    elif filename.startswith("geometry-chunk"):
        model_cls = GeometryChunk
    else:
        model_cls = SemanticModel
    with pytest.raises(ValidationError):
        model_cls.model_validate(payload)


def test_mismatched_revision_fixture_passes_schema_but_fails_the_boundary_check():
    payload = load("invalid", "boundary", "semantic-model-mismatched-revision.json")
    model = SemanticModel.model_validate(payload)
    with pytest.raises(MismatchedRevisionIdError, match="does not match"):
        check_revision_ids(model)


def test_duplicate_objectid_fixture_passes_schema_but_fails_the_boundary_check():
    payload = load("invalid", "boundary", "semantic-model-duplicate-objectid.json")
    model = SemanticModel.model_validate(payload)  # schema-valid
    with pytest.raises(DuplicateObjectIdError, match="duplicates"):
        check_distinct_object_ids(model)


def test_express_id_mapping_matches_the_golden_fixture_shared_with_typescript():
    golden = load("express-id-mapping.json")
    assert golden["cases"]
    for case in golden["cases"]:
        assert express_id_to_object_id(case["revisionId"], case["expressId"]) == case["objectId"]


def test_same_express_id_in_two_revisions_maps_to_different_object_ids():
    assert express_id_to_object_id("rev-arch-01", 1) != express_id_to_object_id("rev-struct-07", 1)


def test_produced_payloads_match_the_hand_authored_golden_fixtures():
    """The producer (produce.py) builds payloads independently, via this package's
    own pydantic models; they must equal the hand-authored fixtures byte-for-byte
    (mod dump ordering) so both are proven to describe the same contract."""
    from model_contracts import produce

    def dump(payload):
        return payload.model_dump(mode="json", exclude_unset=True)

    assert dump(produce.build_model_descriptor()) == load("valid", "model-descriptor.json")
    assert dump(produce.build_semantic_model()) == load("valid", "semantic-model.json")
    assert dump(produce.build_render_manifest()) == load("valid", "render-manifest.json")
    assert dump(produce.build_prepared_scene_descriptor()) == load(
        "valid", "prepared-scene-non-ifc", "model-descriptor.json"
    )
    assert dump(produce.build_prepared_scene_render_manifest()) == load(
        "valid", "prepared-scene-non-ifc", "render-manifest.json"
    )
