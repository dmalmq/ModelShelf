# Prepare reproducible Japanese and synthetic demo evidence

ID: 05
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: none
Wave: 1
Original plan coverage: 4

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

An agent can reproduce the planned three-discipline building demo and known pass/fail/change cases without inventing expected outcomes.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

None. This ticket is on the initial frontier.

## Ownership

Ignored third-party downloads, source manifests, self-authored IFC fixture generator, demo pack specifications/metadata.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Acquire the BLCJ S1000 architectural, structural, and MEP IFC samples through the official pack. Preserve originals, URLs, dates, hashes, usage terms, schemas, and alignment facts.
- Author 8–12 information checks from the first three saved reference collections after inspecting actual IFC properties. Record source references, mappings, scope, priority, category, and why each demo requirement applies.
- Produce v1/v2 packs with one explained rule change and self-authored A/B fixtures covering 100+ repeated failures, additions/removals, property/shape/move/rotation changes, and ambiguous IDs.

## Acceptance criteria

- [ ] Acquisition is checksum-verifiable and repeatable. Restricted source archives remain ignored and are not redistributed.
- [ ] The three models align under documented shared-coordinate treatment; any required transform is explicit and evidenced.
- [ ] A machine-readable oracle lists exact expected results for every synthetic requirement/change.
- [ ] No reference-dictionary field is called universally mandatory; native parameter names are not assumed to equal IFC names.

## Verification

- Create scripts/fetch-demo-models.mjs and scripts/generate-demo-fixtures.py.
- Inspect real models with the locked worker environment once available, or an isolated pinned IfcOpenShell environment.
- Validate IDS XML and independently inspect each synthetic oracle case; validation integration is completed by the scoped-check ticket.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
