# Inspect a real finding in its model context

ID: 08
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: orca-timingila-t08
Blocked by: 06, 07
Wave: 1
Original plan coverage: 5

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

Selecting a real grouped finding highlights its objects and lets the reviewer isolate, frame, filter, and inspect them.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Run scoped IDS checks against pinned delivery inputs](06-scoped-ids-runs.md). Read its Answer and verified interface before starting.
- [Open a combined delivery in the browser](07-combined-viewer.md). Read its Answer and verified interface before starting.

## Ownership

Viewer controls and test-route finding inspector, API adapter, revision-qualified highlight/isolation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Implement inspector-specific UI in ModelShelf. Translate findings into generic ObjectRef highlight groups and host-provided styles. Keep colors/priorities, requirement text, delivery state, and API lookups outside the rendering core.

- Connect live run results to the viewer test route, with no hardcoded findings. Retrieve the complete affected-object set through paging.
- Add source/discipline/storey/type filters, section cut, dimming, isolate/reset, frame selection, and selected-object properties.
- Keep textual evidence available for absent geometry and incomplete checks. Define intersection of selection with visibility filters and make hidden selected objects explicit.

## Acceptance criteria

- [ ] No inspection-specific method or state is added to the rendering core.

- [ ] Selecting a 100+ object finding highlights every accessible member rather than the embedded preview page only.
- [ ] Storey/discipline/source filters, section plane, isolation reset, and property inspection work through real controls.
- [ ] Highlighting targets the selected revision only, including base/head copies with repeated IDs.
- [ ] A non-geometric finding has readable evidence and an explanation rather than an empty failed interaction.

## Verification

- node scripts/verify-viewer.mjs --scenario inspection
- Use the synthetic oracle and an actual worker run; assert selected object references against the API evidence.
- Capture screenshots of selection, isolation, missing geometry, and filtered states.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

Selecting a live grouped finding highlights every accessible member, isolates and frames the set, and offers source/discipline/storey/type filters, section cut, dimming, isolation reset, and property inspection. Members without drawable geometry keep textual evidence; hidden selections are explicit.

### Behavior

- The delivery page gains a Findings tab beside Selection. A run picker defaults to the latest completed run (`?run=` deep-links); findings flatten the run scorecard plus review-incomplete rows.
- Selecting a finding pages the complete affected set past the embedded 25, paints one severity-colored highlight group, isolates the set, dims the rest to 0.25, and frames it. Counts report matched vs total members.
- Source/discipline/storey/type filters compile to revision-qualified ObjectRef subsets applied through generic isolation; Reset clears isolation, filters, section, and dimming.
- Section Z input clips above a project height (controller converts to world coordinates against the shared origin); property inspection fetches `/api/objects/:id` for finding members.
- Members with no renderable identity and convertible members with no drawable geometry share one evidence panel with expected/instructions text; incomplete findings always show it with a review-incomplete explanation.
- Rendering-core additions are generic only: `setHighlights` (later groups win), `isolate` (composes with discipline visibility), `setSectionZ` (world clip plane), `setDimOpacity` (color blend toward white while highlights are active). No finding, severity, or requirement concept entered the core.

### Files

- Inspector UI: `apps/web/src/components/viewer/finding-inspector.tsx`, `apps/web/src/components/viewer/findings-api.ts`
- Generic core: `apps/web/src/components/viewer/types.ts`, `delivery-controller.ts`, `renderer-owner.ts`
- Host: `apps/web/src/components/viewer/combined-delivery-viewer.tsx` (Findings tab, extended verify handle)
- Prover: `scripts/verify-viewer-inspection.mjs` (dispatched by `scripts/verify-viewer.mjs --scenario inspection`)

### Commands

```text
npm --prefix apps/web run typecheck
# passed

npm --prefix apps/web run build
# passed

node scripts/generate-model-contracts.mjs --check
# passed, no drift

node scripts/verify-viewer.mjs --scenario inspection
# passed in ~245 s; 23 named browser checks

node scripts/verify-viewer.mjs
# passed in ~65 s; combined/duplicate/empty regression green

git diff --check
# passed
```

The run scored a live checker + IfcTester worker: a BLCJ S1000 delivery (ARCH/STRUCT/MEP) run against the BLCJ v2 pack plus a synthetic-fixtures delivery run against the same pack. The flow-segment finding holds 107 affected objects across 4 storeys; all 107 requested, 107 matched, 0 unaccounted. Storey filtering narrowed isolation 107 to 33 (1FL); hidden selection, reset, section clip, property panel (IfcFlowSegment), and the incomplete-finding evidence panel were asserted against `/api` evidence in the browser.

### Evidence

- [Structured browser results](../evidence/08-finding-inspection/results.json)
- [Selection and hidden notice](../evidence/08-finding-inspection/inspection-selection.png)
- [Storey isolation](../evidence/08-finding-inspection/inspection-isolated.png)
- [Section cut](../evidence/08-finding-inspection/inspection-section.png)
- [Incomplete evidence](../evidence/08-finding-inspection/inspection-evidence.png)
- [Browser and server log](../evidence/08-finding-inspection/verifier.log)

### Limits

- Synthetic fixture geometry is not triangulable by the browser IFC engine (`GetMesh() unexpected mesh type`), so the 100+ member proof uses the real BLCJ MEP flow-segment finding; the fixtures delivery covers the incomplete-evidence path.
- Dimming blends toward white; BatchedMesh exposes no per-instance alpha.
- Revision-only targeting rides revision-qualified ObjectRef keys (07 duplicate-GlobalId proof still holds); this run's large finding lives in one revision.
- No database, schema, backend response, or shared-contract change.
