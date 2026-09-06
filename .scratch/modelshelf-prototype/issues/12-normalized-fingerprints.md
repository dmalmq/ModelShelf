# Compute versioned fingerprints from normalized object state

ID: 12
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: open
Assignee: unassigned
Blocked by: 09
Wave: 2
Original plan coverage: 8, fingerprint portion

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

Equivalent normalized object state produces stable fingerprints, while property, placement, and shape representation changes are distinguishable.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Prove the Wave 1 review loop and viewer performance](09-wave-one-gate.md). Read its Answer and verified interface before starting.

## Ownership

Rust fingerprint consumer, worker normalized geometry/properties, persisted fingerprint profiles and tests.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Make fingerprinting a pure module over normalized shared snapshots and explicit settings. No IFC/parser, HTTP, database, or Next.js imports. Keep original source IDs as provenance, not fingerprint identity.

- Use authoritative normalized worker records and full BLAKE3 digests. Correct length/area/volume conversions and honor explicit units.
- Separate object-local triangle representation from placement. Canonicalize unordered triangle emission without claiming arbitrary geometric equivalence.
- Persist a versioned fingerprint profile including extraction, algorithm, units policy, tessellation settings, and quantization. Missing/unsupported geometry remains unknown.

## Acceptance criteria

- [ ] A standalone Rust test/driver fingerprints normalized fixtures without loading IFC or starting any application services.

- [ ] Equivalent metres/millimetres and corresponding area/volume values produce equivalent fingerprints under one profile.
- [ ] Formatting/STEP numbering/triangle ordering do not change fingerprints; deliberate property, move/rotation, and shape edits affect the correct components.
- [ ] Quantization-boundary behavior is tested and described honestly.
- [ ] Profile changes require new derived snapshots and do not overwrite historical evidence.

## Verification

- cargo test -p fingerprint
- Run fixture A/B through the real worker and compare persisted component hashes, including unavailable geometry.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.
