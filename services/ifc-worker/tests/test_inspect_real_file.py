"""End-to-end `inspect` against the real restricted sample (skipped where it is
not locally available; see conftest.py). Verifies the acceptance criterion that
record counts, byte sizes, and hashes are independently checkable, not merely
"the worker didn't crash".
"""

from __future__ import annotations

import json
from pathlib import Path

from model_contracts import (
    GeometryChunk,
    ModelDescriptor,
    SemanticModel,
    check_distinct_object_ids,
    check_revision_ids,
    express_id_to_object_id,
)

from ifc_worker.hashing import sha256_file
from tests.conftest import run_worker, write_request

EXPECTED_PRODUCT_COUNT = 127  # ifcopenshell.open(sample).by_type("IfcProduct")
EXPECTED_PLACEMENT_NUMBERS = 12  # row-major 3x4


def test_inspect_real_file_end_to_end(tmp_path: Path, real_sample_path: Path) -> None:
    model_sha256 = sha256_file(real_sample_path)
    request_path = write_request(
        tmp_path,
        jobId="real-file-job",
        model={"path": str(real_sample_path), "sha256": model_sha256, "revisionId": "rev-fzk-haus-01"},
        outputDir=str(tmp_path / "out"),
    )

    run = run_worker(request_path)

    assert run.returncode == 0, run.stderr
    result = run.result_event
    assert result is not None, "expected exactly one terminal result event"

    manifest_path = Path(result["manifest"]["path"])
    assert manifest_path.is_file()
    assert result["manifest"]["sha256"] == sha256_file(manifest_path)
    assert result["manifest"]["size"] == manifest_path.stat().st_size

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["jobId"] == "real-file-job"
    assert manifest["operation"] == "inspect"
    assert manifest["revisionId"] == "rev-fzk-haus-01"
    assert manifest["modelSha256"] == model_sha256
    assert manifest["idsSha256"] is None

    semantic_ref = manifest["artifacts"]["semantic"]
    semantic_path = Path(semantic_ref["path"])
    assert sha256_file(semantic_path) == semantic_ref["sha256"]
    assert semantic_path.stat().st_size == semantic_ref["size"]
    semantic_payload = json.loads(semantic_path.read_text(encoding="utf-8"))
    semantic = SemanticModel.model_validate(semantic_payload)
    check_distinct_object_ids(semantic)
    check_revision_ids(semantic)
    assert semantic_ref["recordCount"] == EXPECTED_PRODUCT_COUNT
    assert len(semantic.objects) == EXPECTED_PRODUCT_COUNT

    descriptor = ModelDescriptor.model_validate(
        json.loads(Path(manifest["artifacts"]["descriptor"]["path"]).read_text(encoding="utf-8"))
    )
    assert descriptor.revisionId == "rev-fzk-haus-01"
    assert descriptor.artifacts.semantic.status == "available"

    geometry_ref = manifest["artifacts"]["geometry"]
    geometry_path = Path(geometry_ref["path"])
    chunks = [
        GeometryChunk.model_validate(json.loads(line))
        for line in geometry_path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    assert len(chunks) == geometry_ref["recordCount"]

    outcomes_ref = manifest["artifacts"]["outcomes"]
    assert outcomes_ref["recordCount"] == 0
    assert outcomes_ref["size"] == 0

    walls = [obj for obj in semantic.objects if obj.classification == "IfcWallStandardCase"]
    assert walls, "sample is expected to contain walls"
    wall = next(w for w in walls if w.nativeIds and w.nativeIds.globalId == "2XPyKWY018sA1ygZKgQPtU")
    native = wall.nativeIds
    assert native is not None and native.expressId is not None
    assert wall.ref.revisionId == "rev-fzk-haus-01"
    assert wall.ref.objectId == express_id_to_object_id("rev-fzk-haus-01", native.expressId)
    assert wall.storey == "Erdgeschoss"
    assert wall.placement is not None
    assert len(wall.placement) == EXPECTED_PLACEMENT_NUMBERS

    wall_chunk = next(c for c in chunks if c.ref.objectId == wall.ref.objectId)
    assert wall_chunk.status.value == "available"
    assert wall_chunk.vertices
    assert wall_chunk.triangles

    length_props = [p for p in wall.properties or [] if p.pset == "BaseQuantities" and p.name == "Length"]
    assert length_props, "expected a BaseQuantities.Length quantity on this wall"
    length_prop = length_props[0]
    length_value = length_prop.values[0]
    assert length_value.dimension is not None
    assert length_value.dimension.value == "length"
    assert length_prop.values[0].originalUnit == "m"
    assert length_prop.values[0].siValue == length_prop.values[0].value

    express_ids = [obj.nativeIds.expressId for obj in semantic.objects if obj.nativeIds]
    assert len(set(express_ids)) == len(express_ids)
    object_ids = [obj.ref.objectId for obj in semantic.objects]
    assert len(set(object_ids)) == len(object_ids)

    # Semantics are independently loadable: the semantic file does not embed geometry bytes.
    assert "vertices" not in semantic_path.read_text(encoding="utf-8")


def test_stdout_is_pure_ndjson_ending_in_exactly_one_result(tmp_path: Path, real_sample_path: Path) -> None:
    model_sha256 = sha256_file(real_sample_path)
    request_path = write_request(
        tmp_path,
        model={"path": str(real_sample_path), "sha256": model_sha256, "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
    )

    run = run_worker(request_path)

    assert run.returncode == 0
    assert len(run.stdout_lines) >= 1
    result_indices = [i for i, line in enumerate(run.stdout_lines) if line["event"] == "result"]
    assert result_indices == [len(run.stdout_lines) - 1], "exactly one result event, and it must be last"
    for line in run.stdout_lines:
        assert line["protocolVersion"] == 2
        assert line["jobId"] == "test-job"


def test_absent_geometry_object_is_distinguished_from_available(
    tmp_path: Path,
    real_sample_path: Path,
) -> None:
    model_sha256 = sha256_file(real_sample_path)
    request_path = write_request(
        tmp_path,
        model={"path": str(real_sample_path), "sha256": model_sha256, "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode == 0, run.stderr
    result = run.result_event
    assert result is not None

    manifest = json.loads(Path(result["manifest"]["path"]).read_text(encoding="utf-8"))
    geometry_path = Path(manifest["artifacts"]["geometry"]["path"])
    chunks = [json.loads(line) for line in geometry_path.read_text(encoding="utf-8").splitlines() if line]
    semantic = json.loads(Path(manifest["artifacts"]["semantic"]["path"]).read_text(encoding="utf-8"))
    storey_ids = {
        obj["ref"]["objectId"]
        for obj in semantic["objects"]
        if obj["classification"] == "IfcBuildingStorey"
    }
    wall_ids = {
        obj["ref"]["objectId"]
        for obj in semantic["objects"]
        if obj["classification"] == "IfcWallStandardCase"
    }
    assert storey_ids, "sample is expected to contain building storeys with no geometry"
    storey_chunks = [c for c in chunks if c["ref"]["objectId"] in storey_ids]
    wall_chunks = [c for c in chunks if c["ref"]["objectId"] in wall_ids]
    assert storey_chunks and all(c["status"] == "absent" for c in storey_chunks)
    assert all(c.get("vertices") in (None, []) for c in storey_chunks)
    assert wall_chunks and all(c["status"] == "available" for c in wall_chunks)


def test_geometry_disabled_setting_marks_every_object_unsupported(
    tmp_path: Path,
    real_sample_path: Path,
) -> None:
    model_sha256 = sha256_file(real_sample_path)
    request_path = write_request(
        tmp_path,
        model={"path": str(real_sample_path), "sha256": model_sha256, "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
        settings={"geometry": False},
    )
    run = run_worker(request_path)
    assert run.returncode == 0, run.stderr
    result = run.result_event
    assert result is not None

    manifest = json.loads(Path(result["manifest"]["path"]).read_text(encoding="utf-8"))
    assert manifest["artifacts"]["geometry"] is None
    descriptor = json.loads(Path(manifest["artifacts"]["descriptor"]["path"]).read_text(encoding="utf-8"))
    assert descriptor["artifacts"]["render"]["status"] == "unsupported"
    semantic = json.loads(Path(manifest["artifacts"]["semantic"]["path"]).read_text(encoding="utf-8"))
    assert semantic["objects"]
    SemanticModel.model_validate(semantic)
