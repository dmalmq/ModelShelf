# modelshelf-prototype - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** A local ModelShelf prototype with a combined 3D building view, prioritized grouped findings, and comparison between model deliveries.

**Why this approach:** Rust owns the application and comparison logic. An established IFC/IDS worker handles standards interpretation so the team can concentrate on a reliable review experience.

**What it will NOT do:** Regulatory approval, clash checking, Revit write-back, or arbitrary spreadsheet conversion.

**Effort:** Large
**Risk:** High. Model compatibility, coordinate alignment, and browser performance still need evidence.
**Decisions to sanity-check:** Local single-user deployment, Rust with a Python IFC/IDS worker, and a first pack of 8–12 explicitly supported checks. These are the recommended defaults adopted for this prototype.

Your next move: review the plan, then start implementation when ready. Full execution detail follows below.

---

> TL;DR (machine): Large; high risk; 2 waves, 11 implementation tasks, 4 final verification tasks.

## Scope

### Must have

Build a local, single-user prototype for a client-side BIM reviewer. Keep the working name ModelShelf. The physical workspace remains rockling; the Orca display name is ModelShelf.

The reviewer creates a delivery containing architectural, structural, and services revisions, checks it against a versioned pack, navigates grouped findings in a combined 3D view, and compares two deliveries. Every result identifies its exact input revisions and check-pack version.

Approved architecture:
- Approved reusable-module amendment: [module ownership and contracts](../../docs/adr/0001-reusable-model-modules.md). It supersedes earlier drafts that expose bare IFC IDs as the reusable viewer interface. Shared contracts and one reusable viewer package are required; no new network services or native RVT/PLN support are added.
- Rust/Axum owns HTTP, revisions, SQLite persistence, local content-addressed file storage, job scheduling, grouping, fingerprints, and comparison.
- A local Python worker using IfcOpenShell and IfcTester owns authoritative IFC interpretation and IDS evaluation. Run it as a subprocess with a versioned JSON file protocol, not a public service. Pin tested dependency versions in a lockfile during implementation.
- Next.js/React owns ModelShelf UI and consumes the public React export of packages/model-viewer. Its rendering core is framework-independent, and packages/model-contracts provides generated shared payloads. Reuse existing versions and styling unless a measured incompatibility requires an update. Three.js and web-ifc are the initial viewer path, with IFC processing in a Web Worker.
- Keep existing Rust libraries and tests as research/reference code where useful. The incomplete custom IDS engine must not produce production scorecards. Refactor fingerprint/modeldiff consumers to accept the worker's normalized snapshots instead of relying on custom IFC interpretation.
- SQLite and filesystem storage are sufficient for the local prototype. One active heavy processing job at a time. No Redis, Kubernetes, cloud deployment, or authentication platform.

Domain decisions:
- SourceModel is a persistent project-owned input such as Architecture East or Mechanical. Discipline is metadata, not its identity.
- ModelRevision is immutable and belongs to one SourceModel. It records content hash, schema, source file, processing versions, status, and artifacts.
- Delivery is a dated manifest of source-model revision references. A new delivery can reuse unchanged revisions. One revision per SourceModel per delivery; multiple SourceModels may share a discipline.
- Run snapshots delivery membership and pack version in one transaction before processing. Store run_models rows with revision IDs and hashes. Never reconstruct historical inputs from a mutable delivery.
- ObjectOccurrence is revision-specific. A public viewer reference includes opaque revisionId and objectId. IFC expressId and optional GlobalId stay in a source mapping shared by the worker and browser adapter. A persistent object match is scoped to SourceModel and only considered exact when the GlobalId is unique on both sides.
- Duplicate/missing/changed IDs are unresolved unless an explicit heuristic candidate is shown. Do not mark arbitrary pairings exact. Splits/merges remain unresolved in this prototype.
- Checks apply to explicitly selected SourceModels or disciplines. Evaluate per file and aggregate results; cross-model geometric rules are excluded. An intentionally excluded structural model does not create a missing-space failure.
- PackVersion contains IDS, rule metadata, source references, scope, and a supported-rule profile. Severity/category metadata is outside the IDS XML but part of the immutable pack digest.

User experience:
- Project shelf with delivery dates, included models, processing status, and run history.
- Review screen with a findings panel and combined viewer. Filters include source model, discipline, storey, object type, severity, and category.
- Severity bands precede categories. One row per distinct failed requirement; instances expand beneath it. Counts identify distinct objects where labelled as object totals, rather than adding duplicate memberships.
- A finding shows source requirement, expected/actual information, scope, affected count, and processing limitations. Selecting it can highlight all affected objects, not only the first embedded page of 25.
- Viewer supports selection, framing, isolation/reset, transparency, section cut, model visibility, and property inspection. Textual findings remain usable if geometry fails.
- Comparison includes added/removed objects, property changes, movement/rotation, shape fingerprints, and new/resolved/persistent findings. Use a shared camera with base/head toggle and change overlay. Display revision-qualified object details.
- Finding comparisons require the same pack version, scope semantics, and identical persisted check-profile digests. Otherwise ask for a rerun under matching settings; do not label engine changes model regressions.
- Use text as well as color for severity, change kinds, and incomplete results. Preserve Japanese property labels.

Fingerprint policy:
- Rust computes independent property, placement, shape, and combined BLAKE3 digests from normalized worker output. Store full digests internally.
- Normalize measures according to their dimensions and explicit units, including length, area, and volume. Sort unordered collections deterministically and retain meaningful list ordering.
- Shape fingerprint uses normalized local-coordinate tessellated triangles from fixed IfcOpenShell settings. Canonicalize triangle ordering and vertex cycles, not topology. Placement is separate and includes rotation.
- Initially round lengths to 0.1 mm and directions to 1e-6; version these settings. Quantization is not a guarantee that every pair within a tolerance shares a hash. Flag unsupported representations and do not use missing geometry as proof of unchanged shape.
- A different tessellation can still change the shape fingerprint. Label it 'Shape representation changed', not proof of physical geometry change across exporters.
- Recompute both sides under the same fingerprint profile before comparison. Cache by model hash plus worker/settings version.

### Must NOT have (guardrails, anti-slop, scope boundaries)

No Revit add-in/write-back, arbitrary Excel-to-IDS conversion, clash/code-compliance engine, regulatory approval labels, BCF round-trip, billing, production multi-tenancy, automated fuzzy identity acceptance, or public redistribution of restricted sample files. No product implementation during this planning turn.

## Verification strategy

Test decision: focused regression tests for the confirmed identity/unit/evidence bugs, then integration tests with each feature. Use existing cargo tests, Python worker tests, and browser-driven QA. Do not weaken the existing tests to hide failures.

New verification entrypoints named below are deliverables, not commands that already exist. Use .omo/evidence/modelshelf-prototype/ for logs, screenshots, timings, and manifests. Keep third-party inputs and user data out of commits.

Record CPU/GPU, RAM, browser version, model bytes, product count, and triangles for performance checks. Provisional acceptance on the recorded local machine: at least 30 FPS median during a scripted orbit, p95 selection response below 200 ms after load, filtering below 500 ms, and no UI-thread tasks above 200 ms during parsing. Cold initial geometry should be usable within 15 seconds on the selected three-discipline demo. Record peaks and failures honestly; these are prototype targets, not measured claims or universal hardware promises.

Verify a clean empty data directory, restart persistence, duplicate uploads, missing IFC geometry, corrupt input, worker crash, unsupported rule, mixed model units, duplicate GlobalIds, and more than 100 affected objects. A failed worker must never yield a clean scorecard.

## Execution strategy

### Parallel execution waves

The shared-contract task is newly numbered 11 to preserve existing task identities. It precedes its consumers. The baseline task may already be owned by another agent and remains independently executable.

Wave 1 establishes shared model contracts, a runnable base, revision contracts, the worker, demo evidence, and a measured viewer. Wave 2 completes the shelf, checking workflow, comparisons, and repeatable operation. Execute dependent tasks in order even within a wave; parallelize only disjoint owners with agreed contracts.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 11 | none | 2,3,5,8 | 1,4 source retrieval |
| 1 | none | 2,3,5,6 | 4 |
| 2 | 1,11 | 3,5,6,7,8 | 4 |
| 3 | 2 | 4 completion,5,7,8 | 4 source retrieval |
| 4 | 3 for final oracle checks | 5,7,8,10 | 1,2 and early 3 |
| 5 | 2,3,4 | 6,9,10 | none required |
| 6 | 2,5 | 7,9,10 | 8 |
| 7 | 3,4,6 | 9,10 | 8 |
| 8 | 2,3,4 | 9,10 | 6,7 |
| 9 | 5,6,7,8 | 10 | none |
| 10 | 1–9 | F1–F4 | none |

Preserve all current uncommitted work. Before changing the database, inspect whether any local data exists. Add a forward migration; do not reset an existing database. Use a versioned transactional migration runner in services/checker/src/db.rs. Preserve each legacy model ID as its revision ID. Give each legacy model row its own SourceModel named Legacy <discipline> <model-id>; do not infer cross-delivery lineage from discipline alone. Preserve deliveries and their existing member references. Mark every legacy run provenance_incomplete rather than fabricate historical run_models membership; it remains readable but cannot participate in trusted finding comparisons. New runs use the new snapshot tables. A failed migration rolls back and the next start retries without duplicate rows. Test both empty and populated databases.

## Todos

- [ ] 11. Publish shared model contracts and generated consumers
  What to do / Must NOT do: Follow the accepted module decision and shared-contract ticket. Create schemas/model-v1.schema.json, packages/model-contracts, generated Rust/Python bindings, and deterministic source-ID mapping fixtures. Define opaque ObjectRef, separate semantic/render payloads, source mappings, coordinates, capabilities, versions and hashes. Keep application/job envelopes and internal business types outside this scope. Do not implement a plugin framework or native-format adapters.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2,3,5,8. Number retained separately to avoid renumbering existing work; implement before consumers.
  References: docs/adr/0001-reusable-model-modules.md; .scratch/modelshelf-prototype/issues/18-shared-model-contracts.md; docs/contracts/worker-v1.md.
  Acceptance criteria and QA: New node scripts/generate-model-contracts.mjs --check verifies deterministic generated consumers and detects drift. New node scripts/verify-model-contracts.mjs passes real Python producer to Rust/TypeScript consumer checks, rejects invalid payloads, and verifies IFC/non-IFC identity fixtures. No app/database/rendering dependencies in shared contracts.
  Evidence: .omo/evidence/modelshelf-prototype/task-11.md with generation results, public exports, schema version and fixtures.
  Commit: N until authorized | feat(model-contracts): publish reusable model contracts

- [ ] 1. Restore the runnable service and freeze the baseline
  What to do / Must NOT do: Fix missing tokio-util IO and SQLx derive features; implement seed.rs with an idempotent demo tenant/project/pack creation path. Keep existing crate tests. Record baseline failures before edits. Establish README launch commands and empty-data-directory behavior. Own scripts/qa-harness.mjs here: allocate isolated ports and a temporary data directory, launch/stop service processes, seed deterministic self-authored fixtures, and preserve logs under the evidence directory. Lock Playwright as the browser-test driver in apps/web and let later verification entrypoints share this harness. Never rely on production user data or implicitly kill unrelated processes. Do not introduce cloud services.
  Parallelization: Wave 1 | Blocked by: none
  References: services/checker/Cargo.toml; services/checker/src/main.rs:16; services/checker/src/routes.rs; Cargo.toml; apps/web/package.json
  Acceptance criteria and QA: cargo test --workspace; cargo run -p modelshelf-checker -- --help; start serve on an unused localhost port and curl /api/health; run an unknown CLI command and confirm nonzero exit.
  Evidence: .omo/evidence/modelshelf-prototype/task-1.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(service-baseline): restore the runnable service and freeze the baseline

- [ ] 2. Model persistent sources, immutable revisions, and pinned run inputs
  What to do / Must NOT do: Add a forward migration for source_models, revision references, delivery membership, and run_models. A draft delivery may change until finalized; finalization and run input capture are transactional. Upload to a SourceModel, then attach its ready revision to a delivery. Consume generated opaque revisionId/objectId references from the shared model contract; keep source-specific IDs in mappings. Store hashes for IDS and metadata. Add tests for two MEP sources, unchanged revision reuse, immutable delivery edits, and upload/finalization races.
  Parallelization: Wave 1 | Blocked by: 1,11
  References: services/checker/migrations/0001_init.sql:43; services/checker/src/upload.rs:80; services/checker/src/run.rs:52; services/checker/src/dto.rs; docs/contracts/http-api.md; apps/web/src/lib/types.ts
  Acceptance criteria and QA: cargo test -p modelshelf-checker; new scripts/verify-api.mjs --scenario revisions proves reuse and rejects edits to finalized inputs. Migration verification preserves old rows and marks uncertain historical provenance.
  Evidence: .omo/evidence/modelshelf-prototype/task-2.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(revision-model): model persistent sources, immutable revisions, and pinned run inputs

- [ ] 3. Add the authoritative IFC/IDS worker and durable jobs
  What to do / Must NOT do: Create services/ifc-worker with pyproject.toml, a lockfile, typed request/result models, and tests. JSON protocol v1 takes operation, job ID, known input paths/hashes, scope, and settings; returns output manifest, versions, per-rule outcomes, diagnostics, and normalized object records. Rust validates responses and controls paths. stdout carries protocol/progress; stderr carries logs. No Python database writes. Add docs/contracts/worker-v1.md, schemas/worker-v1.schema.json, and golden request/result fixtures in this task. Invoke worker with --request <absolute-job-request.json>. stdout is newline-delimited JSON progress/events and a terminal result-manifest path; records carry protocolVersion=1 and jobId. Bulk objects/results live in hashed JSONL artifacts. Rust, Python, and TypeScript consume generated shared model payloads from the canonical JSON Schema; job envelopes reference those payloads. Rust and Python independently validate boundaries against golden valid/invalid fixtures. Separate semantic records from render artifacts joined by ObjectRef. Normalize measures as value, originalUnit, SI value, and dimension; placements are row-major 3x4 transforms in metres in the project frame; shape coordinates are object-local. Geometry status is available, absent, or unsupported with a reason. Mark collections ordered or unordered in the contract. Every artifact has size and SHA-256. Rust rejects mismatched job IDs, malformed/truncated streams, missing terminal records, nonzero exit, or hash mismatch. Add SQLite-backed queued/running/completed/failed jobs and polling endpoints. HTTP starts jobs with 202. Use bounded subprocesses and atomic artifact/result publication. Interrupted jobs become visibly failed after restart and can be retried idempotently. The Rust IDS engine is excluded from live scoring.
  Parallelization: Wave 1 | Blocked by: 2
  References: services/checker/src/state.rs; services/checker/src/upload.rs; services/checker/src/run.rs; crates/ids/tests/known-gaps.txt; https://docs.ifcopenshell.org/ifctester.html
  Acceptance criteria and QA: uv run --project services/ifc-worker pytest; cargo test -p modelshelf-checker; scripts/verify-api.mjs --scenario worker-failure checks valid/invalid IFC, invalid IDS, malformed worker response, crash/restart, and no false completed result.
  Evidence: .omo/evidence/modelshelf-prototype/task-3.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(worker-jobs): add the authoritative ifc/ids worker and durable jobs

- [ ] 4. Assemble Japanese demo models and traceable check packs
  What to do / Must NOT do: Download one BLCJ S1000 architectural/structural/MEP set locally with source revision, SHA-256, terms, and artifact manifest. Confirm actual IFC schemas and shared coordinates. Use only the three initial recommended references to author packs/demo v1 with 8–12 supported information checks, source citations, scope, severity, and category. Select fields after inspecting real exported properties; never invent standard mappings or mandatory rules. Add pack v2 with one documented requirement change. Generate separate small self-authored A/B fixtures covering add/remove/move/rotate/property/shape edits, ambiguous IDs, unsupported input, and 100+ repeated failures. Preserve source samples unchanged. Store expected outcomes explicitly.
  Parallelization: Wave 1 | Blocked by: 3 for final checks; source retrieval may start immediately
  References: references/bim-checking/README.md; references/bim-checking/manifest.json; samples/ifc/AC20-FZK-Haus.ifc; https://blcj.or.jp/archive_index/samplemodel/
  Acceptance criteria and QA: uv run --project services/ifc-worker pytest tests/test_demo_packs.py; verify every selected rule against independently documented fixture expectations; invalid/unsupported rules are rejected or incomplete, never silently passed.
  Evidence: .omo/evidence/modelshelf-prototype/task-4.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(demo-evidence): assemble japanese demo models and traceable check packs

- [ ] 5. Build and benchmark the combined viewer with qualified selection
  What to do / Must NOT do: Create packages/model-viewer with a framework-independent core, thin React export, standalone plain-browser example, and a ModelShelf test route consuming public exports. Use opaque revisionId/objectId references throughout. Keep IFC loading private and keep ModelShelf delivery/finding types out of the package. Process IFC in a dedicated browser worker; batch GPU geometry, share repeated geometry, bound pixel ratio, and release resources on unload. Preserve source transforms; use one shared origin offset for precision, never center disciplines independently. Add selection/isolation/reset, visibility, storeys, section cut, transparency, properties, and progress/error UI. Benchmark actual fixtures. If the initial web-ifc route misses targets, move geometry preparation to the Python geometry iterator, emit cached GLB chunks capped at 10,000 objects with an object mapping manifest, and reuse the same viewer contract. Verify the standalone example with all ModelShelf services stopped, including a prepared scene with non-IFC opaque IDs. Add import-boundary checks and verify intentional violations in temporary fixtures. Do not claim performance until measured. End Wave 1 with node scripts/verify-api.mjs --scenario first-loop: seed a delivery and tiny supported pack, start/poll a worker run, retrieve one grouped finding, page its affected objects, and use the viewer test route to highlight one revision-qualified object. This is a real integration gate, not a mock scorecard, and must pass before Task 6.
  Parallelization: Wave 1 | Blocked by: 2,3,4
  References: apps/web/src/components/viewer/types.ts:15; apps/web/src/app/globals.css; apps/web/src/lib/palette.ts; apps/web/public/wasm; apps/web/next.config.mjs
  Acceptance criteria and QA: New node scripts/verify-viewer.mjs launches browser tests using the local app; prove correct selection when revisions share GlobalIds, full finding highlight beyond 25 objects, coordinate alignment, missing geometry behavior, resource cleanup, and record the stated performance targets.
  Evidence: .omo/evidence/modelshelf-prototype/task-5.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(federated-viewer): build and benchmark the combined viewer with qualified selection

- [ ] 6. Build the project shelf and delivery workflow
  What to do / Must NOT do: Create layout.tsx, page.tsx, project/delivery routes, typed API client, and upload/progress controls. Keep Rust authoritative; Next only proxies API calls. Show multiple named sources per discipline and let a new delivery reuse unchanged revisions. Retain selected filters and clear context when switching deliveries. Draft/ready/failed states must have explicit recovery actions.
  Parallelization: Wave 2 | Blocked by: 2,5
  References: apps/web/src/app; apps/web/src/lib/types.ts; apps/web/src/lib/format.ts; docs/contracts/http-api.md
  Acceptance criteria and QA: npm --prefix apps/web run typecheck; npm --prefix apps/web run build; node scripts/verify-ui.mjs --scenario deliveries exercises create/upload/reuse/finalize/reload and invalid upload without losing other ready models.
  Evidence: .omo/evidence/modelshelf-prototype/task-6.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(delivery-shelf): build the project shelf and delivery workflow

- [ ] 7. Connect versioned checks to grouped findings and viewer
  What to do / Must NOT do: Implement run-start/poll/detail UI and pack-version selection. Display severity bands, categories, one row per failed rule, expected/actual values, source references, and all affected objects through a paged API. Preserve the separation between rule outcomes, distinct affected objects, and incomplete checks. Apply pack source-model scope before per-file evaluation. Validate metadata before pack publication rather than silently replacing malformed metadata with defaults. Keep findings interactive while geometry loads or fails.
  Parallelization: Wave 2 | Blocked by: 3,4,6
  References: services/checker/src/run.rs:374; services/checker/src/ids_meta.rs; apps/web/src/lib/types.ts; docs/contracts/http-api.md
  Acceptance criteria and QA: node scripts/verify-ui.mjs --scenario findings checks grouping of 100+ duplicates, severity ordering, scoped rules across disciplines, paged highlight, invalid metadata, no-match applicability, and visible incomplete results.
  Evidence: .omo/evidence/modelshelf-prototype/task-7.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(review-workflow): connect versioned checks to grouped findings and viewer

- [ ] 8. Harden fingerprints and revision comparison
  What to do / Must NOT do: Adapt Rust fingerprinting to normalized shared snapshots. Keep fingerprint and modeldiff crates independent of IFC parsing, database, and HTTP modules. Add dimension-aware numeric normalization, explicit unknown states, versioned profile, separate shape/placement/property hashes, and full stored digests. Canonical mesh fingerprints must ignore triangle emission order and STEP numbering; do not claim topology-independent equality. Pair only unique GlobalIds within the same SourceModel exactly. Return ambiguous match candidates without automatic acceptance. Match source revisions through delivery manifests; compare reused revisions without recomputation. Persist checkProfileDigest from canonical sorted JSON of protocol version, worker build, IfcOpenShell version, IfcTester version, and rule-scope semantics version. Compare actual scope selection by SourceModel IDs under the same pack digest. Persist fingerprintProfileDigest from worker extraction version, fingerprint algorithm/version, units policy, geometry settings, and quantization options. Finding mismatch returns 409 check_profile_mismatch or pack_version_mismatch; offer a new run, never mutate an old one. Model comparison mismatch returns 409 fingerprint_profile_mismatch until a new derived snapshot for both sides is computed under the current profile. Keep prior snapshots. Test each profile field and source-scope mismatch independently.
  Parallelization: Wave 2 | Blocked by: 2,3,4
  References: crates/fingerprint/src/lib.rs:163; crates/modeldiff/src/lib.rs:129; crates/modeldiff/src/heuristic.rs; services/checker/src/diff.rs
  Acceptance criteria and QA: cargo test -p fingerprint -p modeldiff; node scripts/verify-api.mjs --scenario comparisons proves unit equivalence for length/area/volume, changed property values, rotations, representation changes, duplicate IDs, unmatched objects, and settings mismatch rejection.
  Evidence: .omo/evidence/modelshelf-prototype/task-8.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(revision-comparison): harden fingerprints and revision comparison

- [ ] 9. Build the comparison review screen
  What to do / Must NOT do: Create delivery comparison route with base/head pickers, shared camera, revision toggle, and change overlay. Filter change kind/source/discipline/type; show before/after properties and new/resolved/persistent findings. Unchanged models stay contextual. Removed objects are selected from base geometry and added objects from head. Ambiguous matches and missing geometry have textual explanations. Do not color heuristic candidates as confirmed resolved findings.
  Parallelization: Wave 2 | Blocked by: 5,6,7,8
  References: apps/web/src/components/viewer/types.ts; services/checker/src/diff.rs; apps/web/src/lib/palette.ts; apps/web/src/lib/types.ts
  Acceptance criteria and QA: node scripts/verify-ui.mjs --scenario comparisons proves each controlled A/B change, identical GlobalIds on both sides, pack mismatch prompt, incomplete model behavior, and preserved camera/filter context.
  Evidence: .omo/evidence/modelshelf-prototype/task-9.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(comparison-ui): build the comparison review screen

- [ ] 10. Make the demo reproducible and verify the full journey
  What to do / Must NOT do: Provide one documented local launch sequence with exact locked dependencies, idempotent demo seeding, expected fixture counts, and stop/restart instructions. Update stale reference-library status and write docs/limitations.md with supported IFC/IDS profiles and shape-hash limitations. Run all tests, production build, browser scenarios, and full multi-discipline performance capture. No fabricated UI results or claimed speed from parser-only benchmarks.
  Parallelization: Wave 2 | Blocked by: 1–9
  References: README.md and scripts created by prior tasks; docs/contracts/http-api.md; references/bim-checking/README.md
  Acceptance criteria and QA: cargo test --workspace; uv run --project services/ifc-worker pytest; npm --prefix apps/web run typecheck; npm --prefix apps/web run build; node scripts/verify-api.mjs --scenario all; node scripts/verify-ui.mjs --scenario all; node scripts/verify-viewer.mjs. Restart services and verify prior runs/deliveries remain identical.
  Evidence: .omo/evidence/modelshelf-prototype/task-10.md plus referenced logs/screenshots. Record expected and actual results for the happy and failure paths above.
  Commit: N until authorized | feat(prototype-validation): make the demo reproducible and verify the full journey

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  Check every must-have against task evidence and the running demo. Reject unverified scope. Evidence: .omo/evidence/modelshelf-prototype/f1.md.
- [ ] F2. Code quality review
  Inspect final source and run complete build/test commands from task 10. Check worker boundaries, migration safety, immutable evidence, and data normalization. Evidence: .omo/evidence/modelshelf-prototype/f2.md.
- [ ] F3. Real manual QA
  Also drive the standalone viewer with ModelShelf services stopped and verify import boundaries. Drive delivery creation, checking, full affected-object selection, comparison, failure recovery, and restart in a real browser. Capture screenshots and timings. Evidence: .omo/evidence/modelshelf-prototype/f3.md.
- [ ] F4. Scope fidelity
  Verify source attribution, sample use restrictions, supported-profile wording, and absence of misleading compliance/geometry claims or unrequested platform scope. Evidence: .omo/evidence/modelshelf-prototype/f4.md.

## Commit strategy

Do not create commits, push, or open a PR without user authorization for that work. Task commit labels are suggested boundaries only. Keep current unrelated edits intact. Do not commit downloaded models, private databases, transcripts, or local evidence containing restricted content.

## Success criteria

A reviewer can run the prototype locally, open a combined building, filter models, run a source-backed pack, inspect grouped findings, select all affected objects, compare deliveries, and explain why a finding appeared or disappeared. Restarting the service preserves inputs and results. Known incomplete work is visible rather than counted as success.

All eleven implementation tasks and four verification tasks must pass before implementation is called complete. This document's completion does not imply those tasks have run.

Primary references: [IfcTester](https://docs.ifcopenshell.org/ifctester.html), [IfcOpenShell geometry processing](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html), and the locally saved reference library at references/bim-checking/README.md. These support the proposed worker; behavior and compatibility must still be tested on the locked versions.
