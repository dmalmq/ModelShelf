"""`operation: validate`: IfcTester is the only scorer.

Inspect artifacts are still produced so the caller has occurrence IDs. Outcomes
come from IfcTester. Zero applicable objects with required applicability
(`minOccurs` != 0) fail. Optional applicability (`minOccurs == 0`) is
`not_applicable`. Unsupported evaluation is `incomplete`, never a pass.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import ifcopenshell
import ifctester

from ifc_worker.hashing import sha256_file
from ifc_worker.inspect import WorkerInputError, run_inspect
from ifc_worker.jsonl import write_jsonl_atomic
from ifc_worker.protocol import ArtifactRef, Manifest
from ifc_worker.records import Failure, OutcomeRecord

if TYPE_CHECKING:
    from collections.abc import Callable

    from ifc_worker.protocol import Request


def run_validate(request: Request, emit_progress: Callable[[str], None]) -> Manifest:  # noqa: PLR0915
    ids = request.ids
    if ids is None:
        msg = "operation 'validate' requires 'ids'"
        raise WorkerInputError(msg)

    emit_progress("verifying-ids")
    ids_path = Path(ids.path)
    if not ids_path.is_file():
        msg = f"ids path does not exist: {ids_path}"
        raise WorkerInputError(msg)
    actual = sha256_file(ids_path)
    if actual != ids.sha256:
        msg = f"ids hash mismatch: expected {ids.sha256}, got {actual}"
        raise WorkerInputError(msg)

    try:
        spec_file = ifctester.open(str(ids_path))
    except Exception as exc:
        msg = f"ids document is not valid: {exc}"
        raise WorkerInputError(msg) from exc

    wanted = ids.specificationIds
    selected = list(spec_file.specifications)
    if wanted is not None:
        by_name = {spec.name: spec for spec in spec_file.specifications}
        missing = [name for name in wanted if name not in by_name]
        if missing:
            msg = f"unknown specification id(s): {', '.join(missing)}"
            raise WorkerInputError(msg)
        selected = [by_name[name] for name in wanted]
        spec_file.specifications = selected

    emit_progress("inspecting")
    manifest = run_inspect(request, emit_progress)
    revision_id = request.model.revisionId

    emit_progress("checking")
    try:
        ifc_file = ifcopenshell.open(request.model.path)
    except Exception as exc:
        msg = f"cannot parse IFC file: {exc}"
        raise WorkerInputError(msg) from exc

    try:
        # Skip specifications whose ifcVersion does not include this file's schema
        # so a schema/engine mismatch is incomplete, not a missing-object failure.
        spec_file.validate(ifc_file, should_filter_version=True)
    except Exception as exc:
        msg = f"IfcTester failed to evaluate: {exc}"
        raise WorkerInputError(msg) from exc

    outcomes: list[OutcomeRecord] = []
    diagnostics = list(manifest.diagnostics)
    for spec in selected:
        outcomes.extend(_outcomes_for_spec(spec, revision_id, diagnostics))

    output_dir = Path(request.outputDir)
    outcomes_info = write_jsonl_atomic(output_dir / "outcomes.jsonl", outcomes, exclude_none=False)
    manifest.operation = "validate"
    manifest.idsSha256 = ids.sha256
    manifest.artifacts.outcomes = ArtifactRef(
        path=outcomes_info.path,
        sha256=outcomes_info.sha256,
        size=outcomes_info.size,
        recordCount=outcomes_info.record_count,
    )
    manifest.diagnostics = diagnostics
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(manifest.model_dump_json(), encoding="utf-8")
    return manifest


def _outcomes_for_spec(spec: object, revision_id: str, diagnostics: list[str]) -> list[OutcomeRecord]:
    name = str(getattr(spec, "name", "unnamed"))
    identifier = getattr(spec, "identifier", None)
    identifier = str(identifier) if identifier else name
    min_occurs = getattr(spec, "minOccurs", 1)
    if min_occurs is None:
        min_occurs = 1

    requirements = list(getattr(spec, "requirements", None) or [])
    if getattr(spec, "is_ifc_version", True) is False or getattr(spec, "status", None) is None:
        reason = f"{name}: engine did not evaluate this specification (schema or facet unsupported)"
        diagnostics.append(reason)
        if not requirements:
            return [_incomplete_record(identifier, name, None, "applicability")]
        return [
            _incomplete_record(identifier, name, index, _requirement_text(requirement))
            for index, requirement in enumerate(requirements)
        ]

    if not requirements:
        applicable = list(getattr(spec, "applicable_entities", None) or [])
        status = _applicability_status(len(applicable), min_occurs, getattr(spec, "status", None))
        return [
            OutcomeRecord(
                specificationId=identifier,
                specificationName=name,
                requirementIndex=None,
                requirement="applicability",
                status=status,
                applicableCount=len(applicable),
                passedCount=0,
                failedCount=0,
                failures=[],
            )
        ]

    records: list[OutcomeRecord] = []
    for index, requirement in enumerate(requirements):
        try:
            failures_raw = list(getattr(requirement, "failures", None) or [])
            passed = list(getattr(requirement, "passed_entities", None) or [])
        except Exception as exc:  # noqa: BLE001
            diagnostics.append(f"{name} requirement {index}: unsupported evaluation ({exc})")
            records.append(
                OutcomeRecord(
                    specificationId=identifier,
                    specificationName=name,
                    requirementIndex=index,
                    requirement=_requirement_text(requirement),
                    status="incomplete",
                    applicableCount=0,
                    passedCount=0,
                    failedCount=0,
                    failures=[],
                )
            )
            continue

        failed_entities = [item["element"] for item in failures_raw if "element" in item]
        applicable_count = len(passed) + len(failed_entities)
        if applicable_count == 0:
            status = _applicability_status(0, min_occurs, getattr(spec, "status", None))
        elif failed_entities:
            status = "failed"
        else:
            status = "passed"

        failures = [
            Failure(
                revisionId=revision_id,
                expressId=int(item["element"].id()),
                globalId=getattr(item["element"], "GlobalId", None) or None,
                reason=str(item.get("reason") or "requirement failed"),
            )
            for item in failures_raw
            if "element" in item
        ]
        records.append(
            OutcomeRecord(
                specificationId=identifier,
                specificationName=name,
                requirementIndex=index,
                requirement=_requirement_text(requirement),
                status=status,
                applicableCount=applicable_count,
                passedCount=len(passed),
                failedCount=len(failed_entities),
                failures=failures,
            )
        )
    return records


def _applicability_status(applicable_count: int, min_occurs: int, spec_status: object) -> str:
    if applicable_count > 0:
        return "passed" if spec_status else "failed"
    if spec_status is False and min_occurs:
        return "failed"
    if min_occurs:
        return "failed"
    return "not_applicable"


def _incomplete_record(
    identifier: str, name: str, requirement_index: int | None, requirement: str
) -> OutcomeRecord:
    return OutcomeRecord(
        specificationId=identifier,
        specificationName=name,
        requirementIndex=requirement_index,
        requirement=requirement,
        status="incomplete",
        applicableCount=0,
        passedCount=0,
        failedCount=0,
        failures=[],
    )


def _requirement_text(requirement: object) -> str:
    to_string = getattr(requirement, "to_string", None)
    if callable(to_string):
        try:
            text = str(to_string("requirement"))
            if text and not text.startswith("<"):
                return text
        except Exception:  # noqa: BLE001, S110
            pass
    return type(requirement).__name__
