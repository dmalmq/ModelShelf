"""Orchestrates one `operation: inspect` job: verify the input, extract every
`IfcProduct` into an `ObjectRecord`, and publish the `objects`/`outcomes`
artifacts plus the manifest that points at them. `outcomes.jsonl` is written
empty here — IDS checking (`operation: validate`) is a later ticket's scope
(docs/contracts/worker-v1.md defines both operations, but see cli.py for why
`validate` is rejected rather than implemented in this one).
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.util.element as util_element
from model_contracts import ObjectRef, express_id_to_object_id

from ifc_worker.geometry import extract_geometry
from ifc_worker.hashing import sha256_file
from ifc_worker.jsonl import write_jsonl_atomic
from ifc_worker.placement import object_placement
from ifc_worker.properties import extract_properties
from ifc_worker.protocol import ArtifactRef, Artifacts, Manifest, Versions
from ifc_worker.records import ObjectRecord
from ifc_worker.versions import engine_versions

if TYPE_CHECKING:
    from collections.abc import Callable

    from ifc_worker.protocol import Request


class WorkerInputError(Exception):
    """Invalid request/input: the caller gets a nonzero exit and no terminal result."""


def run_inspect(request: Request, emit_progress: Callable[[str], None]) -> Manifest:
    emit_progress("verifying")
    model_path = Path(request.model.path)
    if not model_path.is_file():
        msg = f"model path does not exist: {model_path}"
        raise WorkerInputError(msg)
    actual_sha256 = sha256_file(model_path)
    if actual_sha256 != request.model.sha256:
        msg = f"model hash mismatch: expected {request.model.sha256}, got {actual_sha256}"
        raise WorkerInputError(msg)

    emit_progress("loading")
    try:
        ifc_file = ifcopenshell.open(str(model_path))
    except Exception as exc:
        msg = f"cannot parse IFC file: {exc}"
        raise WorkerInputError(msg) from exc

    emit_progress("extracting")
    diagnostics: list[str] = []
    revision_id = request.model.revisionId
    geometry_enabled = request.settings.geometry
    objects = [
        _extract_object(
            product,
            ifc_file,
            revision_id,
            geometry_enabled=geometry_enabled,
            diagnostics=diagnostics,
        )
        for product in ifc_file.by_type("IfcProduct")
    ]

    emit_progress("writing")
    output_dir = Path(request.outputDir)
    output_dir.mkdir(parents=True, exist_ok=True)
    objects_info = write_jsonl_atomic(output_dir / "objects.jsonl", objects)
    outcomes_info = write_jsonl_atomic(output_dir / "outcomes.jsonl", [])

    manifest = Manifest(
        protocolVersion=1,
        jobId=request.jobId,
        operation="inspect",
        revisionId=revision_id,
        modelSha256=request.model.sha256,
        idsSha256=None,
        versions=Versions(**engine_versions()),
        artifacts=Artifacts(
            objects=ArtifactRef(
                path=objects_info.path,
                sha256=objects_info.sha256,
                size=objects_info.size,
                recordCount=objects_info.record_count,
            ),
            outcomes=ArtifactRef(
                path=outcomes_info.path,
                sha256=outcomes_info.sha256,
                size=outcomes_info.size,
                recordCount=outcomes_info.record_count,
            ),
        ),
        diagnostics=diagnostics,
    )
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(manifest.model_dump_json(), encoding="utf-8")
    return manifest


def _extract_object(
    product: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    revision_id: str,
    *,
    geometry_enabled: bool,
    diagnostics: list[str],
) -> ObjectRecord:
    container = util_element.get_container(product)
    storey = container.Name if container is not None and container.is_a("IfcBuildingStorey") else None
    express_id = product.id()
    return ObjectRecord(
        revisionId=revision_id,
        ref=ObjectRef(revisionId=revision_id, objectId=express_id_to_object_id(revision_id, express_id)),
        expressId=express_id,
        globalId=getattr(product, "GlobalId", None),
        type=product.is_a(),
        name=getattr(product, "Name", None),
        storey=storey,
        placement=object_placement(product),
        properties=extract_properties(product, ifc_file, diagnostics),
        geometry=extract_geometry(product, geometry_enabled=geometry_enabled),
    )
