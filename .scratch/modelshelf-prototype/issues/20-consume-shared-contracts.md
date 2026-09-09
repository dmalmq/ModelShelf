# Consume the generated model contracts in the browser and checker

ID: 20
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 18
Wave: 1
Original plan coverage: 11, consumer-wiring portion; ADR 0001

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

The browser and the checker read shared model payload shapes from the generated contract packages instead of hand-maintained copies, so a schema change fails generation or type checking rather than drifting silently.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Publish shared model contracts across Rust, Python, and the browser](18-shared-model-contracts.md). Its Answer records "No caller wired in yet (out of this ticket's scope)". Rust and Python have since gained callers; TypeScript has none.

## Ownership

`apps/web/src/lib/types.ts`, `apps/web/src/components/viewer/types.ts`, `apps/web/src/components/viewer/object-ref.ts`, `apps/web/src/components/viewer/ifc-worker-protocol.ts`, `apps/web/package.json`, `services/checker/src/dto.rs`, `scripts/verify-model-contracts.mjs`, `scripts/generate-model-contracts.mjs`.

Other agents may be working in this checkout. Ticket 19 restructures the same viewer modules. Agree an ordering with its owner before editing `components/viewer`.

## Implementation boundaries

- Do not change the canonical schemas under `schemas/model/v1/` to fit existing hand-written types. The schema is authoritative; consumers move.
- Do not weaken the generated packages' own fixture tests.
- Keep app-specific extensions (branding, filter attributes) in the application, layered over the generated base type.

## Acceptance criteria

- [ ] `apps/web` declares a dependency on the generated TypeScript package and imports `ObjectRef` from it. `apps/web/src/lib/types.ts:65-69` no longer declares its own `export interface ObjectRef { revisionId: string; objectId: string }`.
- [ ] One express-ID mapping implementation remains. `apps/web/src/components/viewer/object-ref.ts:22-27` (`objectIdForExpressId`, async `crypto.subtle`) and `packages/model-contracts-ts/src/express-id-mapping.ts` (`expressIdToObjectId`, sync `node:crypto`) currently implement the same `occ_ + sha256(revisionId:expressId)[:16]` encoding twice; the surviving implementation is exercised by the golden fixture the contracts package already tests.
- [ ] `services/checker/src/dto.rs:611-620` stops hand-mirroring `ObjectRef`. Either serialize the generated type or keep a newtype whose identical wire shape is proven by a test that fails when the schema changes.
- [ ] `scripts/verify-model-contracts.mjs` fails when a hand-rolled duplicate of a shared payload reappears in `apps/web/src` or `services/checker/src`.
- [ ] `node scripts/generate-model-contracts.mjs --check` still reports no drift.

## Verification

- node scripts/generate-model-contracts.mjs --check
- node scripts/verify-model-contracts.mjs
- npm --prefix apps/web run typecheck && npm --prefix apps/web run build
- cargo test -p modelshelf-checker
- node scripts/verify-viewer.mjs

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
