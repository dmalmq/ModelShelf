"""Wire types for docs/contracts/worker-v2.md: the job request read from a file,
the NDJSON events written to stdout, and the manifest.json a result event points
at. Field names are camelCase to match the wire format directly, with no alias
indirection, the same convention schemas/model/v1's generated Python uses.

This is the worker's own job/progress envelope, kept separate from the shared
model-contracts payloads (ObjectRef, SemanticModel, ...) per the ADR: job
plumbing and model data are different concerns with different lifetimes.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"
PROTOCOL_VERSION: Literal[2] = 2


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelRef(StrictModel):
    path: str
    sha256: str = Field(pattern=SHA256_PATTERN)
    revisionId: str


class IdsRef(StrictModel):
    path: str
    sha256: str = Field(pattern=SHA256_PATTERN)
    specificationIds: list[str] | None


class Settings(StrictModel):
    geometry: bool


class Request(StrictModel):
    protocolVersion: Literal[2]
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
    protocolVersion: Literal[2]
    jobId: str
    event: Literal["progress"] = "progress"
    stage: str


class ManifestPointer(StrictModel):
    path: str
    sha256: str = Field(pattern=SHA256_PATTERN)
    size: int = Field(ge=0)


class ResultEvent(StrictModel):
    protocolVersion: Literal[2]
    jobId: str
    event: Literal["result"] = "result"
    manifest: ManifestPointer


class ArtifactRef(StrictModel):
    path: str
    sha256: str = Field(pattern=SHA256_PATTERN)
    size: int = Field(ge=0)
    recordCount: int | None


class Artifacts(StrictModel):
    descriptor: ArtifactRef
    semantic: ArtifactRef
    renderManifest: ArtifactRef | None
    geometry: ArtifactRef | None
    outcomes: ArtifactRef


class Versions(StrictModel):
    worker: str = Field(min_length=1)
    ifcOpenShell: str = Field(min_length=1)
    ifcTester: str = Field(min_length=1)
    extraction: str = Field(min_length=1)
    scopeSemantics: str = Field(min_length=1)


class Manifest(StrictModel):
    protocolVersion: Literal[2]
    jobId: str
    operation: Literal["inspect", "validate"]
    revisionId: str
    modelSha256: str = Field(pattern=SHA256_PATTERN)
    idsSha256: Annotated[str, Field(pattern=SHA256_PATTERN)] | None
    versions: Versions
    artifacts: Artifacts
    diagnostics: list[str]


def dump_envelope_goldens() -> dict[str, object]:  # noqa: PLR0915
    zero = "0" * 64
    one = "1" * 64
    aaa = "a" * 64
    bbb = "b" * 64
    ccc = "c" * 64
    ddd = "d" * 64
    eee = "e" * 64
    model = ModelRef(path="/data/a.ifc", sha256=zero, revisionId="revision-1")
    inspect_request = Request(
        protocolVersion=PROTOCOL_VERSION,
        jobId="job-1",
        operation="inspect",
        model=model,
        ids=None,
        outputDir="/data/jobs/job-1",
        settings=Settings(geometry=True),
    )
    validate_request = Request(
        protocolVersion=PROTOCOL_VERSION,
        jobId="job-1",
        operation="validate",
        model=model,
        ids=IdsRef(path="/data/a.ids", sha256=one, specificationIds=["spec-a"]),
        outputDir="/data/jobs/job-1",
        settings=Settings(geometry=False),
    )
    progress = ProgressEvent(
        protocolVersion=PROTOCOL_VERSION,
        jobId="job-1",
        stage="loading",
    )
    result = ResultEvent(
        protocolVersion=PROTOCOL_VERSION,
        jobId="job-1",
        manifest=ManifestPointer(
            path="/data/jobs/job-1/manifest.json",
            sha256=one,
            size=1234,
        ),
    )
    versions = Versions(
        worker="0.1.0",
        ifcOpenShell="0.8.5",
        ifcTester="0.8.5",
        extraction="inspect-v2",
        scopeSemantics="scope-v1",
    )
    descriptor = ArtifactRef(
        path="/data/jobs/job-1/descriptor.json",
        sha256=aaa,
        size=10,
        recordCount=1,
    )
    semantic = ArtifactRef(
        path="/data/jobs/job-1/semantic.json",
        sha256=bbb,
        size=20,
        recordCount=2,
    )
    inspect_manifest = Manifest(
        protocolVersion=PROTOCOL_VERSION,
        jobId="job-1",
        operation="inspect",
        revisionId="revision-1",
        modelSha256=zero,
        idsSha256=None,
        versions=versions,
        artifacts=Artifacts(
            descriptor=descriptor,
            semantic=semantic,
            renderManifest=ArtifactRef(
                path="/data/jobs/job-1/render-manifest.json",
                sha256=ccc,
                size=30,
                recordCount=2,
            ),
            geometry=ArtifactRef(
                path="/data/jobs/job-1/geometry.jsonl",
                sha256=ddd,
                size=40,
                recordCount=2,
            ),
            outcomes=ArtifactRef(
                path="/data/jobs/job-1/outcomes.jsonl",
                sha256=eee,
                size=0,
                recordCount=0,
            ),
        ),
        diagnostics=[],
    )
    validate_manifest = Manifest(
        protocolVersion=PROTOCOL_VERSION,
        jobId="job-1",
        operation="validate",
        revisionId="revision-1",
        modelSha256=zero,
        idsSha256=one,
        versions=versions,
        artifacts=Artifacts(
            descriptor=descriptor,
            semantic=semantic,
            renderManifest=None,
            geometry=None,
            outcomes=ArtifactRef(
                path="/data/jobs/job-1/outcomes.jsonl",
                sha256=eee,
                size=50,
                recordCount=3,
            ),
        ),
        diagnostics=["ids-note"],
    )
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "goldens": {
            "request-inspect": inspect_request.model_dump(mode="json"),
            "request-validate": validate_request.model_dump(mode="json"),
            "progress-event": progress.model_dump(mode="json"),
            "result-event": result.model_dump(mode="json"),
            "manifest-inspect": inspect_manifest.model_dump(mode="json"),
            "manifest-validate": validate_manifest.model_dump(mode="json"),
        },
        "properties": {
            "request.schema.json": list(Request.model_fields),
            "progress-event.schema.json": list(ProgressEvent.model_fields),
            "result-event.schema.json": list(ResultEvent.model_fields),
            "manifest.schema.json": list(Manifest.model_fields),
        },
    }
