#!/usr/bin/env node
// Import-boundary check for packages/model-viewer (ticket 19 / the ticket 16
// standalone prerequisite). The framework core must not import application
// modules, Next, or React; ModelShelf may import the package only through its
// public entrypoints.
//
// Exit 0 when the boundary holds, 1 with a per-file report when it does not.
// Usage: node scripts/check-viewer-imports.ts

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgSrc = join(root, "packages", "model-viewer", "src");
const appSrc = join(root, "apps", "web", "src");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) entries.push(...walk(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) entries.push(path);
  }
  return entries;
}

function rel(path) {
  return path.slice(root.length + 1);
}

const FORBIDDEN = ["@/lib", "@/components", "next/"];
const REACT_FILE = new Set(["viewer-react.tsx", "index.ts"]);
const PUBLIC_VIEWER_IMPORT = /^model-viewer(?:\/(?:core|ifc))?$/;
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;

function packageProblems(source, name) {
  const problems = [];
  for (const token of FORBIDDEN) {
    if (source.includes(token)) problems.push(`imports '${token}'`);
  }
  if (/\bfrom ["']react["']/.test(source) && !REACT_FILE.has(name)) {
    problems.push("imports 'react' outside the React wrapper");
  }
  return problems;
}

function appProblems(source) {
  return [...source.matchAll(IMPORT_RE)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("model-viewer") && !PUBLIC_VIEWER_IMPORT.test(specifier));
}

let violations = 0;
for (const file of walk(pkgSrc)) {
  const problems = packageProblems(readFileSync(file, "utf8"), basename(file));
  if (problems.length > 0) {
    violations += 1;
    console.error(`FAIL - ${rel(file)}: ${problems.join(", ")}`);
  }
}

for (const file of walk(appSrc)) {
  const internal = appProblems(readFileSync(file, "utf8"));
  if (internal.length > 0) {
    violations += 1;
    console.error(`FAIL - ${rel(file)}: imports viewer internals (${[...new Set(internal)].join(", ")})`);
  }
}

function verifyControlledFixtures() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "modelshelf-viewer-import-boundary-"));
  try {
    const coreFixture = join(fixtureDir, "core.ts");
    const appFixture = join(fixtureDir, "app.ts");
    writeFileSync(coreFixture, 'import type { Finding } from "@/lib/types";\nimport "next/navigation";\n');
    writeFileSync(appFixture, 'import { CombinedDeliveryViewer } from "model-viewer/src/viewer-react";\n');

    const coreProblems = packageProblems(readFileSync(coreFixture, "utf8"), "core.ts");
    if (coreProblems.length !== 2) {
      throw new Error("controlled core fixture was not rejected for both forbidden imports");
    }
    if (appProblems(readFileSync(appFixture, "utf8")).length !== 1) {
      throw new Error("controlled app fixture was not rejected for an internal viewer import");
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

if (violations > 0) {
  console.error(`\n${violations} file(s) violate the viewer import boundary`);
  process.exit(1);
}

verifyControlledFixtures();
console.log("viewer import boundaries hold (host-independent core; app uses public exports)");
console.log("controlled invalid-import fixtures are rejected");