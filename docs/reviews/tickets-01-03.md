# Proposed fixes for tickets 01–03

Reviewed 2026-09-06 against the working checkout. This report proposes changes; it does not implement them or change ticket status. Other work continued during review, so re-read affected files before editing.

Ticket 02 and ticket 03 need corrections before their completion claims are reliable. Ticket 01's original startup-cleanup bug is fixed in the current checkout, but its revised test depends on an untracked local fixture.

## Priority and ownership

| ID | Priority | Ticket | Proposed fix |
| --- | --- | --- | --- |
| F1 | P1 | 02 | Preserve finding links when rebuilding the object tables |
| F2 | P1 | 03 | Convert placement translations to metres |
| F3 | P1 | 03 | Normalize properties using their actual units |
| F4 | P1 | 03, coordinated with 18 | Use shared payloads and separate semantic and render artifacts |
| F5 | P2 | 03, coordinated with 18 | Preserve ordered property values and inherited properties |
| F6 | P2 | 01 | Make the seed smoke test work without ignored local downloads |
| F7 | P2 | 02 | Generate collision-free legacy source names |
| F8 | P2 | 02, coordinated with 06 | Expose incomplete provenance for historical runs |

P1 blocks dependable ingestion, evidence preservation, or the agreed module contract. P2 addresses a narrower correctness or reproducibility gap. Fix F1–F4 before building more behavior on their outputs.

## F1. Preserve finding links during migration

**Evidence.** [migrate_v2.rs](../../services/checker/src/migrate_v2.rs) renames `objects` to `objects_v1` and rebuilds `object_props`. It does not rebuild `finding_objects`. SQLite rewrites that table's object foreign key to `objects_v1`, which the migration then drops. Its model foreign key also still targets the legacy `models` table.

A probe using the actual migration SQL and the rebuild statements reports these targets through `PRAGMA foreign_key_list(finding_objects)`:

```text
object_id -> objects_v1.id
model_id  -> models.id
```

A subsequent finding-link insert fails with `no such table: main.objects_v1`. Existing linked findings also prevent the foreign-key check from accepting a populated migration. The five migration tests omit this history shape.

**Proposed fix.** Rebuild `finding_objects` within the same migration transaction. Preserve its row IDs, evidence columns, and index. Reference `objects(id)` and `model_revisions(id)`. Inventory every foreign key targeting a rebuilt table before dropping its old name. Keep the final foreign-key check.

If any development database has already recorded version 2, repairing only migration 0002 will not repair that database. Provide a forward repair migration for that state. Do not delete user databases to resolve it.

**Verification.** Migrate a v1 fixture containing a completed run, finding, linked object, and property. Assert preserved values and readable history. Insert findings for both a migrated revision and a newly created revision. Test the repair on an already-version-2 database, rollback, and retry.

## F2. Convert placement translations to metres

**Evidence.** [placement.py](../../services/ifc-worker/src/ifc_worker/placement.py) directly flattens `get_local_placement`. That matrix retains source length units. A synthetic IFC with millimetre project units and a translation of 1000 emits a translation of `1000`, although [worker-v1.md](../contracts/worker-v1.md) requires `1` metre.

This mispositions objects relative to their SI geometry and corrupts placement comparisons.

**Proposed fix.** Resolve the project length unit and convert the translation column after resolving the placement chain. Leave rotation entries unchanged. If the unit or placement form cannot be interpreted, expose unsupported evidence rather than claiming a valid metre transform.

**Verification.** Use self-authored metre, millimetre, and conversion-based-unit IFC fixtures. Cover nested translations and rotation. Assert equivalent physical placements produce equivalent metre matrices and align with generated geometry.

## F3. Normalize properties using their actual units

**Evidence.** [units.py](../../services/ifc-worker/src/ifc_worker/units.py) reads a property's unit but gets its conversion multiplier from the project's unit assignment.

Two real IfcOpenShell entity probes demonstrate the problem:

- A property explicitly measured in metres, inside a millimetre project, receives multiplier `0.001`. A value of 2 metres becomes 0.002 metres.
- An explicit `IfcContextDependentUnit` named `mystery` receives the same multiplier and dimension `length`. The worker invents an SI interpretation for an unknown unit.

**Proposed fix.** Convert from the selected explicit unit. Use project units only when the property or quantity has no explicit unit. Resolve length, area, and volume independently. Preserve the original unit name and raw value when conversion is unsupported, with null SI value and dimension as the protocol requires.

**Verification.** Test explicit units that differ from project units, conversion-based units, square and cubic units, missing units, and context-dependent units. Assert numeric values as well as unit labels. The existing metre-only sample is insufficient.

## F4. Emit shared payloads and independent render artifacts

**Evidence.** [records.py](../../services/ifc-worker/src/ifc_worker/records.py) imports shared `ObjectRef`, but defines the remaining object payload independently. [inspect.py](../../services/ifc-worker/src/ifc_worker/inspect.py) embeds geometry in `objects.jsonl` and publishes only objects and outcomes.

Ticket 03 and [ADR 0001](../adr/0001-reusable-model-modules.md) explicitly require generated shared model payloads and separately loadable semantic and rendering artifacts. Re-running extraction with geometry disabled does not make an existing combined artifact independently loadable. The older worker document does not override this accepted boundary.

The worker tests also contain no golden JSON Schema validation of actual emitted payloads. Shared-package fixture tests establish the shared package's behavior, not worker conformance.

**Proposed fix.** Reconcile the worker envelope with the canonical schemas in `schemas/model/v1`. Emit semantic records and separately referenced geometry artifacts joined by `ObjectRef`, with descriptor, coordinate, capability, and hash metadata. Extend the canonical schemas where extraction needs additional information, then regenerate their consumers. Keep job and progress envelopes separate. Avoid creating another handwritten shared object format.

Update the protocol/version deliberately and migrate current consumers together. Do not add compatibility layers for an unpublished intermediate format.

**Verification.** Validate real worker output against JSON Schema and generated Python and Rust boundary types. Verify hashes, counts, identities, and geometry mappings. Load semantics without reading geometry bytes. Add golden malformed payloads for mismatched revision IDs, invalid transforms, and invalid references.

## F5. Preserve property collections and inheritance

**Evidence.** [properties.py](../../services/ifc-worker/src/ifc_worker/properties.py) skips every property that is not `IfcPropertySingleValue`. A real `IfcPropertyListValue` containing `outer`, then `inner`, produces no records and a diagnostic. `collectionOrder` records a property's position inside a property set, not the order of its values. This does not satisfy ticket 03's ordered-collection requirement.

The same extractor walks only occurrence property relations. A wall with a property set on its `IfcWallType` produces no properties and no diagnostic. Downstream inspection and comparison would mistake inherited information for missing information.

**Proposed fix.** Extend the shared property shape through F4 to represent ordered values explicitly. Preserve list order without treating unordered IFC sets as ordered. Extract inherited type properties with their origin recorded and defined occurrence-override behavior. Keep unsupported property forms visible as diagnostics or capability information.

**Verification.** Use list values whose reversal changes their meaning. Cover type-only properties, occurrence overrides, and duplicate property names in different sets. Assert unsupported evidence is distinguishable from a property that is actually absent.

## F6. Remove the smoke test's untracked fixture dependency

**Evidence.** The updated [qa-harness.mjs](../../scripts/qa-harness.mjs) copies an IDS file from `.local/ids-testcases`, which `.gitignore` excludes. The copy runs before `try/finally`. A copied checkout without that file exits on `ENOENT` and leaves both temporary directories behind.

**Proposed fix.** Check in a tiny self-authored IDS fixture suitable for this seed test. Place setup that can fail inside the cleanup lifetime, including fixture copying. Keep the new stored pack-version count assertion.

**Verification.** Run the smoke test without `.local`. Force fixture/setup failure and verify nonzero exit with no owned temporary directories left behind.

The original ticket 01 findings have improved. A fresh forced-startup-failure probe now exits 1, captures `serve.log`, and leaves no temporary directories. The revised happy-path test checks one stored pack version after two seeds. Preserve those fixes.

## F7. Avoid legacy source-name collisions

**Evidence.** [migrate_v2.rs](../../services/checker/src/migrate_v2.rs) generates source names from discipline and the first eight characters of the legacy model ID. The destination has `UNIQUE(project_id, name)`. Two valid IDs sharing that prefix and discipline make migration fail repeatedly. This is a code-inspection finding rather than a full service reproduction.

**Proposed fix.** Use the complete legacy ID or deterministic collision resolution. Keep each legacy model's separate source identity.

**Verification.** Migrate two models in the same project and discipline with IDs sharing the first eight characters. Assert distinct sources, preserved revision IDs, and successful retry after injected failure.

## F8. Distinguish historical run provenance from source lineage

**Evidence.** Migration assigns `model_revisions.provenance = 'incomplete'`, but [run_detail](../../services/checker/src/run.rs) still loads models from current delivery membership. [RunDetail](../../services/checker/src/dto.rs) exposes no run-input provenance status. An incomplete source lineage flag does not tell an API consumer whether the displayed models are proven inputs to that historical run.

Ticket 02 explicitly requires readable pre-migration history with incomplete provenance when run inputs cannot be established.

**Proposed fix.** Add an explicit historical run provenance status and reason. Preserve original results and evidence without presenting reconstructed membership as verified input. Coordinate the representation with ticket 06's pinned run inputs. Do not infer historical membership from today's delivery.

**Verification.** Migrate a run whose original input membership cannot be proven. Assert history remains readable and its provenance is explicitly incomplete. Keep full new-run input pinning in its assigned downstream ticket.

## Verification performed

- `node scripts/verify-api.mjs --scenario revisions` passed against the real service, including revision reuse and concurrent finalize/member requests.
- `cargo test -p modelshelf-checker` passed all five migration tests.
- `uv run --locked --project services/ifc-worker pytest -q services/ifc-worker/tests` passed all 30 tests.
- The updated `node scripts/qa-harness.mjs` passed locally.
- Additional SQLite and IfcOpenShell probes reproduced F1, F2, F3, and F5. Isolated copied-harness probes reproduced F6 and verified the original startup fix.

Evidence is saved under [tickets-1-3-review](../../.omo/evidence/modelshelf-prototype/tickets-1-3-review/). `probes.json` contains the extraction and foreign-key results. `ticket1-missing-fixture.json` and `ticket1-startup-recheck.json` distinguish the remaining setup failure from the repaired startup failure. `checker-tests.log` records migration test output.

The service tests cover the current checkout, which includes work beyond ticket 01. Separate read-only reviewers inspected tickets 02 and 03. These results do not claim a complete security audit or large-model performance validation.

## Keep later work in its assigned tickets

Queued ingestion, authoritative IDS evaluation, complete run input pinning, source-based model comparison, and viewer performance remain downstream work. Their absence alone is not a defect in these tickets. Keep Python focused on IFC and IDS library access; the corrections above do not move scheduling, database access, summaries, ranking, or comparison policy out of Rust.
