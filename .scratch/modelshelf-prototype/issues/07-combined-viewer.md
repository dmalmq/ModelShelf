# Open a combined delivery in the browser

ID: 07
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 04, 05, 18
Wave: 1
Original plan coverage: 5

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer sees the real architectural, structural, and MEP revisions together in one navigable ModelShelf view with load progress and failure information. Selection uses opaque ObjectRefs. A reusable viewer package is out of this ticket.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Publish shared model contracts across Rust, Python, and the browser](18-shared-model-contracts.md). Consume its verified public contract.

- [Process model revisions through durable jobs](04-queued-ingestion.md). Read its Answer and verified interface before starting.
- [Prepare reproducible Japanese and synthetic demo evidence](05-demo-evidence.md). Read its Answer and verified interface before starting.

## Ownership

ModelShelf viewer route in `apps/web`, browser IFC loading, ObjectRef selection against a combined delivery.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Implement a minimal runnable ModelShelf viewer route. Load IFC through a dedicated browser worker, share/batch geometry, bound pixel ratio, and release GPU/worker resources on unload.
- Keep original model transforms and use one common origin offset. Never independently center disciplines.
- Use opaque revisionId/objectId for selection; keep IFC expressId and GlobalId in source mappings. Findings do not depend on every model having drawable geometry.
- Do not extract `packages/model-viewer`, a standalone example, or import-boundary packaging in this ticket. That extraction waits until this combined view exists.

## Acceptance criteria

- [ ] All three real models load together and align; orbit/pan/zoom work without parsing on the UI thread.
- [ ] Progress and failures identify the source model. One failed model does not hide successful models.
- [ ] Two revisions containing the same GlobalId can be selected independently via ObjectRef.
- [ ] Repeated load/unload frees resources; no per-object rendering design that predictably overwhelms the selected fixtures.

## Verification

- npm --prefix apps/web run typecheck
- npm --prefix apps/web run build
- Create scripts/verify-viewer.mjs for real browser loading, alignment, duplicate GlobalId selection, and disposal checks.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

2026-09-07: VISION.md sequences the combined ModelShelf view before extracting a reusable viewer package. This ticket no longer owns `packages/model-viewer`, the standalone example, or import-boundary packaging.
