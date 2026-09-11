#!/usr/bin/env node
// Stages the four Autodesk Snowdon Towers IFC exports (architecture,
// structure, electrical, plumbing) into samples/ifc/ from a local directory,
// verifying each against the SHA-256 pinned in samples/snowdon-towers/manifest.json.
//
// Unlike scripts/fetch-demo-models.ts there is no download step: no confirmed
// public URL exists for this dataset and Autodesk publishes no redistribution
// grant for it (see samples/snowdon-towers/README.md). The files come from the
// operator's own copy of the Autodesk sample content.
//
// Re-running is idempotent: an already-staged file whose hash matches is left
// alone, not rewritten. A hash mismatch is a hard failure, never a silent
// overwrite of what earlier evidence was generated from.
//
// Usage: node scripts/stage-snowdon-models.ts --from "/path/to/Sample Data"
//        node scripts/stage-snowdon-models.ts --from "$SNOWDON_SRC" --verify-only

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = join(REPO_ROOT, "samples", "snowdon-towers", "manifest.json");
const IFC_DIR = join(REPO_ROOT, "samples", "ifc");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stagedPath(model) {
  return join(IFC_DIR, `snowdon-towers-${model.discipline}.ifc`);
}

function main() {
  const from = arg("--from") ?? process.env.SNOWDON_SRC;
  const verifyOnly = process.argv.includes("--verify-only");
  if (!from) {
    console.error(
      'usage: node scripts/stage-snowdon-models.ts --from "<directory holding the four .ifc files>"\n' +
        "       (or set SNOWDON_SRC). See samples/snowdon-towers/README.md.",
    );
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  mkdirSync(IFC_DIR, { recursive: true });

  let staged = 0;
  let reused = 0;
  for (const model of manifest.models) {
    const dest = stagedPath(model);
    if (existsSync(dest) && statSync(dest).size === model.ifcBytes) {
      const have = sha256(readFileSync(dest));
      if (have === model.ifcSha256) {
        console.log(`ok       ${model.discipline.padEnd(12)} already staged (${model.ifcBytes.toLocaleString()} bytes)`);
        reused += 1;
        continue;
      }
      throw new Error(
        `${dest} exists but its SHA-256 is ${have}, not the pinned ${model.ifcSha256}. ` +
          "Refusing to overwrite: earlier evidence may have been generated from it. " +
          "Move it aside deliberately if you intend to replace it.",
      );
    }

    const source = join(from, model.originalFilename);
    if (!existsSync(source)) {
      throw new Error(`missing ${source}. Expected the original filename "${model.originalFilename}" under --from.`);
    }
    const bytes = readFileSync(source);
    const have = sha256(bytes);
    if (have !== model.ifcSha256) {
      throw new Error(
        `${source} has SHA-256 ${have}, not the pinned ${model.ifcSha256}. ` +
          "This is a different export than the one the recorded alignment and object counts describe. " +
          "Re-pin manifest.json deliberately, with fresh measurements, rather than staging it silently.",
      );
    }
    if (verifyOnly) {
      console.log(`verified ${model.discipline.padEnd(12)} ${model.ifcBytes.toLocaleString()} bytes (not staged)`);
      continue;
    }
    writeFileSync(dest, bytes);
    console.log(`staged   ${model.discipline.padEnd(12)} -> samples/ifc/snowdon-towers-${model.discipline}.ifc`);
    staged += 1;
  }

  const total = manifest.models.reduce((sum, model) => sum + model.ifcBytes, 0);
  console.log(
    `\n${manifest.models.length} models, ${total.toLocaleString()} bytes total ` +
      `(${staged} staged, ${reused} already present).`,
  );
  console.log("These files are gitignored and must not be committed or redistributed.");
}

main();
