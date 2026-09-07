# Prepare reproducible Japanese and synthetic demo evidence

ID: 05
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: unassigned
Blocked by: none
Wave: 1
Original plan coverage: 4

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

An agent can reproduce the planned three-discipline building demo and known pass/fail/change cases without inventing expected outcomes.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

None. This ticket is on the initial frontier.

## Ownership

Ignored third-party downloads, source manifests, self-authored IFC fixture generator, demo pack specifications/metadata.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Acquire the BLCJ S1000 architectural, structural, and MEP IFC samples through the official pack. Preserve originals, URLs, dates, hashes, usage terms, schemas, and alignment facts.
- Author 8–12 information checks from the first three saved reference collections after inspecting actual IFC properties. Record source references, mappings, scope, priority, category, and why each demo requirement applies.
- Produce v1/v2 packs with one explained rule change and self-authored A/B fixtures covering 100+ repeated failures, additions/removals, property/shape/move/rotation changes, and ambiguous IDs.

## Acceptance criteria

- [x] Acquisition is checksum-verifiable and repeatable. Restricted source archives remain ignored and are not redistributed.
- [x] The three models align under documented shared-coordinate treatment; any required transform is explicit and evidenced.
- [x] A machine-readable oracle lists exact expected results for every synthetic requirement/change.
- [x] No reference-dictionary field is called universally mandatory; native parameter names are not assumed to equal IFC names.

## Verification

- Create scripts/fetch-demo-models.mjs and scripts/generate-demo-fixtures.py.
- Inspect real models with the locked worker environment once available, or an isolated pinned IfcOpenShell environment.
- Validate IDS XML and independently inspect each synthetic oracle case; validation integration is completed by the scoped-check ticket.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

### Acquisition: real BLCJ S1000 samples

`scripts/fetch-demo-models.mjs` downloads the three real BLCJ S1000 ("S造1000㎡事務所モデル", a steel-frame ~1,000 m² office building — one of BLCJ's two official BIM-plan-review sample buildings) discipline exports whose URLs were read directly off the official page saved at `references/bim-checking/downloads/03-blcj-mapping/source-and-terms.html` (`https://blcj.or.jp/archive_index/samplemodel/`) — architecture (GLOOBE), structure (Revit/SS7), MEP (Rebro), each the smallest archive BLCJ publishes per discipline confirmed (by unzipping it) to bundle a real IFC export. Each archive's SHA-256 is pinned in the script; a re-run reuses an already-verified archive and hard-fails on any hash mismatch (verified: ran twice, identical hashes both times). Only the `.ifc` file is extracted, into `samples/ifc/blcj-s1000-{architecture,structure,mep}.ifc` (already gitignored by the existing root `.gitignore` pattern). The archives themselves, and BLCJ's usage terms (redistribution prohibited — see `samples/blcj-s1000/README.md`), are recorded in `samples/blcj-s1000/manifest.json` (tracked) with the raw archives under `samples/blcj-s1000/downloads/` (gitignored, mirroring `references/bim-checking/.gitignore`'s existing pattern for the same reason).

### Alignment

`samples/blcj-s1000/alignment.md` documents the finding, with real evidence: **no transform is required** — the three files (all IFC2X3, all millimetres) already share one coordinate frame. Evidence: whole-model bounding boxes overlap almost exactly across all three files; every shared storey elevation (1F/2F/3F/roof) lands on the identical Z value between the architecture and structure files; architecture's and structure's independently-modeled column grids coincide exactly at X=4200mm and X=13000mm. One red herring was caught and documented: the structure file's `IfcSite`/`IfcBuilding` report a `(-1000,-1000,0)` mm offset that does **not** propagate to its actual elements (columns etc. resolve to the same coordinates as architecture/MEP regardless) — a naive alignment based on `IfcSite`'s own placement would have introduced a spurious 1m offset.

### 11 information checks, from real inspected properties (v1 → v2)

`packs/demo/blcj-s1000-v1.ids` (11 specifications) and `blcj-s1000-v2.ids` (one explained rule change) plus `blcj-s1000-v{1,2}.metadata.json` (severity/category triage, `ids_meta.rs`'s schema). Full traceability — source document, real IFC property, scope, priority, category, and why each applies, plus real evaluation results — is in `packs/demo/checks.md`. Every property name was confirmed present (or confirmed absent) by directly dumping real property sets from the three files first; nothing was assumed from the mapping-table documentation alone. Two examples of what that inspection actually found: `NominalHeight`'s real dataType is `IFCLENGTHMEASURE`, not the `IFCPOSITIVELENGTHMEASURE` a buildingSMART-idiomatic guess would use; and doors/windows in this real GLOOBE export carry **zero** fire-rating data anywhere (occurrence or type level, all 78 instances checked), even though BLCJ's own mapping table lists "防火性能" as a GLOOBE-native parameter — kept as spec 5, deliberately, as an honest demonstration of a real, fully-confirmed gap.

The one explained v1→v2 change: v1's "MEP flow segment records its outer diameter" unconditionally required the property on every `IfcFlowSegment` and failed 150/1337 real instances; inspecting those 150 failures showed all were cable-tray segments (`Description = 電気.ケーブルラック`), which are rectangular and have no diameter by design. v2 narrows applicability (combined `<entity>` + `<attribute>` facets in one `<applicability>`) to exclude that family — confirmed via real evaluation that `applicable` drops from 1337 to exactly 1294 (exactly the 43 cable trays, nothing else), leaving 107 honest remaining failures (rectangular ducts, dual-diameter refrigerant pipe pairs).

Verified via a new, reusable dev tool, `cargo run -p ids --example evaluate_pack -- <pack.ids> <model.ifc>...` (parses the pack, runs `ids::evaluate` against real parsed models, no service/database/worker involved — exactly ticket 05's own verification note that full HTTP integration is a later ticket's job). Real results for both pack versions against all three real files: `.omo/evidence/modelshelf-prototype/task-5/evaluate-v{1,2}-real-models.txt`.

### Self-authored synthetic A/B fixtures + oracle

`scripts/generate-demo-fixtures.py` (uses `ifcopenshell`'s Python API, not any download) produces `packs/demo/fixtures/{base,head}.ifc` — 138–141 objects each — and `packs/demo/fixtures/oracle.json`, covering every category asked for: 120 identical, unchanged "repeated failure" walls (a persisting finding, once run through `packs/demo/fixtures.ids`'s one check); 3 additions; 3 removals; 3 property changes; 3 shape changes; 3 moves (500mm translation); 3 rotations (30°, zero translation); a duplicate-GlobalId pair; and an empty-GlobalId object. Every classification in the oracle was independently verified against the real pipeline via a second new dev tool, `cargo run -p modeldiff --example diff_fixtures -- <base.ifc> <head.ifc>` (parses both files, fingerprints, runs `modeldiff::diff` — no service involved), and the 120-repeat/135-total grouped, persisting finding was verified via `evaluate_pack` against `packs/demo/fixtures.ids`.

**Building this fixture found and fixed a real, previously-undiscovered bug** in `crates/modeldiff/src/heuristic.rs::origin()`: it read a placement array assuming an interleaved row-major-3x4-with-translation-per-row layout (indices `[3,7,11]`), but `ifc_model::Transform::to_array12()`'s actual, documented layout is three axis vectors then the origin (`[9,10,11]`). This was invisible to the crate's own 14 unit tests because their `placement_at()` test helper constructed arrays by hand in the same wrong convention — internally consistent, never checked against a real parsed file. The bug made a real 500mm move report as "unchanged" and a pure rotation (zero translation) report as "moved" — both inverted from the code's own doc comments. Fixed as a necessary prerequisite (owner: this ticket): corrected `origin()`'s indices, updated its doc comment, and fixed `crates/modeldiff/tests/diff.rs`'s `placement_at()` to the correct layout — all 14 pre-existing tests still pass, now against a correctly-encoded fixture (`.omo/evidence/modelshelf-prototype/task-5/modeldiff-tests-after-fix.txt`). Also found and fixed, in the fixture design itself (not a code bug): giving "Added"/"Removed" objects the same generic shape as everything else let the heuristic matcher (40% shape + 30% placement + 20% properties + 10% name, floor 0.6) coincidentally score them as "the same object" via shape+properties alone (exactly 0.6) — fixed by giving every category a block size unique across the whole fixture, now documented as a requirement in the generator's own docstring.

Full narrative, category table, and both discoveries: `packs/demo/fixtures/README.md`.

### Commands and results

```
$ node scripts/fetch-demo-models.mjs                 # idempotent; verified twice, identical hashes
$ services/ifc-worker/.venv/bin/python3 scripts/generate-demo-fixtures.py
wrote .../base.ifc, .../head.ifc, and oracle.json (142 tracked objects)
$ cargo test -p modeldiff                            # 14/14 pass, after the heuristic.rs fix
$ cargo run -p modeldiff --example diff_fixtures -- packs/demo/fixtures/base.ifc packs/demo/fixtures/head.ifc
summary: added=3 removed=3 unchanged=129 moved=3 shape_changed=3 properties_changed=3 mixed=0 uncertain_matches=4
$ cargo run -p ids --example evaluate_pack -- packs/demo/fixtures.ids packs/demo/fixtures/base.ifc packs/demo/fixtures/head.ifc
[Fail] Wall declares a fire rating — applicable=138 pass=3 fail=135 (both base and head; a persisting finding)
$ cargo run -p ids --example evaluate_pack -- packs/demo/blcj-s1000-v1.ids samples/ifc/blcj-s1000-*.ifc
... 11 specs, real pass/fail counts as documented in packs/demo/checks.md
$ cargo test --workspace                              # full workspace, all green (including 3 new db.rs tests
                                                       # from a concurrent session's ticket, landed mid-flight)
```

Evidence: `.omo/evidence/modelshelf-prototype/task-5/` (`evaluate-v1-real-models.txt`, `evaluate-v2-real-models.txt`, `evaluate-fixtures.txt`, `diff-fixtures.txt`, `modeldiff-tests-after-fix.txt`, plus `alignment/` with the coordinate-inspection scripts and their real raw output).

### Files changed

- `scripts/fetch-demo-models.mjs`, `scripts/generate-demo-fixtures.py` (new).
- `samples/blcj-s1000/{README.md,alignment.md,manifest.json,.gitignore}` (new, tracked); `samples/ifc/blcj-s1000-*.ifc` (new, gitignored).
- `packs/demo/{README.md,checks.md,blcj-s1000-v1.ids,blcj-s1000-v2.ids,blcj-s1000-v1.metadata.json,blcj-s1000-v2.metadata.json,fixtures.ids}` (new); `packs/demo/fixtures/{README.md,base.ifc,head.ifc,oracle.json}` (new).
- `crates/ids/examples/evaluate_pack.rs`, `crates/modeldiff/examples/diff_fixtures.rs` (new, reusable dev tools).
- `crates/modeldiff/src/heuristic.rs` (bug fix, see above), `crates/modeldiff/tests/diff.rs` (test helper fix to match), `crates/modeldiff/Cargo.toml` (added `ifc-model` as a dev-dependency for the new example).

### Limits and downstream notes

- Only one authoring-tool variant per discipline was acquired (GLOOBE/Revit-SS7/Rebro); BLCJ publishes several others (Archicad, Vectorworks, other MEP tools) as separate, larger archives, deliberately out of scope here.
- The metadata JSON files were structurally reviewed against `ids_meta.rs`'s schema but not yet exercised live through `POST /api/packs/:packId/versions` (that requires wiring these packs into an actual pack/tenant, which is downstream of this ticket — "validation integration is completed by the scoped-check ticket" per this ticket's own verification note).
- The rotation-without-translation behavior documented in `packs/demo/fixtures/README.md` (a pure rotation is reported `unchanged`, not `moved`) is a real, verified, *unfixed* design limitation, left for a future ticket to decide whether orientation change alone should count as "moved" — distinct from the indexing bug above, which was fixed.
- Concurrent session note: while this ticket was in progress, another session made substantial changes to the worker protocol (bumping to protocolVersion 2, replacing `objects.jsonl`/`ObjectRecord` with `model_contracts` `SemanticModel`/`GeometryChunk` types) and to `services/checker/src/jobs.rs`/`scripts/fixtures/fake-worker.mjs` to match, plus added 3 new `db.rs` migration tests. This ticket's own verification deliberately bypassed the worker/HTTP pipeline entirely (using `ifc_model`/`fingerprint`/`modeldiff`/`ids` directly, per this ticket's own stated verification boundary), so it was unaffected; ran the full workspace test suite after their changes landed to confirm no interaction. Also independently fixed one syntax collision in `docs/contracts/http-api.md`'s numbered rule list caused by both sessions editing it concurrently (documented in ticket 04's Answer, not repeated here).

## Review corrections — 2026-09-07

Reopened by review. The historical Answer above is retained; completion requires the corrections below. Read [the review through ticket 05](../../../docs/reviews/tickets-01-05.md) and [the earlier follow-up](../../../docs/reviews/tickets-01-03-follow-up.md) for evidence and verification.

- [x] Make the oracle enumerate exact IDS outcomes and affected membership: 135 failing walls per revision, not only the 120 repeated group; correct distinct tracked count to 141.
- [x] Record intended rotation changes and ambiguous match confidence independently of current flawed engine behavior.
- [x] Correct diameter failure rationale: 62 ducts, 45 pipes, 43 cable trays; v2 excludes only those 43 trays.
- [x] Preserve first retrieval dates on verified-cache reruns; record verification time separately.
- [x] Make fixture regeneration deterministic and isolated; fix root invocation documentation.

### 2026-09-07 correction

Oracle schema `demo-fixtures-oracle-v2` uses wall names as stable keys. IfcTester is the authority for affected sets (135 fail / 3 pass per revision). Rotations are intended `moved` with `engineLimitation.modeldiff = unchanged`. Duplicate and empty GlobalIds are `intendedCorrespondence: uncertain`. Tracked object count is 141.

Generator: `uv run --project services/ifc-worker python scripts/generate-demo-fixtures.py [--output-dir DIR]`. Seeded GUIDs and frozen IFC timestamps. Checker: `python scripts/check-demo-oracle.py --prove-regen`.

Pack-change writeup in `packs/demo/checks.md` corrected to 62 ducts, 45 pipes, 43 trays.

`scripts/fetch-demo-models.mjs` keeps the original `retrievedAt` on cache hits and writes `lastVerifiedAt`.

Evidence: oracle checker stdout in this session; `verify-api` revisions/worker-failure after the property and lifetime follow-ups.

Coordinate shared schema and jobs.rs edits with the owners of related tickets. Append new evidence and close only after these checks pass.
