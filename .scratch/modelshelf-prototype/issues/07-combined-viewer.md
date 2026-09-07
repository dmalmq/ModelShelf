# Open a combined delivery in the browser

ID: 07
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: omp-main-20260907-combined-viewer
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

- [x] All three real models load together and align; orbit/pan/zoom work without parsing on the UI thread.
- [x] Progress and failures identify the source model. One failed model does not hide successful models.
- [x] Two revisions containing the same GlobalId can be selected independently via ObjectRef.
- [x] Repeated load/unload frees resources; no per-object rendering design that predictably overwhelms the selected fixtures.

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

## Answer

`/deliveries/[deliveryId]` now opens one combined browser view for the real BLCJ S1000 architectural, structural, and MEP revisions. The route keeps source-model state visible throughout loading, preserves each model's original transform, and applies one frozen origin offset to every successful revision.

### Behavior

- One long-lived browser Worker downloads and parses revisions sequentially. Download progress is source-specific and throttled to 1 MiB updates. Transfer batches use acknowledgement backpressure.
- Initial geometry stays hidden until every source reaches a terminal state. Successful bounds establish one rounded union center, and every model root receives the same inverse offset. Retrying a failed source does not recenter the models already shown.
- One Three.js renderer, render loop, shared material, and `BatchedMesh` per revision render the delivery. There is no mesh, material, renderer, or scene node per selectable IFC object.
- Each source has its own queued, download, parse, ready, or failed state. A transient MEP failure leaves ARCH and STRUCT visible and offers retry without reloading those models.
- Selection resolves an opaque `{ revisionId, objectId }`. IFC `expressId` and `GlobalId` remain source metadata. The same GlobalId in two revisions maps to two independently selectable ObjectRefs.
- Disposal is idempotent. It terminates the Worker, cancels the animation frame, disconnects controls and resize observation, disposes every `BatchedMesh`, the shared material, render lists, and the WebGL renderer.
- A valid revision with no drawable geometry reaches `ready` with null bounds instead of failing the delivery.

### Files

- Route and interface: `apps/web/src/app/deliveries/[deliveryId]/page.tsx`, `apps/web/src/components/viewer/combined-delivery-viewer.tsx`
- Delivery state and boundaries: `delivery-api.ts`, `delivery-controller.ts`, `types.ts`, `object-ref.ts`
- Worker and protocol: `ifc-loader.worker.ts`, `ifc-worker-protocol.ts`
- Rendering ownership: `renderer-owner.ts`
- Browser verifier: `scripts/verify-viewer.mjs`

### Commands

```text
npm --prefix apps/web run typecheck
# passed

npm --prefix apps/web run build
# passed; /deliveries/[deliveryId] built as a 156 kB dynamic route, 270 kB first load

node --check scripts/verify-viewer.mjs
# passed

node scripts/verify-viewer.mjs
# passed in 60.88 s; 72 named browser checks

git diff --check
# passed
```

The browser run loaded the 36,232,021-byte ARCH, 836,678-byte STRUCT, and 48,736,361-byte MEP fixtures. It rendered 5,275 selectable objects backed by three batch resources, exercised orbit, pan, zoom, canvas raycasting, source-specific failure and retry, duplicate-GlobalId identity, a valid empty IFC, remount, and five unload calls.

### Evidence

- [Structured browser results](../evidence/07-combined-viewer/results.json)
- [Combined desktop](../evidence/07-combined-viewer/combined-desktop.png)
- [Combined mobile](../evidence/07-combined-viewer/combined-mobile.png)
- [Source-specific failure](../evidence/07-combined-viewer/partial-failure-desktop.png)
- [Duplicate ObjectRef selection](../evidence/07-combined-viewer/duplicate-object-selection.png)
- [Browser and server log](../evidence/07-combined-viewer/verifier.log)

### Limits

- Reusable package extraction remains deferred. This ticket adds only the ModelShelf route and its internal viewer modules.
- The real samples make web-ifc report non-fatal `TriangulateBounds() bad bound` diagnostics. Invalid drawable fragments are skipped while valid geometry remains aligned and selectable.
- Three.js reports one internal cached texture after complete scene cleanup. Its disposal guidance says this residual `renderer.info.memory` entry is expected and does not leak. The verifier proves all nine `BatchedMesh` textures are released, from 10 tracked textures before unload to the one internal entry afterward, with zero tracked geometry and shader programs.
- The evidence host has no Japanese font installed. The responsive layout and Japanese/English copy are present, but the screenshots cannot prove Japanese glyph rendering on that host.

### Downstream contract

- The route reads `GET /api/deliveries/{deliveryId}` as the canonical `DeliveryDetail` and each immutable IFC from `GET /api/models/{revisionId}/file`.
- Browser object IDs use `occ_` plus the first 16 lowercase SHA-256 hexadecimal characters of `${revisionId}:${expressId}`. Consumers must still treat the value as opaque.
- No database, schema, backend response, or reusable package contract changed.
