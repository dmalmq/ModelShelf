# apps/web — conventions

Read this before adding UI. It exists because two sessions independently built the same
component kit on 2026-09-07 and 2026-09-08, and neither noticed until the second one ran
a build. Untracked files give git no chance to warn you.

**Check `src/components/domain/` before creating a component.** If a name is close to one
that exists, extend it rather than adding a sibling.

## Where things live

| | |
|---|---|
| `src/components/ui/` | shadcn primitives, CLI-vendored. Do not hand-edit; re-run the CLI. |
| `src/components/domain/` | ModelShelf components. **The only home for these.** |
| `src/lib/types.ts` | The API contract. Mirrors `docs/contracts/http-api.md`. Owned by the backend work — do not change it to suit a component. |
| `src/lib/palette.ts` | Every colour that encodes API data. |
| `src/lib/i18n.ts` | Every user-visible string, in both languages. |
| `src/lib/mock.ts` | Disposable fixtures for the design-exploration routes. |
| `src/lib/fixtures.ts` | API-typed fixtures for `/kitchen-sink`. |
| `/kitchen-sink` | Every domain component with its edge cases, both locales. |

## Colour

> **If a colour encodes a value that came from the API, import it from `palette.ts`.
> If it is chrome, it is a Tailwind token from `globals.css`.**

Data colours are applied as an inline `style`, an SVG `fill`, or a chart config entry —
never a Tailwind class. No `bg-red-*` / `text-amber-*` / `border-green-*` in components.

Severity, spec outcome, change kind and viewer highlight are data. Surfaces, ink, borders,
the brand accent and focus rings are chrome.

Every ramp in `palette.ts` was validated, and two of them replaced committed values that
failed hard accessibility gates. The measurements are recorded inline next to the values.
**Do not "tidy" a hex back to a rounder Tailwind default** — you will reintroduce a
ΔE 2.9 collision between medium and high under deuteranopia.

## Language

Japanese is the default; English is first-class. Both come from `i18n.ts`.

- **No hardcoded user-visible strings in components.** Take a `locale?: Locale` prop
  defaulting to `DEFAULT_LOCALE`.
- **No fixed-width label columns.** Japanese and English differ by roughly 1.6×. Size grid
  tracks to content (`grid-cols-[auto_minmax(0,1fr)_auto]`), not `w-16`.
- **No hierarchy from `text-transform` or negative tracking.** Both are Latin-only and do
  nothing to kanji, so the hierarchy vanishes in the default language.
- **Nothing below 12px.** 11px is a Latin floor, not a CJK one.

## Product rules the components enforce

These come from `PRODUCT.md` and ticket 11. A component that breaks one is wrong even if
it looks right.

1. **No single health score.** Rule totals, distinct objects, not-applicable and undecided
   are four separate numbers. `RunSummary.score` exists; do not put it on a page as a
   headline.
2. **Severity bars encode finding count, never object count.** The demo delivery's one
   advisory finding covers 107 objects — more than any high finding but one.
3. **Not applicable is never folded into pass.** It is an absence, not a result. 19 of 36
   results on the demo delivery; folding it would roughly double the apparent pass rate.
4. **Undecided is never green and never hidden**, even when every evaluated check passed.
5. **Colour always has a textual equivalent** — a ticket 15 acceptance criterion.
6. **The viewer paints at most three classes, one by default.** Passing objects are never
   painted; pass is the absence of highlight.
7. **Provenance: design for `incomplete` as the normal case.** It is the only status that
   occurs today; `complete` is unreachable until input pinning lands in ticket 06.

## Gotchas that cost real time

- **Tailwind preflight resets element padding**, and `.a li { padding: 0 }`-shaped rules
  are specificity (0,1,1). A bare component class at (0,1,0) loses. Utilities land in a
  later layer so they win — but a hand-written class needs the ancestor.
- **`shadcn init` overwrites token values in `globals.css` while keeping your comments**,
  producing a file that asserts contrast ratios its colours do not have. If the tokens
  come back as `oklch(… 0 0)` greys, restore them.
- **`shadcn init` wires Geist via `next/font/google`.** Removed deliberately: no CJK
  coverage, and it fetches from Google at build time.
- **SVG `<path>` with a stroke and no `fill` fills black.** Invisible on a dark canvas,
  glaring on the white one this product uses.

## Verifying

```sh
npm run typecheck
npm run build
npm run start          # then open /kitchen-sink
```

Look at the render. The last three layout bugs here — a black building, a label colliding
with its bar, and wrapped counts — were all invisible to typecheck and to the design
detector, and obvious in a screenshot.
