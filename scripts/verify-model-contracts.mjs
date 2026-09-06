#!/usr/bin/env node
// End-to-end verification of the shared model contract (schemas/model/v1):
//   1. regeneration is deterministic (delegates to generate-model-contracts.mjs --check)
//   2. each language's own fixture test suite passes (cargo test / pytest / node --test)
//   3. a real cross-language round trip: Python produces payloads with its own
//      generated types, Rust and TypeScript each consume those exact files
//   4. none of the three packages import application/database/checking-engine code
//
// Everything Python/Rust write lands in one isolated temp directory, removed when
// this script exits. Usage: node scripts/verify-model-contracts.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUST_CRATE = join(REPO_ROOT, "crates", "model-contracts");
const PY_PKG = join(REPO_ROOT, "packages", "model-contracts-py");
const TS_PKG = join(REPO_ROOT, "packages", "model-contracts-ts");
const EVIDENCE_DIR = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "task-11");

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`ok - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", cwd: REPO_ROOT, ...options });
}

function grepFiles(dir, extensions, forbidden) {
  const hits = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".venv" || entry.name === "dist" || entry.name === "target") continue;
      const path = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        const content = readFileSync(path, "utf8");
        for (const pattern of forbidden) {
          if (pattern.test(content)) hits.push(`${path} matches ${pattern}`);
        }
      }
    }
  };
  walk(dir);
  return hits;
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const log = (name, content) => writeFileSync(join(runDir, name), content);

  // --- 1. deterministic regeneration ---
  const genCheck = run("node", ["scripts/generate-model-contracts.mjs", "--check"]);
  log("generate-check.log", genCheck.stdout + genCheck.stderr);
  check("regeneration is deterministic (no drift)", genCheck.status === 0, genCheck.stdout + genCheck.stderr);

  // --- 2. each language's own fixture suite ---
  const rustTest = run("cargo", ["test", "-p", "model-contracts"]);
  log("rust-test.log", rustTest.stdout + rustTest.stderr);
  check("rust fixture test suite (cargo test -p model-contracts)", rustTest.status === 0, rustTest.stderr);

  const pyTest = run("uv", ["run", "--project", PY_PKG, "pytest", "-q"], { cwd: PY_PKG });
  log("python-test.log", pyTest.stdout + pyTest.stderr);
  check("python fixture test suite (pytest)", pyTest.status === 0, pyTest.stderr);

  const tsBuild = run("npx", ["tsc", "-p", "tsconfig.json"], { cwd: TS_PKG });
  const tsTest = tsBuild.status === 0 ? run("npm", ["test"], { cwd: TS_PKG }) : tsBuild;
  log("typescript-test.log", tsBuild.stdout + tsBuild.stderr + "\n" + (tsTest.stdout ?? "") + (tsTest.stderr ?? ""));
  check("typescript fixture test suite (node --test)", tsTest.status === 0, tsTest.stderr);

  // --- 3. real cross-language round trip ---
  const producedDir = mkdtempSync(join(tmpdir(), "model-contracts-produced-"));
  try {
    const produce = run("uv", ["run", "--project", PY_PKG, "model-contracts-produce", producedDir], { cwd: PY_PKG });
    log("produce.log", produce.stdout + produce.stderr);
    check("python producer writes payloads", produce.status === 0, produce.stderr);

    const roots = [
      ["model-descriptor", "model-descriptor.json"],
      ["semantic-model", "semantic-model.json"],
      ["render-manifest", "render-manifest.json"],
    ];
    const rustConsumeLog = [];
    for (const [kind, file] of roots) {
      const bin = join(RUST_CRATE, "..", "..", "target", "debug", "examples", "consume");
      const result = run(bin, [kind, join(producedDir, file)]);
      rustConsumeLog.push(`${kind}: exit=${result.status} ${result.stdout}${result.stderr}`);
      check(`rust consumes Python's produced ${kind}`, result.status === 0, result.stderr);
    }
    log("rust-consume.log", rustConsumeLog.join("\n"));

    const tsConsumeScript = `
      import { parseModelDescriptor, parseSemanticModel, parseRenderManifest } from "${join(TS_PKG, "dist", "index.js")}";
      import { readFileSync } from "node:fs";
      const dir = ${JSON.stringify(producedDir)};
      const read = (f) => JSON.parse(readFileSync(dir + "/" + f, "utf8"));
      const results = {
        "model-descriptor": parseModelDescriptor(read("model-descriptor.json")).ok,
        "semantic-model": parseSemanticModel(read("semantic-model.json")).ok,
        "render-manifest": parseRenderManifest(read("render-manifest.json")).ok,
      };
      console.log(JSON.stringify(results));
    `;
    const tsConsumeFile = join(producedDir, "consume.mjs");
    writeFileSync(tsConsumeFile, tsConsumeScript);
    const tsConsume = run("node", [tsConsumeFile]);
    log("ts-consume.log", tsConsume.stdout + tsConsume.stderr);
    let tsResults = {};
    try {
      tsResults = JSON.parse(tsConsume.stdout.trim());
    } catch {
      // leave tsResults empty; the check below reports the failure
    }
    for (const [kind] of roots) {
      check(`typescript consumes Python's produced ${kind}`, tsConsume.status === 0 && tsResults[kind] === true, tsConsume.stderr);
    }
  } finally {
    rmSync(producedDir, { recursive: true, force: true });
  }

  // --- 4. import-boundary check ---
  const tsForbidden = grepFiles(join(TS_PKG, "src"), [".ts"], [
    /from ["']react/,
    /from ["']next/,
    /from ["']three/,
    /from ["'](\.\.\/){2,}apps\/web/,
  ]);
  check("typescript package has no app/React/Next/Three imports", tsForbidden.length === 0, tsForbidden.join("; "));

  const rustForbidden = grepFiles(join(RUST_CRATE, "src"), [".rs"], [/\bids::/, /\bsqlx::/, /\baxum::/]);
  const rustCargoToml = readFileSync(join(RUST_CRATE, "Cargo.toml"), "utf8");
  const rustForbiddenDeps = ["ids", "sqlx", "axum"].filter((dep) => new RegExp(`^${dep}\\b`, "m").test(rustCargoToml));
  check(
    "rust crate has no ids/sqlx/axum imports or dependencies",
    rustForbidden.length === 0 && rustForbiddenDeps.length === 0,
    [...rustForbidden, ...rustForbiddenDeps].join("; "),
  );

  const pyForbidden = grepFiles(join(PY_PKG, "src"), [".py"], [
    /^\s*import ifcopenshell/m,
    /^\s*import ifctester/m,
    /^\s*from ifc_worker/m,
    /^\s*import sqlalchemy/m,
    /^\s*from fastapi/m,
  ]);
  check("python package has no ifcopenshell/ifctester/database/web-framework imports", pyForbidden.length === 0, pyForbidden.join("; "));

  console.log(`\nevidence written to ${runDir}`);
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
