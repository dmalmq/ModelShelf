# Complete prioritized findings and pack selection

ID: 11
Parent: ../map.md
Type: task
Mode: AFK
Labels: wayfinder:task, ready-for-agent
Status: resolved
Assignee: Ticket11Owner
Blocked by: 10
Wave: 2
Original plan coverage: 7

## Question

What implementation and evidence establish the behavior below without violating the approved prototype boundaries? This is an execution ticket under the map's Notes override.

## What to build

A reviewer chooses a pack version, runs checks, and works through important grouped findings with clear evidence.

## Context for a fresh agent

Read [the handoff](../HANDOFF.md), [the specification](../spec.md), and [the starting codebase](../codebase-map.md). Inspect current files before editing. This ticket is open even if partial code exists. The application uses Rust as its main backend, a local established IFC/IDS worker, and Next.js. Revisions and run inputs are immutable. Fingerprints describe state, not identity.

## Prerequisites

- [Complete the reviewer delivery shelf](10-delivery-shelf.md). Read its Answer and verified interface before starting.

## Ownership

Pack/run controls and full review screen, grouped findings presentation, shared metadata validation.

Other agents may be working in this checkout. Do not revert their edits. A dependency being resolved does not make concurrent edits to the same files safe. Coordinate shared file/contract ownership first.

## Implementation boundaries

- Keep priority/category grouping and check-pack terminology in ModelShelf. Feed generic highlights and filter values to the viewer; do not teach the package about IDS findings.

- Promote the first-loop inspector into the complete review screen. Show severity bands before categories and group duplicate violations by requirement.
- Separate rule totals, distinct affected objects, not-applicable outcomes, and incomplete review. Avoid one misleading overall success percentage.
- Show expected/actual values, source requirement, scope, instructions, pack history, and failed-run recovery. Preserve access to all affected objects.

## Acceptance criteria

- [ ] Higher-severity findings cannot be displaced by large advisory groups.
- [ ] An object failing multiple rules is not double-counted in totals labelled distinct objects.
- [ ] Incomplete checks stay visible even when all evaluated checks pass.
- [ ] Switching pack versions creates new immutable runs and preserves old results.

## Verification

- node scripts/verify-ui.mjs --scenario findings
- Test priority ordering, malformed metadata, no-match scope, 100+ duplicates, and geometry-loading/failure states.

Commands for new scripts/tests describe deliverables to create in this ticket or its prerequisites, not files guaranteed to exist today. Keep logs and screenshots in a ticket-owned evidence directory. Use real processes/data paths for happy and failure cases; mocks alone are insufficient. Do not lower a performance threshold or weaken a failing test to close this ticket.

## Completion and handoff

Append an Answer with changes, exact commands/results, evidence links, remaining limitations, and any contract changes downstream agents need. Change Status to resolved only when every criterion is demonstrated. Update the map with a linked one-line resolution. No commit, push, PR, deployment, or external publication is authorized by this ticket alone.

## Comments

Created from the approved prototype plan on 2026-09-06. No implementation is claimed by ticket creation.

## Answer

All four acceptance criteria demonstrated against real processes (real checker
binary, real ifc-worker ingestion, real IfcTester scoring, real Next.js, real
Chromium). `node scripts/verify-ui.mjs --scenario findings`: 36/36 checks pass.

### Backend: one definition for failing objects (no other wire change)

- `services/checker/src/dto.rs`: `run_extras` used `COUNT(DISTINCT
  fo.object_id)` with no incomplete exclusion, diverging from
  `run.rs::run_counts`. It now documents and implements the single canonical
  definition — DISTINCT `model_id + express_id` over decided (non-incomplete)
  findings — so one object failing several rules counts once and incomplete
  members never inflate the total.
- `services/checker/src/run.rs`: `run_counts` delegates to `dto::run_extras`;
  run detail, run summaries, and diff headers cannot diverge again.
- Confirmed no other wire change: `RunSummary.score` stays on the wire but is
  never rendered anywhere in the review UI; `docs/contracts/http-api.md` and
  `apps/web/src/lib/types.ts` untouched (read-only).

### Frontend: `apps/web/src/components/review/`

- `review-state.ts` — `ReviewScreenState` typed model: `RunLifecycle`
  (`idle/loading/ready/failed`) + `FindingSelection` + `ObjectFilterSet` +
  `LoadedMembers` under one `useReducer`; `SELECT_FINDING` and `RUN_LOADING`
  clear dependents atomically. `SEVERITY_REGISTRY` rank table, no branches.
- `viewer-bridge.ts` — one-way review→viewer bridge on plain refs/colors/filter
  strings only (never Finding/Severity/Pack types): `findingToHighlights`
  (null refs counted as undrawable, listed not highlighted),
  `setHighlights/isolate/frame/setDimOpacity` push, diagnostics read-back
  (`matched`/`drawnKeys`/`selectedHidden`).
- `totals-header.tsx` — rule totals (pass/fail) vs distinct objects vs N/A vs
  incomplete; no percentage rendered. Reuses `OutcomeBar`.
- `scorecard.tsx` — bands → categories → requirement rows in backend order
  (never re-sorted); `IncompleteSection` always rendered separately, never in
  bands; `SpecTable` keeps `not_applicable` rows.
- `pack-selection.tsx` — pack version list, run selector (`packName vN +
  status`), POST `/api/runs` + poll to terminal status, failed-run banner with
  retry-same-pack / new-run recovery. New runs are immutable; old results stay
  in the selector.
- `evidence-panel.tsx` — requirement, expected/instructions with honest absence
  markers (never invented), actual per object + first-member summary,
  scope/applicability + notes, pack/engine identity; 25-sample first then
  `fetchAllFindingObjects` paging with a pager past 100 rows (windowed);
  header dedupes by `revisionId+objectId`; malformed members show a banner
  while the valid prefix renders; null-ref + not-drawn members list in
  Members-without-geometry with retry; zero-object findings show the Scope
  N/A explanation and clear stale highlights.
- `object-filters.tsx`, `review-i18n.ts` (JA/EN short labels), `review-screen.tsx`
  (fixed composition order).
- `app/deliveries/[deliveryId]/page.tsx` renders `ReviewScreen`, hosted in the
  viewer's Findings tab via a generic `inspector` prop — the first-loop flat
  list no longer renders beside the scorecard (one list). `FindingInspector`
  file retained for non-review use.
- `combined-delivery-viewer.tsx`: controller seam (`onController`) + `inspector`
  prop only; no finding imports. `finding-evidence.tsx` accepts real `Finding`
  (design/d fixture still works); `ProvenanceNotice` takes live
  `status/reason` (bare usage keeps mock default).

### Verification results (exact commands, warm cache)

- `cargo test -p modelshelf-checker` — 14/14 pass.
- `npm --prefix apps/web run typecheck` — clean (after `npm --prefix apps/web
  install`; `node_modules` was absent in this checkout, so every file failed
  before the install — pre-existing environment gap, not a code regression).
- `npm --prefix apps/web run build` — clean (`/deliveries/[deliveryId]` 170 kB).
- `node scripts/verify-ui.mjs --scenario findings` — 36/36 pass, real
  4-spec pack (advisory wall volume 271, high wall overlap, critical site rule,
  N/A doors) over 2× fixture revisions + 1 hand-authored extruded wall/site +
  1 empty model. API proofs: critical band first at 90x advisory volume;
  failing 280 == independent DISTINCT union 280 < rule-sum 551; N/A spec row;
  reviewIncomplete separate; v2 run preserves v1 byte-for-byte; empty run has
  empty bands. Chromium proofs: DOM band order, no `%` in totals, incomplete
  section on both runs, old-run totals restored via selector, evidence
  contents, pager, malformed banner + valid rows, dedupe header, viewer
  read-back `requested 271 / matched 2` (extruded wall), zero page errors,
  empty-run states.
- Evidence: `.scratch/modelshelf-prototype/evidence/11-priority-review/run-2026-09-08T02-47-01-900Z/`
  (`review-overview.png`, `evidence-open.png`, `evidence-probes.png`,
  `geometry-failure.png`, `empty-run.png`, `run-1.json`,
  `viewer-diagnostics.json`, `summary.json`, `checker.log`, `web.log`).

### Limits and notes for downstream agents

- Fixture walls use IFCBLOCK, which browser web-ifc does not tessellate, so
  fixture members are correctly listed as without-geometry; the drawable
  subset is proven by the hand-authored extruded wall (matched 2, triangles
  12). Do not "fix" this by weakening the tessellation path.
- The corruption probes (one duplicate + one expressId −7 row) are inserted by
  the verify script into its own temp DB after all immutability assertions;
  runs stay immutable in production paths.
- Headless Chromium in this container has no CJK fonts (JA labels render as
  tofu in screenshots, markup is bilingual) and the geometry-failure pass
  aborts model-file traffic to prove honest failure + retry without crashing.
- Ticket 10 (delivery shelf) is still open: this ticket wires the delivery
  page to the review screen but does not build project/delivery assembly UI.
  No commit/push/PR performed.
