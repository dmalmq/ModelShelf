# ModelShelf HTTP contract (v0)

Base URL: `http://127.0.0.1:8787`. JSON in/out, `camelCase` fields, UTC ISO-8601 timestamps.
Errors: HTTP status + `{ "error": { "code": string, "message": string } }`.
The TypeScript mirror of every payload is `apps/web/src/lib/types.ts` — the two files MUST agree.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | – | `Health` |
| GET | `/api/projects` | – | `Project[]` |
| GET | `/api/projects/:projectId` | – | `ProjectDetail` |
| POST | `/api/projects/:projectId/deliveries` | `{ label, deliveryDate? }` | `Delivery` |
| GET | `/api/projects/:projectId/source-models` | – | `SourceModel[]` |
| POST | `/api/projects/:projectId/source-models` | `{ name, discipline }` | `SourceModel` |
| POST | `/api/source-models/:sourceModelId/revisions` | multipart: `file` | `202` `IngestionJob` (asynchronous; poll `GET /api/jobs/:jobId`) |
| GET | `/api/jobs/:jobId` | – | `IngestionJob` |
| POST | `/api/jobs/:jobId/retry` | – | `IngestionJob`; no-op unless the job is `failed` |
| GET | `/api/deliveries/:deliveryId` | – | `DeliveryDetail` |
| POST | `/api/deliveries/:deliveryId/members` | `{ sourceModelId, modelRevisionId }` | `DeliveryDetail` |
| POST | `/api/deliveries/:deliveryId/finalize` | – | `DeliveryDetail` |
| GET | `/api/models/:modelId/file` | – | `application/octet-stream` IFC bytes (supports `Range`) |
| GET | `/api/models/:modelId/objects?type=&storey=&limit=&offset=` | – | `ObjectPage` |
| GET | `/api/objects/:objectId` | – | `ObjectDetail` |
| GET | `/api/packs` | – | `Pack[]` |
| POST | `/api/packs/:packId/versions` | `{ idsXml, metadata?, notes? }` | `PackVersion` |
| GET | `/api/pack-versions/:packVersionId` | – | `PackVersionDetail` |
| POST | `/api/runs` | `{ deliveryId, packVersionId }` | `RunDetail` (synchronous execution) |
| GET | `/api/runs/:runId` | – | `RunDetail` |
| GET | `/api/findings/:findingId/objects?limit=&offset=` | – | `FindingObjectPage` |
| GET | `/api/diff/models?baseDeliveryId=&headDeliveryId=&kind=&limit=&offset=` | – | `ModelDiffResponse`, `409 fingerprint_profile_mismatch` when the two sides were fingerprinted under different profiles (or one side predates normalized fingerprints) |
| GET | `/api/diff/runs?baseRunId=&headRunId=` | – | `FindingDiffResponse`, `409 pack_version_mismatch` when the runs used different pack versions |

Rules the service enforces:

1. A source model is a persistent, named, project-owned input (e.g. "Architecture East" or "Mechanical"); discipline is metadata for filtering, never identity — two source models may share a discipline, and both can be members of the same delivery at once.
2. A model revision is immutable and belongs to exactly one source model, independent of any delivery — uploading one (`POST /api/source-models/:sourceModelId/revisions`) never touches delivery membership. It is content-addressed: re-uploading identical bytes reuses the stored blob rather than writing a duplicate. Uploading returns `202` with a job reference immediately; the revision does not exist (and never appears in `SourceModel.revisions`) until that job's `GET /api/jobs/:jobId` reports `status: "completed"` with a `modelRevisionId`. Ingestion runs the authoritative `ifc-worker` (`docs/contracts/worker-v1.md`) out of process, one job at a time service-wide; a job that fails (bad worker output, a crash mid-run) reports `status: "failed"` with `error` and can be retried (`POST /api/jobs/:jobId/retry`, a no-op unless the job is currently `failed`) without re-uploading.
3. `POST /api/deliveries/:deliveryId/members` attaches a source model's revision to a delivery: one revision per source model per delivery (adding a second revision for a source model already a member of that delivery replaces the first, until the delivery is finalized). A second delivery may reference the same revision to reuse it without re-uploading.
4. Adding or replacing delivery membership on a delivery that is finalized, or that already has a completed run, → `409 delivery_locked`. `POST /api/deliveries/:deliveryId/finalize` freezes membership forever; calling it again is a no-op success (same `finalizedAt`), not an error.
5. Every object payload (`ObjectPage`, `ObjectDetail`) carries `ref: { revisionId, objectId }` — the shared, opaque occurrence ID from `schemas/model/v1` (`objectId` is unique only within its `revisionId`, computed deterministically from the model's IFC express ID; never compared across revisions) — alongside the raw `expressId`/`globalId` source mapping.
6. `POST /api/packs/:packId/versions` always allocates `version = max(version) + 1`; existing rows are never mutated.
7. A run stores `engineVersion` + `parserVersion` + pack version + every model's `contentSha256`.
8. `reviewIncomplete` counts are reported separately and never folded into pass/fail.
9. `GET /api/diff/runs` refuses runs bound to different pack versions — otherwise a new rule looks like a regression.
10. `RunDetail.inputProvenance.status` is `complete` for every run the service creates now: membership, content hashes, pack IDS digest, specification scope, and engine profile are frozen in one transaction before evaluation. `GET /api/runs/:id` reads `models` from that snapshot, not from live delivery membership. Historical runs without a snapshot stay `incomplete` with a reason. Original findings and evidence remain readable either way. Finding objects carry `ref: { revisionId, objectId }`, the same shared identity used by object payloads.
11. Object extraction (`ifcType`, `name`, `storey`, `placement`, properties, `ref.objectId`) comes entirely from the worker artifacts, cross-checked against the shared occurrence-id contract before anything is published. A successful worker result is enough to publish; the custom Rust IFC parser is not a publication gate. Every object is fingerprinted at ingest under the current fingerprint profile (`fp-v1`): full digests, canonical texts, and profile identity are stored beside the object row. `predefinedType` is not yet extracted by the worker and is always `null`. `GET /api/objects/:id` returns the shared Property record (`values`, `ordered`, `origin`). Scalar columns on `object_props` are a search projection only.
12. `GET /api/diff/models` pairs revisions by persistent `sourceModelId`, never by discipline — two same-discipline sources in one delivery compare strictly within their own source and never cross-match. A pair whose deliveries point at the same revision short-circuits with `reusedRevision: true`, an empty `changes` list, and a zeroed summary (no comparison runs). A source present on only one side reports pure additions/removals without matching. `limit`/`offset` page each pair's `changes` after the `kind` filter; `total` is the pre-page filtered count. Pairs sort by `sourceModelName`, then `sourceModelId`; changes sort most-actionable-first (`mixed`, `shapeChanged`, `moved`, `propertiesChanged`, `added`, `removed`), then `ifcType`, then `expressId`.
13. Only GlobalIds unique on both sides match `exact`. Duplicate, missing, or regenerated GlobalIds match at best `heuristic` (with `score`/`basis`), and splits/merges stay unresolved additions/removals. Every change's `base`/`head` refs carry `revisionId` + `objectId` alongside the raw `expressId`/`globalId` mapping, so each change names its source and revision even when GlobalIds are absent or duplicated. Comparing snapshots fingerprinted under different profiles → `409 fingerprint_profile_mismatch` naming the expected/actual profile; recompute by re-uploading under one profile (history is append-only; stored artifacts are never overwritten).
