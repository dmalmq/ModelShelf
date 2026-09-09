# Compute versioned fingerprints from normalized object state

ID: 12
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: poteto-12-fingerprint
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

## Answer

Delivered a pure normalized fingerprint module over the worker's authoritative records plus a versioned profile, with standalone tests and real worker A/B evidence.

Changes: `crates/fingerprint/src/normalized.rs` (new, pure imports only `model_contracts`/`serde`/`blake3`); `crates/fingerprint/src/lib.rs` (`pub mod normalized`); `crates/fingerprint/Cargo.toml` (adds `model-contracts`, `serde_json` dev-dep); `crates/fingerprint/examples/fingerprint_worker.rs` (new driver joining `semantic.json` with `geometry.jsonl` by `ObjectRef`); `crates/model-contracts/src/lib.rs` (re-exports `GeometryChunkStatus`, `PropertyValueDimension`). Legacy `IfcModel` API untouched. Native `expressId`/`globalId` are provenance only and never hashed. All four digests are full 64-char BLAKE3. `DerivedSnapshot` carries `profile_version` (`fp-v1`) and `profile_id` (BLAKE3 of canonical profile JSON binding extraction `inspect-v2`, algorithm `blake3-256`, units policy `si-metre`, `use_world_coords=false`, length/area/volume/angle/numeric quanta, ignored psets). Mismatched profiles error (`fingerprint_with_expected_profile`, `require_same_profile`, `verify_profile`) and never overwrite history. Shape is object-local quantized triangles with sorted triangle tokens (winding preserved); `absent`/`unsupported`/missing-chunk are distinct stable tokens and exporter reasons are display-only. Properties trust worker `siValue` for length/area/volume with per-dimension quanta, keep `ordered` semantics, tag `occurrence`/`type` origin, ignore psets case-insensitively. Placement splits translations (length quantum) from rotation (angle quantum); missing placement is distinct from origin-zero.

Commands/results: `cargo test -p fingerprint` passes 30/30 (23 normalized in-code fixtures, no IFC or services; 7 legacy unchanged). `cargo test -p modeldiff` 14/14 and `cargo check --workspace` clean (checker warnings only, pre-existing). Real worker runs `ifc-worker --request` inspect on `packs/demo/fixtures/base.ifc` and `head.ifc` (both exit 0, 141 objects each: 138 available plus 3 absent geometry) fingerprinted by the example driver: 133 shared GlobalIds with 121 unchanged, 3 property-only, 6 placement-only (moved 3 plus rotated 3), 3 shape-only deltas, 6 added plus 6 removed (oracle added/removed 3 each plus ambiguous-ID pairs), zero mixed-component flips. Absent geometry hashes one stable token across both revisions, disjoint from every available shape. Quantization ties pin half-away-from-zero with `-0.0` to `0.0`, NaN/Inf/negative-Inf to fixed tokens; boundary straddling flips are documented as inherent.

Evidence: `.omo/evidence/modelshelf-prototype/ticket-12/` (`cargo-test-fingerprint.log`, `ab-comparison.txt`, `base-snapshots.jsonl`, `head-snapshots.jsonl`, `worker-base-manifest.json`, `worker-head-manifest.json`).

Limitations: STEP numbering and source formatting invariance is structural (normalized records carry neither) rather than tested. Shape is a representation hash, not geometric equivalence. Checker persistence still stores legacy `fp_*` columns with no profile column; migrating ingest/diff to `DerivedSnapshot` and adding the profile column belongs to ticket 13, which owns profile-mismatch dimensions and recomputation without touching old artifacts.

Downstream: ticket 13 can depend on `fingerprint::normalized::{FingerprintProfile, fingerprint_normalized, fingerprint_with_expected_profile, require_same_profile, verify_profile, DerivedSnapshot}` and must gate every comparison on equal `profile_id`.
