# Reconcile stale documentation with the shipped prototype

ID: 30
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 10, 11
Wave: 2
Original plan coverage: 10, documentation portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

Every document a newcomer reads first describes what actually exists, and each resolved todo has a per-task evidence summary the plan asks for.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Complete the reviewer delivery shelf](10-delivery-shelf.md) and [Complete prioritized findings and pack selection](11-priority-review.md).

## Ownership

`README.md`, `references/bim-checking/README.md`, `packs/demo/blcj-s1000-v2.ids`, `.omo/evidence/modelshelf-prototype/`.

Other agents may be working in this checkout. Ticket 16 owns the full launch sequence and `docs/limitations.md`; this ticket only corrects statements that are now false.

## Implementation boundaries

- `README.md` states that no browser test specs exist "since there is no viewer page to test" and documents only `node scripts/qa-harness.mjs`. Five verifiers and a viewer exist. List the real entrypoints and scenario names with one-line purposes.
- `references/bim-checking/README.md:3` states "No checker or application has been built". The checker, worker, packs and viewer are built and verified. Correct the status while keeping the folder reference-only.
- `packs/demo/blcj-s1000-v2.ids:170-183` carries an inline comment repeating the pre-correction claim that every affected segment "was a cable-tray-family segment", which `packs/demo/checks.md:30-38` explicitly corrects to 62 ducts, 45 pipes and 43 cable trays with v2 excluding only the 43 trays. A reader of the IDS alone gets the wrong rationale.
- Every plan todo requires `.omo/evidence/modelshelf-prototype/task-N.md`. Run directories exist for tasks 1, 2, 3, 5, 9, 10 and 11, but no `task-N.md` summary file exists for any todo. Either write one short summary per resolved todo pointing at its run directory, or amend the plan to bless run directories plus `docs/reviews/wave-1-report.md` as the evidence unit; state which you chose.
- Do not overstate. Where a target is unproven, say so and link the ticket that will prove it.
- Do not write `docs/limitations.md` here; that belongs to ticket 16.

## Acceptance criteria

- [ ] `README.md` lists every verification entrypoint and scenario with an accurate one-line purpose, and no longer claims browser tests are absent.
- [ ] `references/bim-checking/README.md` describes the current state accurately and keeps the reference-only boundary explicit.
- [ ] The v2 IDS inline rationale matches `packs/demo/checks.md`, and a check fails if the two diverge again.
- [ ] Per-todo evidence summaries exist for every resolved todo, or the plan records the agreed alternative evidence unit.
- [ ] No document in the repository claims a shipped capability is unimplemented.

## Verification

- node .scratch/modelshelf-prototype/check-tickets.mjs
- python scripts/check-demo-oracle.py
- A read-through of every corrected document against the resolved ticket Answers it describes

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
