# Compare revisions with explicit match confidence

ID: 13
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 12
Wave: 2
Original plan coverage: 8, model comparison portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

The API reports additions, removals, movement, property edits, and representation changes without pretending uncertain identities are exact.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Compute versioned fingerprints from normalized object state](12-normalized-fingerprints.md). Read its Answer and verified interface before starting.

## Ownership

Rust modeldiff matching, delivery/source pairing, diff endpoints and pagination.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Make comparison consume normalized snapshots and explicit match policy and return typed change records. The service loads/persists snapshots; the comparison crate does not perform database or HTTP work.

- Pair revisions through persistent SourceModel identity, not discipline. Reused revisions avoid unnecessary comparison.
- Only unique GlobalIds on both sides produce exact matches. Duplicate/missing/regenerated IDs produce explicit candidates or unresolved additions/removals.
- Compare snapshots under one fingerprint profile; mismatches yield a clear error until both sides are recomputed. Report before/after values and qualified object references.

## Acceptance criteria

- [ ] Dependency checks reject direct parser/database/HTTP dependencies in reusable comparison modules; fixture comparisons run without services.

- [ ] Two MEP sources are never cross-matched solely by discipline.
- [ ] Duplicate IDs are not paired by STEP order and labelled exact. Splits/merges remain unresolved.
- [ ] Every controlled A/B change appears with correct source/revision and matching confidence.
- [ ] Pagination preserves deterministic ordering and complete result counts.

## Verification

- cargo test -p modeldiff
- node scripts/verify-api.mjs --scenario comparisons
- Test each fingerprint-profile mismatch dimension and recomputation without changing old artifacts.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
