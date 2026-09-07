# Process model revisions through durable jobs

ID: 04
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: unassigned
Blocked by: 02, 03
Wave: 1
Original plan coverage: 2,3

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

Uploading a model returns a job immediately; the client can poll until the immutable revision is ready or see why processing failed.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Create deliveries from immutable source-model revisions](02-immutable-deliveries.md). Read its Answer and verified interface before starting.
- [Inspect IFC through a verified worker contract](03-ifc-worker-contract.md). Read its Answer and verified interface before starting.

## Ownership

Rust upload/worker adapter, durable job table/runner, artifact publication and revision read endpoints.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Consume generated shared model payloads in Rust and persist opaque occurrence references plus source mappings. Keep job/persistence logic outside the reusable model-contract and comparison modules.

- Replace live custom-parser ingestion with the authoritative worker. Validate protocol schema/identity/exit code and all artifact hashes/paths in Rust.
- HTTP returns 202 plus a job reference. Persist queued/running/completed/failed state and serialize heavy work. Publish normalized objects and ready state atomically.
- Mark interrupted running jobs failed on restart; provide idempotent explicit retries. Store bytes content-addressed and retain failed input evidence.

## Acceptance criteria

- [x] A model-data schema version mismatch is rejected at the worker boundary, and the API does not expose database row structure as the viewer contract.

- [x] A real upload progresses to a ready revision with inspectable objects and a retrievable original IFC.
- [x] Malformed/truncated stdout, duplicate terminal results, wrong job ID, nonzero exit, bad artifact hash, and path escape cannot publish ready data.
- [x] Restart during work yields a visible recoverable failure, not a permanently running job or clean result.
- [x] Duplicate content avoids duplicate blob storage; simultaneous requests do not exceed one active heavy job.

## Verification

- cargo test -p modelshelf-checker
- node scripts/verify-api.mjs --scenario worker-failure
- Exercise live upload/poll/object retrieval and crash/restart with the shared isolated harness.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

### What changed

Uploading a revision (`POST /api/source-models/:id/revisions`) is now asynchronous: the handler only computes the content hash, writes the blob (content-addressed, unchanged from ticket 02), inserts an `ingestion_jobs` row, and returns `202` with an `IngestionJob` immediately. A single background worker task (`services/checker/src/jobs.rs`, spawned once in `main.rs::serve`) claims queued jobs one at a time — that strict sequencing, not a lock, is what guarantees at most one heavy `ifc-worker` invocation is ever in flight — invokes the real worker (`docs/contracts/worker-v1.md`) as a subprocess, and only inserts `model_revisions`/`objects`/`object_props` once every part of its output has been validated. Nothing is trusted implicitly:

- Every NDJSON line is parsed and checked for `protocolVersion == 1` and a matching `jobId` before its `event` is even inspected; an unsupported protocol version fails the job immediately (the "schema version mismatch" criterion), as does a malformed/truncated line, an event with the wrong job id, more than one terminal `result` event, or a `result` that isn't the last line.
- The manifest the result event points at is checked for path containment inside the job's own output directory (a lexical `.."`/`.`-normalising check, not `fs::canonicalize`, so a path that doesn't even exist yet still gets caught), then its own hash/size are verified against the result event, then its `protocolVersion`/`jobId`/`revisionId`/`modelSha256` are checked against what this job actually requested.
- Both artifacts (`objects.jsonl`, `outcomes.jsonl`) get the same path-containment + hash + size check against the manifest's own declared values, plus a record-count cross-check.
- Every object record's `ref.objectId` is independently recomputed via `model_contracts::express_id_to_object_id` and compared against what the worker reported — a real, executable cross-check of the shared occurrence-id contract, not just trust.

Only after all of that does the job's objects get persisted, in one transaction that also flips the job to `completed` with its `modelRevisionId` — so a client polling `GET /api/jobs/:jobId` never sees a job marked done with a revision that isn't actually queryable yet. A job still `running` when the process exits (crash, kill) is recovered as `failed` with an explicit restart message on the next startup (`db.rs::recover_interrupted_jobs`, called from `AppState::open`), and `POST /api/jobs/:jobId/retry` re-queues a `failed` job in place (same job id, `attemptCount` incremented) — idempotent: retrying anything that isn't currently `failed` is a no-op that just returns the current state.

`--worker-command <template>` (new `serve` flag, `{request}` substituted with the job's request.json path, run through `sh -c`) makes the worker invocation swappable; tests use it to substitute `scripts/fixtures/fake-worker.mjs`, a real subprocess that can be told to misbehave in exactly the ways a real worker never does.

Viewer-facing object extraction (`ifcType`, `name`, `storey`, `placement`, properties, geometry status) now comes entirely from the worker's `objects.jsonl` — the old synchronous `ifc_model::IfcModel::parse`-based extraction in `sources.rs` is gone. `ifc_model::IfcModel::parse` + `fingerprint::snapshot_model` are still run once per completed job, but only to compute the `fp_properties`/`fp_placement`/`fp_shape`/`fp_combined` diff-hash columns `modeldiff` depends on — the worker has no representation-graph data to derive `fp_shape` from, so this is not "custom-parser ingestion," it's the fingerprinting concern ticket 04 doesn't touch. `object_props.data_type` now holds the worker's `dimension` (length/area/volume/null) instead of the old IFC measure-type name, and `inherited` is always `false` and `predefinedType` always `null` — the worker doesn't expose either yet (documented in `http-api.md`, `types.ts`). None of this affects IDS run evaluation (`run.rs::execute`): it re-parses the raw model bytes independently every time and never reads `objects`/`object_props`.

### Files changed

- `services/checker/migrations/0003_jobs.sql` (new): `ingestion_jobs` table.
- `services/checker/src/db.rs`: `MIGRATION_0003`, `SCHEMA_VERSION` bump, `recover_interrupted_jobs`; 3 existing migration tests' hardcoded post-migrate version assertions changed to the `SCHEMA_VERSION` constant (this turned out load-bearing: a concurrent session added a `MIGRATION_0004`/`SCHEMA_VERSION = 4` while this ticket was in flight, and those tests kept passing with no further edit needed).
- `services/checker/src/jobs.rs` (new): the queue, worker loop, protocol validation, and revision publication described above.
- `services/checker/src/dto.rs`: `IngestionJobRow`, `JOB_SELECT`, `IngestionJob`, `job_json` — a hand-shaped DTO distinct from the row type (the "don't expose database row structure" criterion).
- `services/checker/src/sources.rs`: `upload_revision` now enqueues instead of parsing synchronously; the old `store_revision`/`persist_revision` are gone.
- `services/checker/src/routes.rs`: `GET /api/jobs/:jobId`, `POST /api/jobs/:jobId/retry`.
- `services/checker/src/state.rs`: `AppState.worker_command`/`job_notify`; calls `recover_interrupted_jobs` on open.
- `services/checker/src/main.rs`: `mod jobs;`, `--worker-command` flag, spawns the worker loop in `serve`.
- `scripts/fixtures/fake-worker.mjs` (new): a real subprocess standing in for `ifc-worker`, with modes `malformed-stdout`, `duplicate-result`, `wrong-job-id`, `nonzero-exit`, `bad-artifact-hash`, `path-escape`, `schema-version-mismatch`, `slow-success`, `hang`.
- `scripts/verify-api.mjs`: `--scenario revisions` reworked for the async upload contract (upload → poll → use `modelRevisionId`); new `--scenario worker-failure` covers every failure mode above plus concurrency and restart-recovery.
- `docs/contracts/http-api.md`, `apps/web/src/lib/types.ts`: `IngestionJob`/`IngestionJobStatus`, the new endpoints, and the extraction/limitation notes above.

### Commands and results

```
$ cargo test --workspace
... all crates pass, including services/checker's 5 db.rs migration tests (now reaching SCHEMA_VERSION 4)
$ node scripts/verify-api.mjs --scenario revisions
19 checks, all ok — real worker, 127 objects per revision, content-addressed dedup, finalize/membership races, /file retrieval
$ node scripts/verify-api.mjs --scenario worker-failure
23 checks, all ok — 7 failure modes each leave the job failed with no model_revisions row; concurrency never exceeds 1 running job; restart recovery + idempotent retry via the real worker
$ node scripts/qa-harness.mjs   # ticket 01's harness, unaffected
all checks passed
```

Evidence: `.omo/evidence/modelshelf-prototype/task-2/run-*/` (one subdirectory per `verify-api.mjs` run, both scenarios) and `.omo/evidence/modelshelf-prototype/task-1/run-*/` (qa-harness regression). Verified clean process/temp-dir teardown after every run (`pgrep -fa modelshelf-checker`, `/tmp` listing) — no orphans from the restart-recovery scenario's killed server or the concurrency scenario's parallel uploads.

### Limits and downstream notes

- `predefinedType` and property `inherited` are not yet extracted by the worker; both are always `null`/`false`. A future worker change extending `ObjectRecord`/`PropertyRecord` should update `jobs.rs::publish_revision` and the two DTOs together.
- Job output directories (`<data-dir>/jobs/<job-id>/`, holding `request.json`, `stdout.log`, `stderr.log`, and the worker's own artifacts) are never cleaned up, on success or failure — deliberate for this prototype's scale (failed-job evidence retention) but would need a retention policy before any real deployment.
- The worker is invoked via `sh -c` with `{request}` substituted into a template; `--worker-command`'s default assumes the process's CWD is the repo root, same assumption every other script/doc in this repo already makes.
- Concurrent session note: while this ticket was in progress, another session added `MIGRATION_0004`/`services/checker/migrations/0004_run_input_provenance.sql`, `RunRow.input_provenance(_reason)`, and `RunDetail.inputProvenance` (http-api.md rule now numbered 10; this ticket's worker-extraction rule renumbered to 11 to avoid a duplicate "10." after both sessions edited that file concurrently). Rebuilt and reran the full workspace test suite plus both `verify-api.mjs` scenarios after their changes landed to confirm no interaction; none found — their migration/tables are disjoint from `ingestion_jobs`, and `run.rs::execute` (which their change touches) never reads anything this ticket writes.

## Review corrections — 2026-09-07

Reopened by review. The historical Answer above is retained; completion requires the corrections below. Read [the review through ticket 05](../../../docs/reviews/tickets-01-05.md) and [the earlier follow-up](../../../docs/reviews/tickets-01-03-follow-up.md) for evidence and verification.

- [x] Validate render schemas, counts, mappings and descriptor identity, not only hashes.
- [x] Preserve full structured property values, ordering and SI metadata through persistence/API.
- [x] Move restart recovery out of AppState::open and require exclusive service ownership; seed must not invalidate live work.
- [x] Supervise descendant worker lifetime and timeouts; fence publication by attempt and retain separate retry output directories.
- [x] Reject symlink-based artifact path escapes.
- [x] Do not require custom IFC parser success to publish a successful authoritative worker result.

Coordinate shared schema and jobs.rs edits with the owners of related tickets. Append new evidence and close only after these checks pass.
