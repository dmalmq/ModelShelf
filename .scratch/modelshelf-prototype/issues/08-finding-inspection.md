# Inspect a real finding in its model context

ID: 08
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
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

- Implement inspector-specific UI in ModelShelf. Translate findings into generic ObjectRef highlight groups and host-provided styles. Keep colors/priorities, requirement text, delivery state, and API lookups outside the viewer package.

- Connect live run results to the viewer test route, with no hardcoded findings. Retrieve the complete affected-object set through paging.
- Add source/discipline/storey/type filters, section cut, dimming, isolate/reset, frame selection, and selected-object properties.
- Keep textual evidence available for absent geometry and incomplete checks. Define intersection of selection with visibility filters and make hidden selected objects explicit.

## Acceptance criteria

- [ ] Identical viewer exports are used by ModelShelf and the standalone example; no inspection-specific method or state is added to the rendering core.

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
