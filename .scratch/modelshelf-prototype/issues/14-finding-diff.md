# Compare findings only under compatible checking settings

ID: 14
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: unassigned
Blocked by: 11, 13
Wave: 2
Original plan coverage: 8, finding comparison portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

The reviewer can distinguish new, resolved, and persistent findings without confusing rule or engine changes with model improvements.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Complete prioritized findings and pack selection](11-priority-review.md). Read its Answer and verified interface before starting.
- [Compare revisions with explicit match confidence](13-model-diff.md). Read its Answer and verified interface before starting.

## Ownership

Run comparison API, immutable check-profile digests, finding/object identity reconciliation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Keep finding comparison policy in the application checking workflow. Reuse pure object-match results while preserving opaque ObjectRefs; do not introduce viewer or source-format dependencies.

- Require identical pack digest, scoped SourceModel selection/semantics, and persisted check profile for finding comparisons. Define mismatch codes and rerun action.
- Use stable requirement identity and confirmed object matches for affected-set deltas; uncertain matches stay uncertain.
- Keep historical runs immutable. Empty/missing/incomplete models do not count as resolved defects merely because objects disappeared from evaluation.

## Acceptance criteria

- [ ] Same-pack corrected fixtures show expected new/resolved/persistent outcomes.
- [ ] Pack, worker, engine, scope, and settings changes reject an invalid comparison and direct users to a rerun.
- [ ] Ambiguous object matches or incomplete runs cannot create false resolution claims.

## Verification

- node scripts/verify-api.mjs --scenario finding-comparisons
- Assert every independent compatibility dimension, missing source, worker failure, and uncertain identity case.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

2026-09-09, [plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md): `services/checker/src/diff.rs` `diff_runs` currently gates only on `pack_version_id` equality. It never reads `runs.input_provenance`, `runs.scope_json` or `runs.engine_profile_json`, although migration 0007 persists all three. Two `provenance_incomplete` legacy runs, runs with different discipline scope, and runs evaluated by different engine versions all diff as trusted like-for-like comparisons. The plan requires the same pack version, the same scope semantics and identical persisted check-profile digests. Note that ticket 23 replaces the hardcoded engine profile with the worker-reported versions; take its output before building the digest.

## Answer

`GET /api/diff/runs` now compares findings only under compatible checking settings. `diff_runs` builds a `Compatibility` value per run from the persisted row plus its `run_models` pins and refuses on the first mismatching dimension: incomplete provenance or empty pins (`provenance_incomplete`), non-`completed` status (`run_not_completed`), `incomplete_count > 0` (`run_incomplete`), different pack versions (`pack_version_mismatch`, unchanged), different IDS/metadata digests (`pack_digest_mismatch`), different scope text or pinned source membership (`scope_mismatch`), different engine profile (`engine_profile_mismatch`). Every refusal is 409, names the dimension and both run ids, and directs a rerun under identical settings. Scope and engine profile compare as parsed JSON values, and stored values only: the gate never hardcodes an expected profile, so ticket 23 can replace the writer freely. Object identity across runs is confirmed GlobalIds only. The `express:` fallback is gone from the comparison inputs. A finding both runs still list is held `persisting` when either side matched objects without a GlobalId, so uncertain identity can never produce a resolution claim. Finding-level introduced/resolved by stable requirement key is unchanged, and `modeldiff::diff_findings` is untouched.

Changes: `services/checker/src/diff.rs` (`Compatibility`, `check_compat`, pin loading with no live-membership fallback, confirmed-only finding keys, `hold_uncertain`, 13 unit tests), `services/checker/src/error.rs` (six new 409 codes), `services/checker/src/dto.rs` (`RunRow` plus `RUN_SUMMARY_SELECT` carry `ids_sha256`, `pack_metadata_sha256`, `scope_json`, `engine_profile_json`), `docs/contracts/http-api.md` (rule 9 reworded, new rule 14), `scripts/verify-api.mjs` (`--scenario finding-comparisons`). No wire change: deltas are unchanged and codes are open strings, so `apps/web/src/lib/types.ts` is untouched.

Commands and results: `cargo test -p modelshelf-checker` (30 passed), `cargo test -p modeldiff` (24 passed, signature untouched), `node scripts/verify-api.mjs --scenario finding-comparisons` (42 checks: same-pack corrected fixtures show introduced/resolved/persisting, then pack, scope-text, source-membership, engine-profile, IDS-digest, provenance, empty-pins, review-incomplete, and failed-run refusals each assert their 409 code, mutated rows restored to 200, and the NULL-GlobalId probe stays persisting with no synthetic ids). Regressions `checks`, `first-loop`, and `comparisons` all pass.

Evidence: `.omo/evidence/modelshelf-prototype/ticket-14/run-2026-09-09T02-21-11-896Z/` (per-dimension refusal payloads, happy-path diff, uncertain-identity probe).

Limitations: duplicate or regenerated GlobalIds are trusted at face value when present on both sides. Ticket 13 style match confidence does not extend to finding object sets. The engine profile writer is still the hardcoded literal until ticket 23 lands. Downstream agents need nothing: the response shape is unchanged.
