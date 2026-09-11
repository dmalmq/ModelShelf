#!/usr/bin/env node
// `--scenario inspection` prover for ticket 08 (finding inspection).
//
// Dispatched from scripts/verify-viewer.mjs so the ticket command
// `node scripts/verify-viewer.mjs --scenario inspection` runs the real loop:
// a live checker + IfcTester worker ingest the real BLCJ S1000 delivery and
// the synthetic fixtures, score two runs, and a real browser drives the
// finding inspector against that backend. Assertions compare viewer state
// with /api evidence, never with fixtures.
//
// The fixtures' synthetic geometry is not triangulable by the browser IFC
// engine, so the 100+ member highlight runs against the real BLCJ delivery
// while the non-geometric evidence runs against the fixtures delivery, where
// the IFC2X3 pack against IFC4 models honestly reports incomplete findings.

import { mkdtempSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { cpus, platform, arch as osArch, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";
import {
  BIN_PATH,
  REPO_ROOT,
  buildBinary,
  freePort,
  runCli,
  stopProcess,
  waitForHealth,
} from "./lib/checker-harness.mjs";

const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const EVIDENCE_DIR = join(REPO_ROOT, ".scratch", "modelshelf-prototype", "evidence", "08-finding-inspection");
const SAMPLES = {
  ARCH: join(REPO_ROOT, "samples", "ifc", "blcj-s1000-architecture.ifc"),
  STRUCT: join(REPO_ROOT, "samples", "ifc", "blcj-s1000-structure.ifc"),
  MEP: join(REPO_ROOT, "samples", "ifc", "blcj-s1000-mep.ifc"),
};
const FIXTURES_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "base.ifc");
const BLCJ_IDS = join(REPO_ROOT, "packs", "demo", "blcj-s1000-v2.ids");
const BLCJ_METADATA = join(REPO_ROOT, "packs", "demo", "blcj-s1000-v2.metadata.json");

const results = { passed: false, checks: [], runA: null, runB: null, highlight: null, isolation: null, perf: null };
const nextLogs = [];
const assertPerf = process.argv.includes("--assert-perf");
function check(condition, label) {
  if (!condition) throw new Error(`FAIL - ${label}`);
  console.log(`ok - ${label}`);
  results.checks.push(label);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function mark(page, marks, name) {
  marks.push({ name, t: await page.evaluate(() => performance.now()) });
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function uploadAndAwait(base, sourceModelId, filename, filePath, timeoutMs = 600_000) {
  const bytes = await readFileAsync(filePath);
  const form = new FormData();
  form.set("file", new Blob([bytes]), filename);
  const enqueued = await (
    await fetch(`${base}/api/source-models/${sourceModelId}/revisions`, { method: "POST", body: form })
  ).json();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = (await api(base, "GET", `/api/jobs/${enqueued.id}`)).json;
    if (job.status === "completed" || job.status === "failed") return job;
    if (Date.now() > deadline) throw new Error(`ingest job ${enqueued.id} timed out`);
    await delay(500);
  }
}

async function pageAllFindingObjects(base, findingId) {
  const objects = [];
  let offset = 0;
  const limit = 100;
  let total = Infinity;
  while (offset < total) {
    const page = (await api(base, "GET", `/api/findings/${findingId}/objects?limit=${limit}&offset=${offset}`)).json;
    total = page.total;
    objects.push(...page.objects);
    offset += page.objects.length;
    if (page.objects.length === 0) break;
  }
  return { total, objects };
}

async function waitForHttp(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Next exited before readiness with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await delay(250);
  }
}

async function inspect(page) {
  const diagnostics = await page.evaluate(() => window.__modelshelfViewer?.inspect());
  if (!diagnostics) throw new Error("Viewer diagnostics are unavailable");
  return diagnostics;
}

async function waitForModelsReady(page, timeout) {
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.sources.every(({ status }) => status === "ready"),
    undefined,
    { timeout },
  );
}

async function toggleDiscipline(page, discipline) {
  try {
    await page.locator(`[data-discipline-toggle="${discipline}"]`).click({ timeout: 30_000 });
  } catch (error) {
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((button) => button.offsetParent !== null)
        .map((button) => ({
          text: (button.textContent ?? "").trim().slice(0, 40),
          aria: button.getAttribute("aria-label"),
          data: [...button.attributes].filter(({ name }) => name.startsWith("data-")).map(({ name, value }) => `${name}=${value}`).join(" "),
        })),
    );
    throw new Error(`toggle ${discipline} failed; visible buttons: ${JSON.stringify(buttons).slice(0, 2000)}\n${error}`);
  }
}

export async function runInspectionScenario() {
  const runDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-inspection-"));
  buildBinary(runDir);
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-inspect-data-"));
  const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
  check(seed.status === 0, "seed succeeds");

  const checkerPort = await freePort();
  const checker = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(checkerPort)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  checker.stdout.on("data", (chunk) => nextLogs.push(`checker: ${chunk}`));
  checker.stderr.on("data", (chunk) => nextLogs.push(`checker: ${chunk}`));

  let browser = null;
  let nextProcess = null;
  try {
    await waitForHealth(checkerPort, { child: checker });
    const base = `http://127.0.0.1:${checkerPort}`;

    const blcjMetadata = JSON.parse(await readFileAsync(BLCJ_METADATA, "utf8"));
    const blcjPack = (
      await api(base, "POST", "/api/packs/demo-pack/versions", {
        idsXml: await readFileAsync(BLCJ_IDS, "utf8"),
        metadata: blcjMetadata,
      })
    ).json;
    check(Boolean(blcjPack?.id), "BLCJ pack version is published");

    const arch = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Architecture", discipline: "ARCH" })).json;
    const struct = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Structure", discipline: "STRUCT" })).json;
    const mep = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "MEP", discipline: "MEP" })).json;
    const archJob = await uploadAndAwait(base, arch.id, "arch.ifc", SAMPLES.ARCH);
    const structJob = await uploadAndAwait(base, struct.id, "struct.ifc", SAMPLES.STRUCT);
    const mepJob = await uploadAndAwait(base, mep.id, "mep.ifc", SAMPLES.MEP);
    check(
      archJob.status === "completed" && structJob.status === "completed" && mepJob.status === "completed",
      "all three BLCJ revisions ingest",
    );

    const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Inspection drop" })).json;
    for (const [source, job] of [[arch, archJob], [struct, structJob], [mep, mepJob]]) {
      await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: source.id, modelRevisionId: job.modelRevisionId });
    }
    await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {});

    const runA = (await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId: blcjPack.id })).json;
    check(runA?.run?.status === "completed", "BLCJ run completes");

    const east = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "East", discipline: "ARCH" })).json;
    const west = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "West", discipline: "ARCH" })).json;
    const eastJob = await uploadAndAwait(base, east.id, "east.ifc", FIXTURES_IFC, 120_000);
    const westJob = await uploadAndAwait(base, west.id, "west.ifc", FIXTURES_IFC, 120_000);
    check(eastJob.status === "completed" && westJob.status === "completed", "both fixture revisions ingest");
    const deliveryB = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Evidence drop" })).json;
    await api(base, "POST", `/api/deliveries/${deliveryB.id}/members`, { sourceModelId: east.id, modelRevisionId: eastJob.modelRevisionId });
    await api(base, "POST", `/api/deliveries/${deliveryB.id}/members`, { sourceModelId: west.id, modelRevisionId: westJob.modelRevisionId });
    await api(base, "POST", `/api/deliveries/${deliveryB.id}/finalize`, {});
    const runB = (await api(base, "POST", "/api/runs", { deliveryId: deliveryB.id, packVersionId: blcjPack.id })).json;
    check(runB?.run?.status === "completed", "fixtures run completes with honest incomplete findings");

    const detailA = (await api(base, "GET", `/api/runs/${runA.run.id}`)).json;
    const findingsA = detailA.scorecard.flatMap((band) => band.categories.flatMap((c) => c.findings));
    const flow =
      findingsA.find((f) => f.specName === "MEP flow segment records its outer diameter") ??
      [...findingsA].sort((a, b) => b.objectCount - a.objectCount)[0];
    check(flow?.objectCount > 100, `flow-segment finding carries a 100+ object set (got ${flow?.objectCount})`);
    const paged = await pageAllFindingObjects(base, flow.id);
    check(paged.total === flow.objectCount && paged.objects.length === flow.objectCount, "paging retrieves the full affected set");
    results.runA = { deliveryId: delivery.id, runId: runA.run.id, findingId: flow.id, objectCount: flow.objectCount };

    const detailB = (await api(base, "GET", `/api/runs/${runB.run.id}`)).json;
    const incompleteFinding = detailB.reviewIncomplete[0];
    check(Boolean(incompleteFinding), "fixtures run exposes a non-geometric incomplete finding");
    results.runB = { deliveryId: deliveryB.id, runId: runB.run.id, incompleteCount: detailB.reviewIncomplete.length };

    const webBuild = spawnSync(
      process.execPath,
      [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "build"],
      { cwd: WEB_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CHECKER_ORIGIN: base } },
    );
    nextLogs.push(`next build exited ${webBuild.status}\n${String(webBuild.stdout).slice(-3000)}\n${String(webBuild.stderr).slice(-3000)}\n`);
    if (webBuild.status !== 0) throw new Error("Next production build failed");
    const appPort = await freePort();
    nextProcess = spawn(
      process.execPath,
      [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(appPort)],
      { cwd: WEB_ROOT, env: { ...process.env, CHECKER_ORIGIN: base }, stdio: ["ignore", "pipe", "pipe"] },
    );
    nextProcess.stdout.on("data", (chunk) => nextLogs.push(String(chunk)));
    nextProcess.stderr.on("data", (chunk) => nextLogs.push(String(chunk)));

    const appOrigin = `http://127.0.0.1:${appPort}`;
    await waitForHttp(`${appOrigin}/deliveries/${delivery.id}?run=${runA.run.id}`, nextProcess, 180_000);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      window.__modelshelfViewerVerify = true;
      window.__modelshelfLongTasks = [];
      window.__modelshelfNavStart = performance.now();
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          window.__modelshelfLongTasks.push({
            start: entry.startTime,
            duration: entry.duration,
            attribution: (entry.attribution || []).slice(0, 3).map((a) => ({
              name: a.name,
              containerSrc: a.containerSrc,
            })),
          });
        }
      }).observe({ type: "longtask", buffered: true });
    });
    page.on("pageerror", (error) => nextLogs.push(`browser error: ${error.stack ?? error.message}\n`));

    const perf = {
      machine: { platform: platform(), arch: osArch(), cpus: cpus().length, totalMem: totalmem() },
      browser: { version: browser.version(), viewport: { width: 1440, height: 900 } },
      inputs: null,
      coldMs: null,
      orbitFps: [],
      orbitFpsSmall: [],
      orbitFpsStructOnly: [],
      marks: [],
      selectMs: [],
      filterMs: null,
      longTasks: [],
    };
    const navStart = Date.now();
    await page.goto(`${appOrigin}/deliveries/${delivery.id}?run=${runA.run.id}`, { waitUntil: "domcontentloaded" });
    await waitForModelsReady(page, 360_000);
    perf.coldMs = Date.now() - navStart;
    await mark(page, perf.marks, "ready");

    const review = page.locator("[data-review-screen]");
    const canvas = review.locator("canvas");

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("Inspector canvas has no layout box");
    for (let sample = 0; sample < 3; sample += 1) {
      if (sample === 0) await mark(page, perf.marks, "orbit-full-start");
      const counting = page.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0;
            const started = performance.now();
            function tick() {
              frames += 1;
              if (performance.now() - started < 2000) requestAnimationFrame(tick);
              else resolve({ frames, ms: performance.now() - started });
            }
            requestAnimationFrame(tick);
          }),
      );
      const x0 = canvasBox.x + canvasBox.width * 0.4;
      const x1 = canvasBox.x + canvasBox.width * 0.6;
      const y = canvasBox.y + canvasBox.height * 0.5;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      await page.mouse.move(x1, y, { steps: 20 });
      await page.mouse.up();
      const { frames, ms } = await counting;
      perf.orbitFps.push((frames / ms) * 1000);
    }
    await mark(page, perf.marks, "orbit-full-end");
    perf.orbitFpsSmall = [];
    await page.setViewportSize({ width: 480, height: 300 });
    await delay(500);
    await mark(page, perf.marks, "orbit-small-start");
    for (let sample = 0; sample < 2; sample += 1) {
      const counting = page.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0;
            const started = performance.now();
            function tick() {
              frames += 1;
              if (performance.now() - started < 2000) requestAnimationFrame(tick);
              else resolve({ frames, ms: performance.now() - started });
            }
            requestAnimationFrame(tick);
          }),
      );
      await page.mouse.move(190, 150);
      await page.mouse.down();
      await page.mouse.move(290, 150, { steps: 20 });
      await page.mouse.up();
      const { frames, ms } = await counting;
      perf.orbitFpsSmall.push((frames / ms) * 1000);
    }
    await mark(page, perf.marks, "orbit-small-end");
    await page.setViewportSize({ width: 1440, height: 900 });
    await delay(500);
    perf.readyPerfNow = await page.evaluate(() => performance.now());
    perf.orbitFpsStructOnly = [];
    await toggleDiscipline(page, "ARCH");
    await toggleDiscipline(page, "MEP");
    await delay(500);
    await mark(page, perf.marks, "orbit-struct-start");
    for (let sample = 0; sample < 2; sample += 1) {
      const counting = page.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0;
            const started = performance.now();
            function tick() {
              frames += 1;
              if (performance.now() - started < 2000) requestAnimationFrame(tick);
              else resolve({ frames, ms: performance.now() - started });
            }
            requestAnimationFrame(tick);
          }),
      );
      const { frames, ms } = await counting;
      perf.orbitFpsStructOnly.push((frames / ms) * 1000);
    }
    await mark(page, perf.marks, "orbit-struct-end");
    await toggleDiscipline(page, "ARCH");
    await toggleDiscipline(page, "MEP");
    await delay(500);
    const selectRefs = paged.objects.slice(0, 21).map((o) => o.ref);
    perf.selectMs = await page.evaluate((refs) => {
      const samples = [];
      for (const ref of refs) {
        const started = performance.now();
        window.__modelshelfViewer?.select(ref);
        samples.push(performance.now() - started);
      }
      window.__modelshelfViewer?.select(null);
      return samples;
    }, selectRefs);
    await page.locator('[data-inspector-tab="findings"]').click();
    await page.locator(`[data-finding-id="${flow.id}"]`).click();
    await page.waitForSelector(`[data-evidence-panel="${flow.id}"]`, { timeout: 120_000 });
    // The panel highlights the embedded sample first, then pages every member
    // in; the spatial proof below is about the complete set.
    await page.waitForFunction(
      (expected) => window.__modelshelfViewer?.inspect().renderer.highlightGroups[0]?.requested === expected,
      flow.objectCount,
      { timeout: 120_000 },
    );


    const highlighted = await inspect(page);
    const group = highlighted.renderer.highlightGroups[0];
    check(group?.requested === flow.objectCount, `highlight requests every affected object (${group?.requested})`);
    check((group?.matched ?? 0) > 100, `over 100 finding members are accessible in the viewer (${group?.matched})`);
    const viewerKeys = new Set(highlighted.objects.map((o) => `${o.ref.revisionId}\0${o.ref.objectId}`));
    const missing = paged.objects.filter((o) => !viewerKeys.has(`${o.ref.revisionId}\0${o.ref.objectId}`));
    check(
      missing.length === group.requested - group.matched,
      `members without drawable geometry are accounted, not silently dropped (${missing.length} missing)`,
    );
    check(highlighted.isolatedRequested === flow.objectCount, "selecting a finding isolates its full member set");
    results.highlight = group;

    const storeyCounts = new Map();
    for (const object of paged.objects) storeyCounts.set(object.storey, (storeyCounts.get(object.storey) ?? 0) + 1);
    const narrow = [...storeyCounts.entries()].find(([, count]) => count > 0 && count < flow.objectCount);
    check(Boolean(narrow), "finding members span more than one storey for filter narrowing");
    const [narrowStorey, narrowCount] = narrow;
    const otherRef = paged.objects.find((o) => o.storey !== narrowStorey)?.ref;
    check(Boolean(otherRef), "a member outside the narrowed storey exists for the hidden-selection proof");
    await page.locator('[data-filter="storey"]').selectOption(narrowStorey);
    const filterStart = Date.now();
    await page.waitForFunction(
      (expected) => window.__modelshelfViewer?.inspect().isolatedRequested === expected,
      narrowCount,
      { timeout: 30_000 },
    );
    perf.filterMs = Date.now() - filterStart;
    results.isolation = { storey: narrowStorey, isolatedRequested: narrowCount };
    check(true, `storey filter narrows isolation (${narrowStorey}: ${narrowCount})`);
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-isolated.png") });

    await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), otherRef);
    await page.waitForFunction(() => window.__modelshelfViewer?.inspect().selectedHidden === true, undefined, {
      timeout: 30_000,
    });
    check(true, "selecting an object outside the isolation is reported as hidden");
    check(await review.locator("[data-hidden-notice]").isVisible(), "hidden selection renders an explicit notice");

    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-selection.png") });

    await page.locator("[data-reset-view]").click();
    await page.waitForFunction(
      () => {
        const state = window.__modelshelfViewer?.inspect();
        return state?.selectedHidden === false && state?.isolatedRequested === null;
      },
      undefined,
      { timeout: 30_000 },
    );
    const afterReset = await inspect(page);
    check(
      afterReset.isolatedRequested === null && afterReset.renderer.highlightGroups.length === 1,
      "reset view drops isolation and keeps the finding highlighted in the full delivery",
    );

    await page.locator("[data-section-z]").fill("1.5");
    await page.locator("[data-section-z]").press("Enter");
    await page.waitForFunction(() => window.__modelshelfViewer?.inspect().renderer.clipping === true, undefined, {
      timeout: 30_000,
    });
    check(true, "section cut clips above the project height");
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-section.png") });
    await page.locator("[data-section-z]").fill("");
    await page.locator("[data-section-z]").press("Enter");

    const refreshedBox = await canvas.boundingBox();
    if (!refreshedBox) throw new Error("Inspector canvas has no layout box");
    let picked = null;
    for (const y of [0.5, 0.42, 0.58]) {
      for (const x of [0.5, 0.42, 0.58]) {
        await page.mouse.click(refreshedBox.x + refreshedBox.width * x, refreshedBox.y + refreshedBox.height * y);
        await delay(120);
        picked = (await inspect(page)).snapshot.selected;
        if (picked) break;
      }
      if (picked) break;
    }
    check(Boolean(picked), "canvas picking selects geometry beside the inspector");
    const memberRef = paged.objects[0].ref;
    await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), memberRef);
    await page.locator("[data-inspect-selection]").click();
    await page.waitForSelector("[data-property-panel]", { timeout: 30_000 });
    const panelText = (await review.locator("[data-property-panel]").innerText()).slice(0, 400);
    results.propertySample = panelText;
    const propertyFontSize = await review.locator("[data-property-panel]").evaluate(
      (node) => Number.parseFloat(getComputedStyle(node).fontSize),
    );
    check(propertyFontSize >= 12, `property inspector text meets the 12px floor (${propertyFontSize}px)`);
    const secondMemberRef = paged.objects.find(
      (object) =>
        object.ref.revisionId !== memberRef.revisionId ||
        object.ref.objectId !== memberRef.objectId,
    )?.ref;
    check(Boolean(secondMemberRef), "a second member is available for property cleanup");
    if (secondMemberRef) {
      await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), secondMemberRef);
      await page.waitForSelector("[data-property-panel]", { state: "detached", timeout: 30_000 });
      check(true, "changing viewer selection clears stale property details");
    }

    const finale = await inspect(page);
    perf.inputs = {
      revisions: finale.snapshot.sources.map((source) => ({ revisionId: source.revisionId })),
      objects: finale.objects.length,
      triangles: finale.resources.triangles,
    };
    perf.longTasks = await page.evaluate(() => window.__modelshelfLongTasks ?? []);
    results.perf = perf;
    const orbitMedian = median(perf.orbitFps);
    const selectP95 = percentile(perf.selectMs, 95);
    const markTime = (name) => perf.marks.find((m) => m.name === name)?.t ?? null;
    const orbitWindows = [
      [markTime("orbit-full-start"), markTime("orbit-full-end")],
      [markTime("orbit-small-start"), markTime("orbit-small-end")],
      [markTime("orbit-struct-start"), markTime("orbit-struct-end")],
    ].filter(([a, b]) => a !== null && b !== null);
    const inOrbit = (entry) => orbitWindows.some(([a, b]) => entry.start >= a && entry.start <= b);
    const coldTasks = perf.longTasks.filter((entry) => entry.start < perf.readyPerfNow);
    const uiTasks = perf.longTasks.filter((entry) => entry.start >= perf.readyPerfNow && !inOrbit(entry));
    const orbitTasks = perf.longTasks.filter((entry) => entry.start >= perf.readyPerfNow && inOrbit(entry));
    const maxColdTask = coldTasks.reduce((max, entry) => Math.max(max, entry.duration), 0);
    const maxUiTask = uiTasks.reduce((max, entry) => Math.max(max, entry.duration), 0);
    const maxOrbitTask = orbitTasks.reduce((max, entry) => Math.max(max, entry.duration), 0);
    perf.longTaskSummary = {
      coldCount: coldTasks.length,
      maxColdMs: maxColdTask,
      uiCount: uiTasks.length,
      maxUiMs: maxUiTask,
      orbitCount: orbitTasks.length,
    };
    // Threshold verdicts are the Wave 1 gate (ticket 09), requested explicitly
    // with --assert-perf. The default run records the same numbers without
    // failing, so ticket 08's functional proof stays green on any host.
    const gate = (condition, label) => {
      results.perf.gate = results.perf.gate ?? [];
      results.perf.gate.push({ label, met: Boolean(condition) });
      if (assertPerf) check(condition, label);
      else console.log(`recorded (gate only) - ${label}`);
    };
    gate(perf.coldMs < 15_000, `cold usable geometry arrives within 15 s (${perf.coldMs} ms)`);
    gate(orbitMedian >= 30, `median orbit stays at 30 FPS or above (${orbitMedian.toFixed(1)})`);
    gate(selectP95 < 200, `p95 selection stays below 200 ms (${selectP95.toFixed(1)} ms)`);
    gate(perf.filterMs < 500, `filtering stays below 500 ms (${perf.filterMs} ms)`);
    gate(maxUiTask < 200, `no non-render UI task over 200 ms (${maxUiTask.toFixed(1)} ms max)`);
    await page.goto(`${appOrigin}/deliveries/${deliveryB.id}?run=${runB.run.id}`, { waitUntil: "domcontentloaded" });

    await waitForModelsReady(page, 180_000);
    await page.locator('[data-inspector-tab="findings"]').click();
    await page.waitForSelector(`[data-finding-id="${incompleteFinding.id}"]`, { timeout: 60_000 });
    await page.locator(`[data-finding-id="${incompleteFinding.id}"]`).click();
    await page.waitForSelector(`[data-evidence-panel="${incompleteFinding.id}"]`, { timeout: 60_000 });
    await page.waitForSelector(`[data-evidence-panel="${incompleteFinding.id}"] [data-incomplete-evidence]`, { timeout: 30_000 });
    const evidenceText = await page.locator(`[data-evidence-panel="${incompleteFinding.id}"]`).innerText();
    const undecidedText = await page
      .locator(`[data-evidence-panel="${incompleteFinding.id}"] [data-incomplete-evidence]`)
      .innerText();
    results.incompleteEvidence = evidenceText.slice(0, 400);
    // An undecided requirement must say so in its own panel and must never be
    // explained away as "not applicable".
    check(
      /未判定|Review incomplete/i.test(undecidedText) && !/対象外|not applicable/i.test(undecidedText),
      `review-incomplete finding states that it could not be decided (${undecidedText.slice(0, 80)})`,
    );
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-evidence.png"), fullPage: true });

    results.passed = true;
    console.log("viewer inspection verification passed");
  } catch (error) {
    results.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (nextProcess) await stopProcess(nextProcess);
    await stopProcess(checker);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    writeFileSync(join(EVIDENCE_DIR, "verifier.log"), nextLogs.join(""));
  }
}
