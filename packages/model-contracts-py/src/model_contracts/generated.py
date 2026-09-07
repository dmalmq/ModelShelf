# GENERATED FILE. Do not edit by hand.
# Source: schemas/model/v1/*.schema.json (combined; see scripts/generate-model-contracts.mjs)
# Regenerate: node scripts/generate-model-contracts.mjs

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    conint,
    constr,
)


class ObjectRef(BaseModel):
    """
    An opaque reference to one object occurrence within one model revision. objectId is unique only within its revisionId; consumers must not decode either field.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    revisionId: constr(min_length=1)
    objectId: constr(min_length=1)


class Transform(BaseModel):
    """
    A rigid transform plus uniform-per-axis scale, applied in translation * rotation * scale order, placing a revision into the shared delivery origin.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    translation: list[float] = Field(
        ..., description='[x, y, z] in metres.', max_length=3, min_length=3
    )
    rotationQuaternion: list[float] = Field(
        ...,
        description='[x, y, z, w], not required to be pre-normalized by producers.',
        max_length=4,
        min_length=4,
    )
    scale: list[PositiveFloat] = Field(
        ...,
        description='[x, y, z], each strictly positive.',
        max_length=3,
        min_length=3,
    )


class SemanticCapability1(BaseModel):
    """
    Whether a revision's semantic (property/classification) artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['available']
    artifactVersion: constr(min_length=1)
    contentHash: constr(pattern=r'^[0-9a-f]{64}$')
    objectCount: conint(ge=0)


class SemanticCapability2(BaseModel):
    """
    Whether a revision's semantic (property/classification) artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['absent']


class SemanticCapability3(BaseModel):
    """
    Whether a revision's semantic (property/classification) artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['unsupported']
    reason: constr(min_length=1)


class SemanticCapability4(BaseModel):
    """
    Whether a revision's semantic (property/classification) artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['failed']
    error: constr(min_length=1)


class RenderCapability1(BaseModel):
    """
    Whether a revision's render artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch. Geometric emptiness (absent), an unsupported conversion, and a processing failure are distinguishable states, not folded into one.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['available']
    artifactVersion: constr(min_length=1)
    contentHash: constr(pattern=r'^[0-9a-f]{64}$')
    format: Literal['prepared-scene-v1']
    primitiveCount: conint(ge=0)


class RenderCapability2(BaseModel):
    """
    Whether a revision's render artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch. Geometric emptiness (absent), an unsupported conversion, and a processing failure are distinguishable states, not folded into one.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['absent']


class RenderCapability3(BaseModel):
    """
    Whether a revision's render artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch. Geometric emptiness (absent), an unsupported conversion, and a processing failure are distinguishable states, not folded into one.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['unsupported']
    reason: constr(min_length=1)


class RenderCapability4(BaseModel):
    """
    Whether a revision's render artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch. Geometric emptiness (absent), an unsupported conversion, and a processing failure are distinguishable states, not folded into one.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['failed']
    error: constr(min_length=1)


class UpAxis(Enum):
    Y_UP = 'Y_UP'
    Z_UP = 'Z_UP'


class SourceProvenance(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    format: constr(min_length=1)
    originalFilename: constr(min_length=1)
    contentHash: constr(pattern=r'^[0-9a-f]{64}$')
    producedBy: str | None = None


class Artifacts(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    semantic: (
        SemanticCapability1
        | SemanticCapability2
        | SemanticCapability3
        | SemanticCapability4
    ) = Field(
        ...,
        description="Whether a revision's semantic (property/classification) artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch.",
        title='SemanticCapability',
    )
    render: (
        RenderCapability1 | RenderCapability2 | RenderCapability3 | RenderCapability4
    ) = Field(
        ...,
        description="Whether a revision's render artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch. Geometric emptiness (absent), an unsupported conversion, and a processing failure are distinguishable states, not folded into one.",
        title='RenderCapability',
    )


class ModelDescriptor(BaseModel):
    """
    Identity, units, placement, provenance, and artifact availability for one model revision. Carries no ModelShelf project/delivery/pack concepts.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schemaVersion: Literal['model-v1']
    revisionId: constr(min_length=1)
    lengthToMetre: PositiveFloat = Field(
        ...,
        description='Multiply a source-file length unit by this factor to get metres.',
    )
    upAxis: UpAxis
    transform: Transform
    sourceProvenance: SourceProvenance
    artifacts: Artifacts


class NativeIds(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expressId: conint(ge=1) | None = None
    globalId: constr(min_length=1) | None = None


class Origin(Enum):
    occurrence = 'occurrence'
    type = 'type'


class Dimension(Enum):
    length = 'length'
    area = 'area'
    volume = 'volume'


class PropertyValue(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    value: str | float | bool | None
    originalUnit: str | None = None
    siValue: float | None = None
    dimension: Dimension | None = None


class BoundingBox(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    min: list[float] = Field(..., max_length=3, min_length=3)
    max: list[float] = Field(..., max_length=3, min_length=3)


class Instance(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    instanceId: constr(min_length=1)
    ref: ObjectRef
    placement: list[float] | None = Field(
        None,
        description='Object-to-project 3x4 row-major transform in metres, same layout as SemanticObject.placement. Present when placement was converted so a renderer can position object-local vertices without loading SemanticModel. Omitted when the source placement cannot be interpreted.',
        max_length=12,
        min_length=12,
    )
    boundingBox: BoundingBox | None = None


class RenderManifest(BaseModel):
    """
    Maps rendered instances in one revision's geometry artifact back to ObjectRef. Loadable independently of the revision's semantic model; a render conversion must not invent or rewrite checking evidence.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schemaVersion: Literal['model-v1']
    revisionId: constr(min_length=1)
    format: Literal['prepared-scene-v1']
    instances: list[Instance]


class Status(Enum):
    available = 'available'
    absent = 'absent'
    unsupported = 'unsupported'


class GeometryChunk(BaseModel):
    """
    Object-local triangulated geometry for one rendered instance, joined to a SemanticModel object by ObjectRef. Loadable independently of semantic records.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    ref: ObjectRef
    instanceId: constr(min_length=1)
    status: Status
    reason: str | None = None
    vertices: list[float] | None = Field(
        None, description='Flat xyz SI object-local coordinates.'
    )
    triangles: list[conint(ge=0)] | None = Field(
        None, description='Flat zero-based vertex indices.'
    )


class Property(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    pset: constr(min_length=1)
    name: constr(min_length=1)
    values: list[PropertyValue] = Field(
        ...,
        description='One entry per stored value. List-valued IFC properties keep authoring order; unordered IFC sets set ordered=false.',
    )
    ordered: bool
    origin: Origin


class SemanticObject(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    ref: ObjectRef
    nativeIds: NativeIds | None = None
    classification: constr(min_length=1)
    name: str | None = None
    storey: str | None = None
    placement: list[float] | None = Field(
        None,
        description='Row-major 3x4 project-frame transform. Translations are metres. Omitted when the source placement cannot be interpreted.',
        max_length=12,
        min_length=12,
    )
    properties: list[Property] | None = None


class SemanticModel(BaseModel):
    """
    Classification, properties, and native-ID metadata for every occurrence in one revision, keyed by ObjectRef. Loadable independently of the revision's render manifest.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schemaVersion: Literal['model-v1']
    revisionId: constr(min_length=1)
    objects: list[SemanticObject]
