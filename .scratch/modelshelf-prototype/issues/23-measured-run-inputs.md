# Record measured run inputs instead of hardcoded and reconstructed ones

ID: 23
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 02, 06
Wave: 1
Original plan coverage: 2,3; plan 'never reconstruct historical inputs from a mutable delivery'

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

Every run and revision records the processing versions that actually produced it, and a run declaring complete provenance can never serve current mutable delivery membership as its proven inputs.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Create deliveries from immutable source-model revisions](02-immutable-deliveries.md) and [Run scoped IDS checks against pinned delivery inputs](06-scoped-ids-runs.md).

## Ownership

`services/checker/src/run.rs`, `services/checker/src/jobs.rs`, `services/checker/src/dto.rs`, `services/checker/migrations/`, `scripts/verify-api.mjs`.

Other agents may be working in this checkout. Ticket 22 edits `run.rs` in the same region. Agree an ordering with its owner before starting.

## Implementation boundaries

- `services/checker/src/run.rs:68-74` pins a hardcoded literal `{"worker":"0.1.0","ifcTester":"0.8.5","ifcOpenShell":"0.8.5","operation":"validate"}` into `runs.engine_profile_json`, while `invoke_worker` receives the worker's real `manifest.versions` from `services/ifc-worker/src/ifc_worker/versions.py` and `execute()` discards them. A dependency bump would silently diverge from run history.
- `services/checker/src/jobs.rs` `publish_revision` persists format, filename, hash and `length_to_metre` but drops `manifest.versions`, so a stored `ModelRevision` does not record its processing versions. The plan requires a revision to record "content hash, schema, source file, processing versions, status, and artifacts".
- `services/checker/src/run.rs:749-770` `load_run_models` falls back to `crate::diff::load_models(pool, &row.delivery_id)` when `run_models` is empty even though the caller still reports `InputProvenance::Complete`. That is reconstruction from a mutable delivery presented as proven input.
- `services/checker/src/run.rs:42-81` reads pack and membership before `state.pool.begin()`; only the inserts are transactional, so membership can change between the read and the pin.
- `services/checker/src/dto.rs:535-537` `UNPINNED_REASON` still says pinning "is not implemented yet" although migration 0007 and `run_models` shipped. Reword to describe historical runs, do not delete the honest incomplete state.
- Add a forward migration. Do not reset or rewrite existing rows' provenance to look better than it is.

## Acceptance criteria

- [ ] `runs.engine_profile_json` contains the worker-reported versions from the manifest that evaluated the models, and a test fails if the stored profile keeps a stale literal after a version change.
- [ ] `model_revisions` records the worker, IfcOpenShell, IfcTester and extraction versions that produced it, exposed on revision and run detail and asserted round-trip in `scripts/verify-api.mjs --scenario revisions`.
- [ ] A run with `input_provenance = complete` and no `run_models` rows is reported as an error or as incomplete provenance; it never serves live membership.
- [ ] Membership and pack reads happen inside the pinning transaction, fenced against a concurrent `add_member`/`finalize`.
- [ ] `UNPINNED_REASON` describes historical runs accurately and no API copy denies that pinning exists.

## Verification

- cargo test -p modelshelf-checker
- node scripts/verify-api.mjs --scenario revisions
- node scripts/verify-api.mjs --scenario checks
- A migration run against a database created before this ticket, proving old rows survive and read honestly

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
