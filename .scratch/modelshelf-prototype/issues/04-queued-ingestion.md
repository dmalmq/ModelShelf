# Process model revisions through durable jobs

ID: 04
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 02, 03
Wave: 1
Original plan coverage: 2,3

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

Uploading a model returns a job immediately; the client can poll until the immutable revision is ready or see why processing failed.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Create deliveries from immutable source-model revisions](02-immutable-deliveries.md). Read its Answer and verified interface before starting.
- [Inspect IFC through a verified worker contract](03-ifc-worker-contract.md). Read its Answer and verified interface before starting.

## Ownership

Rust upload/worker adapter, durable job table/runner, artifact publication and revision read endpoints.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Consume generated shared model payloads in Rust and persist opaque occurrence references plus source mappings. Keep job/persistence logic outside the reusable model-contract and comparison modules.

- Replace live custom-parser ingestion with the authoritative worker. Validate protocol schema/identity/exit code and all artifact hashes/paths in Rust.
- HTTP returns 202 plus a job reference. Persist queued/running/completed/failed state and serialize heavy work. Publish normalized objects and ready state atomically.
- Mark interrupted running jobs failed on restart; provide idempotent explicit retries. Store bytes content-addressed and retain failed input evidence.

## Acceptance criteria

- [ ] A model-data schema version mismatch is rejected at the worker boundary, and the API does not expose database row structure as the viewer contract.

- [ ] A real upload progresses to a ready revision with inspectable objects and a retrievable original IFC.
- [ ] Malformed/truncated stdout, duplicate terminal results, wrong job ID, nonzero exit, bad artifact hash, and path escape cannot publish ready data.
- [ ] Restart during work yields a visible recoverable failure, not a permanently running job or clean result.
- [ ] Duplicate content avoids duplicate blob storage; simultaneous requests do not exceed one active heavy job.

## Verification

- cargo test -p modelshelf-checker
- node scripts/verify-api.mjs --scenario worker-failure
- Exercise live upload/poll/object retrieval and crash/restart with the shared isolated harness.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
