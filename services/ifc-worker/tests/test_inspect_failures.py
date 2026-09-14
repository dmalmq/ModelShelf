"""Every failure path must exit nonzero without ever writing a terminal result
line — a caller must never mistake "the job failed" for "the job succeeded".
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from ifc_worker.hashing import sha256_file
from tests.conftest import run_worker, write_request

if TYPE_CHECKING:
    from pathlib import Path


def _no_result(run) -> bool:  # noqa: ANN001 - WorkerRun, kept loosely typed to avoid an import cycle in tests
    return run.result_event is None


def test_wrong_hash_is_rejected(tmp_path: Path, real_sample_path: Path) -> None:
    request_path = write_request(
        tmp_path,
        model={"path": str(real_sample_path), "sha256": "0" * 64, "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)
    assert "hash mismatch" in run.stderr


def test_missing_model_file_is_rejected(tmp_path: Path) -> None:
    request_path = write_request(
        tmp_path,
        model={"path": str(tmp_path / "does-not-exist.ifc"), "sha256": "0" * 64, "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)


def test_malformed_ifc_is_rejected(tmp_path: Path) -> None:
    bad_ifc = tmp_path / "bad.ifc"
    bad_ifc.write_text("this is not an IFC file\n", encoding="utf-8")
    request_path = write_request(
        tmp_path,
        model={"path": str(bad_ifc), "sha256": sha256_file(bad_ifc), "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)


def test_missing_required_field_is_rejected(tmp_path: Path) -> None:
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps({"protocolVersion": 2, "jobId": "job"}), encoding="utf-8")
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)


def test_validate_without_ids_is_rejected(tmp_path: Path, real_sample_path: Path) -> None:
    request_path = write_request(
        tmp_path,
        operation="validate",
        model={"path": str(real_sample_path), "sha256": sha256_file(real_sample_path), "revisionId": "r"},
        ids=None,
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)


def test_validate_operation_is_rejected_as_not_yet_implemented(
    tmp_path: Path,
    real_sample_path: Path,
) -> None:
    """`validate` is part of the contract (docs/contracts/worker-v2.md) but IDS
    checking is a separate ticket's scope; this worker must say so loudly, not
    fabricate a passing/incomplete result.
    """
    request_path = write_request(
        tmp_path,
        operation="validate",
        model={"path": str(real_sample_path), "sha256": sha256_file(real_sample_path), "revisionId": "r"},
        ids={
            "path": str(real_sample_path),
            "sha256": sha256_file(real_sample_path),
            "specificationIds": None,
        },
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)


def test_unreadable_request_file_is_rejected(tmp_path: Path) -> None:
    request_path = tmp_path / "request.json"
    request_path.write_text("not json", encoding="utf-8")
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)


def test_relative_model_path_exits_nonzero_without_result(tmp_path: Path) -> None:
    request_path = write_request(
        tmp_path,
        model={"path": "relative.ifc", "sha256": "0" * 64, "revisionId": "r"},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)
    assert "invalid request" in run.stderr


def test_relative_output_dir_exits_nonzero_without_result(tmp_path: Path) -> None:
    request_path = write_request(
        tmp_path,
        model={"path": str(tmp_path / "missing.ifc"), "sha256": "0" * 64, "revisionId": "r"},
        outputDir="relative-out",
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)
    assert "invalid request" in run.stderr


def test_relative_ids_path_exits_nonzero_without_result(tmp_path: Path) -> None:
    request_path = write_request(
        tmp_path,
        operation="validate",
        model={"path": str(tmp_path / "missing.ifc"), "sha256": "0" * 64, "revisionId": "r"},
        ids={"path": "relative.ids", "sha256": "1" * 64, "specificationIds": None},
        outputDir=str(tmp_path / "out"),
    )
    run = run_worker(request_path)
    assert run.returncode != 0
    assert _no_result(run)
    assert "invalid request" in run.stderr
