# Complete the reviewer delivery shelf

ID: 10
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 09
Wave: 2
Original plan coverage: 6

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer can create, revisit, and assemble deliveries through the application without using the test route or CLI.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Prove the Wave 1 review loop and viewer performance](09-wave-one-gate.md). Read its Answer and verified interface before starting.

## Ownership

Project/delivery routes, upload/reuse/finalize forms, typed API client and status UI.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Compose the reusable viewer through its React export. Keep delivery/source organization and host resource loaders in the app; import generated model payloads instead of duplicating viewer types.

- Build project shelf and delivery detail pages on the verified API. Let users name sources, assign disciplines, upload revisions, and reuse unchanged revisions.
- Show draft/finalized/processing/failed states with recovery actions and input provenance. Preserve reasonable filter context across navigation.
- Keep Rust authoritative; avoid parallel business logic in Next server actions.

## Acceptance criteria

- [ ] A reviewer creates two deliveries, reuses one revision, updates another, finalizes, reloads, and sees identical membership.
- [ ] Invalid upload does not discard other ready sources. Two MEP sources remain distinct.
- [ ] Historical runs and their exact inputs are reachable from the delivery.

## Verification

- node scripts/verify-ui.mjs --scenario deliveries
- npm --prefix apps/web run typecheck
- npm --prefix apps/web run build

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
