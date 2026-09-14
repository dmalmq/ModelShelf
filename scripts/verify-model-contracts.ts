#!/usr/bin/env node
// End-to-end verification of the shared model contract (schemas/model/v1):
//   1. regeneration is deterministic (delegates to generate-model-contracts.ts --check)
//   2. each language's own fixture test suite passes (cargo test / pytest / node --test)
//   3. a real cross-language round trip: Python produces payloads with its own
//      generated types, Rust and TypeScript each consume those exact files
//   4. none of the three packages import application/database/checking-engine code
//
// Everything Python/Rust write lands in one isolated temp directory, removed when
// this script exits. Usage: node scripts/verify-model-contracts.ts

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

function walkSourceFiles(dir, extensions) {
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".venv" || entry.name === "dist" || entry.name === "target") continue;
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) files.push(path);
    }
  };
  walk(dir);
  return files;
}

function schemaTitles() {
  const dir = join(REPO_ROOT, "schemas", "model", "v1");
  const titles = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".schema.json")) continue;
    const schema = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (typeof schema.title === "string" && schema.title.length > 0) titles.push(schema.title);
  }
  return titles;
}

function countTsFields(block) {
  return [...block.matchAll(/^\s*(?:readonly\s+)?(\w+)\??:/gm)].length;
}

function scanHandRolledSharedPayloads(roots) {
  const titles = schemaTitles();
  const hits = [];
  for (const root of roots) {
    for (const file of walkSourceFiles(root, [".ts", ".tsx", ".rs"])) {
      const content = readFileSync(file, "utf8");
      if (file.endsWith(".rs")) {
        for (const title of titles) {
          if (new RegExp(`\\bstruct\\s+${title}\\b`).test(content)) hits.push(`${file} declares struct ${title}`);
          if (new RegExp(`\\bstruct\\s+${title}Out\\b`).test(content)) hits.push(`${file} declares struct ${title}Out`);
        }
        for (const match of content.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/gs)) {
          const fields = [...match[2].matchAll(/pub\s+(\w+)\s*:/g)].map((field) => field[1]);
          if (fields.length === 2 && fields.includes("revision_id") && fields.includes("object_id")) {
            hits.push(`${file} restates a two-field ObjectRef as struct ${match[1]}`);
          }
        }
        continue;
      }
      for (const title of titles) {
        if (new RegExp(`(?:export\\s+)?interface\\s+${title}\\b`).test(content)) {
          hits.push(`${file} declares interface ${title}`);
        }
        if (new RegExp(`(?:export\\s+)?type\\s+${title}\\s*=`).test(content)) {
          hits.push(`${file} declares type ${title}`);
        }
      }
      for (const match of content.matchAll(
        /(?:export\s+)?(?:interface|type)\s+(\w+)\s*(?:=\s*)?\{([^}]*revisionId:\s*string;[^}]*objectId:\s*string;[^}]*)\}/gs,
      )) {
        if (countTsFields(match[2]) === 2) {
          hits.push(`${file} restates a two-field { revisionId, objectId } type as ${match[1]}`);
        }
      }
    }
  }
  return hits;
}

function scanMappingCopies(roots) {
  const hits = [];
  for (const root of roots) {
    for (const file of walkSourceFiles(root, [".ts", ".tsx", ".mjs", ".js"])) {
      if (file.includes("model-contracts-ts")) continue;
      if (file.includes("verify-model-contracts.ts")) continue;
      const content = readFileSync(file, "utf8");
      const hashesExpressId =
        /createHash\(\s*["']sha256["']\s*\)/.test(content) &&
        /revisionId:\$\{|\$\{revisionId\}:/.test(content) &&
        /occ_/.test(content);
      const subtleExpressId =
        /crypto\.subtle\.digest/.test(content) &&
        /revisionId:\$\{|\$\{revisionId\}:/.test(content) &&
        /occ_/.test(content);
      if (hashesExpressId || subtleExpressId) hits.push(`${file} reimplements occ_+sha256 express-id mapping`);
    }
  }
  return hits;
}

function selfCheckDuplicateDetector() {
  const dir = mkdtempSync(join(tmpdir(), "model-contracts-dup-"));
  try {
    writeFileSync(
      join(dir, "dup.ts"),
      "export interface ObjectRef {\n  revisionId: string;\n  objectId: string;\n}\n",
    );
    const payloadCopy = scanHandRolledSharedPayloads([dir]).length > 0;
    writeFileSync(
      join(dir, "hash.ts"),
      'import { createHash } from "node:crypto";\nconst objectId = `occ_${createHash("sha256").update(`${revisionId}:${expressId}`).digest("hex").slice(0, 16)}`;\n',
    );
    const mappingCopy = scanMappingCopies([dir]).length > 0;
    return payloadCopy && mappingCopy;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const log = (name, content) => writeFileSync(join(runDir, name), content);

  // --- 1. deterministic regeneration ---
  const genCheck = run("node", ["scripts/generate-model-contracts.ts", "--check"]);
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
      import { parseModelDescriptor, parseSemanticModel, parseRenderManifest } from "${join(TS_PKG, "dist", "validate.js")}";
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

  // --- 5. consumers must not restate shared payload shapes ---
  const consumerHits = scanHandRolledSharedPayloads([
    join(REPO_ROOT, "apps", "web", "src"),
    join(REPO_ROOT, "services", "checker", "src"),
  ]);
  check(
    "apps/web and checker do not restate shared model payloads",
    consumerHits.length === 0,
    consumerHits.join("; "),
  );

  const mappingHits = scanMappingCopies([
    join(REPO_ROOT, "apps", "web", "src"),
    join(REPO_ROOT, "services", "checker", "src"),
    join(REPO_ROOT, "packages", "model-viewer", "src"),
    join(REPO_ROOT, "scripts"),
  ]);
  check(
    "no extra TypeScript occ_+sha256 express-id mapping outside model-contracts-ts",
    mappingHits.length === 0,
    mappingHits.join("; "),
  );

  const selfHits = selfCheckDuplicateDetector();
  check("duplicate-payload detector flags a planted ObjectRef copy", selfHits, "");

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
