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
| GET | `/api/deliveries/:deliveryId` | – | `DeliveryDetail` |
| POST | `/api/deliveries/:deliveryId/models` | multipart: `file`, `discipline` | `ModelInfo` |
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

1. Uploading a model to a delivery that already has a completed run for that discipline → `409 delivery_locked`.
2. `POST /api/packs/:packId/versions` always allocates `version = max(version) + 1`; existing rows are never mutated.
3. A run stores `engineVersion` + `parserVersion` + pack version + every model's `contentSha256`.
4. `reviewIncomplete` counts are reported separately and never folded into pass/fail.
5. `GET /api/diff/runs` refuses runs bound to different pack versions — otherwise a new rule looks like a regression.
