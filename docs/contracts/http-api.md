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
| GET | `/api/diff/models?baseDeliveryId=&headDeliveryId=&kind=&limit=&offset=` | – | `ModelDiffResponse` |
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
10. `RunDetail.inputProvenance.status` is `complete` when the listed `models` are the inputs that run evaluated. `incomplete` means those models are reconstructed from current delivery membership (pre-migration history) and are not verified run inputs; `reason` explains why. Original findings and evidence remain readable either way.
11. Object extraction (`ifcType`, `name`, `storey`, `placement`, properties, `ref.objectId`) comes entirely from the worker's `objects.jsonl`, cross-checked against the shared occurrence-id contract before anything is published — not a second, independent Rust parse. `predefinedType` is not yet extracted by the worker and is always `null`.
