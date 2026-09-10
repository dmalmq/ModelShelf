import type { ChangeKind, Severity } from "@/lib/types";

/**
 * Every colour in this file encodes a value that came from the API.
 *
 * Chrome colours — surfaces, ink, borders, the brand accent — live in
 * `src/app/globals.css` as Tailwind tokens. Data colours live here, in
 * TypeScript, and are applied as an inline style, an SVG fill, or a chart
 * config entry. Never as a Tailwind class.
 *
 * The split is the invariant: if a colour depends on what the checker
 * returned, it is imported from this module and nowhere else.
 *
 * Every ramp below was run through a palette validator rather than judged by
 * eye. Two of them replace committed values that failed hard accessibility
 * gates; the reasons are recorded inline so nobody reverts them for looking
 * less familiar.
 */

/**
 * Severity — the product's highest-stakes encoding, and a reserved status
 * palette. It is never reused for a chart series, and it always ships with a
 * label beside the swatch. Colour alone never carries severity.
 *
 * Validated on the light surface: worst adjacent pair ΔE 8.4 (deuteranopia)
 * and 15.3 (normal vision). All hard gates pass.
 *
 * Replaces a committed ramp that failed twice:
 *   critical #dc2626 vs high #ea580c — ΔE 8.7 for NORMAL colour vision,
 *     below the floor of 15. The most consequential distinction in the
 *     product was hard to see for everyone, not just CVD readers.
 *   medium #ca8a04 vs high #ea580c — ΔE 2.9 under deuteranopia, i.e. one
 *     colour for roughly 1 in 12 men.
 */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#9f1239",
  high: "#e2560d",
  medium: "#d19a02",
  advisory: "#0284c7",
};


/** Objects the engine could not decide on. Never green, never counted as a pass. */
export const REVIEW_INCOMPLETE_COLOR = "#7c3aed";

/**
 * Run input provenance. Amber, not red: incomplete provenance limits how much
 * a result proves, it is not a failed check — and that is precisely the
 * distinction the colour has to survive.
 *
 * Validated on the light surface: contrast 7.0:1, worst adjacent pair ΔE 13.0
 * (deuteranopia) and 36.3 (normal vision), both against `fail`/`critical`.
 *
 * Replaces the literal #9a3412 this shipped as. That value sat ΔE 2.2 from
 * `fail` #9f1239 under deuteranopia — one colour, for roughly 1 in 12 men, for
 * the two states a reader most needs to tell apart. Do not revert it toward
 * orange-red without re-running the deutan pair check against OUTCOME_COLOR.
 */
export const PROVENANCE_COLOR = "#6f4f00";

/**
 * Spec outcomes. `not_applicable` is a deliberate neutral: it means "this rule
 * did not apply here", which is an absence rather than a result, and it must
 * never read as a pass. It is excluded from the chroma gate for that reason.
 *
 * Validated (pass / fail / incomplete): worst adjacent ΔE 16.3 deutan,
 * 29.0 normal vision. All gates pass.
 */
export const OUTCOME_COLOR = {
  pass: "#16a34a",
  fail: "#9f1239",
  not_applicable: "#94a3b8",
  review_incomplete: "#7c3aed",
} as const;

/**
 * Change kinds for delivery comparison.
 *
 * Validated across the six meaningful kinds: worst adjacent ΔE 9.7 deutan,
 * 22.6 normal vision. `unchanged` is excluded — it is neutral ground, not a
 * series.
 *
 * Two values replace committed ones:
 *   removed #dc2626 → #be123c, for separation across the ramp.
 *   shape_changed #9333ea vs moved #2563eb — ΔE 1.3 under deuteranopia.
 *     In a diff view those two mean very different things to a coordinator.
 */
export const CHANGE_COLOR: Record<ChangeKind, string> = {
  added: "#16a34a",
  removed: "#be123c",
  unchanged: "#94a3b8",
  moved: "#2563eb",
  shape_changed: "#a21caf",
  properties_changed: "#ca8a04",
  mixed: "#db2777",
};

/**
 * Viewer highlights, for the 3D canvas only. The canvas is white (--viewer),
 * so these were re-validated against #ffffff after the model space moved off
 * dark: every value clears 3:1 contrast (worst 3.19:1, secondary) and the
 * worst pairwise separation is ΔE 50.1.
 *
 * The three-class ceiling still holds: the viewer paints AT MOST three
 * classes at once, and by default exactly one — the selected finding.
 * Ranking is the findings panel's job, where the full severity ramp lives.
 *
 * Passing objects are never painted. Pass is the absence of highlight — which
 * also keeps the entire colour budget on the objects a reviewer must act on.
 */
export const VIEWER_HIGHLIGHT = {
  /** The selected finding's objects. The default and usually only class shown. */
  violation: "#e11d48",
  /** A second finding, only when the reviewer is explicitly comparing two. */
  secondary: "#d97706",
  /** Context objects a host deliberately calls out. */
  reference: "#0284c7",
  /** Review-incomplete objects. Shown alone, never alongside violations. */
  incomplete: "#7c3aed",
  /** Single-object selection. An outline, never a fill. */
  selection: "#0d9488",
} as const;

/** Enforces the three-class ceiling above at the call site. */
export const VIEWER_MAX_HIGHLIGHT_GROUPS = 3;

