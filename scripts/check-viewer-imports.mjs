#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgSrc = join(root, "packages", "model-viewer", "src");
const fixturesDir = join(root, "packages", "model-viewer", "fixtures", "invalid");
const appSrc = join(root, "apps", "web", "src");

const PUBLIC_VIEWER_IMPORT = /^model-viewer(?:\/(?:ifc|react))?$/;
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;
const DIAGNOSTICS_RE = /\bdiagnostics\s*\(/;

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) entries.push(...walk(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".mjs")) entries.push(path);
  }
  return entries;
}

function posix(path) {
  return relative(root, path).split(sep).join("/");
}

function inDir(file, folder) {
  return posix(file).includes(`/${folder}/`);
}

function packageProblems(source, file) {
  const problems = [];
  if (source.includes("@/lib") || source.includes("@/components")) problems.push("imports an app path");
  if (source.includes("next/")) problems.push("imports 'next/'");
  if (/\bFinding\b/.test(source)) problems.push("mentions Finding");
  if (/\bSeverity\b/.test(source)) problems.push("mentions Severity");
  if (/\bModelShelf\b/.test(source)) problems.push("mentions ModelShelf");
  const specifiers = [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
  const reactFile = inDir(file, "react");
  const ifcFile = inDir(file, "ifc");
  if (specifiers.includes("react") && !reactFile) problems.push("imports 'react' outside the React entry");
  if (specifiers.some((specifier) => specifier === "three" || specifier.startsWith("three/")) && (reactFile || ifcFile)) {
    problems.push("imports 'three' outside the core entry");
  }
  if (specifiers.includes("web-ifc") && !ifcFile) problems.push("imports 'web-ifc' outside the IFC entry");
  return problems;
}

function appProblems(source, file) {
  const problems = [];
  const specifiers = [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
  const internal = specifiers.filter((specifier) => specifier.startsWith("model-viewer") && !PUBLIC_VIEWER_IMPORT.test(specifier));
  if (internal.length > 0) problems.push(`imports viewer internals (${[...new Set(internal)].join(", ")})`);
  const handle = basename(file) === "verification-handle.ts";
  if (DIAGNOSTICS_RE.test(source) && !handle && posix(file).startsWith("apps/web/")) {
    problems.push("calls diagnostics() outside verification-handle.ts");
  }
  return problems;
}

let violations = 0;

for (const file of walk(pkgSrc)) {
  const problems = packageProblems(readFileSync(file, "utf8"), file);
  if (problems.length > 0) {
    violations += 1;
    console.error(`FAIL - ${posix(file)}: ${problems.join(", ")}`);
  }
}

for (const file of walk(appSrc)) {
  const problems = appProblems(readFileSync(file, "utf8"), file);
  if (problems.length > 0) {
    violations += 1;
    console.error(`FAIL - ${posix(file)}: ${problems.join(", ")}`);
  }
}

const fixtures = walk(fixturesDir);
if (fixtures.length === 0) {
  console.error("FAIL - packages/model-viewer/fixtures/invalid/ is empty");
  process.exit(1);
}

let fixtureFailures = 0;
for (const file of fixtures) {
  const source = readFileSync(file, "utf8");
  const name = basename(file);
  const asPackage = packageProblems(source, file);
  const asApp = appProblems(source, join(appSrc, name));
  const rejected = asPackage.length + asApp.length > 0;
  if (!rejected) {
    console.error(`FAIL - fixture ${posix(file)} was accepted`);
    violations += 1;
    continue;
  }
  fixtureFailures += 1;
  console.log(`ok - rejected fixture ${posix(file)} (${[...asPackage, ...asApp].join(", ")})`);
}

if (fixtureFailures !== fixtures.length) {
  console.error(`FAIL - expected every invalid fixture to be rejected (${fixtureFailures}/${fixtures.length})`);
  process.exit(1);
}

if (violations > 0) {
  console.error(`\n${violations} file(s) violate the viewer import boundary`);
  process.exit(1);
}

console.log("viewer import boundaries hold (host-independent core; app uses public exports)");
console.log("checked-in invalid-import fixtures are rejected");
