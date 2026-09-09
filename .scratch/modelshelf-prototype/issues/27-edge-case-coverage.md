# Cover the untested plan edge cases with real scenarios

ID: 27
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 06, 05
Wave: 2
Original plan coverage: Verification strategy edge-case list

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

Each edge case the plan names is exercised end to end against real processes, not only in a unit test, and mixed model units are exercised at all.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Prepare reproducible Japanese and synthetic demo evidence](05-demo-evidence.md) owns the fixtures and oracle.
- [Run scoped IDS checks against pinned delivery inputs](06-scoped-ids-runs.md) owns the applicability semantics.

## Ownership

`scripts/generate-demo-fixtures.py`, `scripts/check-demo-oracle.py`, `packs/demo/fixtures/`, `scripts/verify-api.mjs`, `scripts/qa-harness.mjs`, `services/ifc-worker/tests/`.

Other agents may be working in this checkout. Ticket 28 also edits the verification scripts. Coordinate before editing shared files.

## Implementation boundaries

- The plan requires verifying "a clean empty data directory, restart persistence, duplicate uploads, missing IFC geometry, corrupt input, worker crash, unsupported rule, mixed model units, duplicate GlobalIds, and more than 100 affected objects". Restart persistence, duplicate uploads, missing geometry, corrupt input, worker crash, duplicate GlobalIds and 100+ objects are covered today. Three are not.
- Mixed model units have zero coverage. `packs/demo/fixtures/base.ifc:8-12` assigns one METRE unit set, and worker unit tests cover MILLI and METRE only; no fixture or scenario mixes units across a delivery.
- The unsupported-rule path is proven only at pytest level in `services/ifc-worker/tests/test_demo_packs.py:256-270`. A service layer that dropped incomplete outcomes would stay green. It needs an end-to-end assertion that an unsupported rule surfaces as incomplete with diagnostics.
- `scripts/qa-harness.mjs:37-45` seeds two temporary directories and asserts idempotency; nothing observes a fresh unseeded directory or a not-yet-existing data path.
- `packs/demo/fixtures/oracle.json` groups repeated_failure, removed, added, property_changed, shape_changed, moved, rotated and ambiguous_ids, but stores no unsupported-input case, although plan todo 4 lists "unsupported input" among the fixture edits with explicitly stored expected outcomes.
- Japanese property labels pass through `services/ifc-worker/src/ifc_worker/properties.py` verbatim today, but no test pins it; a future normalization would pass the suite silently.
- Add fixtures and oracle entries; do not change existing oracle counts to make a new case fit. Do not weaken an existing assertion.

## Acceptance criteria

- [ ] A delivery whose models declare different length units scores identically to its metric equivalent, with the expectation stored in the oracle and asserted in a real scenario.
- [ ] An unsupported rule against a real model is asserted end to end as incomplete with diagnostics, never as pass and never as fail.
- [ ] A fresh, unseeded data directory and a not-yet-existing data path both boot to an honest empty state, asserted rather than assumed.
- [ ] The A/B fixtures include an unsupported-input object with its expected incomplete outcome enumerated in `oracle.json` and asserted by `check-demo-oracle.py`.
- [ ] A worker test asserts byte-identical round-trip of Japanese pset and property names through extraction and parsing.

## Verification

- python scripts/check-demo-oracle.py
- uv run --locked --project services/ifc-worker pytest
- node scripts/verify-api.mjs --scenario checks
- node scripts/qa-harness.mjs

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.

2026-09-09: the mixed-units gap now has a real source. The Snowdon Towers models adopted by ticket 31 are FOOT-based (`lengthToMetre` 0.3048, confirmed through the real worker), so a mixed-unit delivery can pair a metric BLCJ revision with an imperial Snowdon revision instead of relying on a synthesized non-metric fixture. Prefer that over authoring one. See [`samples/snowdon-towers/alignment.md`](../../../samples/snowdon-towers/alignment.md).
