# Completion audit, 2026-09-15

This is an independent F1 to F4 audit of the ModelShelf prototype on product
SHA `72ee471e34b1d978b65226aecb60f778ceb7ff9b`. Last runtime change is
`d0b07b3` (PR 71). PR 72 only updates tracker tables. Commands are the live
`scripts/*.ts` names. Plan files that still say `.mjs` are stale. The review
loop is evidenced on this SHA. Plan text still says all four categories must
pass. They did not.

Per-run machine, browser, and inputs land locally under
`.omo/evidence/modelshelf-prototype/` (gitignored). Command logs from this
audit are in `.omo/evidence/modelshelf-prototype/ticket-17/`.

## Recorded setup

| Item | Value |
|---|---|
| Date | 2026-09-15 |
| Product SHA | `72ee471e34b1d978b65226aecb60f778ceb7ff9b` |
| Last runtime SHA | `d0b07b3` (PR 71). PR 72 is tracker-only |
| Machine | Linux x64, 4 CPUs, ~16 GiB RAM, no `/dev/dri` |
| Browser | Chromium 153.0.8010.12, viewport 1440×900 |
| GPU | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` |
| Inspection scene | 5275 objects, 692230 triangles, BLCJ bytes 85805060 |

## Verdicts

| Category | Result |
|---|---|
| F1 Plan compliance | outstanding failure |
| F2 Code quality | pass |
| F3 Reviewer journey | pass with notes |
| F4 Scope fidelity | pass with notes |

## F1. Plan compliance

**Result.** Outstanding failure.

Architecture, structure, and MEP revisions ingest. A versioned pack run groups
findings. The combined 3D view highlights a 107-member flow-segment finding.
Delivery-to-delivery comparison runs. Exact run inputs are pinned. New runs
report `complete` provenance. The demo pack is 11 checks in `packs/demo`.
Generated contracts match the schemas. The second consumer is in-repo
`packages/model-viewer/example/`. It loads the public core with checker,
worker, and Next.js not started. `ObjectRef` stays two opaque strings.
Cross-revision match is a unique GlobalId on both sides of the same
`source_model_id`. Fingerprints describe state under `fp-v1`. The worker job
envelope is protocol 2. IfcTester scores live IDS. `crates/ids` is parse-only
on the service path. Native `.rvt` and `.pln` import is not claimed.

Comparison has seven kinds and no `Rotated` kind. In-place rotation is
`moved`, distance 0 m, with a placement-basis note. Sub-threshold origin shift
stays `unchanged` only when the basis is identical.
`node scripts/verify-api.ts --scenario comparisons` observed that on this SHA
(35 checks, exit 0).

Wave-1 inspection gates still fail on this host. Functional 100+ highlight
passed (107 requested, 107 matched). Cold load 3403 ms passed the 15 s budget.
Select p95 1.8 ms passed the 200 ms budget. Filter 44 ms passed the 500 ms
budget. Median orbit 1.4 FPS failed the 30 FPS budget. Maximum non-render UI
longtask 1159 ms failed the 200 ms budget. Thresholds were not lowered. Ticket
29 owns hardware GL. That is the F1 miss. The plan's three-discipline demo is
BLCJ S1000, which this run ingested. Snowdon Towers is not the seeded catalog.
Ticket 31 owns that adoption. Seed still creates tenant `demo-tenant`, project
`demo-project`, and pack `demo-pack` from `packs/demo`.

## F2. Code quality

**Result.** Pass.

Task 10 commands passed on this SHA. `cargo test --workspace` exited 0.
Worker pytest recorded 78 passed and 19 skipped. Web typecheck exited 0. Web
build exited 0 with three product routes (`/`, `/deliveries/[deliveryId]`,
`/deliveries/compare`). `node scripts/verify-api.ts --scenario all` exited 0.
`node scripts/verify-ui.ts --scenario all` exited 0. Combined viewer printed
82 `ok -` lines and exited 0. Contract `--check` reports rust, python, and ts
with no drift. `verify-worker-envelope.ts --check` confirms protocol 2.
`verify-named-proof.ts` confirms four NamedProof labels. Migrations,
fingerprinting, and matching run inside `cargo test`. Worker and checker stay
on opposite sides of the job envelope. Comparison crates do not parse IFC.

## F3. Reviewer journey

**Result.** Pass with notes.

Standalone example, delivery shelf, findings, comparison, 100+ highlight, and
failure recovery were driven in Chromium. Screenshots exist under the
gitignored leaves below. Combined and inspection overwrite
`results.json` and PNGs in place. API, UI, and standalone runs use timestamped
directories.

| Journey | Proof |
|---|---|
| Standalone core, services not started | `verify-viewer.ts --scenario standalone` exit 0. `.omo/evidence/modelshelf-prototype/19-extract-viewer/standalone/run-2026-09-15T00-09-26-650Z/standalone-picked.png` |
| Combined delivery view | `verify-viewer.ts` exit 0. `07-combined-viewer/{combined-desktop.png,combined-mobile.png,duplicate-object-selection.png,partial-failure-desktop.png}` |
| Inspection, 107-member highlight | `verify-viewer.ts --scenario inspection`. Functional checks passed. Process exit 1 on Wave-1 orbit and longtask. `08-finding-inspection/{results.json,inspection-evidence.png,inspection-isolated.png,inspection-section.png,inspection-selection.png}` |
| Delivery creation | `verify-ui.ts` deliveries. `task-10/run-2026-09-15T00-24-18-915Z/` (`shelf-desktop.png`, `delivery-run-desktop.png`, failed-upload and meeting shots) |
| Findings | `verify-ui.ts` findings. `11-priority-review/run-2026-09-15T00-24-47-976Z/` (`review-overview.png`, `evidence-open.png`) |
| Comparison | `verify-ui.ts` comparisons. `ticket-15/run-2026-09-15T00-25-19-295Z/` (`compare-base.png`, `compare-uncertain.png`) |
| Worker and sibling failure | API `worker-failure` 71 checks. Combined partial-failure PNG. UI invalid upload then retry |
| Checker restart | API `--scenario restart` 16 checks. Snapshot identity after a new process on the same data dir |
| Catalog restart | `demo-launch.ts` SIGINT then same `--data-dir`. Pack version UUIDs identical (3 versions). Project id identical. `deliveryCount` 0. `.omo/evidence/modelshelf-prototype/ticket-17/demo-launch/` |

**Outstanding.** Chromium did not reopen the same delivery after process
death. API restart proves checker snapshot identity. Demo-launch restart
proves the seeded catalog. Neither path reopens a delivery URL in a browser.
Demo-launch smoke used Next.js **dev** and curl, not Chromium.

## F4. Scope fidelity

**Result.** Pass with notes.

Native `.rvt` and `.pln` import is not claimed. VISION, ADR 0001, and
`docs/limitations.md` say IFC including exports from Revit or Archicad.
Regulatory approval is denied in docs. The demo pack is not an approved
national architectural validation pack. `"Regulatory"` is a pack category
label in scorecard metadata, not an approval claim. The pack keeps that label.
Sidebar `ready: false` items stay visible as the product map.
`samples/snowdon-towers/README.md` still reads as if Snowdon were the
four-discipline seeded demo. Ticket 31 owns that wording.

The same change updates live support-profile sentences in
`docs/limitations.md` and `PRODUCT.md` so they match this SHA. Rotation is
`moved` at 0 m with a basis note. New runs are `complete`. The worker
distinguishes occurrence origin from type origin and still does not extract
predefined types. The committed severity ramp in
`apps/web/src/lib/palette.ts` records that hard gates pass (ΔE 8.4 deutan and
15.3 normal).

`docs/reviews/plan-alignment-2026-09-09.md` and the 2026-09-07 remaining-work
table in `docs/reviews/wave-1-report.md` stay dated snapshots. Their recorded
numbers are left as written.

`node scripts/check-published-claims.ts` exited 0.
`node scripts/check-published-tree.ts` exited 1 on
`apps/web/scripts/check-routes.mjs`. README already records that red.
Assign it back. Do not allowlist the file here.

## Commands

| Command | Exit | Evidence |
|---|---|---|
| `cargo test --workspace` | 0 | `ticket-17/cargo-test.log` |
| `uv run --locked --project services/ifc-worker pytest` | 0 | 78 passed, 19 skipped. `ticket-17/pytest.log` |
| `node scripts/check-viewer-imports.ts` | 0 | `ticket-17/check-viewer-imports.log` |
| `node scripts/check-published-claims.ts` | 0 | `ticket-17/check-published-claims.log` |
| `node scripts/check-published-tree.ts` | 1 | `javascript not on the allowlist: apps/web/scripts/check-routes.mjs`. Assign back. Do not allowlist in this change. |
| `npm --prefix apps/web run typecheck` | 0 | `ticket-17/web-typecheck.log` |
| `npm --prefix apps/web run build` | 0 | 3 product routes. `ticket-17/web-build.log` |
| `node scripts/generate-model-contracts.ts --check` | 0 | rust/python/ts no drift |
| `uv run --project services/ifc-worker python scripts/check-demo-oracle.py` | 0 | oracle matches IfcTester |
| `node scripts/verify-model-contracts.ts` | 0 | `task-11/run-2026-09-15T00-08-53-140Z` |
| `node scripts/verify-worker-envelope.ts --check` | 0 | dump-lock |
| `node scripts/verify-named-proof.ts` | 0 | four NamedProof labels |
| `node scripts/verify-viewer.ts --scenario standalone` | 0 | `19-extract-viewer/standalone/run-2026-09-15T00-09-26-650Z/` including `standalone-picked.png`. Checker, worker, and Next.js not started. |
| `node scripts/qa-harness.ts` | 0 | `task-1/run-2026-09-15T00-09-30-730Z` |
| `node scripts/verify-viewer.ts` (combined) | 0 | 82 `ok -` lines. `07-combined-viewer/{results.json,combined-desktop.png,combined-mobile.png,duplicate-object-selection.png,partial-failure-desktop.png}` |
| `node scripts/verify-viewer.ts --scenario inspection` | 1 | Functional checks passed. Wave-1: cold 3403 ms pass, orbit 1.4 FPS fail, select p95 1.8 ms pass, filter 44 ms pass, max UI longtask 1159 ms fail. `08-finding-inspection/results.json` `passed: false`. Ticket 29. Do not lower thresholds. |
| `node scripts/verify-api.ts --scenario all` | 0 | `ticket-16/run-2026-09-15T00-22-57-557Z/summary.json`. revisions 26, worker-failure 71, checks 31, first-loop 12, comparisons 35, finding-comparisons 41, restart 16. Rotated walls: kind moved, distance 0, basis note. |
| `node scripts/verify-ui.ts --scenario all` | 0 | deliveries `task-10/run-2026-09-15T00-24-18-915Z`, findings `11-priority-review/run-2026-09-15T00-24-47-976Z`, comparisons `ticket-15/run-2026-09-15T00-25-19-295Z` |

Demo-launch smoke used an empty data dir on port 18787, then the same
`--data-dir` after SIGINT.

```
node scripts/demo-launch.ts --data-dir /tmp/modelshelf-ticket17-demo-data --port 18787
```

First seed reported `+3 pack version(s)` (blcj v1, blcj v2, fixtures.ids).
`GET http://127.0.0.1:3210/` returned 200. `GET /api/health` returned
`{status:ok, engineVersion:ifctester/0.8.5, parserVersion:ifcopenshell/0.8.5, schemaVersion:10}`.
Restart kept the three pack version UUIDs and the project id.
`deliveryCount` stayed 0. Seed does not create deliveries. Snapshots are in
`ticket-17/demo-launch/`. That path is curl against Next.js **dev**, not
Chromium.

## Residual open work

This audit is local 17, GitHub #19. It does not close GitHub issues.

| Local | GitHub | Why it stays open |
|---|---|---|
| 29 | [#50](https://github.com/dmalmq/ModelShelf/issues/50) | Hardware-GL re-measure of Wave-1 orbit and longtask. Do not manufacture a SwiftShader pass. |
| 31 | [#52](https://github.com/dmalmq/ModelShelf/issues/52) | Adopt Snowdon Towers as the four-discipline seeded demo. |
| 32 | [#53](https://github.com/dmalmq/ModelShelf/issues/53) | Graded Snowdon variants. Blocked by 31. |
| map | [#21](https://github.com/dmalmq/ModelShelf/issues/21) | Parent prototype map. |

Named notes that this change does not implement:

- F3 has no Chromium reopen of the same delivery after process death.
- F4 keeps the pack `"Regulatory"` label, sidebar `ready: false` items, and
  the Snowdon README.
- `check-published-tree.ts` stays red on `apps/web/scripts/check-routes.mjs`.
  Assign that red back. Do not allowlist the file.
