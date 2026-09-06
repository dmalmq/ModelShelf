"""JSONL line-item shapes for the `objects` and `outcomes` artifacts
(docs/contracts/worker-v1.md). One line per record; line order carries no
meaning ("Properties and object records are unordered" in the contract),
which is why `PropertyRecord.collectionOrder` exists — it is the only place
original per-pset authoring order survives.

`ObjectRecord.ref` is `model_contracts.ObjectRef` (schemas/model/v1), computed via
its documented express-ID mapping — the "shared occurrence ID" ticket 03 requires
so a Rust or browser consumer can correlate this worker's output with the shared
contract without either side reimplementing the mapping. Everything else here
(expressId, globalId, path-keyed properties, embedded geometry) is this worker's
own artifact shape, predating that shared contract and kept as worker-v1.md
specifies it; expressId/globalId remain as the "source mapping" a browser IFC
loader needs to verify or recompute `ref.objectId` independently.
"""

from __future__ import annotations

from typing import Literal

from model_contracts import (  # noqa: TC002 - pydantic needs the real class to build ObjectRecord's schema
    ObjectRef,
)

from ifc_worker.protocol import StrictModel

PropertyValue = str | bool | int | float | None
Dimension = Literal["length", "area", "volume"] | None


class PropertyRecord(StrictModel):
    path: str
    value: PropertyValue
    originalUnit: str | None
    siValue: float | None
    dimension: Dimension
    collectionOrder: int


class Geometry(StrictModel):
    status: Literal["available", "absent", "unsupported"]
    reason: str | None
    vertices: list[float] | None
    triangles: list[int] | None


class ObjectRecord(StrictModel):
    revisionId: str
    ref: ObjectRef
    expressId: int
    globalId: str | None
    type: str
    name: str | None
    storey: str | None
    placement: list[float] | None
    properties: list[PropertyRecord]
    geometry: Geometry


class Failure(StrictModel):
    revisionId: str
    expressId: int
    globalId: str | None
    reason: str


class OutcomeRecord(StrictModel):
    specificationId: str | None
    specificationName: str
    requirementIndex: int | None
    requirement: str
    status: Literal["passed", "failed", "incomplete"]
    applicableCount: int
    passedCount: int
    failedCount: int
    failures: list[Failure]
