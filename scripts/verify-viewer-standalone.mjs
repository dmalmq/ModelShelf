#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EVIDENCE_DIR = join(REPO_ROOT, ".scratch", "modelshelf-prototype", "evidence", "19-extract-viewer", "standalone");
const PKG_ROOT = join(REPO_ROOT, "packages", "model-viewer");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
};

function mimeFor(path) {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function waitFor(path, port) {
  const url = `http://127.0.0.1:${port}${path}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function runStandaloneScenario() {
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const log = (name, value) =>
    writeFileSync(join(runDir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));

  const results = { passed: false, checks: [] };
  const check = (condition, label, detail) => {
    if (!condition) throw new Error(`FAIL - ${label}${detail ? ` (${detail})` : ""}`);
    console.log(`ok - ${label}`);
    results.checks.push(label);
  };

  const boundary = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "check-viewer-imports.mjs")], {
    stdio: "inherit",
  });
  if (boundary.status !== 0) throw new Error("viewer import-boundary check failed before the standalone run");

  const build = spawnSync("npm", ["--prefix", "packages/model-viewer", "run", "build:example"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  });
  if (build.status !== 0) throw new Error("example bundle build failed");

  const bundleBytes = readFileSync(join(PKG_ROOT, "dist", "model-viewer.mjs"));
  check(
    !bundleBytes.includes("web-ifc"),
    "the public core bundle contains no web-ifc",
    `${bundleBytes.byteLength} bytes`,
  );

  const fixtureServer = createServer((request, response) => {
    const raw = (request.url ?? "/").split("?")[0];
    const rel = raw === "/" ? "/example/index.html" : raw;
    const resolved = normalize(join(PKG_ROOT, rel));
    if (!resolved.startsWith(PKG_ROOT + sep) && resolved !== PKG_ROOT) {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("forbidden");
      return;
    }
    try {
      const file = readFileSync(resolved);
      response.writeHead(200, { "content-type": mimeFor(resolved) });
      response.end(file);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    }
  });
  const port = await listen(fixtureServer);
  const origin = `http://127.0.0.1:${port}`;

  let browser = null;
  const pageLogs = [];
  try {
    await waitFor("/example/index.html", port);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (message) => pageLogs.push(`${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => pageLogs.push(`pageerror: ${error.stack ?? error.message}`));

    await page.goto(`${origin}/example/index.html`, { waitUntil: "domcontentloaded" });

    const readState = () =>
      page.evaluate(() => {
        const text = document.getElementById("state")?.textContent ?? "";
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      });

    await page.waitForFunction(
      () => {
        const text = document.getElementById("state")?.textContent ?? "";
        try {
          const parsed = JSON.parse(text);
          return parsed.sources?.length === 2 && parsed.sources.every((source) => source.status === "ready");
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 60_000 },
    );

    let current = await readState();
    check(current.sources.length === 2, "both fixture revisions reach ready");

    await page.locator("#pick").click();
    current = await readState();
    check(
      current.selected?.revisionId === "east-wing" && current.selected?.objectId === "wall-01",
      "pick selects the authored opaque ObjectRef",
      JSON.stringify(current.selected),
    );

    await page.locator("#highlight").click();
    current = await readState();
    check(
      current.highlightGroups.length === 1 && current.highlightGroups[0] === 2,
      "highlight paints the authored wall and slab",
      JSON.stringify(current.highlightGroups),
    );

    await page.locator("#isolate").click();
    current = await readState();
    check(current.isolatedMatched === 1, "isolate shows only the isolated object", JSON.stringify(current.isolatedMatched));

    await page.locator("#section").click();
    current = await readState();
    check(current.clipping === true, "the section plane clips the scene");

    await page.screenshot({ path: join(runDir, "standalone-picked.png") });

    await page.locator("#unload").click();
    current = await readState();
    check(current.unloaded === true, "unload disposes the viewer");

    check(
      pageLogs.filter((line) => line.startsWith("pageerror:") || line.startsWith("error:")).length === 0,
      "the example page reports no console or page errors",
      pageLogs.join(" | "),
    );
    log("page.log", pageLogs.join("\n"));

    results.passed = true;
    results.log = pageLogs;
    console.log("standalone viewer verification passed");
  } finally {
    if (browser) await browser.close();
    await closeServer(fixtureServer);
    writeFileSync(join(runDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runStandaloneScenario();
}
