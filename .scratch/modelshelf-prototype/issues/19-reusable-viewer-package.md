# Extract the reusable viewer package behind public exports

ID: 19
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 09, 11
Wave: 2
Original plan coverage: 5, reusable-package portion; ADR 0001

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

A `packages/model-viewer` package with a framework-independent core and a thin React export, consumed by ModelShelf only through its public exports, plus a standalone plain-browser example that runs with ModelShelf services stopped.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Prove the Wave 1 review loop and viewer performance](09-wave-one-gate.md) and [Complete prioritized findings and pack selection](11-priority-review.md). Both are resolved, so the map's "extraction is deferred until after Wave 1" condition is spent.

## Ownership

`apps/web/src/components/viewer/**`, the new `packages/model-viewer`, `scripts/verify-viewer.mjs`, and the delivery route that mounts the viewer.

Other agents may be working in this checkout. Do not revert their edits. Coordinate shared file/contract ownership first. Ticket 21 also edits `apps/web/src/components`; agree a boundary before starting.

## Implementation boundaries

- The core must not import ModelShelf application types. Today `apps/web/src/components/viewer/types.ts:1-6` imports `Discipline, DeliveryDetail, ModelInfo, ObjectRef` from `@/lib/types`, `types.ts:24` declares `DeliveryModel extends ModelInfo`, and `delivery-controller.ts`, `renderer-owner.ts`, `findings-api.ts`, `ifc-worker-protocol.ts` and `delivery-api.ts` each take ModelShelf delivery or checking types. Replace them with host-supplied generic interfaces over opaque refs, string filter attributes, and plain highlight groups.
- Keep finding-to-highlight translation in the application. `apps/web/src/components/review/viewer-bridge.ts` already demonstrates the correct seam; do not move severity or finding concepts into the core.
- Delete the duplicate severity ramp at `apps/web/src/components/viewer/finding-inspector.tsx:17-22` (`#e02424/#f97316/#eab308/#3b82f6`), which disagrees with the validated ramp in `apps/web/src/lib/palette.ts:36-39` (`#9f1239/#e2560d/#d19a02/#0284c7`). Application colour comes from `palette.ts` and nowhere else.
- No Next.js dependency in the core. No new network service, no native RVT/PLN adapter, no plugin framework.
- Do not regress the proven behavior of tickets 07 and 08: one shared origin offset, batched geometry, worker parsing, idempotent disposal, revision-qualified selection, full finding highlight past the embedded 25.

## Acceptance criteria

- [ ] `packages/model-viewer` exposes a framework-independent core and a thin React wrapper through package exports; `apps/web` imports only those exports and no internal module paths.
- [ ] The core compiles and runs with zero imports of `@/lib/types`, `next/*`, checking rules, or priority policy. An import-boundary check enforces this and fails when violated.
- [ ] A standalone plain-browser example opens self-authored non-IFC-identified fixtures over a static server with the checker, worker, and Next.js stopped, and supports pick, highlight, isolate, section, and unload using only public exports.
- [ ] One severity ramp remains in the repository; `finding-inspector.tsx` no longer defines colours.
- [ ] `node scripts/verify-viewer.mjs` and `node scripts/verify-viewer.mjs --scenario inspection` still pass with the same named checks as before extraction.

## Verification

- node scripts/verify-viewer.mjs
- node scripts/verify-viewer.mjs --scenario inspection
- The new standalone example scenario, run with ModelShelf services stopped
- The new import-boundary check
- npm --prefix apps/web run typecheck && npm --prefix apps/web run build

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
