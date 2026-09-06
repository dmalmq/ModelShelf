"""The Python "producer" side of the cross-language proof: build valid payloads
using this package's own generated pydantic models (not hand-written JSON text),
serialize them, and write them to a directory for the Rust and TypeScript
consumers to read. See scripts/verify-model-contracts.mjs, which drives this.

Usage: model-contracts-produce <output-dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .generated import (
    Artifacts,
    BoundingBox,
    Instance,
    ModelDescriptor,
    NativeIds,
    ObjectRef,
    Property,
    RenderCapability1,
    RenderCapability2,
    RenderManifest,
    SemanticCapability1,
    SemanticCapability2,
    SemanticModel,
    SemanticObject,
    SourceProvenance,
    Transform,
    UpAxis,
)
from .express_id_mapping import express_id_to_object_id

REVISION_ID = "rev-arch-01"


def _object_ref(express_id: int) -> ObjectRef:
    return ObjectRef(revisionId=REVISION_ID, objectId=express_id_to_object_id(REVISION_ID, express_id))


def build_model_descriptor() -> ModelDescriptor:
    return ModelDescriptor(
        schemaVersion="model-v1",
        revisionId=REVISION_ID,
        lengthToMetre=0.001,
        upAxis=UpAxis.Z_UP,
        transform=Transform(
            translation=[12.5, -4.0, 0.0],
            rotationQuaternion=[0.0, 0.0, 0.0, 1.0],
            scale=[1.0, 1.0, 1.0],
        ),
        sourceProvenance=SourceProvenance(
            format="IFC4",
            originalFilename="AC20-Institute-Var-2.ifc",
            contentHash="3b5f0a39bb623931d52383372c4397e959ba76f09ad613beb954eab4c6eb46bf",
            producedBy="modelshelf-ifc-worker/0.1.0",
        ),
        artifacts=Artifacts(
            semantic=SemanticCapability1(
                status="available",
                artifactVersion="1",
                contentHash="b6c0205beceb277b177e385da8024fc3eb9b3f4c7c32f1124fcc814ae5982e03",
                objectCount=3,
            ),
            render=RenderCapability1(
                status="available",
                artifactVersion="1",
                contentHash="3ed73f3c000a297c1b22559ce44e19ffd9a45364e1b509a40f514d4f1d917c69",
                format="prepared-scene-v1",
                primitiveCount=3,
            ),
        ),
    )


def build_semantic_model() -> SemanticModel:
    duplicate_global_id = "2N1uYIQ9v8IK2SjULhSkPq"
    return SemanticModel(
        schemaVersion="model-v1",
        revisionId=REVISION_ID,
        objects=[
            SemanticObject(
                ref=_object_ref(1),
                nativeIds=NativeIds(expressId=1, globalId=duplicate_global_id),
                classification="IfcWallStandardCase",
                name="Basic Wall:Exterior - 200mm",
                storey="Level 1",
                properties=[
                    Property(pset="Pset_WallCommon", name="IsExternal", value=True),
                    Property(pset="Pset_WallCommon", name="FireRating", value="60"),
                ],
            ),
            SemanticObject(
                # Same source GlobalId as above (a copy/paste in the authoring tool):
                # the point of this fixture is that objectId still stays distinct.
                ref=_object_ref(482),
                nativeIds=NativeIds(expressId=482, globalId=duplicate_global_id),
                classification="IfcWallStandardCase",
                name="Basic Wall:Exterior - 200mm",
                storey="Level 1",
                properties=[Property(pset="Pset_WallCommon", name="IsExternal", value=True)],
            ),
            SemanticObject(
                ref=_object_ref(999999),
                nativeIds=NativeIds(expressId=999999, globalId="1lm73wLKrCiA0FTgO6z1sd"),
                classification="IfcDoor",
                name="Single-Flush:0915 x 2134mm",
                storey="Level 1",
                properties=[
                    Property(pset="Pset_DoorCommon", name="FireRating", value="20"),
                    Property(pset="Pset_DoorCommon", name="OverallHeight", value=2134.0),
                ],
            ),
        ],
    )


def build_render_manifest() -> RenderManifest:
    return RenderManifest(
        schemaVersion="model-v1",
        revisionId=REVISION_ID,
        format="prepared-scene-v1",
        instances=[
            Instance(
                instanceId="inst-0",
                ref=_object_ref(1),
                boundingBox=BoundingBox(min=[0.0, 0.0, 0.0], max=[5.0, 0.2, 3.0]),
            ),
            Instance(
                instanceId="inst-1",
                ref=_object_ref(482),
                boundingBox=BoundingBox(min=[5.0, 0.0, 0.0], max=[10.0, 0.2, 3.0]),
            ),
            Instance(
                instanceId="inst-2",
                ref=_object_ref(999999),
                boundingBox=BoundingBox(min=[2.0, 0.0, 0.0], max=[2.9, 0.2, 2.134]),
            ),
        ],
    )


def build_prepared_scene_descriptor() -> ModelDescriptor:
    return ModelDescriptor(
        schemaVersion="model-v1",
        revisionId="rev-synthetic-01",
        lengthToMetre=1.0,
        upAxis=UpAxis.Z_UP,
        transform=Transform(
            translation=[0.0, 0.0, 0.0], rotationQuaternion=[0.0, 0.0, 0.0, 1.0], scale=[1.0, 1.0, 1.0]
        ),
        sourceProvenance=SourceProvenance(
            format="prepared-scene-v1",
            originalFilename="synthetic-two-blocks.scene.json",
            contentHash="66035cf00d7237d25bb92897277e6cbfc8e2a0fb082f692269a77f0a737fcdad",
            producedBy="modelshelf-contract-fixtures/0.1.0",
        ),
        # No IFC source, so no semantic artifact exists at all for this revision;
        # "absent" is the honest state, not an empty/invented SemanticModel.
        artifacts=Artifacts(
            semantic=SemanticCapability2(status="absent"),
            render=RenderCapability1(
                status="available",
                artifactVersion="1",
                contentHash="1e1b6c8cc300f14105460342430af0c7b39d3dca92f5280c2483f2e1e85036c8",
                format="prepared-scene-v1",
                primitiveCount=2,
            ),
        ),
    )


def build_prepared_scene_render_manifest() -> RenderManifest:
    return RenderManifest(
        schemaVersion="model-v1",
        revisionId="rev-synthetic-01",
        format="prepared-scene-v1",
        instances=[
            Instance(
                instanceId="inst-0",
                ref=ObjectRef(revisionId="rev-synthetic-01", objectId="synthetic-block-a"),
                boundingBox=BoundingBox(min=[0.0, 0.0, 0.0], max=[1.0, 1.0, 1.0]),
            ),
            Instance(
                instanceId="inst-1",
                ref=ObjectRef(revisionId="rev-synthetic-01", objectId="synthetic-block-b"),
                boundingBox=BoundingBox(min=[2.0, 0.0, 0.0], max=[3.0, 1.0, 1.5]),
            ),
        ],
    )


def _write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload.model_dump(mode="json"), indent=2) + "\n")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: model-contracts-produce <output-dir>", file=sys.stderr)
        return 2
    out = Path(sys.argv[1])
    _write(out / "model-descriptor.json", build_model_descriptor())
    _write(out / "semantic-model.json", build_semantic_model())
    _write(out / "render-manifest.json", build_render_manifest())
    _write(out / "prepared-scene-non-ifc" / "model-descriptor.json", build_prepared_scene_descriptor())
    _write(out / "prepared-scene-non-ifc" / "render-manifest.json", build_prepared_scene_render_manifest())
    print(f"wrote 5 payload(s) to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
