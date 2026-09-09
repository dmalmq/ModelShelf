# Plan alignment review, 2026-09-09

Scope: the code delivered by tickets 01-11 and 18, compared against
[the approved plan](../../.omo/plans/modelshelf-prototype.md),
[the ticket specification](../../.scratch/modelshelf-prototype/spec.md), and
[the reusable-module decision](../adr/0001-reusable-model-modules.md).
Tickets 12-17 are not started; gaps that those tickets already own are recorded
as inherited gaps in their Comments rather than duplicated as new tickets.

This review reads source and evidence only. It runs no builds and changes no
behavior.

## Verdict

The delivered work follows the plan on the load-bearing architecture. Rust owns
persistence, jobs, grouping and comparison; IfcTester is the only scorer;
`crates/ids` is off every scoring path; the migration runner is versioned,
transactional and preserves legacy rows; blob storage is genuinely
content-addressed; restricted samples are gitignored; the demo pack carries 11
cited specifications with a documented v1 to v2 change.

Twelve divergences are worth fixing. Two are structural: the reusable viewer
package was deferred and never extracted, and the generated shared contracts
have no browser caller. The rest are integrity, coverage and honesty gaps inside
already-resolved scope.

## Confirmed compliant

- Migration runner versioned and transactional, rollback proven by `MigrationFault`
  tests; legacy revision IDs, `Legacy <discipline> <model-id>` naming, delivery
  membership and `provenance_incomplete` stamping preserved (`services/checker/src/db.rs`,
  `services/checker/src/migrate_v2.rs`).
- `crates/ids` reachable only for specification-name listing (`run.rs:58-60`) and
  pack display (`routes.rs:676`); live scoring is IfcTester through `invoke_worker`.
- Applicability semantics match the spec clarification: required with zero matches
  fails, optional with zero matches is not applicable, unsupported is incomplete
  (`services/ifc-worker/src/ifc_worker/validate.py`, `run.rs` `fold_outcome`).
- Pack publication validates IDS and metadata instead of defaulting (`routes.rs`
  `create_pack_version`, `seed.rs`).
- Worker boundary respected: NDJSON on stdout, logs on stderr, bulk in hashed
  files, no Python database access, engines pinned exactly in `uv.lock`.
- Viewer capability set complete, one shared origin offset, dedicated Worker,
  batched geometry, bounded pixel ratio, idempotent disposal, finding pagination
  exhausted past the embedded 25.
- Severity bands precede categories, one row per failed requirement, text
  accompanies every colour, Japanese labels rendered verbatim.
- Playwright locked at 1.63.0; no puppeteer or raw CDP.

## Divergences and the tickets that fix them

| Severity | Divergence | Evidence | Ticket |
| --- | --- | --- | --- |
| Blocker | Reusable viewer package never extracted; viewer core imports `Discipline`, `DeliveryDetail`, `ModelInfo`, `Finding`, `Severity` | no `packages/model-viewer`; `apps/web/src/components/viewer/types.ts:1-6,24` | [19](../../.scratch/modelshelf-prototype/issues/19-reusable-viewer-package.md) |
| Blocker | Generated TypeScript contracts have zero importers; `ObjectRef` and the express-ID mapping exist twice | `apps/web/src/lib/types.ts:65-69`; `components/viewer/object-ref.ts:22-27` vs `packages/model-contracts-ts/src/express-id-mapping.ts` | [20](../../.scratch/modelshelf-prototype/issues/20-consume-shared-contracts.md) |
| Major | Mock fixtures and design routes ship in the production build; seven production modules import `@/lib/mock` | `apps/web/src/lib/mock.ts`, `apps/web/src/app/design/**` | [21](../../.scratch/modelshelf-prototype/issues/21-remove-mock-scaffolding.md) |
| Major | Concurrent runs bypass the one-heavy-job rule; interrupted runs strand as `running` forever | `run.rs` `create_run` inline `execute`; `db.rs:111-122` recovers jobs only | [22](../../.scratch/modelshelf-prototype/issues/22-serialize-heavy-jobs.md) |
| Major | Engine profile hardcoded, worker versions never persisted, complete runs fall back to live membership | `run.rs:68-74`, `run.rs:749-770`, `jobs.rs` `publish_revision` | [23](../../.scratch/modelshelf-prototype/issues/23-measured-run-inputs.md) |
| Major | Band and category object totals double-count multi-rule objects; spec table re-sorts backend order | `run.rs:652-653`; `scorecard.tsx:135-143` | [24](../../.scratch/modelshelf-prototype/issues/24-distinct-counts-and-order.md) |
| Major | No worker envelope schema; protocol version says 2 in code and doc, 1 in plan, `v1` in the filename | `schemas/` has only `model/v1/`; `protocol.py:40-46`; `jobs.rs:433-481` | [25](../../.scratch/modelshelf-prototype/issues/25-worker-envelope-schema.md) |
| Major | Manifest symlink escape not canonicalized; worker never enforces absolute paths; pydantic and typer float | `jobs.rs:512-522` vs `jobs.rs:718-735`; `protocol.py:24-50`; `pyproject.toml:8` | [26](../../.scratch/modelshelf-prototype/issues/26-worker-boundary-hardening.md) |
| Major | Mixed model units, end-to-end unsupported rules, and empty-directory boot have no coverage | `packs/demo/fixtures/base.ifc:8-12`; `test_demo_packs.py:256-270`; `qa-harness.mjs:37-45` | [27](../../.scratch/modelshelf-prototype/issues/27-edge-case-coverage.md) |
| Major | Perf thresholds pass silently without `--assert-perf`; four checks cannot fail; no CPU or GPU in the artifact | `verify-viewer-inspection.mjs:408,415,423,430,492` | [28](../../.scratch/modelshelf-prototype/issues/28-honest-verification-harness.md) |
| Major | Orbit FPS 2.5 against a 30 target and the longtask verdict remain undrawn; no hardware-GL measurement exists | ticket 09 Answer; `docs/reviews/wave-1-report.md` | [29](../../.scratch/modelshelf-prototype/issues/29-hardware-gl-performance.md) |
| Minor | `README.md` denies browser tests exist; reference library claims nothing is built; v2 IDS comment contradicts its own correction; no per-todo evidence summaries | `README.md`; `references/bim-checking/README.md:3`; `packs/demo/blcj-s1000-v2.ids:170-183` | [30](../../.scratch/modelshelf-prototype/issues/30-documentation-and-evidence.md) |

## Inherited gaps recorded on unstarted tickets

These are real divergences from the plan, but tickets 12 to 16 already own the
work. Each was appended to the owning ticket's Comments rather than duplicated.

- Ticket 12: `crates/fingerprint` still depends on `ifc-model` and fingerprints
  from parsed IFC rather than normalized snapshots; area and volume measures skip
  dimension-aware unit scaling while lengths are scaled.
- Ticket 13: `services/checker/src/jobs.rs:806` writes the sentinel
  `incomplete:waiting-for-normalized-snapshot` into all four `fp_*` columns, so
  `crates/modeldiff` `classify_pair` reports every matched pair of new revisions
  as unchanged. `/api/diff/models` currently produces untrustworthy change kinds.
- Ticket 14: `diff.rs` `diff_runs` gates only on `pack_version_id`. It ignores
  `input_provenance`, `scope_json` and `engine_profile_json`, so legacy runs and
  engine-version changes compare as trusted like-for-like.
- Ticket 16: neither `verify-api.mjs` nor `verify-ui.mjs` accepts
  `--scenario all`, so the plan's final acceptance command exits 2; the
  `comparisons` scenario does not exist; `docs/limitations.md` does not exist.

## Addendum: what changed between the review and this commit

The review read the tree at `d6c068c`. Three pull requests landed while the
remediation tickets were being written, and two of the findings above are
already closed. Recorded here rather than silently edited, so the review still
reflects what was observed when it was observed.

- **PR #32** (design foundations) merged as `e9bf8f2`. Its four automated review
  findings were answered in `cacac44` first. This shrank ticket 21's surface:
  production modules importing `@/lib/mock` went from seven to four, but a
  second fixtures file and a `/kitchen-sink` route were added. Ticket 21 records
  the new end state.
- **PR #33** resolved ticket 12, delivering `fingerprint::normalized`.
- **PR #35** resolved ticket 13, and closed the largest finding in the inherited
  list below: ingestion now persists real digests, migration `0008_diff_snapshots`
  records the profile, and comparison is profile-gated with a 409. The sentinel
  `incomplete:waiting-for-normalized-snapshot` is gone from `services/checker`.

Two consequences for the ticket set:

- Ticket 33 was written as "write real fingerprints at ingestion and retire the
  legacy API" and implemented as PR #34. PR #35 landed the ingestion and gating
  half concurrently, so PR #34 was closed as duplicated and ticket 33 narrowed to
  the part ticket 13 deliberately left: `crates/fingerprint` still carries the
  IFC-parsing path and its `ifc-model` dependency, now with no callers.
- Ticket 34 is new. Ticket 13 measured, pinned, and recorded as a limitation that
  a rotation-only change reports as `unchanged`. The plan lists "movement/rotation"
  among what comparison must include, so that limitation needs an owner decision
  rather than a default.

## Method

Four read-only audits covered the Rust backend, the worker and shared contracts,
the browser application, and the verification and evidence trail. Every finding
above was re-checked against the cited file before a ticket was written.
