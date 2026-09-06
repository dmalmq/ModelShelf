"""Wire types for docs/contracts/worker-v1.md: the job request read from a file,
the NDJSON events written to stdout, and the manifest.json a result event points
at. Field names are camelCase to match the wire format directly, with no alias
indirection, the same convention schemas/model/v1's generated Python uses.

This is the worker's own job/progress envelope, kept separate from the shared
model-contracts payloads (ObjectRef, SemanticModel, ...) per the ADR: job
plumbing and model data are different concerns with different lifetimes.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelRef(StrictModel):
    path: str
    sha256: str
    revisionId: str


class IdsRef(StrictModel):
    path: str
    sha256: str
    specificationIds: list[str] | None = None


class Settings(StrictModel):
    geometry: bool = True


class Request(StrictModel):
    protocolVersion: Literal[1]
    jobId: str
    operation: Literal["inspect", "validate"]
    model: ModelRef
    ids: IdsRef | None
    outputDir: str
    settings: Settings

    @model_validator(mode="after")
    def _validate_operation_requires_ids(self) -> Request:
        if self.operation == "validate" and self.ids is None:
            msg = "operation 'validate' requires 'ids'"
            raise ValueError(msg)
        return self


class ProgressEvent(StrictModel):
    protocolVersion: Literal[1]
    jobId: str
    event: Literal["progress"] = "progress"
    stage: str


class ManifestPointer(StrictModel):
    path: str
    sha256: str
    size: int


class ResultEvent(StrictModel):
    protocolVersion: Literal[1]
    jobId: str
    event: Literal["result"] = "result"
    manifest: ManifestPointer


class ArtifactRef(StrictModel):
    path: str
    sha256: str
    size: int
    recordCount: int


class Artifacts(StrictModel):
    objects: ArtifactRef
    outcomes: ArtifactRef


class Versions(StrictModel):
    worker: str
    ifcOpenShell: str
    ifcTester: str
    extraction: str
    scopeSemantics: str


class Manifest(StrictModel):
    protocolVersion: Literal[1]
    jobId: str
    operation: Literal["inspect", "validate"]
    revisionId: str
    modelSha256: str
    idsSha256: str | None
    versions: Versions
    artifacts: Artifacts
    diagnostics: list[str]
