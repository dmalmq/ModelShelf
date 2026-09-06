"""End-to-end `inspect` against the real restricted sample (skipped where it is
not locally available; see conftest.py). Verifies the acceptance criterion that
record counts, byte sizes, and hashes are independently checkable, not merely
"the worker didn't crash".
"""

from __future__ import annotations

import json
from pathlib import Path

from model_contracts import express_id_to_object_id

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

    objects_ref = manifest["artifacts"]["objects"]
    objects_path = Path(objects_ref["path"])
    assert sha256_file(objects_path) == objects_ref["sha256"]
    assert objects_path.stat().st_size == objects_ref["size"]
    lines = objects_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == objects_ref["recordCount"]
    assert objects_ref["recordCount"] == EXPECTED_PRODUCT_COUNT

    outcomes_ref = manifest["artifacts"]["outcomes"]
    assert outcomes_ref["recordCount"] == 0
    assert outcomes_ref["size"] == 0

    records = [json.loads(line) for line in lines]
    walls = [r for r in records if r["type"] == "IfcWallStandardCase"]
    assert walls, "sample is expected to contain walls"
    wall = next(w for w in walls if w["globalId"] == "2XPyKWY018sA1ygZKgQPtU")
    assert wall["revisionId"] == "rev-fzk-haus-01"
    assert wall["ref"] == {
        "revisionId": "rev-fzk-haus-01",
        "objectId": express_id_to_object_id("rev-fzk-haus-01", wall["expressId"]),
    }
    assert wall["storey"] == "Erdgeschoss"
    assert wall["placement"] is not None
    assert len(wall["placement"]) == EXPECTED_PLACEMENT_NUMBERS
    assert wall["geometry"]["status"] == "available"
    assert len(wall["geometry"]["vertices"]) > 0
    assert len(wall["geometry"]["triangles"]) > 0

    length_props = [p for p in wall["properties"] if p["path"] == "BaseQuantities.Length"]
    assert length_props, "expected a BaseQuantities.Length quantity on this wall"
    length_prop = length_props[0]
    assert length_prop["dimension"] == "length"
    assert length_prop["originalUnit"] == "m"
    assert length_prop["siValue"] == length_prop["value"]  # project is already in metres

    # A duplicated GlobalId reused for a different express ID would be a producer
    # bug; express IDs (not GlobalIds) are this record shape's real identity.
    express_ids = [r["expressId"] for r in records]
    assert len(set(express_ids)) == len(express_ids)
    object_ids = [r["ref"]["objectId"] for r in records]
    assert len(set(object_ids)) == len(object_ids)


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
        assert line["protocolVersion"] == 1
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
    objects_path = Path(manifest["artifacts"]["objects"]["path"])
    records = [json.loads(line) for line in objects_path.read_text(encoding="utf-8").splitlines()]

    storeys = [r for r in records if r["type"] == "IfcBuildingStorey"]
    assert storeys, "sample is expected to contain building storeys with no geometry"
    assert all(s["geometry"]["status"] == "absent" for s in storeys)
    assert all(s["geometry"]["vertices"] is None for s in storeys)

    walls = [r for r in records if r["type"] == "IfcWallStandardCase"]
    assert all(w["geometry"]["status"] == "available" for w in walls)


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
    objects_path = Path(manifest["artifacts"]["objects"]["path"])
    records = [json.loads(line) for line in objects_path.read_text(encoding="utf-8").splitlines()]
    assert records
    assert all(r["geometry"]["status"] == "unsupported" for r in records)
    assert all(r["geometry"]["vertices"] is None for r in records)
