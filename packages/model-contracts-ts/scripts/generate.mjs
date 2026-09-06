#!/usr/bin/env node
// Regenerates src/generated/*.ts from schemas/model/v1/*.schema.json. Deterministic:
// same schema in, byte-identical output out. `--check` regenerates into a temp
// directory and diffs against the committed files instead of overwriting them.
import { compileFromFile } from "json-schema-to-typescript";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(PKG_ROOT, "..", "..", "schemas", "model", "v1");
const GENERATED_DIR = join(PKG_ROOT, "src", "generated");

const ROOTS = [
  ["object-ref.schema.json", "object-ref.ts"],
  ["model-descriptor.schema.json", "model-descriptor.ts"],
  ["semantic-model.schema.json", "semantic-model.ts"],
  ["render-manifest.schema.json", "render-manifest.ts"],
];

async function generateInto(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const [schemaFile, outFile] of ROOTS) {
    const ts = await compileFromFile(join(SCHEMA_DIR, schemaFile), {
      cwd: SCHEMA_DIR,
      bannerComment:
        "/* eslint-disable */\n/**\n * GENERATED FILE. Do not edit by hand.\n * Source: schemas/model/v1/" +
        schemaFile +
        "\n * Regenerate: npm run generate --prefix packages/model-contracts-ts\n */",
      style: { singleQuote: false },
    });
    writeFileSync(join(outDir, outFile), ts);
  }
}

function readAll(dir) {
  const out = new Map();
  for (const [, outFile] of ROOTS) {
    out.set(outFile, readFileSync(join(dir, outFile), "utf8"));
  }
  return out;
}

async function main() {
  const check = process.argv.includes("--check");
  if (!check) {
    await generateInto(GENERATED_DIR);
    console.log(`generated ${ROOTS.length} file(s) into ${GENERATED_DIR}`);
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "model-contracts-ts-check-"));
  try {
    await generateInto(tmp);
    const fresh = readAll(tmp);
    const committed = readAll(GENERATED_DIR);
    const drifted = [];
    for (const [file, freshContent] of fresh) {
      if (committed.get(file) !== freshContent) drifted.push(file);
    }
    if (drifted.length > 0) {
      console.error(`generated files are out of date: ${drifted.join(", ")}`);
      console.error("run: npm run generate --prefix packages/model-contracts-ts");
      process.exit(1);
    }
    console.log("generated files match schemas/model/v1 (no drift)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
