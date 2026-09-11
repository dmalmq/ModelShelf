// Accessibility gate for the severity and change-kind colours.
//
// Reads the hexes out of src/lib/palette.ts and the surfaces out of
// src/app/globals.css, so it always checks what is committed rather than a
// copy that can drift. Exits nonzero on a hard failure.
//
//   node scripts/verify-palette.mts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, validate } from "./lib/validate-palette.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const palette = fs.readFileSync(path.join(root, "src/lib/palette.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");

/** Hexes of one `export const NAME: Record<…> = { … }` block, in source order. */
function record(name) {
  const body = new RegExp(`export const ${name}[^=]*=\\s*\\{([^}]*)\\}`).exec(palette);
  if (!body) throw new Error(`${name} not found in palette.ts`);
  return [...body[1].matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
}

function constant(name) {
  const hit = new RegExp(`export const ${name}\\s*=\\s*"(#[0-9a-fA-F]{6})"`).exec(palette);
  if (!hit) throw new Error(`${name} not found in palette.ts`);
  return hit[1];
}

/** A `--ms-*` value from whichever theme block declares it. */
function token(name, theme) {
  const block = theme === "dark" ? /\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/ : /:root\s*\{([\s\S]*?)\n\}/;
  const scope = block.exec(css);
  if (!scope) throw new Error(`${theme} theme block not found in globals.css`);
  const hit = new RegExp(`--ms-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(scope[1]);
  if (!hit) throw new Error(`--ms-${name} not found in the ${theme} theme`);
  return hit[1];
}

const desk = [...record("SEVERITY_COLOR"), constant("REVIEW_INCOMPLETE_COLOR")];
const viewerHighlights = record("VIEWER_HIGHLIGHT");
const changeKinds = record("CHANGE_COLOR");

// The model plate is white. Dark chrome exists for the shell toggle; the
// five-class desk ramp is not re-validated there (see palette.ts).
const VIEWER_CANVAS = "#ffffff";
const CONTRAST_FLOOR = 3;

const failures = [];
const notes = [];

function gate(label, { report, ok }) {
  const hard = Object.entries(report).filter(([, v]) => v === false || v === "fail");
  console.log(`\n${label}`);
  for (const [check, value] of Object.entries(report)) {
    const mark = value === true || value === "pass" ? "PASS" : value === false || value === "fail" ? "FAIL" : "WARN";
    console.log(`  [${mark}] ${check}`);
  }
  if (!ok && hard.length > 0) failures.push(`${label}: ${hard.map(([c]) => c).join(", ")}`);
  return ok;
}

for (const surfaceToken of ["panel-raised", "panel", "surface"]) {
  const surface = token(surfaceToken, "light");
  gate(
    `severity · light desk · on --ms-${surfaceToken} ${surface}`,
    validate(desk, { mode: "light", surface, pairs: "all" }),
  );
}

console.log(`\nviewer highlights · one at a time · on canvas ${VIEWER_CANVAS}`);
for (const hex of viewerHighlights) {
  const ratio = contrast(hex, VIEWER_CANVAS);
  const ok = ratio >= CONTRAST_FLOOR;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${hex} at ${ratio.toFixed(2)}:1`);
  if (!ok) failures.push(`viewer highlight ${hex} only ${ratio.toFixed(2)}:1 on ${VIEWER_CANVAS}`);
}

const unchanged = changeKinds[2];
const changeCategorical = changeKinds.filter((hex) => hex !== unchanged);
const change = validate(changeCategorical, { mode: "light", surface: token("panel-raised", "light"), pairs: "all" });
console.log(`\nchange kinds · light · excluding unchanged ${unchanged} (reported, not gated)`);
for (const [check, value] of Object.entries(change.report)) {
  const mark = value === true || value === "pass" ? "PASS" : value === false || value === "fail" ? "FAIL" : "WARN";
  console.log(`  [${mark}] ${check}`);
  if (mark === "FAIL") notes.push(`change kinds: ${check}`);
}

console.log("");
if (notes.length > 0) console.log(`known, not gated: ${notes.join(" · ")}`);
if (failures.length > 0) {
  console.error(`FAILED\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("palette OK");
