# ModelShelf design plan — Direction A on shadcn/ui + Tailwind v4

Direction A is the chosen shell: light chrome, deep engineering blue.
This document turns it into something buildable and names the parts of the mock that
should not survive contact with the real product.

> **Recovery note.** This file was lost when `.design/` was deleted off disk on
> 2026-09-07 (it was never tracked by git) and was rewritten from session context.
> The five HTML artifacts survived because they had been pushed to the Claude Design
> project `ModelShelf — BIM delivery review` (`4df41587-9b5e-4134-a729-232099b00ca8`),
> which is now the durable copy. Pull them with `DesignSync get_file` when needed.

> **Viewer surface: WHITE (`#ffffff`).** Decided by the user on 2026-09-07, matching
> what commit `f60b52f` had already merged to `main` via PR #25. See §3.

---

## 1. What reads as AI slop in the mock, and what replaces it

I built the mock, so this list is a critique of my own work. Items marked **done**
were fixed in `directions/a-instrument.html` and confirmed by the Impeccable
detector, which went from 33 unique findings to 1.

### 1.1 Swatches that encode nothing — done

The KPI tiles carried a coloured square each. On *Blocking* and *Undecided* the square
maps to a severity band and earns its place. On **Distinct objects** it was crimson for
no reason at all — there is no "distinct objects" colour in the system. It was
decoration wearing the costume of an encoding.

**Fix.** A swatch appears only where it maps to a value in `palette.ts`.

### 1.2 The longest bar on screen meant zero — done

*Critical — None* rendered as a full-width empty track. The eye reads bar length
first and meaning second, so the most prominent mark in the chart communicated
absence.

**Fix.** Zero-count bands get no track. They collapse into one line above the chart:
`No critical findings in this delivery.`

### 1.3 The UI narrated its own design rationale — done

> "Bars encode *findings* so that volume can never outrank severity; object counts stay as text beside them."

> "Discipline is deliberately **not** colour-coded. Severity already owns red, orange, amber and blue."

This was me explaining my decisions to the user, printed inside the product. A reviewer
opening the scorecard for the ninth time this week does not need a lecture on chart
theory. Real products do not defend their axis choices in the margin.

**Fix.** All six strings replaced. Captions now say something about *this delivery*
(`30 of 60 spaces have a blank Reference`). The rationale lives in this document.

### 1.4 Unicode dingbats standing in for icons — outstanding in the mock

`&#9888;` `&#9679;` `&#10003;` `&#10005;`. These render differently on every platform,
cannot be sized or coloured reliably, and are the most recognisable tell that nobody
opened an icon set.

**Fix.** `lucide-react`, installed with shadcn. Cannot be applied in a static HTML
mock; applies from the component build onward.

### 1.5 Card soup in the right rail — outstanding

Four cards — viewer, warning, composition, provenance — stacked with identical
borders, radii, shadows and weight. Nothing tells you which matters.

**Fix.** Three treatments for three jobs:
- The **viewer** is not a card. Full-bleed panel, flush to the rail edges.
- The **undecided warning** is an `Alert`, conditional on `incompleteCount > 0`.
- **Provenance** collapses into an `Accordion`, closed by default.

### 1.6 A chart for three numbers — outstanding

*Objects by source model* draws three grey bars for 3,014 / 2,184 / 322. A bar chart
earns its keep when comparison is hard by eye. Three numbers are not hard by eye.

**Fix.** Three inline stats in the delivery header. No chart.

### 1.7 A truncated axis that exaggerates the story — outstanding

The trend line runs a y-axis from 30% to 60%, turning a twelve-point rise into a
dramatic climb. Worse, one of those steps is not model improvement at all — pack v2
scoped cable trays out of the diameter rule. (The caption now says so; the axis still
lies.)

**Fix.** Baseline at zero, or replace with a small stacked column per run showing
pass / fail / undecided counts. The second is better: it removes the score from the
page as a headline, which is what ticket 11 asks for anyway.

### 1.8 Bespoke font weights — done

`620`, `640`, `650`, `660`, `680`. Five weights within forty units of each other, each
chosen by feel. No reader perceives the difference; none is reproducible.

**Fix.** Three weights: `400`, `500`, `600`. Hierarchy from size and ink colour.

### 1.9 Shadow on everything — partly done

`0 1px 2px rgba(16,24,40,.06)` on every surface, including surfaces that never move.
Elevation should mean *this floats above the page*.

**Fix.** Shadows on popovers, dropdowns, dialogs and toasts only. Everything else gets
a `1px` border.

### 1.10 Smaller tells

| Tell | Fix | Status |
|---|---|---|
| `Compare with…` — ellipsis as decoration | `Compare` | done |
| One `10px` radius on every element | `6px` controls, `8px` cards, `0` full-bleed | tokens done |
| `Finalized` as a green pill with a dot | A `Lock` icon and the word | outstanding |
| Placeholder polygon posing as a 3D view | Real `web-ifc` render, or an explicit empty state | outstanding — the detector's one remaining finding |

### 1.11 Found by fixing, not by the detector

Removing the severity rail exposed a real CSS bug. The reset
`.a h1, .a h2, … .a li { padding: 0 }` has specificity **(0,1,1)**; `.a-f` has
**(0,1,0)**. The reset won, so the row padding never applied — invisible only because
the 4px rail sat where the padding should have been.

Carry this into the component build: **Tailwind's preflight does the same kind of
element-level reset**, so any hand-written component class is one specificity point
short of it.

---

## 2. Stack

Everything builds on what was already configured in `apps/web`.

| Layer | Choice | Status |
| --- | --- | --- |
| Framework | Next 15 App Router, React 19 | present |
| CSS | Tailwind v4 via `@tailwindcss/postcss` | present |
| Components | shadcn/ui, CLI-vendored | **installed — 23 components** |
| Icons | `lucide-react` | installed |
| Charts | `recharts` via shadcn `chart` | installed |
| Alias | `@/*` → `./src/*` | present |

```sh
npx shadcn@latest init -y -b radix -p nova --no-monorepo --css-variables
```

Two CLI behaviours worth recording, because both need reversing after any re-run:

1. **`init` overwrites token values but keeps surrounding comments**, producing a file
   that asserts contrast ratios its colours do not have. `globals.css` carries a header
   note about this.
2. **`init` wires Geist via `next/font/google`.** Wrong here twice over: Geist has no
   CJK coverage, so half this product's content would fall back mid-line; and it fetches
   from Google at build time, which an offline prototype should not need.

Verified after scaffolding: `npm run typecheck` clean, `npm run build` ✓ 3.1s, 4/4
static pages — the first successful build in this repo.

---

## 3. Token architecture — the one decision that matters

**Chrome tokens → CSS variables + `@theme inline`, shadcn's standard names.**
`--background`, `--foreground`, `--card`, `--border`, `--input`, `--ring`, `--primary`,
`--muted-foreground`, `--radius`. These never encode a value from the API.

**Data tokens → TypeScript only, in `palette.ts`.**
Severity, spec outcome, change kind, viewer highlight. Applied as an inline `style`, an
SVG `fill`, or a Recharts `ChartConfig` entry. Never a Tailwind class.

> **If a colour encodes a value that came from the API, it comes from `palette.ts`.
> If it is chrome, it is a Tailwind token.**

That is lintable. An ESLint rule banning `bg-red-*`, `text-amber-*`, `border-green-*`
inside `src/components/**` enforces it on people who never read this document.

### Data values — corrected from what was committed

Measured with the palette validator, not judged by eye.

| Slot | Was | Now | Reason |
|---|---|---|---|
| `critical` | `#dc2626` | `#9f1239` | ΔE 8.7 against `high` for **normal** colour vision; floor is 15 |
| `high` | `#ea580c` | `#e2560d` | re-step to clear the gate against the new `medium` |
| `medium` | `#ca8a04` | `#d19a02` | ΔE 2.9 against `high` under deuteranopia |
| `removed` | `#dc2626` | `#be123c` | change-kind ramp separation |
| `shape_changed` | `#9333ea` | `#a21caf` | ΔE 1.3 against `moved` under deuteranopia |

`advisory #0284c7` and `review_incomplete #7c3aed` unchanged. All corrected ramps pass
every hard gate. `medium` sits at 2.45:1 against the light surface, so
`SEVERITY_NEEDS_LABEL` marks it as requiring a visible label — the relief rule.

### The viewer surface — decided: white

`--viewer: #ffffff`. The model space matches the light chrome instead of punching a
dark hole in it. Highlight colours are the set validated against white:

| Role | Hex | vs #ffffff |
|---|---|---|
| `violation` | `#e11d48` | 4.70:1 |
| `secondary` | `#d97706` | 3.19:1 — worst case |
| `reference` | `#0284c7` | 4.10:1 |
| `incomplete` | `#7c3aed` | 5.70:1 |
| `selection` | `#0d9488` | 3.74:1 |

All clear 3:1. Verified independently, not taken from the commit's own comment.

**One consequence to design around.** `--viewer` is now the same value as `--card`, so
the panel has no figure/ground separation of its own. It earns its edge two other ways:
a border one step stronger than a card's (`#d7dee7`), and a faint ground grid that reads
as model space rather than document. Anything that renders geometry on white needs a
deliberate answer here — white-on-white is not a boundary.

Two rules survive the change unaltered, because both were measured against geometry
rather than against a background:

> **The viewer paints at most three severity classes, and by default exactly one** —
> the selected finding. Ranking is the findings panel's job.

> **Passing objects are never painted.** Pass is the absence of highlight. This matters
> more on white, not less: painting 1,832 passing elements green would spend the whole
> colour budget on the objects nobody needs to look at, and make the building unreadable.

The dark-canvas finding is retained for the record, since it constrains any future dark
mode: no five-way severity ramp survives a dark background — roughly 600 combinations
validated, none passed; four-way also failed; three-way passes comfortably
(ΔE 16.8–19.3 deutan). If a dark theme is ever built, `palette.ts` needs full
re-validation, not an inversion.

## 4. Component inventory

### shadcn primitives — installed

`Button` `Card` `Badge` `Alert` `Separator` `Table` `Tabs` `Breadcrumb` `DropdownMenu`
`Select` `Tooltip` `Popover` `Accordion` `Collapsible` `ScrollArea` `Skeleton` `Dialog`
`Sheet` `Toggle` `ToggleGroup` `Chart` `Input` `Label`

### Domain components to build

| Component | Contract | Notes |
|---|---|---|
| `SeverityLadder` | `SeverityBand[]` | Bar length = **finding** count. Zero bands collapse to a text line. |
| `SeverityBadge` | `Severity` | Colour from `palette.ts` + always a label. Never colour alone. |
| `OutcomeBar` | `RunSummary` | One stacked bar, four segments, 2px gaps. Not-applicable held apart. |
| `FindingRow` | `Finding` | Severity chip, title, expected/actual, object count. |
| `FindingsTree` | `SeverityBand[]` | Collapsible bands → categories → findings. |
| `RunHistoryColumns` | `RunSummary[]` | Stacked columns per run. Pack-version changes labelled on the axis. |
| `ProvenanceNotice` | `RunInputProvenance` | **Design for `incomplete` as the normal case** — `complete` is unreachable until ticket 06 lands input pinning. |
| `ModelStats` | `ModelInfo[]` | Three inline stats. No chart. |
| `StoreyHeatmap` | counts by storey × discipline | Sequential blue, one hue. Every cell carries its number. |
| `DeliveryTimeline` | `DeliverySummary[]` | Deliveries on a date axis with reuse links. |
| `DiffSummaryBar` | `DiffSummary` | Change kinds, corrected palette, direct labels. |
| `ViewerPanel` | `ViewerModelSource[]`, `ViewerHighlight[]` | Wraps the reusable viewer's React export. Full-bleed, never a `Card`. |

Ticket 07's package boundary holds: `ViewerPanel` translates findings into generic
`ObjectRef` highlight groups and host-provided styles. Severity, requirement text and
API lookups stay on the ModelShelf side of the seam.

---

## 5. Charts

| Figure | Implementation |
|---|---|
| Severity ladder | CSS. It is a meter, not a chart. |
| Outcome bar | CSS or inline SVG. One stacked bar. |
| Run history columns | Recharts `BarChart`, stacked, via `ChartContainer` |
| Findings by category | Recharts `BarChart`, horizontal, stacked by severity |
| Storey heatmap | CSS grid |
| Diff summary | CSS |
| Model composition | no chart |

Never two y-axes. A legend whenever two or more series are present. Text wears ink
tokens, not the series colour. Every colour has a textual equivalent — ticket 15
requires it outright.

---

## 6. Build order

1. ~~**Foundations.** `shadcn init`, chrome tokens, corrected `palette.ts`, `app/layout.tsx`.~~ **done and verified.** Outstanding: the ESLint colour rule.
2. **Domain kit.** §4 rendered against fixture data on a `/kitchen-sink` route. ← next
3. **Run scorecard** — ticket 11. Verify: `scripts/verify-ui.mjs --scenario findings`.
4. **Delivery shelf** — ticket 10.
5. **Finding inspector** — ticket 08.
6. **Comparison** — ticket 15.

Steps 3–6 are ticket-owned and blocked on their prerequisites. Step 2 is not owned by
any open ticket.

---

## 7. Standing rules

1. No single health score anywhere. Rule totals, distinct objects, not-applicable and undecided are four separate numbers.
2. Severity bars encode findings. Object counts are text.
3. Not applicable is never folded into pass.
4. Undecided is never green and never hidden, even when every evaluated check passes.
5. Colour always has a textual equivalent.
6. Pack-version changes are labelled on every time axis.
7. The viewer paints at most three severity classes, one by default.
8. Discipline is not a hue.
9. Captions describe the delivery, never the chart.
10. Elevation means floating. Everything else has a border.
11. Nothing below 12px. 11px is a Latin floor, not a CJK one.
12. No hierarchy device that relies on `text-transform` or negative tracking — both are Latin-only and do nothing to kanji.
