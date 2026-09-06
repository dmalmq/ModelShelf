# Create deliveries from immutable source-model revisions

ID: 02
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 01, 18
Wave: 1
Original plan coverage: 2

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A client can assemble a delivery from named source revisions, including two models in the same discipline, and reuse unchanged revisions in the next delivery.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Publish shared model contracts across Rust, Python, and the browser](18-shared-model-contracts.md). Consume its verified public contract.

- [Restore and verify the local application baseline](01-local-baseline.md). Read its Answer and verified interface before starting.

## Ownership

Service data model, forward migrations, source/revision/delivery endpoints and shared HTTP types.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Use the shared opaque ObjectRef model in application DTOs. Persist source-specific IFC identifiers in a mapping rather than making expressId the reusable viewer identity.

- Introduce persistent SourceModel, immutable ModelRevision, and delivery membership. Discipline is a filter, not identity.
- Use transactional versioned forward migrations. Preserve old model IDs as revision IDs; give each legacy model its own conservative source identity. Do not guess lineage.
- Finalize deliveries transactionally and reject later membership edits. Keep pre-migration history readable with incomplete provenance when its run inputs cannot be established.

## Acceptance criteria

- [ ] API model payloads consume the shared contract and preserve revision-local objectId/source-identifier mapping without inventing cross-revision identity.

- [ ] Two separately named MEP sources coexist in one delivery.
- [ ] A second delivery reuses an unchanged revision without copying its source bytes.
- [ ] Finalized membership cannot change, including concurrent finalize/edit requests.
- [ ] Migration succeeds on empty and populated data, rolls back on injected failure, and retries without data loss or duplication.

## Verification

- cargo test -p modelshelf-checker
- Create scripts/verify-api.mjs --scenario revisions using the shared harness.
- Assert stored rows and HTTP responses for reuse, finalize races, and conservative legacy migration.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
