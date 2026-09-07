"""Orchestrates one `operation: inspect` job: verify the input, extract every
`IfcProduct` into shared semantic/render artifacts, and publish a descriptor
plus the worker job manifest. `outcomes.jsonl` is written empty here; IDS
scoring is `operation: validate` in `ifc_worker.validate`.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import ifcopenshell
import ifcopenshell.util.element as util_element
from model_contracts import (
    Artifacts as DescriptorArtifacts,
)
from model_contracts import (
    GeometryChunk,
    Instance,
    ModelDescriptor,
    NativeIds,
    ObjectRef,
    RenderCapability1,
    RenderCapability3,
    RenderManifest,
    SemanticCapability1,
    SemanticModel,
    SemanticObject,
    SourceProvenance,
    Status,
    Transform,
    UpAxis,
    check_distinct_object_ids,
    check_revision_ids,
    express_id_to_object_id,
)

from ifc_worker.geometry import extract_geometry
from ifc_worker.hashing import sha256_file
from ifc_worker.jsonl import write_json_atomic, write_jsonl_atomic
from ifc_worker.placement import object_placement
from ifc_worker.properties import extract_properties
from ifc_worker.protocol import PROTOCOL_VERSION, ArtifactRef, Artifacts, Manifest, Versions
from ifc_worker.units import length_scale_to_metre
from ifc_worker.versions import WORKER_VERSION, engine_versions

if TYPE_CHECKING:
    from collections.abc import Callable

    from ifc_worker.protocol import Request

IDENTITY_TRANSFORM = Transform(
    translation=[0.0, 0.0, 0.0],
    rotationQuaternion=[0.0, 0.0, 0.0, 1.0],
    scale=[1.0, 1.0, 1.0],
)


class WorkerInputError(Exception):
    """Invalid request/input: the caller gets a nonzero exit and no terminal result."""


def run_inspect(request: Request, emit_progress: Callable[[str], None]) -> Manifest:  # noqa: PLR0915
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
    semantic_objects: list[SemanticObject] = []
    chunks: list[GeometryChunk] = []
    instances: list[Instance] = []
    for index, product in enumerate(ifc_file.by_type("IfcProduct")):
        semantic, chunk, instance = _extract_object(
            product,
            ifc_file,
            revision_id,
            index=index,
            geometry_enabled=geometry_enabled,
            diagnostics=diagnostics,
        )
        semantic_objects.append(semantic)
        if chunk is not None and instance is not None:
            chunks.append(chunk)
            instances.append(instance)

    semantic_model = SemanticModel(
        schemaVersion="model-v1",
        revisionId=revision_id,
        objects=semantic_objects,
    )
    check_distinct_object_ids(semantic_model)
    check_revision_ids(semantic_model)

    emit_progress("writing")
    output_dir = Path(request.outputDir)
    output_dir.mkdir(parents=True, exist_ok=True)
    semantic_info = write_json_atomic(
        output_dir / "semantic.json",
        semantic_model,
        record_count=len(semantic_objects),
    )
    outcomes_info = write_jsonl_atomic(output_dir / "outcomes.jsonl", [])

    render_manifest_info = None
    geometry_info = None
    if geometry_enabled:
        render_manifest = RenderManifest(
            schemaVersion="model-v1",
            revisionId=revision_id,
            format="prepared-scene-v1",
            instances=instances,
        )
        render_manifest_info = write_json_atomic(
            output_dir / "render-manifest.json",
            render_manifest,
            record_count=len(instances),
        )
        geometry_info = write_jsonl_atomic(output_dir / "geometry.jsonl", chunks)
        primitive_count = sum(1 for chunk in chunks if chunk.status.value == "available")
        render_capability = RenderCapability1(
            status="available",
            artifactVersion="1",
            contentHash=geometry_info.sha256,
            format="prepared-scene-v1",
            primitiveCount=primitive_count,
        )
    else:
        render_capability = RenderCapability3(
            status="unsupported",
            reason="geometry extraction disabled by request settings",
        )

    schema_label = ifc_file.schema
    length_to_metre = length_scale_to_metre(ifc_file)
    if length_to_metre is None:
        diagnostics.append(
            "project length unit could not be interpreted; descriptor lengthToMetre defaults to 1",
        )
        length_to_metre = 1.0

    descriptor = ModelDescriptor(
        schemaVersion="model-v1",
        revisionId=revision_id,
        lengthToMetre=length_to_metre,
        upAxis=UpAxis.Z_UP,
        transform=IDENTITY_TRANSFORM,
        sourceProvenance=SourceProvenance(
            format=str(schema_label),
            originalFilename=model_path.name,
            contentHash=request.model.sha256,
            producedBy=f"modelshelf-ifc-worker/{WORKER_VERSION}",
        ),
        artifacts=DescriptorArtifacts(
            semantic=SemanticCapability1(
                status="available",
                artifactVersion="1",
                contentHash=semantic_info.sha256,
                objectCount=len(semantic_objects),
            ),
            render=render_capability,
        ),
    )
    descriptor_info = write_json_atomic(output_dir / "descriptor.json", descriptor, record_count=1)

    manifest = Manifest(
        protocolVersion=PROTOCOL_VERSION,
        jobId=request.jobId,
        operation="inspect",
        revisionId=revision_id,
        modelSha256=request.model.sha256,
        idsSha256=None,
        versions=Versions(**engine_versions()),
        artifacts=Artifacts(
            descriptor=ArtifactRef(
                path=descriptor_info.path,
                sha256=descriptor_info.sha256,
                size=descriptor_info.size,
                recordCount=descriptor_info.record_count,
            ),
            semantic=ArtifactRef(
                path=semantic_info.path,
                sha256=semantic_info.sha256,
                size=semantic_info.size,
                recordCount=semantic_info.record_count,
            ),
            renderManifest=(
                ArtifactRef(
                    path=render_manifest_info.path,
                    sha256=render_manifest_info.sha256,
                    size=render_manifest_info.size,
                    recordCount=render_manifest_info.record_count,
                )
                if render_manifest_info is not None
                else None
            ),
            geometry=(
                ArtifactRef(
                    path=geometry_info.path,
                    sha256=geometry_info.sha256,
                    size=geometry_info.size,
                    recordCount=geometry_info.record_count,
                )
                if geometry_info is not None
                else None
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


def _extract_object(  # noqa: PLR0913
    product: ifcopenshell.entity_instance,
    ifc_file: ifcopenshell.file,
    revision_id: str,
    *,
    index: int,
    geometry_enabled: bool,
    diagnostics: list[str],
) -> tuple[SemanticObject, GeometryChunk | None, Instance | None]:
    container = util_element.get_container(product)
    storey = container.Name if container is not None and container.is_a("IfcBuildingStorey") else None
    express_id = product.id()
    object_id = express_id_to_object_id(revision_id, express_id)
    ref = ObjectRef(revisionId=revision_id, objectId=object_id)
    global_id = getattr(product, "GlobalId", None) or None
    native = NativeIds(expressId=express_id, globalId=global_id)
    placement = object_placement(product, ifc_file)
    if getattr(product, "ObjectPlacement", None) is not None and placement is None:
        diagnostics.append(f"object #{express_id}: placement could not be converted to metres")
    semantic = SemanticObject(
        ref=ref,
        nativeIds=native,
        classification=product.is_a(),
        name=getattr(product, "Name", None),
        storey=storey,
        placement=placement,
        properties=extract_properties(product, ifc_file, diagnostics),
    )
    if not geometry_enabled:
        return semantic, None, None
    extracted = extract_geometry(product, geometry_enabled=True)
    instance_id = f"inst-{index}"
    chunk = GeometryChunk(
        ref=ref,
        instanceId=instance_id,
        status=Status(extracted.status),
        reason=extracted.reason,
        vertices=extracted.vertices,
        triangles=extracted.triangles,
    )
    instance = Instance(instanceId=instance_id, ref=ref, placement=placement)
    return semantic, chunk, instance
