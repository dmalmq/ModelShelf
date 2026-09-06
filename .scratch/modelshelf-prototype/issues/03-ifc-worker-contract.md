# Inspect IFC through a verified worker contract

ID: 03
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 18
Wave: 1
Original plan coverage: 3, inspect portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

The local IFC worker turns a verified input into typed, hashed object artifacts that Rust can consume without interpreting IFC itself.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Publish shared model contracts across Rust, Python, and the browser](18-shared-model-contracts.md). Read its Answer and generated payload contract before starting.

## Ownership

Python worker, worker protocol/schema, golden protocol fixtures and CLI tests. No Rust database edits.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Consume the shared model schema and generated Python payloads. Keep job/progress envelopes separate. Emit independently loadable semantic records and render artifacts joined by opaque ObjectRef. Keep processing and IDS validation separate internal worker modules in the same process.

- Use existing dependency files as a starting point. Implement the missing worker entrypoint with locked IfcOpenShell and Pydantic models.
- Define JSON request files and NDJSON progress plus one terminal result on stdout. Bulk output uses hashed JSONL artifacts; logs use stderr. Specify every schema/version and path policy.
- Extract revision-qualified objects, optional GlobalIds, typed properties with SI dimensions/units, project-frame placements, and object-local geometry with explicit available/absent/unsupported states. Preserve ordered collections.

## Acceptance criteria

- [ ] Worker artifact references use the shared occurrence IDs and include the source mapping needed by the browser IFC loader; semantic extraction can run without geometry.

- [ ] A real IFC yields inspect artifacts whose record counts, byte sizes, and hashes are verified.
- [ ] Request/job/revision identity is preserved; invalid input or hash mismatch exits nonzero without a successful terminal result.
- [ ] Golden fixtures validate against the JSON Schema and Python model. Unknown units retain raw evidence without invented SI values.
- [ ] No worker database access or external network access is required to inspect a local model.

## Verification

- uv run --locked --project services/ifc-worker pytest
- uv run --locked --project services/ifc-worker ifc-worker --request <absolute-test-request.json>
- Test missing fields, wrong hashes, malformed IFC, empty/missing geometry, unit dimensions, and stdout framing.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
