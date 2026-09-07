# Inspect IFC through a verified worker contract

ID: 03
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
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

- [x] Worker artifact references use the shared occurrence IDs and include the source mapping needed by the browser IFC loader; semantic extraction can run without geometry.

- [x] A real IFC yields inspect artifacts whose record counts, byte sizes, and hashes are verified.
- [x] Request/job/revision identity is preserved; invalid input or hash mismatch exits nonzero without a successful terminal result.
- [x] Golden fixtures validate against the JSON Schema and Python model. Unknown units retain raw evidence without invented SI values.
- [x] No worker database access or external network access is required to inspect a local model.

## Verification

- uv run --locked --project services/ifc-worker pytest
- uv run --locked --project services/ifc-worker ifc-worker --request <absolute-test-request.json>
- Test missing fields, wrong hashes, malformed IFC, empty/missing geometry, unit dimensions, and stdout framing.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

2026-09-07: reopened by [tickets-01-05.md](../../../docs/reviews/tickets-01-05.md). SI prefix exponent, render-instance placement, and IFC2X3 type inheritance are implemented in this wave. Remaining: property persistence round-trip at the API (ticket 04).

## Answer

### What was built

`services/ifc-worker/src/ifc_worker/`, implementing `operation: inspect` from `docs/contracts/worker-v1.md`, plus one contract addition (see below):

- `protocol.py` — pydantic models for the request envelope and the NDJSON stdout events (`Request`, `ProgressEvent`, `ResultEvent`, `Manifest`, `ArtifactRef`/`Artifacts`/`Versions`). `Request` rejects `operation: "validate"` without `ids` at parse time (a `model_validator`), and rejects unknown fields/operations — invalid requests never reach extraction.
- `records.py` — the JSONL line-item shapes (`ObjectRecord`, `PropertyRecord`, `Geometry`, plus `OutcomeRecord`/`Failure` for the not-yet-implemented `validate` path). `ObjectRecord.ref` is `model_contracts.ObjectRef` (see contract addition below).
- `properties.py` / `units.py` — walks `IfcPropertySet`/`IfcElementQuantity` into `PropertyRecord`s. Per-property SI normalization (`originalUnit`/`siValue`/`dimension`) only runs for length/area/volume measures; every other measure type (thermal, mass density, angle, boolean, label, ...) keeps its raw value with `dimension: null`, both because that's what the contract asks for and because IfcOpenShell's own unit-resolution helpers are unreliable (one derived-unit path genuinely crashes) outside that scope — see the module docstring for the concrete case that drove this.
- `placement.py` — `ObjectPlacement` → 12 numbers, row-major 3x4, via `ifcopenshell.util.placement.get_local_placement`.
- `geometry.py` — `available`/`absent`/`unsupported`, never collapsed: `absent` only when `Representation is None`; `unsupported` covers both a triangulation failure and `settings.geometry: false` (every object explicitly marked unsupported, not silently skipped, per the contract's "geometry-disabled extraction is unsupported").
- `inspect.py` — orchestrates one job: verify path + recompute sha256 (never trust the caller's hash), open the file, extract every `IfcProduct`, write `objects.jsonl` + an empty `outcomes.jsonl` atomically (temp file + rename, same directory), write `manifest.json`.
- `cli.py` — `ifc-worker --request <path>`. Stdout carries only NDJSON (progress lines, then exactly one `result` line last); every failure path (bad JSON, pydantic validation error, missing model file, hash mismatch, unparseable IFC, unexpected engine exception) prints to stderr and exits nonzero **before** any result line is written.
- `docs/contracts/worker-v1.md` — updated in place (see next section).

### Contract addition: shared occurrence ID

`worker-v1.md` (written before ticket 18) had no notion of the shared model contract. Ticket 03's own acceptance criterion #1 ("Worker artifact references use the shared occurrence IDs") requires it, so `ObjectRecord` now also carries `ref: model_contracts.ObjectRef`, computed via that package's `express_id_to_object_id(revisionId, expressId)` — the exact same function `packages/model-contracts-ts` and a future browser IFC loader would use, so three independent implementations never need to agree by coincidence. `services/ifc-worker/pyproject.toml` now depends on `modelshelf-model-contracts` via `[tool.uv.sources]` path dependency on `packages/model-contracts-py`. `expressId`/`globalId` stay in the record as the "source mapping" the contract still asks for, so a consumer can independently verify or recompute `ref.objectId`. I updated `worker-v1.md`'s Object records paragraph to document `ref` in place, rather than leaving the wire format silently out of sync with what the worker actually emits.

One boundary-text sentence I did **not** implement literally: "Emit independently loadable semantic records and render artifacts joined by opaque ObjectRef" could read as "ship two separate JSONL files (semantic + render)," splitting from `worker-v1.md`'s single combined `objects.jsonl` with per-object embedded `geometry`. I kept the single-artifact shape `worker-v1.md` specifies field-by-field (and which this ticket's own verification section cites verbatim), and read "independently loadable" as satisfied at the capability level: `settings.geometry: false` gets you semantics without geometry cost, and geometry's status is always an explicit, distinguishable enum rather than folded into presence/absence of a file. Flagging this reading explicitly in case a later ticket (07, the combined viewer) needs the literal two-file split instead — that would be a `worker-v1.md` v2 change, not a v1 bug.

### Commands and results

```
$ cd services/ifc-worker && uv run --locked pytest -q
..............................
30 passed in 14.27s

$ uv run --locked --project services/ifc-worker pytest -q   # from repo root, exactly as this ticket's verification lists it
............................................
44 passed in 14.46s
```
The 44-vs-30 difference is `uv run --project X` selecting X's dependency environment without changing the pytest process's CWD; from repo root, with no ini file discoverable at that CWD, pytest's default (recursive) collection also picks up `packages/model-contracts-py`'s own 14 tests (which pass — nothing wrong, just broader than "only ifc-worker"). Run from inside `services/ifc-worker` (or `uv run --project services/ifc-worker pytest tests`) for the precisely-scoped 30.

```
$ uv run --locked --project services/ifc-worker ifc-worker --request <real-request.json>
{"protocolVersion":1,"jobId":"...","event":"progress","stage":"verifying"}
{"protocolVersion":1,"jobId":"...","event":"progress","stage":"loading"}
{"protocolVersion":1,"jobId":"...","event":"progress","stage":"extracting"}
{"protocolVersion":1,"jobId":"...","event":"progress","stage":"writing"}
{"protocolVersion":1,"jobId":"...","event":"result","manifest":{...}}
exit 0
```
Against the real restricted sample (`samples/ifc/AC20-FZK-Haus.ifc`, IFC4, 127 `IfcProduct`s): `objects.jsonl` has exactly 127 records (`recordCount` in the manifest matches an independent `wc -l`, and the manifest's `sha256`/`size` match an independent re-hash/`stat` of the file — not just "the field says so"); every `expressId` and every `ref.objectId` is distinct across all 127; a wall's `BaseQuantities.Length` resolves to `originalUnit: "m", dimension: "length", siValue == value` (project is already metric); `IfcBuildingStorey`/`IfcVirtualElement` objects report `geometry.status: "absent"` while walls report `"available"` with real vertex/triangle data; `settings.geometry: false` makes every object report `"unsupported"`.

Failure paths, each exits nonzero with **no** result line on stdout: wrong hash, missing model file, malformed IFC (`this is not an IFC file` → IfcOpenShell's own parse error, exit 1), missing required request field, `validate` without `ids` (pydantic rejects at parse time), `validate` with `ids` (explicitly rejected as not-yet-implemented, exit 2 — see below), unparseable request JSON.

```
$ cd services/ifc-worker && uv run ruff check src tests && uv run ruff format --check src tests && uv run basedpyright src tests
All checks passed!
18 files already formatted
0 errors, 0 warnings, 0 notes
```
`select = ["ALL"]` (ruff) and `typeCheckingMode = "all"` (basedpyright) were present in `pyproject.toml` before this ticket but unconfigured (276 and 59 raw findings respectively). Curated both to a baseline this codebase can actually honor: dropped rules that fight this project's real conventions (blanket per-function docstrings/copyright headers nothing else in the repo follows, camelCase wire fields, a CLI's legitimate `print()`, `assert` in pytest tests) or are fundamentally incompatible with IfcOpenShell's dynamically-typed C++ bindings (`typeCheckingMode: all`'s `reportAny`/`reportUnknownMemberType` fire on essentially every attribute access on an `entity_instance`); fixed everything else for real (line wrapping, `TYPE_CHECKING`-gated imports, `os.replace` → `Path.replace`, a manual loop → list comprehension, a magic number, two missing `result_event is not None` narrowings). Two `pyright: ignore` and one `noqa` remain, each commented with the specific IfcOpenShell/stub gap that makes the tool wrong, not the code.

### Limits and downstream notes

- `operation: "validate"` is defined in the wire format and rejected loudly (exit 2, clear stderr message) rather than implemented — IDS/`ifctester` wiring is explicit future scope (ticket 06's "Run scoped IDS checks"), not a silent gap. `OutcomeRecord`/`Failure` models exist so 06 has the target shape; `outcomes.jsonl` is written empty for every `inspect` job today.
- Property/quantity extraction is scoped to `IfcPropertySingleValue` and `IfcPhysicalSimpleQuantity` — confirmed to be 100% of what the real sample file actually uses (zero `IfcPropertyEnumeratedValue`/`ListValue`/`BoundedValue`/`TableValue`/`ComplexProperty` instances). Anything else is skipped with a diagnostic recorded in the manifest's `diagnostics` array, not silently dropped or guessed at; a future delivery using those property types will need that handling added, with its own real fixture.
- SI normalization covers length/area/volume only, matching the contract; a `NonPositiveScale`-style gap does **not** apply here (unlike the Rust model-contracts crate) since pydantic's own `PositiveFloat`-equivalent isn't in play — there's no analogous typify-style stub gap on the Python side for this ticket's scope.
- No performance/scale testing was done beyond the one real sample (127 objects, ~2.5MB IFC); a much larger delivery's extraction time and `objects.jsonl` size are unmeasured.
- Concurrent session note: `.scratch/modelshelf-prototype/issues/18-shared-model-contracts.md` (already resolved by this same session earlier) and `docs/adr/0001-reusable-model-modules.md` were both read as prerequisites; no other concurrent edits were observed in `services/ifc-worker/` or `docs/contracts/worker-v1.md` during this ticket.

## Review corrections — 2026-09-07

Reopened by review. The historical Answer above is retained; completion requires the corrections below. Read [the review through ticket 05](../../../docs/reviews/tickets-01-05.md) and [the earlier follow-up](../../../docs/reviews/tickets-01-03-follow-up.md) for evidence and verification.

- [ ] Fix prefixed area/volume conversion (square/cubic millimetres).
- [ ] Include SI object placement in independently loadable render artifacts; test world-coordinate alignment without semantic bytes.
- [ ] Extract IFC2X3 inherited type properties as well as IFC4 properties.

Coordinate shared schema and jobs.rs edits with the owners of related tickets. Append new evidence and close only after these checks pass.
