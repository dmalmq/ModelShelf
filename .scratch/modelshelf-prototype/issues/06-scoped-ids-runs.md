# Run scoped IDS checks against pinned delivery inputs

ID: 06
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 04, 05
Wave: 1
Original plan coverage: 3,4 and first-loop portion of 5

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A ready delivery can be checked with a selected pack, and the API returns reproducible grouped findings tied to exact model revisions.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Process model revisions through durable jobs](04-queued-ingestion.md). Read its Answer and verified interface before starting.
- [Prepare reproducible Japanese and synthetic demo evidence](05-demo-evidence.md). Read its Answer and verified interface before starting.

## Ownership

Python validation operation, Rust run worker/aggregation, pack publication, run snapshots and affected-object paging.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Checking emits revision-qualified ObjectRefs and raw requirement evidence. ModelShelf owns severity/category policy and converts findings to generic viewer highlight groups; the checking module never imports rendering code.

- Use IfcTester as the authoritative validator. Freeze input membership, hashes, pack metadata/IDS digest, scope, and engine profile in one transaction before queueing a run.
- Apply source/discipline scope before per-file evaluation. Separate raw engine outcome, not-applicable presentation, failure, and incomplete evaluation. Correct the partial worker draft’s blanket zero-applicability rule.
- Validate pack metadata and supported rule forms before publication. Group by distinct requirement and expose paginated revision-qualified object evidence.

## Acceptance criteria

- [ ] A finding can be consumed as textual evidence without a renderer, and every referenced object maps to the same shared identity used by rendering.

- [ ] The synthetic oracle matches every selected rule; a malformed or unsupported requirement cannot quietly pass.
- [ ] Required no-match applicability fails, legitimate optional no-match is represented separately, and engine/geometry limitations are incomplete.
- [ ] Two files in one discipline are evaluated correctly; excluded files do not create spurious missing-object failures.
- [ ] A run retains its exact input list after restart; a finding affecting over 100 objects can retrieve every member beyond the first 25.

## Verification

- uv run --locked --project services/ifc-worker pytest tests/test_demo_packs.py
- cargo test -p modelshelf-checker
- node scripts/verify-api.mjs --scenario checks verifies scoped runs, invalid metadata, input snapshots, and affected-object paging.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
