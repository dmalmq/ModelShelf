# Report distinct object counts and preserve backend order

ID: 24
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 11
Wave: 2
Original plan coverage: 7; plan counting rule

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

Every count labelled as an object total counts distinct objects, and the review screen never silently rearranges rows the backend ordered.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Complete prioritized findings and pack selection](11-priority-review.md), which established the canonical run-level definition of failing objects.

## Ownership

`services/checker/src/run.rs` `build_scorecard`, `apps/web/src/components/review/scorecard.tsx`, `apps/web/src/components/review/review-state.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/types.ts`.

Other agents may be working in this checkout. Tickets 19 and 21 also touch `apps/web/src/components`. Coordinate before editing shared files.

## Implementation boundaries

- `services/checker/src/run.rs:652-653` accumulates `group.object_count += finding.object_count` into `CategoryGroup` and `SeverityBand`, so one object failing three rules counts three times toward a band total, while the run-level `failing_object_count` in `services/checker/src/dto.rs` correctly uses `COUNT(DISTINCT model_id || express_id)` over decided findings. Ticket 11 unified the run level only.
- Either compute band and category totals as distinct decided objects, or relabel them as finding-membership counts in both the API and the UI. State which and make the label match the arithmetic.
- `apps/web/src/components/review/scorecard.tsx:135-143` re-sorts specs by `OUTCOME_ORDER` although the same file's header states "The backend sort is authoritative and preserved - this component never re-sorts". Group visually without reordering, or move outcome grouping into the Rust payload.
- Three parallel severity orderings exist: `SEVERITY_ORDER` in `apps/web/src/lib/types.ts:435`, and `SEVERITY_REGISTRY`/`severityRank` in `apps/web/src/components/review/review-state.ts:8-18` which has no callers. `formatScore` in `apps/web/src/lib/format.ts:79-82` also has no callers and formats a score the UI deliberately never renders. Keep exactly one ordering and delete the dead helpers.
- Do not introduce client-side severity sorting to compensate. Rust stays authoritative.

## Acceptance criteria

- [ ] A delivery where one object fails several rules in the same band reports a band and category object total equal to the distinct object count, or a clearly labelled membership count; the API and the rendered label agree.
- [ ] The spec table renders in backend order, verified against the raw API payload in the browser scenario.
- [ ] One severity ordering remains in `apps/web/src`; `severityRank`, `SEVERITY_REGISTRY` duplication, and `formatScore` are gone or have real callers.
- [ ] `node scripts/verify-ui.mjs --scenario findings` asserts the distinct-count identity for a band, not only for the run.

## Verification

- cargo test -p modelshelf-checker
- node scripts/verify-ui.mjs --scenario findings
- npm --prefix apps/web run typecheck && npm --prefix apps/web run build

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
