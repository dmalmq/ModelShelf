"""Entrypoint: `ifc-worker --request <absolute-request.json>`.

Stdout carries only the NDJSON progress/result events docs/contracts/worker-v1.md
specifies; every diagnostic goes to stderr. Request/parse/input failures exit
nonzero without ever writing a terminal result line, so a caller can tell
"failed before producing anything trustworthy" from "produced a result" purely
from (exit code, whether a result line appeared) — it never has to parse stderr
text to know which case it is in.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import typer
from pydantic import ValidationError

from ifc_worker.hashing import sha256_file
from ifc_worker.inspect import WorkerInputError, run_inspect
from ifc_worker.protocol import PROTOCOL_VERSION, ManifestPointer, ProgressEvent, Request, ResultEvent

app = typer.Typer(add_completion=False)


@app.command()
def inspect_command(request: Path = typer.Option(..., "--request", exists=True, readable=True)) -> None:  # noqa: B008
    """Run the job described by the request file at `request`."""
    sys.exit(_run(request))


def _run(request_path: Path) -> int:
    try:
        payload = json.loads(request_path.read_text(encoding="utf-8"))
        parsed = Request.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        print(f"invalid request: {exc}", file=sys.stderr)
        return 2

    if parsed.operation == "validate":
        # docs/contracts/worker-v1.md defines this operation, but IDS checking
        # (ifctester wiring, outcome scoping) is a separate ticket's scope; failing
        # loudly here is the honest behavior, not a fabricated "passed" result.
        print("operation 'validate' is not implemented by this worker build", file=sys.stderr)
        return 2

    def emit_progress(stage: str) -> None:
        event = ProgressEvent(protocolVersion=PROTOCOL_VERSION, jobId=parsed.jobId, stage=stage)
        print(event.model_dump_json(), flush=True)

    try:
        run_inspect(parsed, emit_progress)
    except WorkerInputError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - any unexpected engine failure must also skip the terminal result
        print(f"worker engine failure: {exc}", file=sys.stderr)
        return 1

    manifest_path = Path(parsed.outputDir) / "manifest.json"
    result = ResultEvent(
        protocolVersion=PROTOCOL_VERSION,
        jobId=parsed.jobId,
        manifest=ManifestPointer(
            path=str(manifest_path),
            sha256=sha256_file(manifest_path),
            size=manifest_path.stat().st_size,
        ),
    )
    print(result.model_dump_json(), flush=True)
    return 0


def main() -> None:
    app()
