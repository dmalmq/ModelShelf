# Compare revisions with explicit match confidence

ID: 13
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: poteto-13-diff
Blocked by: 12
Wave: 2
Original plan coverage: 8, model comparison portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

The API reports additions, removals, movement, property edits, and representation changes without pretending uncertain identities are exact.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Compute versioned fingerprints from normalized object state](12-normalized-fingerprints.md). Read its Answer and verified interface before starting.

## Ownership

Rust modeldiff matching, delivery/source pairing, diff endpoints and pagination.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Make comparison consume normalized snapshots and explicit match policy and return typed change records. The service loads/persists snapshots; the comparison crate does not perform database or HTTP work.

- Pair revisions through persistent SourceModel identity, not discipline. Reused revisions avoid unnecessary comparison.
- Only unique GlobalIds on both sides produce exact matches. Duplicate/missing/regenerated IDs produce explicit candidates or unresolved additions/removals.
- Compare snapshots under one fingerprint profile; mismatches yield a clear error until both sides are recomputed. Report before/after values and qualified object references.

## Acceptance criteria

- [ ] Dependency checks reject direct parser/database/HTTP dependencies in reusable comparison modules; fixture comparisons run without services.

- [ ] Two MEP sources are never cross-matched solely by discipline.
- [ ] Duplicate IDs are not paired by STEP order and labelled exact. Splits/merges remain unresolved.
- [ ] Every controlled A/B change appears with correct source/revision and matching confidence.
- [ ] Pagination preserves deterministic ordering and complete result counts.

## Verification

- cargo test -p modeldiff
- node scripts/verify-api.mjs --scenario comparisons
- Test each fingerprint-profile mismatch dimension and recomputation without changing old artifacts.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

Delivered revision comparison over normalized snapshots with explicit match confidence, paired by SourceModel identity, in one uncommitted cutover.

Changes: `crates/modeldiff/src/normalized.rs` (new `DiffObject` bundle of `DerivedSnapshot` + `IdentitySide`, `MatchPolicy` with `HeuristicPolicy::Off/On`, `compare()` returning `Result<ModelDiff, ProfileMismatch>`); `crates/modeldiff/src/lib.rs` (re-exports, qualified `ObjectRef`, untouched `diff_findings`); deleted `src/heuristic.rs`, legacy `diff()`/`DiffOptions`; rewrote `tests/diff.rs` (24 tests) and `examples/diff_fixtures.rs`. `services/checker/migrations/0008_diff_snapshots.sql` + `SCHEMA_VERSION 8` (profile/canonical columns, NULL legacy semantics, no backfill). `jobs.rs` threads validated geometry chunks into `publish_revision`, which fingerprints every object under `FingerprintProfile::v1()`. `diff.rs` pairs by `source_model_id` with reused-revision short-circuit (`reusedRevision`, empty changes, zeroed summary) and one-sided add/remove pairs; `error.rs` gains 409 `fingerprint_profile_mismatch`; `dto.rs`, `types.ts`, `http-api.md` (rules 11-13) mirror the new shapes. New `scripts/verify-api.mjs --scenario comparisons` (37 checks).

Behavior: exact matches only for GlobalIds unique on both sides; duplicates pair by express_id as `Heuristic{1.0, type+gid-duplicate}` with notes, never exact; splits/merges stay unresolved add/remove; profile gate rejects cross-profile comparison before any pairing; legacy NULL-profile rows 409 with recompute guidance; history append-only (re-upload mints a new revision, old digests untouched).

Commands/results (all re-run by the reviewer, not taken from the implementer): `cargo test -p modeldiff` 24/24; `cargo test -p modelshelf-checker` 15/15; `cargo test -p fingerprint` 30/30 (23+7); `cargo tree -p modeldiff -e normal` shows direct deps fingerprint+serde only, no sqlx/axum/hyper (ifc-model appears transitively via the fingerprint legacy module); `node scripts/verify-api.mjs --scenario comparisons` 37/37 against the real checker/worker, including oracle groups (added/removed/property REI30->REI60/shape/moved 3 each, 120 unchanged), two MEP sources never cross-matching, duplicate/empty/regenerated IDs never exact with uncertainMatches 6, deterministic pagination reassembly, legacy 409, and append-only re-upload.

Evidence: `.omo/evidence/modelshelf-prototype/ticket-13/` (`run-2026-09-09T01-30-26-995Z` is the reviewer-confirmed green run with `diff-unpaged.json`, `rotated-behavior.json`, `profile-mismatch.json`, `reupload-diff.json`, `fingerprints-example.jsonl`, `ingest-digest-proof.json`).

Limitations: pure rotation about an object's own origin reports unchanged with a sub-threshold note (origin-only distance measurement; pinned by test and scenario, recorded not fixed). Shape is a representation hash, not geometric equivalence. Placement-digest equality dominates origin distance in heuristic scoring.

Downstream (ticket 14): `diff_findings`/`diff_runs` untouched; object rows now carry profile/canonical columns with NULL meaning pre-13; every change ref carries `revisionId`+`objectId`; pairs carry `sourceModelId`/`sourceModelName`/`reusedRevision`; new 409 code `fingerprint_profile_mismatch`.
