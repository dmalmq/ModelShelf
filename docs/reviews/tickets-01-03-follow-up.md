# Follow-up review of the ticket 01–03 fixes

Reviewed 2026-09-06 against the working checkout after the F1–F8 implementation report. No application changes were made by this review.

The corrections are substantial, but “all eight implemented” overstates the result. F1 and F7 now have appropriate migration repairs and coverage. Historical F8 is explicitly incomplete. Protocol 2 uses shared payloads, and its consumers have moved together. The following correctness issues remain beyond the acknowledged verification gaps.

## Remaining findings

### R1. P1: Square and cubic prefixes still normalize incorrectly

Related finding: F3.

[si_multiplier_for_unit](../../services/ifc-worker/src/ifc_worker/units.py) applies an SI prefix once regardless of dimension. A real IfcOpenShell probe gives:

| Input | Actual SI value | Expected SI value |
| --- | --- | --- |
| 1,000,000 square millimetres | 1,000 square metres | 1 square metre |
| 1,000,000,000 cubic millimetres | 1,000,000 cubic metres | 1 cubic metre |

Apply the prefix with the exponent required by `SQUARE_METRE` or `CUBIC_METRE`. Preserve conversion-based factors separately. Add prefixed area and volume cases. The new test with explicit square/cubic **metres** in a millimetre project does not exercise this defect.

### R2. P1: Rendering artifacts cannot position objects independently

Related findings: F2 and F4.

[geometry.py](../../services/ifc-worker/src/ifc_worker/geometry.py) produces object-local vertices with `use-world-coords = False`. [inspect.py](../../services/ifc-worker/src/ifc_worker/inspect.py) stores object placement only in `SemanticObject`. Neither the render instance nor the geometry chunk contains a transform, and the descriptor uses an identity transform.

A renderer must therefore load semantics to position translated or rotated objects. Physically separate files have not fulfilled the independent-rendering contract.

Add an SI placement transform to the render instance, or deliberately produce project-frame vertices. Define which coordinate frame the renderer receives. Verify a translated and rotated geometric fixture using only descriptor, render manifest, and geometry bytes. Compare the resulting world coordinates with IfcOpenShell's world-coordinate triangulation. This also closes the acknowledged F2 alignment gap.

### R3. P1: Rust verifies render hashes without validating their payloads

Related finding: F4 and the ticket 04 integration.

[jobs.rs](../../services/checker/src/jobs.rs), in `invoke_worker`, hashes render-manifest and geometry artifacts but does not parse their shared schemas or validate their object mappings. It parses the descriptor and discards the result without comparing its revision, source hash, artifact hashes, counts, or capabilities with the requested job and verified artifacts.

A correct hash proves that bytes match the supplied hash. It does not prove those bytes describe a valid scene or the requested revision.

Validate all artifacts at this boundary. Verify cross-artifact identity, references, counts, and capability consistency before publishing the revision. Extend the fake-worker scenarios with correctly hashed malformed geometry, a descriptor for another revision, and an invalid instance reference. Each must fail ingestion without publishing a completed revision.

### R4. P2: IFC2X3 type properties still disappear

Related finding: F5.

[properties.py](../../services/ifc-worker/src/ifc_worker/properties.py) follows only `IsTypedBy` for inheritance. IFC2X3 exposes `IfcRelDefinesByType` through `IsDefinedBy`. A real IFC2X3 wall/type/property probe produces no records and no diagnostic.

Resolve types across the supported IFC schemas, using the established library helper or explicit schema-aware traversal. Keep occurrence override behavior. Test the same type-only and override cases in IFC2X3 and IFC4. If a schema is unsupported, declare that explicitly rather than silently omitting evidence.

### R5. P2: Rust's property projection loses the shared record

Related findings: F4 and F5.

[publish_revision](../../services/checker/src/jobs.rs) preserves inherited origin, but stores only the first value's SI value, unit, and dimension. It discards `ordered` and converts raw values into text through `property_values_text`. The persisted API projection cannot round-trip the shared property record, even though the original semantic artifact retains it.

Persist the structured property record or serve it from the authoritative semantic artifact. Keep any scalar search projection separate from the evidence representation. Verify API round-trips for booleans, numbers, ordered lists, unordered collections, and per-value normalization metadata. Coordinate this change with the owner of ticket 04.

### R6. P2: New runs claim complete provenance before input pinning

Related finding: F8.

[migration 0004](../../services/checker/migrations/0004_run_input_provenance.sql) defaults `input_provenance` to `complete`. New run inserts do not override it, while [run_detail](../../services/checker/src/run.rs) still reconstructs models from delivery membership.

Default unpinned runs to incomplete with a reason. Set complete only when the exact input snapshot is established. This does not require implementing all of ticket 06 now; it prevents the new metadata from claiming something the application cannot prove. Use a forward migration for databases already on version 4.

## Verification and accepted corrections

The following commands passed again during this review:

- `cargo test --workspace`
- `uv run --locked --project services/ifc-worker pytest -q services/ifc-worker/tests`: 39 tests.
- `node scripts/verify-model-contracts.ts`
- `node scripts/verify-api.ts --scenario revisions`
- `node scripts/verify-api.ts --scenario worker-failure`

Independent read-only reviews checked the migration/provenance changes and protocol integration. Parent probes reproduced R1 and R4 with real IfcOpenShell entities. R2, R3, R5, and R6 are implementation findings from traced producers and consumers.

F1 rebuilds finding links with the correct foreign keys and preserves their IDs. The version 4 repair covers already-migrated databases. F7 uses complete legacy IDs with collision/retry coverage. Historical F8 clearly labels reconstructed inputs. F6 now uses the checked-in fixture and places its copy inside cleanup. This follow-up inspected F6 but did not repeat its missing-fixture probe.

The F4 tests validate actual semantic, descriptor, and geometry output through generated Python models. They do not validate the emitted render manifest there, and the contract verification script exercises package fixtures rather than actual worker output. The audit trail should cite these checks accurately and keep the missing cross-artifact checks open.

Keep the previous [review](tickets-01-03.md) as the original findings record. Close items only when their corrected behavior and relevant regression checks pass. The remaining problems warrant another focused pass before treating these tickets as complete.
