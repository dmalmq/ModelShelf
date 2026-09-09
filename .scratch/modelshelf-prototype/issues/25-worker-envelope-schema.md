# Publish the worker envelope schema and settle its version

ID: 25
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent, plan-alignment
Status: open
Assignee: unassigned
Blocked by: 03, 04
Wave: 1
Original plan coverage: 3, contract-artifact portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override, raised by the 2026-09-09 plan-alignment review.

## What to build

One machine-readable schema for the worker job envelope, validated by both the Python producer and the Rust consumer, with the protocol version stated consistently in the plan, the contract document, and its filename.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), [the starting codebase](../codebase-map.md), and [the plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md) that raised this ticket. Inspect current source before editing. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable.

## Prerequisites

- [Inspect IFC through a verified worker contract](03-ifc-worker-contract.md) and [Process model revisions through durable jobs](04-queued-ingestion.md).

## Ownership

`schemas/`, `docs/contracts/worker-v1.md`, `services/ifc-worker/src/ifc_worker/protocol.py`, `services/checker/src/jobs.rs` envelope and manifest types, `scripts/generate-model-contracts.mjs`, `scripts/verify-model-contracts.mjs`, `scripts/lib/fake-worker.mjs`.

Other agents may be working in this checkout. Ticket 26 also edits the worker and `jobs.rs`. Agree an ordering with its owner before starting.

## Implementation boundaries

- Plan todo 3 requires `schemas/worker-v1.schema.json` and golden request/result fixtures. Neither exists; `schemas/` holds only `model/v1/`. `services/checker/src/jobs.rs` `EventEnvelope`/`Manifest` and `services/ifc-worker/src/ifc_worker/protocol.py` are hand-maintained duplicates that can drift silently.
- The protocol version has moved without the plan following. `protocol.py:40-46` sets `PROTOCOL_VERSION: Literal[2] = 2`, `jobs.rs:433-481` sends and requires 2, and `docs/contracts/worker-v1.md` is titled "IFC worker protocol v2" while keeping the v1 filename. The document explains the reason ("The unpublished v1 combined objects.jsonl envelope never shipped"), so the change is deliberate; the naming is not.
- Settle it in one direction and record it. Renaming the document to `worker-v2.md` and correcting the plan and tickets 03/04 is the expected outcome; reverting to 1 is acceptable only if the shared-artifact split is also reverted, which it should not be.
- The model payload schemas under `schemas/model/v1/` are already correct. Do not duplicate them inside the envelope schema; reference them.
- Do not add a plugin framework or a second protocol dialect.

## Acceptance criteria

- [ ] A canonical worker envelope schema exists covering request, progress event, result event, manifest, and artifact reference, and it references the existing `schemas/model/v1/` payload schemas rather than restating them.
- [ ] The Python models and the Rust envelope/manifest types are both validated against that schema, and a deliberate field rename in one of them fails a check.
- [ ] Golden request and result fixtures exist and are exercised by a test.
- [ ] Exactly one protocol version number appears across `protocol.py`, `jobs.rs`, the contract document, its filename, the plan, and tickets 03 and 04. Every cross-reference resolves.
- [ ] Drift is detectable by a `--check` style command in the same style as `scripts/generate-model-contracts.mjs --check`.

## Verification

- uv run --locked --project services/ifc-worker pytest
- cargo test -p modelshelf-checker
- node scripts/generate-model-contracts.mjs --check
- node scripts/verify-model-contracts.mjs
- node scripts/verify-api.mjs --scenario worker-failure

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Raised on 2026-09-09 by the plan-alignment review of tickets 01-11 and 18. Every claim below cites the file and line observed in that review. No implementation is claimed by ticket creation.
