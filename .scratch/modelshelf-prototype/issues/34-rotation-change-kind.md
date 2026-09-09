# Decide whether a rotation-only change reads as unchanged

ID: 34
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 13
Wave: 2
Original plan coverage: 9; plan comparison scope

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

An owner decision, then its implementation: today a wall rotated in place is reported to the reviewer as **unchanged**.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Compare revisions with explicit match confidence](13-model-diff.md), which measured this behaviour, pinned it with a test, and recorded it as a limitation rather than a defect.

## Ownership

`crates/modeldiff/src/normalized.rs` `classify_pair`, `crates/modeldiff/tests/diff.rs`, `scripts/verify-api.mjs --scenario comparisons`, `packs/demo/fixtures/README.md`.

## The decision to make

`classify_pair` promotes a pair to `Moved` only when origin-to-origin distance exceeds `move_threshold_m`. A pure rotation displaces no origin, so its distance is exactly 0, which falls into the sub-threshold branch that exists to swallow exporter coordinate noise. The placement fingerprint *does* change — `fingerprint::normalized` hashes the full axis set — but the kind lands on `Unchanged`.

Ticket 13 chose to keep this and pin it: `crates/modeldiff/tests/diff.rs::pure_rotation_without_translation_is_not_a_move` and `scripts/verify-api.mjs` both assert the three `Rotated-*` fixture walls report `unchanged`. The fixture README calls it "a real, documented consequence of the current design's choice of what counts as moved". That is a defensible, honestly recorded position.

The case against it: the plan lists "movement/rotation" among what comparison must include, and the fingerprint policy says "Placement is separate and includes rotation". A reviewer comparing two deliveries of a building where a duct run was rotated 90 degrees in place would be told nothing changed. Sub-threshold forgiveness is calibrated for translation noise; a rotation is not noise.

Bring this to the owner before implementing. If the answer is "keep as is", close this ticket and leave the pins in place. If the answer is "surface it", the boundaries below apply.

## Implementation boundaries, if the decision is to surface it

- Forgive a differing placement fingerprint only when the rotation basis is identical AND the displacement is sub-threshold. Compare bases by max absolute difference of the nine direction cosines; they are dimensionless and bounded, so no angle reconstruction is needed.
- Decide explicitly whether a rotation becomes `Moved` with a distinguishing note, or a new `ChangeKind::Rotated`. A new kind is a wire contract change: `dto.rs`, `apps/web/src/lib/types.ts`, `docs/contracts/http-api.md`, and `CHANGE_COLOR` in `apps/web/src/lib/palette.ts` all enumerate the seven existing kinds, and the palette's adjacent-pair contrast was validated across exactly those. Adding an eighth requires re-running that validation.
- Update the pins rather than deleting them: `pure_rotation_without_translation_is_not_a_move` and the `verify-api` rotated-walls assertion must be rewritten to the new expectation, not removed.
- Correct `packs/demo/fixtures/README.md`, which currently records the limitation as open "for a future ticket to decide".

## Acceptance criteria

- [ ] The owner's decision is recorded in this ticket with its reasoning.
- [ ] If unchanged is kept: the pins stay, and the README states the decision was made rather than deferred.
- [ ] If surfaced: the three `Rotated-*` fixture walls report a placement change, the three `Moved-*` walls still report their real displacement, and no translation below the noise threshold is promoted.
- [ ] `cargo test -p modeldiff` and `node scripts/verify-api.mjs --scenario comparisons` both pass against the chosen expectation.

## Verification

- cargo test -p modeldiff
- node scripts/verify-api.mjs --scenario comparisons

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review. An implementation of the "surface it" option exists in the closed [PR #34](https://github.com/dmalmq/ModelShelf/pull/34) (`efca9c4`), including the basis comparison and its regression test, if that is the direction chosen.
