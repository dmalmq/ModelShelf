# IFC worker protocol v1

Run `uv run --locked --project services/ifc-worker ifc-worker --request /absolute/request.json`.
All paths are absolute. The caller creates a fresh output directory for each job. Inputs are immutable and verified before parsing. No database access occurs in the worker.

Request example:
```json
{"protocolVersion":1,"jobId":"job-1","operation":"inspect","model":{"path":"/data/a.ifc","sha256":"<64 lowercase hex>","revisionId":"revision-1"},"ids":null,"outputDir":"/data/jobs/job-1","settings":{"geometry":true}}
```
For `validate`, `ids` is required and has `path`, `sha256`, and `specificationIds` (null means all specifications; otherwise IDS specification identifiers). Caller applies source-model scope by selecting the IDS document/specification identifiers for this model. Unknown identifiers fail the job.

Stdout contains only NDJSON. Each record carries `protocolVersion:1` and `jobId`.
```json
{"protocolVersion":1,"jobId":"job-1","event":"progress","stage":"loading"}
{"protocolVersion":1,"jobId":"job-1","event":"result","manifest":{"path":"/data/jobs/job-1/manifest.json","sha256":"<64 lowercase hex>","size":1234}}
```
One terminal result, last, and exit 0 signify transport success. Logs go to stderr. Request/input/engine failures exit nonzero without a terminal result. IDS violations are successful jobs with failed outcomes; unsupported evaluation produces incomplete outcomes, never passes.

Manifest has `protocolVersion`, `jobId`, `operation`, `revisionId`, `modelSha256`, `idsSha256` (nullable), `versions` (`worker`, `ifcOpenShell`, `ifcTester`, `extraction`, `scopeSemantics`), `artifacts` (keys `objects` and `outcomes`, each with `path`, `sha256`, `size`, `recordCount`), and `diagnostics` (string array). Both artifacts are UTF-8 JSONL, atomically published before the manifest. Caller verifies paths remain in its job directory, sizes, hashes, version, job identity, nonzero exit, stream completeness, and exactly one terminal record.

Object records have `revisionId`, `expressId`, `globalId` (nullable), `type`, `name` (nullable), `storey` (nullable), `placement` (12 numbers or null), `properties`, and `geometry`. Placement is row-major 3x4, project frame, translations in metres. Geometry is `{status,reason,vertices,triangles}`; statuses are available/absent/unsupported. Vertices are flat xyz SI object-local coordinates; triangles are flat zero-based vertex indices. Geometry-disabled extraction is unsupported. Properties contain `path`, `value`, `originalUnit`, `siValue`, `dimension`, `collectionOrder`; unsupported units retain raw values and null SI/dimension. Dimensions are length/area/volume or null. Properties and object records are unordered; coordinates/matrix/triangle indices are ordered. GlobalIds are not assumed unique.

Outcome records contain `specificationId`, `specificationName`, `requirementIndex` (zero-based or null for applicability), `requirement` (engine description), `status` (passed/failed/incomplete), `applicableCount`, `passedCount`, `failedCount`, and `failures`. Each failure contains `revisionId`, `expressId`, `globalId`, `reason`. Outcomes and failures are unordered. Zero applicable objects are incomplete unless IfcTester explicitly fails required applicability, which is failed. Invalid IDS XML/schema fails the job. The IfcTester engine determines facet applicability and requirement results; no independent scoring is performed.
