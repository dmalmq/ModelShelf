# Retire the dead IFC-parsing fingerprint API

ID: 33
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 13
Wave: 2
Original plan coverage: 8, ADR 0001 import boundary

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

`crates/fingerprint` stops depending on `ifc-model`, because the IFC-parsing fingerprint path it still carries has no callers left and interprets IFC a second time in parallel with the worker.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Compare revisions with explicit match confidence](13-model-diff.md), which moved ingestion and comparison onto `fingerprint::normalized` and left the legacy module in place. Its Answer records the residue: "`cargo tree -p modeldiff -e normal` shows direct deps fingerprint+serde only ... (ifc-model appears transitively via the fingerprint legacy module)".

## Ownership

`crates/fingerprint/src/lib.rs`, `crates/fingerprint/tests/fingerprints.rs`, `crates/fingerprint/Cargo.toml`.

Other agents may be working in this checkout. Do not revert their edits.

## Why this is now small

Ticket 13 delivered ingestion-side fingerprints, the profile column, and profile-gated comparison. Verified against `origin/main`: nothing outside `crates/fingerprint` itself calls `snapshot_model`, `fingerprint_object`, `canonical_property_text`, `canonical_shape_text` or `FpOptions`. The only remaining consumers are the crate's own legacy tests. This is a deletion, not a migration.

## Implementation boundaries

- Delete `FpOptions`, `canonical_property_text`, `canonical_shape_text`, `fingerprint_object`, `snapshot_model` and their private helpers, plus the `use ifc_model::{...}` import and the `ifc-model` dependency.
- `crates/fingerprint/src/lib.rs` and `crates/fingerprint/src/normalized.rs` each declare a `Fingerprints` struct. Collapse to one; `normalized`'s is the surviving definition.
- Keep `ObjectSnapshot` and `PropSnapshot` if `modeldiff` still needs them; check first, since ticket 13 introduced `DiffObject`/`IdentitySide` and they may now be dead too.
- Delete the legacy tests in `crates/fingerprint/tests/fingerprints.rs` that exercise the removed functions. Do not port them: they test a path that no longer exists. `normalized`'s own tests are the replacement and already pass.
- Do not touch `crates/ifc-model` itself. It remains reference/test code for `crates/ids`, per the plan.
- No behaviour change. This ticket adds no capability; it removes a second way to compute a fingerprint.

## Acceptance criteria

- [ ] `cargo tree -p fingerprint` shows no `ifc-model`, direct or transitive.
- [ ] `snapshot_model`, `fingerprint_object`, `canonical_*_text` and `FpOptions` no longer exist anywhere in the workspace.
- [ ] Exactly one `Fingerprints` definition remains in `crates/fingerprint`.
- [ ] `cargo test --workspace` passes with no test removed except those that exercised the deleted functions.
- [ ] `node scripts/verify-api.mjs --scenario comparisons` still passes its full check count, proving the deletion changed no comparison behaviour.

## Verification

- cargo tree -p fingerprint
- cargo test --workspace
- node scripts/verify-api.mjs --scenario comparisons

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review. Originally scoped as "write real fingerprints at ingestion and retire the legacy API" and implemented as [PR #34](https://github.com/dmalmq/ModelShelf/pull/34). Ticket 13 landed the ingestion and profile-gating work concurrently in [PR #35](https://github.com/dmalmq/ModelShelf/pull/35), so PR #34 was closed as duplicated and this ticket was narrowed to the part ticket 13 deliberately left behind. See [the review](../../../docs/reviews/plan-alignment-2026-09-09.md).
