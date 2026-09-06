# Create deliveries from immutable source-model revisions

ID: 02
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 01, 18
Wave: 1
Original plan coverage: 2

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A client can assemble a delivery from named source revisions, including two models in the same discipline, and reuse unchanged revisions in the next delivery.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Publish shared model contracts across Rust, Python, and the browser](18-shared-model-contracts.md). Consume its verified public contract.

- [Restore and verify the local application baseline](01-local-baseline.md). Read its Answer and verified interface before starting.

## Ownership

Service data model, forward migrations, source/revision/delivery endpoints and shared HTTP types.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Use the shared opaque ObjectRef model in application DTOs. Persist source-specific IFC identifiers in a mapping rather than making expressId the reusable viewer identity.

- Introduce persistent SourceModel, immutable ModelRevision, and delivery membership. Discipline is a filter, not identity.
- Use transactional versioned forward migrations. Preserve old model IDs as revision IDs; give each legacy model its own conservative source identity. Do not guess lineage.
- Finalize deliveries transactionally and reject later membership edits. Keep pre-migration history readable with incomplete provenance when its run inputs cannot be established.

## Acceptance criteria

- [x] API model payloads consume the shared contract and preserve revision-local objectId/source-identifier mapping without inventing cross-revision identity.

- [x] Two separately named MEP sources coexist in one delivery.
- [x] A second delivery reuses an unchanged revision without copying its source bytes.
- [x] Finalized membership cannot change, including concurrent finalize/edit requests.
- [x] Migration succeeds on empty and populated data, rolls back on injected failure, and retries without data loss or duplication.

## Verification

- cargo test -p modelshelf-checker
- Create scripts/verify-api.mjs --scenario revisions using the shared harness.
- Assert stored rows and HTTP responses for reuse, finalize races, and conservative legacy migration.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

### What was built

New schema (`services/checker/migrations/0002_source_models.sql` + `services/checker/src/migrate_v2.rs`, applied by a rewritten `db.rs` migration runner): `source_models` (persistent, project-owned, `UNIQUE(project_id, name)`; discipline is metadata only), `model_revisions` (immutable, `id` reused verbatim from legacy `models.id` for migrated rows so `objects.model_id` never needs remapping), `delivery_members` (`UNIQUE(delivery_id, source_model_id)` — one revision per source model per delivery, exactly what "two MEP sources coexist" and "reuse a revision in a second delivery" both fall out of), and `deliveries.finalized_at` (nullable; set once, forever). The old `models` table is untouched and kept as historical record; nothing that existed before this migration was deleted or mutated.

New endpoints (`services/checker/src/sources.rs` for source models/revisions; `add_delivery_member`/`finalize_delivery` in `routes.rs` for delivery lifecycle, next to `create_delivery`/`get_delivery`): `POST/GET /api/projects/:id/source-models`, `POST /api/source-models/:id/revisions` (multipart, decoupled from any delivery), `POST /api/deliveries/:id/members`, `POST /api/deliveries/:id/finalize`. `docs/contracts/http-api.md` and `apps/web/src/lib/types.ts` are updated together (`SourceModel`, `ModelRevisionSummary`, `Delivery.finalizedAt`, `ModelInfo.sourceModelId`/`sourceModelName`, `ObjectRef`, `ObjectRow.ref`).

`objects` gained `ref_object_id` (schemas/model/v1's `ObjectRef.objectId`), computed via `model_contracts::express_id_to_object_id` at ingest time (`sources.rs::persist_revision`) and backfilled for every pre-existing row during migration (`migrate_v2::backfill_object_refs`). `ObjectRowOut`/`ObjectDetail` now expose `ref: { revisionId, objectId }` alongside the existing `expressId`/`globalId` (the "source mapping" the contract still calls for), satisfying "consume the shared contract... without inventing cross-revision identity" directly, not just by convention.

### Two things discovered and fixed along the way (both real, both now covered by tests)

1. **`express_id_to_object_id` didn't exist in Rust.** Ticket 18 deliberately left it out of `crates/model-contracts` ("Rust only consumes `ObjectRef` opaquely"), reasonably, at the time — but that assumed only the (not-yet-built) worker would ever *produce* one. This ticket's synchronous ingestion path (`sources.rs`, using `ifc-model`/`fingerprint` directly, since worker/job integration is ticket 04's scope) is itself an IFC adapter that needs to produce `objectId`s today. Added `express_id_to_object_id` to `crates/model-contracts` (same algorithm, `sha2` dependency, tested against the same golden fixture `schemas/model/v1/fixtures/express-id-mapping.json` all three languages already share — now four-way... three-way agreement: Python, TypeScript, Rust). Updated `schemas/model/v1/README.md`'s now-inaccurate "Rust does not implement the mapping" line and ticket 18's crate doc comment.
2. **`objects.model_id REFERENCES models(id)` was a live bug waiting to happen.** That FK was fine when a model row lived one-per-delivery; a revision created *after* this migration has no row in the now-frozen `models` table at all, only in `model_revisions`, so the very first real upload through the new endpoint hit `FOREIGN KEY constraint failed` (caught by my own real end-to-end test with the real sample file, not by inspection). SQLite has no `ALTER TABLE` for retargeting a foreign key, and `ALTER TABLE RENAME` rewrites *other* tables' FK text to point at the renamed name — verified empirically (see the ticket's evidence log) — so `object_props` (which references `objects`) had to be rebuilt in the same pass or it would end up referencing a dropped table. Implemented as `migrate_v2::rebuild_objects_foreign_key`, run with FK enforcement off for the *entire* v2 transaction (SQLite forbids toggling `PRAGMA foreign_keys` mid-transaction, and the rebuild is only valid once `model_revisions` is populated by the legacy-model migration earlier in the same transaction) with an explicit `pragma_foreign_key_check` gate right before commit — if that finds anything inconsistent, the migration fails and rolls back instead of silently committing a database SQLite's own enforcement would otherwise have caught. A dedicated test (`objects_foreign_key_targets_model_revisions_and_is_actually_enforced`) proves the rebuilt constraint still rejects a bad `model_id`/`object_id`, not just that the rebuild ran without erroring.

Also found and fixed in passing: `axum::extract::Multipart` enforces its own 2 MiB default body limit independently of the `RequestBodyLimitLayer` already configured in `main.rs` — a real ~2.5MB IFC upload (the actual restricted sample) hit it immediately. Added `DefaultBodyLimit::max(MAX_BODY_BYTES)`. This was a latent bug in the *original* (ticket-01-era) upload handler too, never exercised end-to-end with a real file before.

### Commands and results

```
$ cargo test --workspace
... all crates pass, including 5 new migration tests in services/checker (see below)

$ cargo test -p modelshelf-checker db::
running 5 tests
test db::tests::migrates_a_fresh_empty_database_to_the_latest_version ... ok
test db::tests::migrates_populated_v1_data_preserving_old_rows_and_synthesizing_v2_rows ... ok
test db::tests::objects_foreign_key_targets_model_revisions_and_is_actually_enforced ... ok
test db::tests::a_failing_migration_rolls_back_completely_and_a_retry_succeeds_without_duplication ... ok
test db::tests::a_fault_during_object_ref_backfill_also_rolls_back_the_whole_version ... ok
test result: ok. 5 passed; 0 failed
```
The populated-data test seeds two legacy `models` rows in two different deliveries (both ARCH — the *old* schema's own `UNIQUE(delivery_id, discipline)` makes two same-discipline models in *one* legacy delivery impossible, so "two separate legacy ARCH uploads" is the realistic "don't guess lineage" scenario) and asserts: both survive in `models` untouched, each gets its own `source_models` row (not merged), `model_revisions.id` equals the legacy `models.id` exactly, `provenance = 'incomplete'`, and each object's `ref_object_id` matches an independent call to `express_id_to_object_id`. The two fault-injection tests (`MigrationFault::AfterLegacyModelMigration` / `AfterObjectRefBackfill`, `pub(crate)`-only, never reachable in production) prove: the failing attempt leaves `schema_migrations` at version 1 *and* the v2 tables not even existing (DDL rolled back too, verified via `sqlite_master`), and a subsequent clean retry succeeds with no duplicate rows.

```
$ node scripts/verify-api.mjs --scenario revisions   (run 4x for stability; all 4 clean)
ok - cargo build succeeds
ok - seed succeeds
ok - two source models created
ok - both revisions uploaded and parsed
ok - two same-discipline (MEP) source models coexist in one delivery
ok - second delivery reuses the revision (same model id, no new blob written)
ok - finalize sets finalizedAt and locks the delivery
ok - membership edit after finalize is rejected (409 delivery_locked)
ok - finalizing an already-finalized delivery is idempotent
ok - 20 concurrent finalize calls all agree on one finalizedAt
ok - 20 concurrent membership edits each either fully succeeded or were rejected — none silently dropped or partially applied
ok - final membership count matches exactly the member calls that actually reported success (no edit applied after the finalize it lost to)
ok - duplicate source model name is rejected (400)
ok - unknown discipline is rejected (400)
ok - uploading to a nonexistent source model is rejected (404)
ok - adding a revision under the wrong source model is rejected (400)
ok - object payloads include the shared ref (revisionId/objectId), not just the raw expressId
all checks passed
```
This runs against the real restricted sample IFC via real HTTP against a real spawned server on an isolated port/temp-data-dir (no mocks). The concurrency check fires 20 concurrent `finalize` calls and 20 concurrent `members` calls at the *same* fresh delivery simultaneously via `Promise.all`; every run so far has finalize winning the race (SQLite serializes writers, so this is a valid, not a required, outcome) — the invariant actually being verified (and the one that matters) is that zero member-adds ever landed *after* the point `finalized_at` was set, checked via the final `modelCount` matching exactly the count of calls that reported success. The edit-wins direction is separately covered by the non-concurrent scenario earlier in the same script (both source models added successfully *before* finalizing delivery 1).

Extracted `scripts/lib/checker-harness.mjs` (build/port/CLI-run/health-poll helpers) so `qa-harness.mjs` (ticket 01) and this new `verify-api.mjs` share one implementation — "using the shared harness" per this ticket's verification text — and re-ran `qa-harness.mjs` afterward to confirm the refactor didn't regress it.

```
$ npm run typecheck --prefix apps/web    # after adding SourceModel/ModelRevisionSummary/ObjectRef/finalizedAt/etc.
(clean)
$ node scripts/verify-model-contracts.mjs   # after adding express_id_to_object_id to crates/model-contracts
all checks passed
$ cd services/ifc-worker && uv run ruff check src tests && uv run basedpyright src tests && uv run --locked pytest -q
All checks passed! / 0 errors, 0 warnings, 0 notes / 30 passed   (unaffected by this ticket; re-checked for regression only)
```

Evidence: `.omo/evidence/modelshelf-prototype/task-2/` — `migration-tests.log` and four `run-<timestamp>/` directories from `verify-api.mjs` (build log, serve log, and a JSON dump per interesting response: delivery-after-both-members, race-delivery-final-state).

### Interface changes downstream tickets need

- **Ticket 04** (durable jobs / worker integration): the synchronous ingestion path this ticket kept (`sources.rs::store_revision`, using `ifc-model`/`fingerprint` directly) is exactly what 04 replaces with worker-based, queued ingestion. When it does, it inherits `ref_object_id` computation and the source-model/revision/membership shape as-is — nothing here should need to change, only *how* a `ModelRevisionRow` gets populated.
- **`diff.rs::diff_models`**: still matches base/head models by discipline via `.find()` — now a documented, known limitation (see its new doc comment), since two source models can share a discipline in one delivery for the first time as of this ticket. It silently picks one arbitrary pair per discipline rather than erroring. Real model comparison by `source_model_id` is ticket 13's scope, not this one's.
- **Ticket 06** ("pinned delivery inputs"): `finalized_at` is the freeze mechanism this ticket owns; it does **not** wire "a run may only target a finalized delivery" — `create_run` still accepts a draft delivery, exactly as before this ticket. Whether to require finalization before running a check, and any `run_models`-style pinned-snapshot table (mentioned in the original plan's todo #2 but explicitly out of *this* ticket's narrower acceptance criteria), is 04/06 territory.
- `models`/`object_props` physically changed shape underneath (`objects.model_id` now `REFERENCES model_revisions(id)`; `object_props` was rebuilt to fix its FK text after that rename) — transparent to all existing Rust code since column names didn't change, but worth knowing before anyone hand-writes new raw SQL against these tables.

### Limits

- `ref_object_id` is nullable at the SQL level (SQLite cannot add a `NOT NULL` column with no constant default to an existing table) even though every row — migrated or freshly inserted — always has one in practice.
- The membership "replace" semantics (`POST .../members` on a source model already a member of an unfinalized delivery silently replaces the prior revision, via `INSERT OR REPLACE`) aren't explicitly specified anywhere; I chose this as the natural behavior for "assembling" a draft delivery and documented it in `http-api.md` rule 3. Flagging in case a reviewer expected an error instead.
- No UI exists yet to exercise any of this (out of scope; ticket 10 owns the delivery shelf).

## Review corrections — 2026-09-07

Reopened by review. The historical Answer above is retained; completion requires the corrections below. Read [the review through ticket 05](../../../docs/reviews/tickets-01-05.md) and [the earlier follow-up](../../../docs/reviews/tickets-01-03-follow-up.md) for evidence and verification.

- [ ] Run input provenance must default to incomplete until exact inputs are pinned. Add a forward migration and test a newly created run.

Coordinate shared schema and jobs.rs edits with the owners of related tickets. Append new evidence and close only after these checks pass.
