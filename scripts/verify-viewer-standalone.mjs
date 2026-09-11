#!/usr/bin/env node
// `--scenario standalone` prover for the reusable viewer package (ticket 19,
// implemented as the ticket 16 prerequisite). Runs with the checker, worker,
// and Next.js stopped: the import-boundary check and example build run first,
// then a static server serves packages/model-viewer and a real browser drives
// the plain-browser example through public exports only.
//
// Dispatched from scripts/verify-viewer.mjs so the ticket command
// `node scripts/verify-viewer.mjs --scenario standalone` runs the full loop.

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";

import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";
import { REPO_ROOT } from "./lib/checker-harness.mjs";

const EVIDENCE_DIR = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "ticket-16", "standalone");
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

async function waitFor(path, serverProcess) {
  const url = `http://127.0.0.1:${serverProcess.port}${path}`;
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

  // 1. the import-boundary check must hold before the bundle is trusted.
  const boundary = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "check-viewer-imports.mjs")], {
    stdio: "inherit",
  });
  if (boundary.status !== 0) throw new Error("viewer import-boundary check failed before the standalone run");

  // 2. (re)build the public core bundle.
  const build = spawnSync("npm", ["--prefix", "packages/model-viewer", "run", "build:example"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (build.status !== 0) throw new Error("example bundle build failed");

  const bundleBytes = readFileSync(join(PKG_ROOT, "dist", "model-viewer.core.mjs"));
  check(
    !bundleBytes.includes("web-ifc"),
    "the public core bundle contains no web-ifc",
    `${bundleBytes.byteLength} bytes`,
  );

  // 3. serve the package directory statically (no backend).
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
  fixtureServer.port = await listen(fixtureServer);
  const origin = `http://127.0.0.1:${fixtureServer.port}`;

  let browser = null;
  const pageLogs = [];
  try {
    await waitFor("/example/index.html", fixtureServer);

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
          return parsed.models?.length === 2 && parsed.models.every((m) => m.status === "ready");
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 60_000 },
    );

    let state = await readState();
    check(state.models.length === 2, "both fixture revisions reach ready");
    check(
      state.models.find((m) => m.id === "rev-a")?.objects === 3 &&
        state.models.find((m) => m.id === "rev-b")?.objects === 2,
      "each revision exposes its authored object count",
      JSON.stringify(state.models),
    );

    await page.getByRole("button", { name: "Highlight A" }).click();
    state = await readState();
    check(
      state.highlightGroups.length === 1 && state.highlightGroups[0] === 5,
      "highlight paints every authored object",
      JSON.stringify(state.highlightGroups),
    );

    await page.getByRole("button", { name: "Isolate A" }).click();
    state = await readState();
    check(
      state.isolatedMatched === 3,
      "isolate shows only the isolated revision's objects",
      JSON.stringify(state.isolatedMatched),
    );

    await page.getByRole("button", { name: "Section z=0.5" }).click();
    state = await readState();
    check(state.clipping === true, "the section plane clips the scene");

    const canvasBox = await page.locator("canvas").boundingBox();
    if (!canvasBox) throw new Error("The example canvas has no layout box");
    let picked = false;
    const fractions = [0.5, 0.42, 0.58, 0.34, 0.66];
    for (const y of fractions) {
      for (const x of fractions) {
        await page.mouse.click(canvasBox.x + canvasBox.width * x, canvasBox.y + canvasBox.height * y);
        await delay(120);
        const current = await readState();
        if (current.selected?.revisionId) {
          picked = true;
          state = current;
          break;
        }
      }
      if (picked) break;
    }
    check(picked, "clicking an instance selects its revision-qualified ObjectRef", state.selected?.objectId);

    await page.screenshot({ path: join(runDir, "standalone-picked.png") });


    await page.getByRole("button", { name: /Unload/ }).click();
    state = await readState();
    check(state.unloaded === true, "unload disposes the viewer");

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