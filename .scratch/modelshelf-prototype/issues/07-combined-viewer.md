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

A reviewer sees the real architectural, structural, and MEP revisions together in one navigable view with load progress and failure information.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Publish shared model contracts across Rust, Python, and the browser](18-shared-model-contracts.md). Consume its verified public contract.

- [Process model revisions through durable jobs](04-queued-ingestion.md). Read its Answer and verified interface before starting.
- [Prepare reproducible Japanese and synthetic demo evidence](05-demo-evidence.md). Read its Answer and verified interface before starting.

## Ownership

Reusable model-viewer package, standalone example, thin React wrapper, minimal ModelShelf test-route integration, private browser IFC loader, and public-contract lifecycle tests.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Implement the reusable model-viewer package with framework-independent rendering core and thin React export. Keep a browser IFC loader private behind the normalized scene-input seam. ModelShelf uses the public package from its test route.
- Add a standalone plain-browser example using only public exports and local assets; it must run without Next.js, Rust service, or Python worker. A tiny prepared scene with opaque non-IFC IDs proves the core does not require IFC metadata.
- Host callbacks own resource fetching and property lookup. Do not import app Discipline enums, findings, authentication, routes, Three.js objects through the public contract, or global application state.

- Implement a minimal runnable viewer route. Load IFC through a dedicated browser worker, share/batch geometry, bound pixel ratio, and release GPU/worker resources on unload.
- Keep original model transforms and use one common origin offset. Never independently center disciplines.
- Use opaque revisionId/objectId for selection; keep IFC expressId and GlobalId in source mappings. Findings do not depend on every model having drawable geometry.

## Acceptance criteria

- [ ] The standalone example loads, picks, highlights, frames, isolates, clips, and unloads through public exports with all ModelShelf services stopped.
- [ ] A prepared scene using opaque non-IFC IDs and the real IFC integration both work without changing the rendering core.
- [ ] Automated boundary checks reject viewer imports from ModelShelf/Next.js/checking code and app imports of private renderer modules.

- [ ] All three real models load together and align; orbit/pan/zoom work without parsing on the UI thread.
- [ ] Progress and failures identify the source model. One failed model does not hide successful models.
- [ ] Two revisions containing the same GlobalId can be selected independently.
- [ ] Repeated load/unload frees resources; no per-object rendering design that predictably overwhelms the selected fixtures.

## Verification

- Create `node scripts/verify-viewer.mjs --scenario standalone` and a deterministic import-boundary check. Exercise controlled invalid-import fixtures to prove the check rejects violations.

- npm --prefix apps/web run typecheck
- npm --prefix apps/web run build
- Create scripts/verify-viewer.mjs for real browser loading, alignment, duplicate GlobalId selection, and disposal checks.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
