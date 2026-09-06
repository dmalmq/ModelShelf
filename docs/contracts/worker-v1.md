# IFC worker protocol v2

The unpublished v1 combined `objects.jsonl` envelope never shipped. Protocol 2 emits the shared `schemas/model/v1` payloads as separate artifacts. Job and progress envelopes stay worker-specific.

Run `uv run --locked --project services/ifc-worker ifc-worker --request /absolute/request.json`.
All paths are absolute. The caller creates a fresh output directory for each job. Inputs are immutable and verified before parsing. No database access occurs in the worker.

Request example:
```json
{"protocolVersion":2,"jobId":"job-1","operation":"inspect","model":{"path":"/data/a.ifc","sha256":"<64 lowercase hex>","revisionId":"revision-1"},"ids":null,"outputDir":"/data/jobs/job-1","settings":{"geometry":true}}
```
For `validate`, `ids` is required and has `path`, `sha256`, and `specificationIds` (null means all specifications; otherwise IDS specification identifiers). Caller applies source-model scope by selecting the IDS document/specification identifiers for this model. Unknown identifiers fail the job.

Stdout contains only NDJSON. Each record carries `protocolVersion:2` and `jobId`.
```json
{"protocolVersion":2,"jobId":"job-1","event":"progress","stage":"loading"}
{"protocolVersion":2,"jobId":"job-1","event":"result","manifest":{"path":"/data/jobs/job-1/manifest.json","sha256":"<64 lowercase hex>","size":1234}}
```
One terminal result, last, and exit 0 signify transport success. Logs go to stderr. Request/input/engine failures exit nonzero without a terminal result. IDS violations are successful jobs with failed outcomes; unsupported evaluation produces incomplete outcomes, never passes.

Manifest has `protocolVersion`, `jobId`, `operation`, `revisionId`, `modelSha256`, `idsSha256` (nullable), `versions` (`worker`, `ifcOpenShell`, `ifcTester`, `extraction`, `scopeSemantics`), `artifacts`, and `diagnostics` (string array). Artifact keys are `descriptor`, `semantic`, `renderManifest` (nullable), `geometry` (nullable), and `outcomes`. Each artifact has `path`, `sha256`, `size`, and optional `recordCount`. Caller verifies paths remain in its job directory, sizes, hashes, version, job identity, nonzero exit, stream completeness, and exactly one terminal record.

Shared model payloads follow `schemas/model/v1` and are independently loadable:

- `descriptor.json` is a `ModelDescriptor` (units, identity transform into the project frame, provenance, semantic/render capability and hashes).
- `semantic.json` is a `SemanticModel`. Each object is keyed by `ObjectRef`. Native `expressId`/`globalId` stay in `nativeIds`. Placement is an optional row-major 3x4, translations in metres. Properties use `values` (ordered when the IFC form is ordered), `ordered`, and `origin` (`occurrence` or `type`). Unsupported units keep the raw value with null `siValue`/`dimension`.
- `render-manifest.json` is a `RenderManifest` mapping `instanceId` to `ObjectRef`.
- `geometry.jsonl` is one `GeometryChunk` per line (`available` / `absent` / `unsupported`, object-local SI vertices and triangles). Geometry-disabled extraction omits both render files and marks render capability `unsupported`.

`objectId` is the documented deterministic express-ID mapping. GlobalIds are not assumed unique. Semantic records can be loaded without reading geometry bytes.

Outcome records contain `specificationId`, `specificationName`, `requirementIndex` (zero-based or null for applicability), `requirement` (engine description), `status` (passed/failed/incomplete), `applicableCount`, `passedCount`, `failedCount`, and `failures`. Each failure contains `revisionId`, `expressId`, `globalId`, `reason`. Outcomes and failures are unordered. Zero applicable objects are incomplete unless IfcTester explicitly fails required applicability, which is failed. Invalid IDS XML/schema fails the job. The IfcTester engine determines facet applicability and requirement results; no independent scoring is performed.
