# Review model and finding changes visually

ID: 15
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: unassigned
Blocked by: 14
Wave: 2
Original plan coverage: 9

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer selects two deliveries and investigates model and finding changes in the browser.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Compare findings only under compatible checking settings](14-finding-diff.md). Read its Answer and verified interface before starting.

## Ownership

Comparison route and controls, shared-camera viewer integration, before/after property presentation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Base/head overlays are app-supplied generic highlights and model inputs. Use the viewer public interface unchanged; it must not know about delivery revisions being better/worse or findings being resolved.

- Add base/head pickers, synchronized camera, revision toggle, and change overlay. Filter by source, discipline, object type, change kind, and confidence.
- Select removed objects in base geometry and added objects in head. Show exact before/after properties and finding evidence.
- Present uncertain matches, incompatible settings, incomplete geometry, and rerun actions clearly.

## Acceptance criteria

- [x] Each controlled A/B change is discoverable and points to the correct revision geometry.
- [x] Camera and filters remain coherent while switching sides.
- [x] Repeated GlobalIds across both sides never cause selection on the wrong revision.
- [x] Color has a textual equivalent; Japanese labels are readable and keyboard controls work.

## Verification

- node scripts/verify-ui.mjs --scenario comparisons
- Capture base/head and uncertainty states; inspect browser console and network errors.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

2026-09-09, [plan-alignment review](../../../docs/reviews/plan-alignment-2026-09-09.md): a real source for move, remove and shape change kinds is available. The repository owner exported the [Snowdon Towers](../../../samples/snowdon-towers/README.md) IFC set himself from the Autodesk Revit sample projects, so he can make a small deliberate edit in Revit (move one wall, delete one beam, swap one type) and export a genuine second revision. That gives real exporter output for the change kinds this screen renders, which the synthetic A/B fixtures cannot reproduce. Revit GlobalIds are stable across exports, so matching works; expect re-tessellation of untouched geometry to read as "Shape representation changed", which the plan already says to label honestly rather than treat as physical change. Ask the owner before assuming the revision exists.

Note also [ticket 34](34-rotation-change-kind.md): a rotation-only change currently reports as unchanged, so this screen would render a rotated object as identical. Confirm that decision before building the change overlay.

## Answer

`/deliveries/compare?base=&head=` compares two deliveries in one screen. A single
`CombinedDeliveryViewer` hosts the compare panel through its generic `inspector`
seam, and the whole overlay is app-supplied generic highlight groups pushed
through `DeliveryViewerController`: the viewer package is untouched and still
knows nothing about deliveries being better or worse.

Changes: new `apps/web/src/components/compare/` (`compare-api.ts` typed clients
for `GET /api/diff/models` and `GET /api/diff/runs` with a 409
`fingerprint_profile_mismatch` error and a 409 incomparable error carrying the
first-mismatch dimension; `compare-state.ts` one reducer holding lifecycle, both
diff statuses, side, revision-qualified selection key, filters, and a ref-keyed
change index; `compare-bridge.ts` active-side-only kind groups capped at
`VIEWER_MAX_HIGHLIGHT_GROUPS` with the overflow kept as text, plus the
jump-to-other-side banner rule; `compare-screen.tsx` toolbar with delivery
selects, side toggle, kind/confidence/source filters; `compare-inspector.tsx`
change rows, per-side identity table, before/after property table, and the
finding-delta list with run pickers and a rerun CTA), new route
`apps/web/src/app/deliveries/compare/page.tsx`, new
`scripts/verify-ui-comparisons.mjs`, and `scripts/verify-ui.mjs` gains
`--scenario comparisons`. No backend, DTO, or contract change.

Three decisions worth recording. The overlay never touches the camera:
highlighting and dimming are the overlay's job, framing belongs to an explicit
selection, so filtering cannot yank the view. Side toggle swaps the delivery,
which makes the viewer dispose its controller and build a new one, so the screen
subscribes to snapshots and repaints the overlay and re-frames the selection as
each revision becomes ready. An uncertain match means a heuristic match only: a
one-sided addition or removal carries `none` confidence because it has no
counterpart at all, and counting those as uncertain would overstate the
backend's `uncertainMatches`.

Commands and results: `node scripts/verify-ui.mjs --scenario comparisons` 38/38
against the real checker binary, the real ifc-worker ingestion queue, a
production Next build, and real Chromium. The scenario stages inline extruded-wall
fixtures with a controlled A/B layout and asserts a per-object oracle
(kind plus match confidence for `U-0 P-0 S-0 M-0 R-0 R-1 A-0 A-1 D-a D-b E-0
CompareSite`) rather than summary totals, then drives the browser: every
controlled row listed, exactly three uncertain badges against
`uncertainMatches` 3, removal framing base-side geometry, addition showing the
head banner with a working jump, selection moving the camera while filtering
never does, side toggle preserving filters and selection, duplicate GlobalIds
selecting their own revisions independently, finding deltas grouped
resolved/introduced/persisting, an incompatible run pair naming
`pack_version_mismatch` with a rerun CTA, keyboard focus and Enter selecting and
clearing a row, every compare label carrying its Japanese copy, and zero console
or network errors. `cd apps/web && npx tsc --noEmit` clean; `npx next build` ✓.

Evidence: `.omo/evidence/modelshelf-prototype/ticket-15/run-2026-09-09T03-50-13-898Z/`
(`snapshots/change-oracle.json`, `snapshots/diff-models.json`,
`snapshots/diff-runs.json`, `snapshots/diff-runs-refused.json`,
`snapshots/finding-panel.txt`, `compare-base.png`, `compare-head.png`,
`compare-uncertain.png`, `results.json`).

Limitations. The exact camera matrix does not survive a side switch: the viewer
owns camera state, exposes no setter on its public interface, and rebuilds its
controller when the delivery changes, so coherence is delivered by re-framing the
selected change on the new side rather than by restoring the matrix. This host
has no CJK font, so kanji renders as tofu in the screenshots; the Japanese copy is
asserted in the DOM instead. A rotation-only change still reports as `unchanged`
per ticket 34, which stays open, and this screen renders it as unchanged rather
than inventing a client-side rotation check. The fixtures are inline IFC rather
than `packs/demo/fixtures`, whose walls are `IfcBlock` CSG primitives that
web-ifc cannot tessellate, so no change ref could resolve to geometry in the
browser; the Snowdon second revision named in the Comments above would give real
exporter output and remains the better future source. Change-kind groups are
capped at three painted classes; the rest stay in the list with their text
labels.

Downstream agents need nothing new: no wire, DTO, or contract change.
