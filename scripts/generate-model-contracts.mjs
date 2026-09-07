#!/usr/bin/env node
// Regenerates the Rust, Python, and TypeScript bindings for schemas/model/v1 from
// the canonical JSON Schema files. `--check` regenerates into temporary locations
// and diffs against the committed files instead of overwriting them (used in CI and
// by scripts/verify-model-contracts.mjs).
//
// Prerequisites (one-time local setup, not installed by this script):
//   cargo install cargo-typify --version 0.7.0 --locked
//   uv sync --project packages/model-contracts-py  (pulls datamodel-code-generator)
//   npm install --prefix scripts
//   npm install --prefix packages/model-contracts-ts
//
// Usage: node scripts/generate-model-contracts.mjs [--check]

import RefParser from "@apidevtools/json-schema-ref-parser";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(REPO_ROOT, "schemas", "model", "v1");
const RUST_GENERATED = join(REPO_ROOT, "crates", "model-contracts", "src", "generated.rs");
const PY_PKG = join(REPO_ROOT, "packages", "model-contracts-py");
const PY_GENERATED = join(PY_PKG, "src", "model_contracts", "generated.py");
const TS_PKG = join(REPO_ROOT, "packages", "model-contracts-ts");

// Maps each top-level schema file to the PascalCase name it becomes under a
// combined document's $defs, so Rust and Python generate ObjectRef (etc.) exactly
// once and every referencing type shares that one definition, instead of each
// generator inlining its own copy per root schema (harmless in structurally-typed
// TypeScript, but a real duplicate-type problem in nominally-typed Rust/Python).
const NAME_MAP = {
  "object-ref.schema.json": "ObjectRef",
  "transform.schema.json": "Transform",
  "semantic-capability.schema.json": "SemanticCapability",
  "render-capability.schema.json": "RenderCapability",
  "model-descriptor.schema.json": "ModelDescriptor",
  "semantic-model.schema.json": "SemanticModel",
  "render-manifest.schema.json": "RenderManifest",
  "geometry-chunk.schema.json": "GeometryChunk",
};

function rewriteCrossFileRefs(node) {
  if (Array.isArray(node)) {
    node.forEach(rewriteCrossFileRefs);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string" && NAME_MAP[value]) {
        node[key] = `#/$defs/${NAME_MAP[value]}`;
      } else {
        rewriteCrossFileRefs(value);
      }
    }
  }
}

/**
 * Builds one self-contained JSON Schema document with every type under a flat
 * top-level $defs, so a single-file generator (cargo-typify) can see the whole
 * contract and dedupe shared types. json-schema-to-typescript (used for the
 * TypeScript package) resolves the original per-file $refs directly and does not
 * need this — see packages/model-contracts-ts/scripts/generate.mjs.
 */
function buildCombinedSchema() {
  const defs = {};
  for (const [file, name] of Object.entries(NAME_MAP)) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8"));
    delete schema.$id;
    delete schema.$schema;
    rewriteCrossFileRefs(schema);
    if (schema.$defs) {
      for (const [localName, localSchema] of Object.entries(schema.$defs)) {
        if (localName in defs) throw new Error(`$defs name collision: ${localName}`);
        defs[localName] = localSchema;
      }
      delete schema.$defs;
    }
    defs[name] = schema;
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $defs: defs };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") {
    throw new Error(`'${command}' not found on PATH. See the prerequisites in this script's header.`);
  }
  return result;
}

function generateRust(combinedSchemaPath) {
  const result = run("cargo", ["typify", combinedSchemaPath, "--no-builder", "-o", "-"]);
  if (result.status !== 0) {
    throw new Error(`cargo typify failed:\n${result.stdout}\n${result.stderr}`);
  }
  return (
    "// GENERATED FILE. Do not edit by hand.\n" +
    "// Source: schemas/model/v1/*.schema.json (combined; see scripts/generate-model-contracts.mjs)\n" +
    "// Regenerate: node scripts/generate-model-contracts.mjs\n" +
    result.stdout
  );
}

/** Removes datamodel-codegen's unrequested root `Model(RootModel[Any])` (an
 * artifact of the combined document having no top-level "type" of its own) and the
 * two imports that then go unused, so the generated file only contains our types. */
function stripStrayRootModel(source) {
  const withoutClass = source.replace(/\n\nclass Model\(RootModel\[Any\]\):\n {4}root: Any\n/, "");
  return withoutClass
    .replace("from typing import Any, Literal", "from typing import Literal")
    .replace("    PositiveFloat,\n    RootModel,\n    conint,", "    PositiveFloat,\n    conint,");
}

function generatePython(combinedSchemaPath) {
  const tmpOut = join(dirname(combinedSchemaPath), "generated.py");
  const result = run(
    "uv",
    [
      "run",
      "--project",
      PY_PKG,
      "datamodel-codegen",
      "--input",
      combinedSchemaPath,
      "--input-file-type",
      "jsonschema",
      "--output",
      tmpOut,
      "--output-model-type",
      "pydantic_v2.BaseModel",
      "--target-python-version",
      "3.12",
      "--use-schema-description",
      "--disable-timestamp",
      "--collapse-root-models",
      "--enum-field-as-literal",
      "one",
    ],
    { cwd: REPO_ROOT },
  );
  if (result.status !== 0) {
    throw new Error(`datamodel-codegen failed:\n${result.stdout}\n${result.stderr}`);
  }
  const raw = readFileSync(tmpOut, "utf8");
  const banner =
    "# GENERATED FILE. Do not edit by hand.\n" +
    "# Source: schemas/model/v1/*.schema.json (combined; see scripts/generate-model-contracts.mjs)\n" +
    "# Regenerate: node scripts/generate-model-contracts.mjs\n";
  const body = raw.replace(/^# generated by datamodel-codegen:\n#[^\n]*\n\n/, "");
  return banner + "\n" + stripStrayRootModel(body);
}

function generateTsInto(check) {
  const result = run("node", ["scripts/generate.mjs", ...(check ? ["--check"] : [])], { cwd: TS_PKG });
  return { ok: result.status === 0, output: result.stdout + result.stderr };
}

function diff(label, committedPath, freshContent) {
  const committed = existsSync(committedPath) ? readFileSync(committedPath, "utf8") : null;
  if (committed === freshContent) return { label, drifted: false };
  return { label, drifted: true, path: committedPath };
}

async function main() {
  const check = process.argv.includes("--check");
  const workDir = mkdtempSync(join(tmpdir(), "model-contracts-gen-"));
  const results = [];

  try {
    const combined = buildCombinedSchema();
    const combinedPath = join(workDir, "model-v1.combined.json");
    writeFileSync(combinedPath, JSON.stringify(combined, null, 2));

    const rustContent = generateRust(combinedPath);
    const pythonContent = generatePython(combinedPath);
    const ts = generateTsInto(check);
    results.push({ label: "typescript (packages/model-contracts-ts)", ok: ts.ok, output: ts.output });

    if (check) {
      results.push({
        label: "rust (crates/model-contracts/src/generated.rs)",
        ...(() => {
          const d = diff("rust", RUST_GENERATED, rustContent);
          return { ok: !d.drifted, output: d.drifted ? `drift in ${RUST_GENERATED}` : "up to date" };
        })(),
      });
      results.push({
        label: "python (packages/model-contracts-py/src/model_contracts/generated.py)",
        ...(() => {
          const d = diff("python", PY_GENERATED, pythonContent);
          return { ok: !d.drifted, output: d.drifted ? `drift in ${PY_GENERATED}` : "up to date" };
        })(),
      });
    } else {
      writeFileSync(RUST_GENERATED, rustContent);
      writeFileSync(PY_GENERATED, pythonContent);
      results.push({ label: "rust (crates/model-contracts/src/generated.rs)", ok: true, output: "written" });
      results.push({
        label: "python (packages/model-contracts-py/src/model_contracts/generated.py)",
        ok: true,
        output: "written",
      });
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  let failed = false;
  for (const r of results) {
    console.log(`${r.ok ? "ok" : "FAIL"} - ${r.label}${r.output ? `: ${r.output.trim()}` : ""}`);
    if (!r.ok) failed = true;
  }
  if (failed) {
    console.error(check ? "\ngenerated files are out of date; run: node scripts/generate-model-contracts.mjs" : "\ngeneration failed");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
