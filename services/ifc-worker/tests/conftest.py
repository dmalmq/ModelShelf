from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
REAL_SAMPLE_PATH = REPO_ROOT / "samples" / "ifc" / "AC20-FZK-Haus.ifc"


@pytest.fixture
def real_sample_path() -> Path:
    if not REAL_SAMPLE_PATH.is_file():
        pytest.skip(f"restricted sample not present locally: {REAL_SAMPLE_PATH}")
    return REAL_SAMPLE_PATH


class WorkerRun:
    def __init__(self, returncode: int, stdout_lines: list[dict[str, Any]], stderr: str) -> None:
        self.returncode = returncode
        self.stdout_lines = stdout_lines
        self.stderr = stderr

    @property
    def result_event(self) -> dict[str, Any] | None:
        events = [line for line in self.stdout_lines if line.get("event") == "result"]
        return events[0] if events else None

    @property
    def progress_stages(self) -> list[str]:
        return [line["stage"] for line in self.stdout_lines if line.get("event") == "progress"]


def run_worker(request_path: Path) -> WorkerRun:
    """Invokes the real `ifc-worker` entrypoint exactly as documented
    (docs/contracts/worker-v2.md), as a real subprocess, and parses stdout
    strictly as NDJSON (a non-JSON or trailing-blank line here is itself a
    protocol-framing bug).
    """
    ifc_worker_dir = REPO_ROOT / "services" / "ifc-worker"
    argv = ["uv", "run", "--project", str(ifc_worker_dir), "ifc-worker", "--request", str(request_path)]
    proc = subprocess.run(argv, capture_output=True, text=True, check=False)  # noqa: S603 - fixed argv, no shell, no untrusted input
    lines = proc.stdout.splitlines()
    parsed = [json.loads(line) for line in lines]
    return WorkerRun(proc.returncode, parsed, proc.stderr)


@pytest.fixture
def worker_run() -> type[WorkerRun]:
    return WorkerRun


def write_request(path: Path, **overrides: Any) -> Path:  # noqa: ANN401 - overlays arbitrary JSON-shaped request fields
    payload: dict[str, Any] = {
        "protocolVersion": 2,
        "jobId": "test-job",
        "operation": "inspect",
        "model": {},
        "ids": None,
        "outputDir": str(path.parent / "out"),
        "settings": {"geometry": True},
    }
    payload.update(overrides)
    request_path = path / "request.json"
    request_path.write_text(json.dumps(payload), encoding="utf-8")
    return request_path
