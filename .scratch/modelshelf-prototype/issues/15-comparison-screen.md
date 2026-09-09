# Review model and finding changes visually

ID: 15
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 14
Wave: 2
Original plan coverage: 9

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer selects two deliveries and investigates model and finding changes in the browser.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Compare findings only under compatible checking settings](14-finding-diff.md). Read its Answer and verified interface before starting.

## Ownership

Comparison route and controls, shared-camera viewer integration, before/after property presentation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Base/head overlays are app-supplied generic highlights and model inputs. Use the viewer public interface unchanged; it must not know about delivery revisions being better/worse or findings being resolved.

- Add base/head pickers, synchronized camera, revision toggle, and change overlay. Filter by source, discipline, object type, change kind, and confidence.
- Select removed objects in base geometry and added objects in head. Show exact before/after properties and finding evidence.
- Present uncertain matches, incompatible settings, incomplete geometry, and rerun actions clearly.

## Acceptance criteria

- [ ] Each controlled A/B change is discoverable and points to the correct revision geometry.
- [ ] Camera and filters remain coherent while switching sides.
- [ ] Repeated GlobalIds across both sides never cause selection on the wrong revision.
- [ ] Color has a textual equivalent; Japanese labels are readable and keyboard controls work.

## Verification

- node scripts/verify-ui.mjs --scenario comparisons
- Capture base/head and uncertainty states; inspect browser console and network errors.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

2026-09-09, [plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md): a real source for move, remove and shape change kinds is available. The repository owner exported the [Snowdon Towers](../../../samples/snowdon-towers/README.md) IFC set himself from the Autodesk Revit sample projects, so he can make a small deliberate edit in Revit (move one wall, delete one beam, swap one type) and export a genuine second revision. That gives real exporter output for the change kinds this screen renders, which the synthetic A/B fixtures cannot reproduce. Revit GlobalIds are stable across exports, so matching works; expect re-tessellation of untouched geometry to read as "Shape representation changed", which the plan already says to label honestly rather than treat as physical change. Ask the owner before assuming the revision exists.

Note also [ticket 34](34-rotation-change-kind.md): a rotation-only change currently reports as unchanged, so this screen would render a rotated object as identical. Confirm that decision before building the change overlay.
