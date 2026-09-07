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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
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

const results = { passed: false, checks: [], runA: null, runB: null, highlight: null, isolation: null };
const nextLogs = [];

function check(condition, label) {
  if (!condition) throw new Error(`FAIL - ${label}`);
  console.log(`ok - ${label}`);
  results.checks.push(label);
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
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout },
  );
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

    const appPort = await freePort();
    nextProcess = spawn(
      process.execPath,
      [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(appPort)],
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
    });
    page.on("console", (message) => nextLogs.push(`browser ${message.type()}: ${message.text()}\n`));
    page.on("pageerror", (error) => nextLogs.push(`browser error: ${error.stack ?? error.message}\n`));

    await page.goto(`${appOrigin}/deliveries/${delivery.id}?run=${runA.run.id}`, { waitUntil: "domcontentloaded" });
    await waitForModelsReady(page, 360_000);
    await page.getByRole("tab", { name: /Findings/ }).click();
    await page.locator(`[data-finding-id="${flow.id}"]`).click();
    await page.waitForSelector(`[data-inspector-active="${flow.id}"]`, { timeout: 120_000 });

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
    await page.getByLabel("Storey filter").selectOption(narrowStorey);
    await page.getByRole("button", { name: /Apply filters/ }).click();
    await page.waitForFunction(
      (expected) => window.__modelshelfViewer?.inspect().isolatedRequested === expected,
      narrowCount,
      { timeout: 30_000 },
    );
    results.isolation = { storey: narrowStorey, isolatedRequested: narrowCount };
    check(true, `storey filter narrows isolation (${narrowStorey}: ${narrowCount})`);
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-isolated.png") });

    await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), otherRef);
    await page.waitForFunction(() => window.__modelshelfViewer?.inspect().selectedHidden === true, undefined, {
      timeout: 30_000,
    });
    check(true, "selecting an object outside the isolation is reported as hidden");
    check(await page.locator("[data-hidden-notice]").isVisible(), "hidden selection renders an explicit notice");
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-selection.png") });

    await page.getByRole("button", { name: /Reset view/ }).click();
    await page.waitForFunction(() => window.__modelshelfViewer?.inspect().selectedHidden === false, undefined, {
      timeout: 30_000,
    });
    check(true, "reset view clears isolation and reveals the selection");

    await page.getByLabel("Section Z metres").fill("1.5");
    await page.getByLabel("Section Z metres").press("Enter");
    await page.waitForFunction(() => window.__modelshelfViewer?.inspect().renderer.clipping === true, undefined, {
      timeout: 30_000,
    });
    check(true, "section cut clips above the project height");
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-section.png") });
    await page.getByLabel("Section Z metres").fill("");
    await page.getByLabel("Section Z metres").press("Enter");

    const canvas = page.locator("canvas");
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("Inspector canvas has no layout box");
    let picked = null;
    for (const y of [0.5, 0.42, 0.58]) {
      for (const x of [0.5, 0.42, 0.58]) {
        await page.mouse.click(canvasBox.x + canvasBox.width * x, canvasBox.y + canvasBox.height * y);
        await delay(120);
        picked = (await inspect(page)).snapshot.selected;
        if (picked) break;
      }
      if (picked) break;
    }
    check(Boolean(picked), "canvas picking selects geometry beside the inspector");
    const memberRef = paged.objects[0].ref;
    await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), memberRef);
    await page.getByRole("button", { name: /Inspect selection properties/ }).click();
    await page.waitForSelector("[data-property-panel]", { timeout: 30_000 });
    const panelText = (await page.locator("[data-property-panel]").innerText()).slice(0, 400);
    check(/IfcFlowSegment|IfcWall|IfcSlab|IfcColumn|IfcDoor|IfcWindow/.test(panelText), "property inspection shows the selected object record");
    results.propertySample = panelText;

    await page.goto(`${appOrigin}/deliveries/${deliveryB.id}?run=${runB.run.id}`, { waitUntil: "domcontentloaded" });
    await waitForModelsReady(page, 180_000);
    await page.getByRole("tab", { name: /Findings/ }).click();
    await page.waitForSelector(`[data-finding-id="${incompleteFinding.id}"]`, { timeout: 60_000 });
    await page.locator(`[data-finding-id="${incompleteFinding.id}"]`).click();
    await page.waitForSelector(`[data-inspector-active="${incompleteFinding.id}"]`, { timeout: 60_000 });
    await page.waitForSelector("[data-evidence-panel]", { timeout: 30_000 });
    const evidenceText = await page.locator("[data-evidence-panel]").innerText();
    check(/review incomplete/i.test(evidenceText), "non-geometric finding renders evidence with an explanation");
    await page.screenshot({ path: join(EVIDENCE_DIR, "inspection-evidence.png"), fullPage: true });

    results.passed = true;
    console.log("viewer inspection verification passed");
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
