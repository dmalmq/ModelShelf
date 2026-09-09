# Compare findings only under compatible checking settings

ID: 14
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
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
