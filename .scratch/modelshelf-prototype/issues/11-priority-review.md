# Complete prioritized findings and pack selection

ID: 11
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 10
Wave: 2
Original plan coverage: 7

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer chooses a pack version, runs checks, and works through important grouped findings with clear evidence.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Complete the reviewer delivery shelf](10-delivery-shelf.md). Read its Answer and verified interface before starting.

## Ownership

Pack/run controls and full review screen, grouped findings presentation, shared metadata validation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Keep priority/category grouping and check-pack terminology in ModelShelf. Feed generic highlights and filter values to the viewer; do not teach the package about IDS findings.

- Promote the first-loop inspector into the complete review screen. Show severity bands before categories and group duplicate violations by requirement.
- Separate rule totals, distinct affected objects, not-applicable outcomes, and incomplete review. Avoid one misleading overall success percentage.
- Show expected/actual values, source requirement, scope, instructions, pack history, and failed-run recovery. Preserve access to all affected objects.

## Acceptance criteria

- [ ] Higher-severity findings cannot be displaced by large advisory groups.
- [ ] An object failing multiple rules is not double-counted in totals labelled distinct objects.
- [ ] Incomplete checks stay visible even when all evaluated checks pass.
- [ ] Switching pack versions creates new immutable runs and preserves old results.

## Verification

- node scripts/verify-ui.mjs --scenario findings
- Test priority ordering, malformed metadata, no-match scope, 100+ duplicates, and geometry-loading/failure states.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
