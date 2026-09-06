# Independently audit prototype completion

ID: 17
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 16
Wave: 2
Original plan coverage: F1–F4

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

Another AI checks the actual running product and evidence before the prototype is declared complete.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Package and verify the complete local demo](16-reproducible-demo.md). Read its Answer and verified interface before starting.

## Ownership

Read-only requirement, code-quality, manual QA, and scope audits; any fixes return to the owning ticket.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Audit the accepted reusable-module decision: package boundaries, shared identities, separate semantic/render data, generated payloads, and standalone viewer operation.

- Audit plan coverage against implemented behavior, not ticket status alone.
- Review correctness at worker/data/identity boundaries and verify claimed tests and performance against current source.
- Drive the complete reviewer journey and failure cases in a real browser. Check restrictions, source attribution, and truthful product wording.

## Acceptance criteria

- [ ] Reuse is demonstrated through the standalone consumer, not inferred from package names. Native Revit/Archicad support is not claimed.

- [ ] All four plan verification categories have evidence-backed pass or explicit outstanding failures.
- [ ] Every reported product behavior was observed on the final code state.
- [ ] Any discovered defect is assigned back to its owning ticket and affected verification is repeated after the fix.
- [ ] No commit/PR/deployment or publication happens without separate authorization.

## Verification

- Repeat the final demo journey and targeted checks from the preceding ticket.
- Record independent F1/F2/F3/F4 verdicts with source references, screenshots, logs, and residual limitations.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
