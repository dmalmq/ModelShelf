"""Python bindings for ModelShelf's shared model contract (``schemas/model/v1``).

See ``docs/adr/0001-reusable-model-modules.md`` for what this package may and may
not depend on: no app, database, or IFC-processing (ifcopenshell/ifctester) imports
here — this package only knows the wire shapes, not how to produce IFC data.

Types are generated (``generated.py``); each is a pydantic model, so parsing with
``ModelDescriptor.model_validate(payload)`` already enforces every constraint the
schema can express (unknown fields, required fields, ``enum``/``const``, patterns,
numeric ranges) and raises ``pydantic.ValidationError`` on violation. The one rule
schema validation alone cannot see is ``ObjectRef.objectId`` uniqueness within a
``SemanticModel`` (JSON Schema has no "unique by sub-key" keyword); see
``boundary.check_distinct_object_ids``.
"""

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
    RenderCapability3,
    RenderCapability4,
    RenderManifest,
    SemanticCapability1,
    SemanticCapability2,
    SemanticCapability3,
    SemanticCapability4,
    SemanticModel,
    SemanticObject,
    SourceProvenance,
    Transform,
    UpAxis,
)
from .boundary import DuplicateObjectIdError, check_distinct_object_ids
from .express_id_mapping import express_id_to_object_id

# datamodel-codegen names each oneOf branch ClassName1..4 rather than a single
# discriminated type; these aliases give the union the same name Rust and
# TypeScript export, without hand-editing the generated file.
SemanticCapability = (
    SemanticCapability1 | SemanticCapability2 | SemanticCapability3 | SemanticCapability4
)
RenderCapability = RenderCapability1 | RenderCapability2 | RenderCapability3 | RenderCapability4

__all__ = [
    "ObjectRef",
    "Transform",
    "SemanticCapability",
    "RenderCapability",
    "SourceProvenance",
    "Artifacts",
    "ModelDescriptor",
    "NativeIds",
    "Property",
    "SemanticObject",
    "SemanticModel",
    "BoundingBox",
    "Instance",
    "RenderManifest",
    "DuplicateObjectIdError",
    "check_distinct_object_ids",
    "express_id_to_object_id",
]
