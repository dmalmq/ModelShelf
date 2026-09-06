# Publish shared model contracts across Rust, Python, and the browser

ID: 18
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: claude-code-session-013vF1LacyxtZHAHMb3iU6PT
Blocked by: none
Wave: 1
Original plan coverage: 11, approved reusable-module amendment

## Question

What shared contract lets independently implemented processors and viewers exchange objects without depending on IFC identifiers or ModelShelf business types?

## What to build

A versioned model-data contract and generated consumers that a Python producer, Rust consumer, and browser consumer can all validate using the same golden fixtures.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the accepted module decision](../../../docs/adr/0001-reusable-model-modules.md). This ticket establishes shared data only, not a viewer or an IFC importer. Preserve other agents' code. The baseline ticket may already be claimed; do not edit its service bootstrap or package locks without coordination.

## Prerequisites

None. Keep this work confined to new model-contract files and minimal standalone consumer tests. Existing app integration belongs to downstream tickets.

## Ownership

Shared model schema, model-contract package, generated Rust/Python bindings, deterministic generation script, and cross-language contract fixtures. Schema consumers must use public exports; no dependencies on app/server modules.

## Implementation boundaries

- Define ObjectRef as opaque revisionId/objectId strings. Define and test one deterministic IFC express-ID mapping in source metadata so independent worker/browser loaders produce the same occurrence references. Native GlobalIds remain optional and may be duplicated.
- Define semantic records and render manifests separately, joined by ObjectRef. Specify transforms, metres, axes, capabilities, artifact versions/hashes, and available/absent/unsupported/failed states.
- Use canonical JSON Schema for shared wire shapes. Generate TypeScript, Rust, and Python consumers; do not create three manually maintained definitions. Keep generator versions locked and the check reproducible.
- Keep application HTTP and worker job envelopes outside the shared model schema; later tickets reference shared payloads from those envelopes.
- Include non-IFC IDs and a small prepared scene as format-neutral fixtures. They demonstrate the contract, not native Revit/Archicad support.
- Add no microservices, generic plugin registry, auth system, or production viewer code.

## Acceptance criteria

- [x] Python writes a valid shared payload that Rust and TypeScript consume through generated types and boundary validation.
- [x] All three reject the golden invalid payloads, including wrong artifact version, malformed references, invalid transforms, and contradictory capability states.
- [x] Independent IFC source-ID mapping fixtures agree, and duplicated GlobalIds remain distinct occurrences.
- [x] Shared contracts have no app, database, Next.js, React, Three.js, or validation-engine imports.
- [x] Regeneration is deterministic; a generated-file edit makes the generation check fail.

## Verification

- Create `node scripts/generate-model-contracts.mjs --check` and a documented generation command.
- Create `node scripts/verify-model-contracts.mjs` to run real Python/Rust/browser-consumer fixture checks in isolated temporary directories.
- Record generator/dependency versions, fixture results, and expected rejection messages.

New commands above are implementation deliverables. Do not mark completion from a schema draft alone.

## Completion and handoff

Append an Answer with contract version, package exports, source-ID mapping, exact generation/check commands, evidence, and downstream migration notes. Set Status to resolved only after every criterion passes. Update the map with a named link. No commit/push/publication is authorized by this ticket alone.

## Comments

Added after the user approved reusable viewer modules on 2026-09-06. Existing ticket identities and claims remain unchanged.

## Answer

### What was built

Canonical JSON Schema (draft 2020-12) under `schemas/model/v1/`: `object-ref`, `transform`, `semantic-capability`, `render-capability`, `model-descriptor`, `semantic-model`, `render-manifest`, plus `README.md` (versioning policy, the express-ID mapping algorithm and its rationale) and `fixtures/` (golden valid/invalid payloads and the express-ID mapping table, shared by all three languages). `schemaVersion` is the literal `"model-v1"`.

Every capability (`semantic`/`render` artifact availability) is a `oneOf` keyed by a `status` const with `additionalProperties: false` per branch — `available | absent | unsupported | failed` are mutually exclusive by construction, not by a runtime check, which is what let this generate as a real discriminated union / tagged enum in all three languages (`principle-type-system-discipline`, `principle-model-the-domain`: illegal states unrepresentable rather than validated after the fact).

Generated consumers, one package per language, each with its own generation command, its own test suite against `schemas/model/v1/fixtures/`, and a README:

- `crates/model-contracts/` (Rust, new workspace member). Types generated by `cargo-typify` 0.7.0 from a *combined* single-document bundle of all seven schema files (built by `scripts/generate-model-contracts.mjs`; typify has no external-file-$ref support, and generating each root schema separately would have produced four structurally-identical-but-nominally-distinct `ObjectRef` types across four files — a real problem in a nominally-typed language, unlike TypeScript). `Deserialize` alone enforces almost everything (`#[serde(deny_unknown_fields)]`, pattern-validated newtypes via `regress`, `NonZeroU64` for `expressId`, internally-tagged enums for the capabilities). Two things typify does not encode from the schema needed a hand-written boundary check in `src/lib.rs`: `Transform.scale`'s `exclusiveMinimum` (typify emits plain `[f64; 3]` with no range check — Ajv and pydantic both enforce it correctly, so this is specifically a typify gap) and `ObjectRef.objectId` uniqueness within one `SemanticModel` (JSON Schema has no "unique by sub-key" keyword, in any of the three languages). `examples/consume.rs` is a small CLI `scripts/verify-model-contracts.mjs` drives to prove a real Rust consumer parses a file another language produced.
- `packages/model-contracts-py/` (Python, `uv`-managed, pinned to Python 3.12 like `services/ifc-worker`). Types generated by `datamodel-code-generator` 0.76.2 (pinned exact) into pydantic v2 models, from the same combined bundle. Pydantic enforces the full schema including numeric ranges (`PositiveFloat`, `conint(ge=...)`), so no boundary check was needed for the transform case here. `boundary.py` has the same `objectId`-uniqueness check as Rust; `express_id_mapping.py` implements the IFC express-ID mapping; `produce.py` is the "producer" — it builds valid payloads using this package's own generated models (not hand-authored JSON) and is registered as the `model-contracts-produce` console script. A test proves `produce.py`'s output equals the hand-authored golden fixtures exactly.
- `packages/model-contracts-ts/` (TypeScript, browser-safe — no Node-only API beyond `node:crypto`/`node:fs` used only in the mapping helper and the validator's schema loading, neither of which is browser-required functionality a future viewer would call in-browser). Types generated by `json-schema-to-typescript` 16.0.0 *per schema file* (not combined — TypeScript's structural typing means the small amount of duplicate `ObjectRef` interface text across generated files is harmless and never causes a type error, so the extra bundling machinery Rust/Python needed wasn't worth adding here: **Laziness Protocol**, same problem, cheaper fix). Validation is Ajv 8.20.0 (`Ajv2020`, for 2020-12 support) compiled at runtime directly from the canonical schema files, so there's one source of truth for the rules and no hand-maintained duplicate; `express-id-mapping.ts` implements the same mapping as Python's.

`scripts/generate-model-contracts.mjs`: regenerates all three (`node scripts/generate-model-contracts.mjs`) or checks for drift without writing (`--check`, used by `scripts/verify-model-contracts.mjs` and intended for CI). `scripts/verify-model-contracts.mjs`: one command that (1) calls the generate `--check`, (2) runs each language's own fixture test suite, (3) runs the real cross-language round trip — Python's `model-contracts-produce` writes payloads to an isolated temp dir, Rust's `consume` example and a small Node script (using the built TS package) each parse those exact files — and (4) greps each package for forbidden imports. `scripts/package.json` holds `@apidevtools/json-schema-ref-parser` (only used by the bundling step in `generate-model-contracts.mjs`; not a dependency of any of the three published packages).

`apps/web/package.json`'s `@playwright/test` from ticket 01 is untouched. Root `.gitignore` gained `.venv`, `__pycache__`, `*.egg-info` (`services/ifc-worker/.venv` was already sitting untracked and ungitignored before this ticket; adding these now, since this ticket adds a second `uv`-managed package, avoids a `git add` in a future ticket accidentally sweeping a venv into a commit — documented here as the owner of this small prerequisite fix, not silently folded into unrelated work) and `dist` (build output of `packages/model-contracts-ts`, distinct from its committed `src/generated/`). Root `Cargo.toml` gained the new workspace member and a `model-contracts` workspace-dependency entry (unused by any other crate yet, for whichever later ticket wires it in). Root `README.md` gained a "Shared model contract" section with the one-time setup and the two commands above.

### Interface for downstream tickets

Import `model-contracts` (Rust), `modelshelf-model-contracts` (Python, package name `model_contracts`), or `@modelshelf/model-contracts` (TypeScript). None of the three currently has any caller — this ticket was scoped to "new model-contract files and minimal standalone consumer tests" only, per its Prerequisites note. Ticket 03 (worker contract, now unblocked) is the natural first consumer on the Python/producer side; ticket 07 (combined viewer) and whatever wires the worker's output into the Rust service (02/04) are the natural consumers on the Rust/TypeScript side. `ObjectRef.objectId` for a real IFC adapter must use exactly `"occ_" + sha256(f"{revisionId}:{expressId}")[:16]` (`schemas/model/v1/README.md`); Rust does not implement or import that mapping by design (it only ever consumes `ObjectRef` opaquely per the ADR), so a Rust caller that needs to construct one from an express ID doesn't exist as a function to call — that's intentional, not an oversight.

### Commands and results

```
$ cargo install cargo-typify --version 0.7.0 --locked   # one-time; typify has no external-$ref support, only used to bundle+generate
$ npm install --prefix scripts && npm install --prefix packages/model-contracts-ts
$ uv sync --project packages/model-contracts-py

$ node scripts/generate-model-contracts.mjs --check
ok - typescript (packages/model-contracts-ts): generated files match schemas/model/v1 (no drift)
ok - rust (crates/model-contracts/src/generated.rs): up to date
ok - python (packages/model-contracts-py/src/model_contracts/generated.py): up to date

$ node scripts/verify-model-contracts.mjs
ok - regeneration is deterministic (no drift)
ok - rust fixture test suite (cargo test -p model-contracts)
ok - python fixture test suite (pytest)
ok - typescript fixture test suite (node --test)
ok - python producer writes payloads
ok - rust consumes Python's produced model-descriptor
ok - rust consumes Python's produced semantic-model
ok - rust consumes Python's produced render-manifest
ok - typescript consumes Python's produced model-descriptor
ok - typescript consumes Python's produced semantic-model
ok - typescript consumes Python's produced render-manifest
ok - typescript package has no app/React/Next/Three imports
ok - rust crate has no ids/sqlx/axum imports or dependencies
ok - python package has no ifcopenshell/ifctester/database/web-framework imports
all checks passed

$ cargo test --workspace   # unaffected pre-existing crates still pass; model-contracts: 7 passed
$ node scripts/qa-harness.mjs   # ticket 01's harness, re-run to confirm no regression from Cargo.toml/.gitignore edits: all checks passed
```

Manually confirmed the negative case: appending a line to the committed `crates/model-contracts/src/generated.rs` makes `generate-model-contracts.mjs --check` fail with `FAIL - rust ...: drift`, then regenerating restores a clean check.

Evidence: `.omo/evidence/modelshelf-prototype/task-11/run-<timestamp>/` (`generate-check.log`, `rust-test.log`, `python-test.log`, `typescript-test.log`, `produce.log`, `rust-consume.log`, `ts-consume.log` — one directory per `verify-model-contracts.mjs` run; used plan-coverage item 11's evidence slot since this ticket has no `task-N` number from the original ten-item plan).

### Limits and downstream notes

- No caller exists yet (see above) — this is data-shape plumbing only, exactly as scoped.
- The Rust and Python generators both consume a *combined* schema bundle assembled on the fly (`generate-model-contracts.mjs`'s `buildCombinedSchema`), not the per-file schemas directly; the per-file schemas under `schemas/model/v1/*.schema.json` remain the actual source of truth and the only thing a human should ever edit. Regenerating after any schema edit requires the three prerequisites above (`cargo-typify`, `scripts`/`model-contracts-ts` npm installs, `uv sync`) to already be present locally; none of them are installed by `generate-model-contracts.mjs` itself, which fails with a clear "not found on PATH" message rather than a bare spawn error if one is missing.
- typify's numeric-range gap (see above) is the one place Rust needed an extra hand-written check beyond what Python/TypeScript needed; if a future schema edit adds another numeric-range constraint, it will silently NOT be enforced in Rust unless a matching boundary check is added by hand — `check_positive_scale` in `crates/model-contracts/src/lib.rs` is the template for how to add one, and `every_invalid_schema_fixture_is_rejected` in each language's test suite is the tripwire that will fail (as `bad_transform` did before the fix) if a new invalid fixture exposes the same gap.
- "no ... validation-engine imports" in this ticket's acceptance criteria was interpreted as ModelShelf's own IDS/checking engine (`crates/ids`, `ifcopenshell`/`ifctester`) per the ADR's module-ownership table, not as "no JSON-Schema validator" — Ajv (TypeScript) and pydantic (Python) are themselves generic schema/validation libraries the ADR explicitly calls for ("Export boundary validators and validate external data once on ingress"). Flagging this reading explicitly in case a later reviewer expected something stricter.
- `packages/model-contracts-ts/dist/` and Python's `.venv` are gitignored build/tooling output, not part of what a future ticket needs to touch; only `src/generated/*.ts`, `src/*.ts`, `src/model_contracts/generated.py`, and the hand-written `.py` files are meant to be edited/reviewed.
