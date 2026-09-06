#!/usr/bin/env node
// Reproducibly acquires the three real BLCJ S1000 sample-model IFC exports
// (architecture, structure, MEP) the demo evidence in samples/blcj-s1000/ and
// packs/demo/ is built from, and extracts just the .ifc file from each archive
// into samples/ifc/ (already gitignored there; see root .gitignore). Every URL
// below was read directly from the locally saved, already-reviewed source page
// references/bim-checking/downloads/03-blcj-mapping/source-and-terms.html
// (https://blcj.or.jp/archive_index/samplemodel/) — none was invented.
//
// Re-running this script is idempotent and checksum-verifiable: an
// already-downloaded archive whose hash matches the pinned value below is
// reused, not re-fetched; a hash mismatch (the upstream file changed since
// this was pinned) is a hard failure, never a silent overwrite of what earlier
// evidence was generated from.
//
// Usage: node scripts/fetch-demo-models.mjs

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  statSync,
  openSync,
  closeSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE_DIR = join(REPO_ROOT, "samples", "blcj-s1000");
const DOWNLOADS_DIR = join(BASE_DIR, "downloads");
const IFC_DIR = join(REPO_ROOT, "samples", "ifc");
const MANIFEST_PATH = join(BASE_DIR, "manifest.json");

// "S1000" = S造1000㎡事務所モデル (steel-frame, ~1000m² office building), one of
// BLCJ's two official BIM-plan-review sample buildings (the other, RC3000, is
// out of scope here). Each entry below is the smallest archive BLCJ publishes
// for that discipline that is confirmed (via the page's own update log, and by
// unzipping it) to bundle a real IFC export alongside the native file and PDF.
const SOURCES = [
  {
    discipline: "architecture",
    tool: "GLOOBE",
    url: "https://blcj.or.jp/wp/wp-content/uploads/2026/04/BLCJ_S1000_A_GLOOBE.zip",
    zipName: "BLCJ_S1000_A_GLOOBE.zip",
    sha256: "b0d8ca7799a041de777d754f392b1538b70d529f128da553007f5015503ee0a9",
    ifcEntry: "BLCJ_S1000_A_GLOOBE/BLCJsampleIFC_A_GLOOBE_R2.ifc",
    ifcOut: "blcj-s1000-architecture.ifc",
  },
  {
    discipline: "structure",
    tool: "Revit/SS7",
    url: "https://blcj.or.jp/wp/wp-content/uploads/2026/04/BLCJ_S1000_S_Revit.zip",
    zipName: "BLCJ_S1000_S_Revit.zip",
    sha256: "6f14aef6597aa5fef338b00b544b2679bd184041d30e26a7655d6d5ad6586fed",
    ifcEntry: "BLCJ_S1000_S_Revit/S_構造モデル_260319修正分.ifc",
    ifcOut: "blcj-s1000-structure.ifc",
  },
  {
    discipline: "mep",
    tool: "Rebro",
    url: "https://blcj.or.jp/wp/wp-content/uploads/2026/04/BLCJ_S1000_MEP_Rebro.zip",
    zipName: "BLCJ_S1000_MEP_Rebro.zip",
    sha256: "c4535a92ae18b744a101da7f26f27c88b103563b9f02c8c0d348743d1cf51039",
    ifcEntry: "BLCJ_S1000_MEP_Rebro/BLCJ_SampleModel_2022_MEP_Variation_03.ifc",
    ifcOut: "blcj-s1000-mep.ifc",
  },
];

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function main() {
  mkdirSync(DOWNLOADS_DIR, { recursive: true });
  mkdirSync(IFC_DIR, { recursive: true });
  const manifest = [];

  for (const source of SOURCES) {
    const zipPath = join(DOWNLOADS_DIR, source.zipName);
    let zipBytes;
    if (existsSync(zipPath) && sha256Bytes(readFileSync(zipPath)) === source.sha256) {
      console.log(`ok - ${source.zipName} already present and verified`);
      zipBytes = readFileSync(zipPath);
    } else {
      console.log(`downloading ${source.url} ...`);
      await download(source.url, zipPath);
      zipBytes = readFileSync(zipPath);
      const actual = sha256Bytes(zipBytes);
      if (actual !== source.sha256) {
        throw new Error(
          `${source.zipName}: sha256 mismatch — expected ${source.sha256}, got ${actual}. ` +
            "The upstream file may have changed since this script's hash was pinned; " +
            "re-review it before updating the pin.",
        );
      }
      console.log(`ok - ${source.zipName} downloaded and verified (${actual})`);
    }

    // `unzip -p` piped through execFileSync's buffered stdout can hit ENOBUFS on
    // a 30+ MB entry; writing straight to an open file descriptor sidesteps
    // Node's pipe buffering entirely.
    const ifcOutPath = join(IFC_DIR, source.ifcOut);
    const outFd = openSync(ifcOutPath, "w");
    const result = spawnSync("unzip", ["-p", zipPath, source.ifcEntry], {
      stdio: ["ignore", outFd, "pipe"],
    });
    closeSync(outFd);
    if (result.status !== 0) {
      throw new Error(`unzip -p ${zipPath} ${source.ifcEntry} failed: ${result.stderr}`);
    }
    const ifcBytes = readFileSync(ifcOutPath);
    const ifcSha256 = sha256Bytes(ifcBytes);
    console.log(`ok - extracted ${source.ifcOut} (${ifcBytes.length} bytes, sha256 ${ifcSha256})`);

    manifest.push({
      discipline: source.discipline,
      tool: source.tool,
      url: source.url,
      zipPath: `downloads/${source.zipName}`,
      zipSha256: source.sha256,
      zipBytes: statSync(zipPath).size,
      ifcEntry: source.ifcEntry,
      ifcPath: `../ifc/${source.ifcOut}`,
      ifcSha256,
      ifcBytes: ifcBytes.length,
      retrievedAt: new Date().toISOString(),
    });
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nmanifest written to ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
