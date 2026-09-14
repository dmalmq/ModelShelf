#!/usr/bin/env node
// Fails if GitHub-bound paths include agent working dirs or extra JavaScript
// entrypoints. Allowlisted .mjs files are configs or browser pages that Node
// type-stripping cannot load.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const ALLOWED_DOT = new Set([".gitignore"]);
const ALLOWED_DOT_PREFIXES = [".github/"];

const BANNED_PREFIXES = [
  ".audit/",
  ".design/",
  ".lavish/",
  ".omo/",
  ".scratch/",
  ".cursor/",
  ".claude/",
  ".agents/",
  ".codegraph/",
  "design/claude-design/",
];

const ALLOWED_JS = new Set([
  "apps/web/postcss.config.mjs",
  "packages/model-viewer/example/app.mjs",
]);

function gitLsFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString("utf8")}`);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

const tracked = gitLsFiles();
const failures: string[] = [];

for (const path of tracked) {
  if (path === ".no-mistakes.yaml") {
    failures.push(`banned file: ${path}`);
    continue;
  }
  if (BANNED_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))) {
    failures.push(`banned prefix: ${path}`);
  }
  if (path.startsWith(".")) {
    const allowed =
      ALLOWED_DOT.has(path) || ALLOWED_DOT_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (!allowed) {
      failures.push(`unpublished dot path: ${path}`);
    }
  }
  if (/\.(?:js|mjs|cjs|jsx)$/.test(path) && !ALLOWED_JS.has(path)) {
    failures.push(`javascript not on the allowlist: ${path}`);
  }
}

const tautologyCheck = /check\(true/;
const playwrightIndex = /node_modules\/playwright\/index\.mjs/;
for (const path of tracked) {
  if (!path.startsWith("scripts/") || !path.endsWith(".ts")) continue;
  const source = readFileSync(join(REPO_ROOT, path), "utf8");
  if (tautologyCheck.test(source)) {
    failures.push(`banned tautology in ${path}`);
  }
  if (playwrightIndex.test(source)) {
    failures.push(`banned hardcoded playwright entry in ${path}`);
  }
}

if (failures.length > 0) {
  console.error(`FAIL - published tree (${failures.length})`);
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - published tree (${tracked.length} files)`);
console.log(`ok - javascript allowlist ${[...ALLOWED_JS].join(", ")}`);
