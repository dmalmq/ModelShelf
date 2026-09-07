"""Worker-local JSONL shapes that are *not* shared model payloads.

Shared occurrence records live in ``model_contracts`` (SemanticModel,
GeometryChunk, ModelDescriptor, RenderManifest). Outcomes stay here because
IDS evaluation lives in `ifc_worker.validate` and is not a shared model contract.
"""

from __future__ import annotations

from typing import Literal

from ifc_worker.protocol import StrictModel

Dimension = Literal["length", "area", "volume"] | None


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
    status: Literal["passed", "failed", "incomplete", "not_applicable"]
    applicableCount: int
    passedCount: int
    failedCount: int
    failures: list[Failure]
