# Remove the design mock scaffolding from the shipped application

ID: 21
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 11
Wave: 2
Original plan coverage: 6,7 delivered scope; plan guardrails

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

The production review UI depends on no mock data, and no mock design routes ship in the Next.js build.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Complete prioritized findings and pack selection](11-priority-review.md). The live review screen already reads real run evidence; only the mock dependency and the design routes remain.

## Ownership

`apps/web/src/lib/mock.ts`, `apps/web/src/app/design/**`, `apps/web/src/components/domain/**`, `apps/web/src/components/review/review-i18n.ts`, `apps/web/src/components/review/scorecard.tsx`.

Other agents may be working in this checkout. Ticket 19 and ticket 24 also touch `apps/web/src/components`. Coordinate before editing shared files.

## Implementation boundaries

- Deleting only the routes breaks the review screen. Eleven modules import `@/lib/mock`, and seven of them are production code: `components/domain/provenance-notice.tsx`, `outcome-bar.tsx`, `severity-ladder.tsx`, `severity-badge.tsx`, `finding-evidence.tsx`, `components/review/review-i18n.ts`, and `components/review/scorecard.tsx`. They import the Japanese label dictionaries, not the fixtures. Move those dictionaries to a real labels module first.
- `components/domain/finding-evidence.tsx` accepts a `MockFinding` union and `components/domain/provenance-notice.tsx:18-19` defaults to the mock `PROVENANCE` record. That default renders copy claiming pinned-input recording "is not yet implemented", which contradicts the shipped `run_models` pinning. Require explicit props instead of restating the stale limitation.
- Do not delete real components that the design routes happened to exercise. Do not weaken the review screen to make deletion easier.

## Acceptance criteria

- [ ] `apps/web/src/lib/mock.ts` and `apps/web/src/app/design/**` no longer exist, and no file under `apps/web/src` imports `@/lib/mock`.
- [ ] Japanese and English label dictionaries live in a production labels module and every previous consumer renders unchanged text.
- [ ] `finding-evidence.tsx` accepts only the live `Finding` type; `provenance-notice.tsx` requires explicit `status`/`reason` and no stale "not yet implemented" copy survives anywhere in `apps/web/src`.
- [ ] `npm --prefix apps/web run build` emits no `/design` route.
- [ ] `node scripts/verify-ui.mjs --scenario findings` still passes every named check.

## Verification

- npm --prefix apps/web run typecheck && npm --prefix apps/web run build
- node scripts/verify-ui.mjs --scenario findings
- node scripts/verify-ui.mjs --scenario deliveries

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.

2026-09-09: [PR #32](https://github.com/dmalmq/ModelShelf/pull/32) merged as `e9bf8f2` and changes the facts above. The four automated review findings on it were fixed in `cacac44` before merge.

What it improves: the Japanese label dictionaries moved from `lib/mock.ts` to a new `lib/i18n.ts` carrying both locales, so `severity-badge.tsx`, `severity-ladder.tsx` and `outcome-bar.tsx` no longer import fixtures. Production importers of `@/lib/mock` drop from seven to four: `components/domain/finding-evidence.tsx`, `components/domain/provenance-notice.tsx`, `components/review/review-i18n.ts`, `components/review/scorecard.tsx`.

What it adds to this ticket's scope: a second fixtures file `lib/fixtures.ts` (246 lines), a new `app/kitchen-sink/` route that ships in the production build, and a deprecated re-export shim in `mock.ts` kept alive solely so `app/design/{a,b,c,d}` keep compiling.

Recommended end state: delete `app/design/{a,b,c,d}` and `lib/mock.ts`; keep `app/kitchen-sink/` as the single component gallery, since a bilingual gallery of real edge cases is a design-system artifact rather than a mock product screen; fold any still-needed `mock.ts` fixture into `lib/fixtures.ts` so one fixture file feeds one gallery and the shim dies with its consumers. Decide explicitly whether `/kitchen-sink` should be excluded from the production build.

Two of the four automated review findings on that PR are in production components and survive this deletion regardless: `severity-ladder.tsx` defaults `incompleteCount` to 0 and then renders an explicit "no undecided findings" claim, and `provenance-notice.tsx:62` hardcodes `#9a3412` for an API-derived status instead of importing from `palette.ts`. Both are covered below rather than by deleting callers.
