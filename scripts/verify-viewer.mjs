#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";
import { runInspectionScenario } from "./verify-viewer-inspection.mjs";

const scenarioFlag = process.argv.indexOf("--scenario");
const scenario = scenarioFlag >= 0 ? process.argv[scenarioFlag + 1] : "combined";
if (scenario !== "combined" && scenario !== "inspection") {
  console.error(`usage: node scripts/verify-viewer.mjs [--scenario combined|inspection] (got ${scenario ?? "<none>"})`);
  process.exit(2);
}
if (scenario === "inspection") {
  await runInspectionScenario();
  process.exit(0);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const EVIDENCE_DIR = join(
  REPO_ROOT,
  ".scratch",
  "modelshelf-prototype",
  "evidence",
  "07-combined-viewer",
);
const SAMPLE_PATHS = {
  ARCH: join(REPO_ROOT, "samples", "ifc", "blcj-s1000-architecture.ifc"),
  STRUCT: join(REPO_ROOT, "samples", "ifc", "blcj-s1000-structure.ifc"),
  MEP: join(REPO_ROOT, "samples", "ifc", "blcj-s1000-mep.ifc"),
};
const THREE_INTERNAL_TEXTURE_ALLOWANCE = 1;
const emptyIfcBytes = Buffer.from(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('empty.ifc','2026-09-07T00:00:00',(),(),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'Verifier',$,$,$,$,$);
#2=IFCORGANIZATION($,'ModelShelf',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','Viewer verifier','VERIFIER');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
#6=IFCCARTESIANPOINT((0.,0.,0.));
#7=IFCAXIS2PLACEMENT3D(#6,$,$);
#8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#7,$);
#9=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#10=IFCUNITASSIGNMENT((#9));
#11=IFCPROJECT('0YvctVUKv0kugbFTf53O9L',#5,'Empty',$,$,$,$,(#8),#10);
ENDSEC;
END-ISO-10303-21;
`);
const emptySample = {
  path: "inline:empty.ifc",
  bytes: emptyIfcBytes,
  sha256: createHash("sha256").update(emptyIfcBytes).digest("hex"),
  size: emptyIfcBytes.byteLength,
};

mkdirSync(EVIDENCE_DIR, { recursive: true });
for (const path of Object.values(SAMPLE_PATHS)) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run node scripts/fetch-demo-models.mjs`);
  }
}

const samples = Object.fromEntries(
  Object.entries(SAMPLE_PATHS).map(([discipline, path]) => {
    const bytes = readFileSync(path);
    return [
      discipline,
      {
        path,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: statSync(path).size,
      },
    ];
  }),
);

const revisionFiles = new Map([
  ["combined-arch", samples.ARCH],
  ["combined-struct", samples.STRUCT],
  ["combined-mep", samples.MEP],
  ["duplicate-a", samples.STRUCT],
  ["duplicate-b", samples.STRUCT],
  ["empty-model", emptySample],
]);
const fixtureRequests = [];
let failMepOnce = true;

const fixtureServer = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://fixture.local");
  fixtureRequests.push(requestUrl.pathname);

  const deliveryId = /^\/api\/deliveries\/([^/]+)$/.exec(requestUrl.pathname)?.[1];
  if (deliveryId === "combined") {
    sendJson(response, combinedDelivery());
    return;
  }
  if (deliveryId === "duplicate") {
    sendJson(response, duplicateDelivery());
    return;
  }
  if (deliveryId === "empty") {
    sendJson(response, emptyDelivery());
    return;
  }

  const revisionId = /^\/api\/models\/([^/]+)\/file$/.exec(requestUrl.pathname)?.[1];
  if (!revisionId) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }
  if (revisionId === "combined-mep" && failMepOnce) {
    failMepOnce = false;
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("deliberate verifier failure");
    return;
  }

  const sample = revisionFiles.get(revisionId);
  if (!sample) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("revision not found");
    return;
  }
  response.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(sample.size),
    etag: `"${sample.sha256}"`,
  });
  response.end(sample.bytes);
});

const fixturePort = await listen(fixtureServer);
const appPort = await freePort();
const nextLogs = [];
const nextProcess = spawn(
  process.execPath,
  [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(appPort)],
  {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      CHECKER_ORIGIN: `http://127.0.0.1:${fixturePort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
nextProcess.stdout.on("data", (chunk) => nextLogs.push(String(chunk)));
nextProcess.stderr.on("data", (chunk) => nextLogs.push(String(chunk)));

let browser = null;
let activeWorkerCount = 0;
const results = {
  passed: false,
  checks: [],
  samples: Object.fromEntries(
    Object.entries(samples).map(([discipline, sample]) => [
      discipline,
      { path: sample.path, sha256: sample.sha256, size: sample.size },
    ]),
  ),
  fixtureRequests,
  workerUrls: [],
  partial: null,
  combined: null,
  duplicate: null,
  empty: null,
  disposalRuns: [],
};

try {
  const appOrigin = `http://127.0.0.1:${appPort}`;
  await waitForHttp(`${appOrigin}/deliveries/combined`, nextProcess, 120_000);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__modelshelfViewerVerify = true;
  });
  page.on("worker", (worker) => {
    results.workerUrls.push(worker.url());
    activeWorkerCount += 1;
    worker.on("close", () => {
      activeWorkerCount -= 1;
    });
  });
  page.on("console", (message) => nextLogs.push(`browser ${message.type()}: ${message.text()}\n`));
  page.on("pageerror", (error) => nextLogs.push(`browser error: ${error.stack ?? error.message}\n`));

  await page.goto(`${appOrigin}/deliveries/combined`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.some(({ status }) => status === "failed"),
    undefined,
    { timeout: 360_000 },
  );

  const partial = await inspect(page);
  results.partial = {
    snapshot: partial.snapshot,
    resources: partial.resources,
    renderer: partial.renderer,
  };
  check(
    partial.snapshot.models.filter(({ status }) => status === "ready").length === 2,
    "two successful real models remain ready when MEP fails",
  );
  check(
    partial.snapshot.models.filter(({ status }) => status === "failed").length === 1,
    "the failed source has its own model state",
  );
  check(
    partial.renderer.roots.length === 2 && partial.renderer.roots.every(({ visible }) => visible),
    "successful model roots remain visible after a sibling failure",
  );
  check(Array.isArray(partial.snapshot.origin), "successful models establish the shared origin before retry");
  await page.screenshot({ path: join(EVIDENCE_DIR, "partial-failure-desktop.png"), fullPage: true });

  const mepRow = page.locator('[data-model-id="combined-mep"]');
  await mepRow.getByRole("button", { name: /Retry/ }).click();
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout: 360_000 },
  );

  const combined = await inspect(page);
  check(combined.snapshot.models.length === 3, "the combined delivery contains three model revisions");
  check(
    combined.progressRevisionIds.length === 3,
    "download and parse progress identifies every source revision",
  );
  check(combined.resources.batches === 3, "three batched model resources are active");
  check(combined.resources.workers === 1, "IFC parsing uses one dedicated browser Worker");
  check(results.workerUrls.some((url) => url.includes("ifc-loader")), "the browser loaded the IFC Worker bundle");
  check(combined.resources.renderers === 1, "one renderer owns the combined scene");
  check(combined.resources.renderLoops === 1, "one render loop drives the combined scene");
  check(combined.resources.materials === 1, "model revisions share one material");
  check(activeWorkerCount === 1, "one browser Worker remains active after StrictMode remount");
  check(combined.resources.gpuGeometries > 0, "Three.js observes uploaded GPU geometry");
  check(combined.resources.gpuTextures > 0, "Three.js observes BatchedMesh GPU textures");
  check(combined.resources.shaderPrograms > 0, "Three.js observes compiled shader programs");
  check(combined.resources.renderFrame > 0, "Three.js observes rendered frames");
  check(
    combined.objects.length > combined.resources.batches * 100,
    "thousands of selectable objects remain behind revision-level BatchedMesh resources",
  );
  check(
    JSON.stringify(combined.snapshot.origin) === JSON.stringify(partial.snapshot.origin),
    "retry keeps the established common origin frozen",
  );
  verifyCommonOrigin(combined);
  verifyMetreScaleAndAlignment(combined.snapshot.models);

  const canvas = page.locator("canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Combined viewer canvas has no layout box");

  const orbitBefore = combined.renderer;
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.45, canvasBox.y + canvasBox.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.6, canvasBox.y + canvasBox.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await delay(350);
  const orbitAfter = (await inspect(page)).renderer;
  check(distance(orbitBefore.cameraPosition, orbitAfter.cameraPosition) > 0.01, "left drag orbits the camera");

  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + canvasBox.height * 0.55, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await delay(350);
  const panAfter = (await inspect(page)).renderer;
  check(distance(orbitAfter.cameraTarget, panAfter.cameraTarget) > 0.01, "right drag pans the camera");

  const zoomDistanceBefore = distance(panAfter.cameraPosition, panAfter.cameraTarget);
  await page.mouse.wheel(0, -500);
  await delay(350);
  const zoomAfter = (await inspect(page)).renderer;
  check(
    Math.abs(distance(zoomAfter.cameraPosition, zoomAfter.cameraTarget) - zoomDistanceBefore) > 0.01,
    "wheel input zooms the camera",
  );

  await page.getByRole("button", { name: /Fit all/ }).click();
  await delay(350);
  const picked = await pickVisibleObject(page, canvasBox);
  check(
    combined.objects.some(({ ref }) => sameRef(ref, picked.ref)),
    "canvas raycasting selects a revision-qualified ObjectRef",
  );
  await page.screenshot({ path: join(EVIDENCE_DIR, "combined-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(EVIDENCE_DIR, "combined-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  results.combined = {
    origin: combined.snapshot.origin,
    activeWorkers: activeWorkerCount,
    resources: combined.resources,
    modelBounds: combined.snapshot.models.map(({ model, status, ...state }) => ({
      revisionId: model.revisionId,
      status,
      ...state,
    })),
    cameraAfterInput: zoomAfter,
    pickedRef: picked.ref,
  };

  const firstDispose = await page.evaluate(() => window.__modelshelfViewer?.dispose());
  const secondDispose = await page.evaluate(() => window.__modelshelfViewer?.dispose());
  results.disposalRuns.push(firstDispose, secondDispose);
  await verifyDisposed(page, firstDispose, combined.resources, "combined first unload");
  await verifyDisposed(page, secondDispose, combined.resources, "combined repeated unload");

  await page.goto(`${appOrigin}/deliveries/duplicate`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout: 180_000 },
  );

  const duplicate = await inspect(page);
  const matching = findDuplicateGlobalId(duplicate.objects);
  check(matching[0].ref.revisionId !== matching[1].ref.revisionId, "duplicate GlobalId rows retain different revisions");
  check(matching[0].ref.objectId !== matching[1].ref.objectId, "duplicate GlobalId rows receive different opaque object IDs");
  for (const object of matching) {
    check(
      object.ref.objectId === expectedObjectId(object.ref.revisionId, object.expressId),
      `ObjectRef mapping matches the contract for ${object.ref.revisionId}`,
    );
  }
  check(
    duplicate.objects.some(({ targetCount }) => targetCount > 1),
    "one ObjectRef can address several placed geometry instances",
  );

  await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), matching[0].ref);
  let selected = (await inspect(page)).snapshot.selected;
  check(sameRef(selected?.ref, matching[0].ref), "the first duplicate GlobalId revision selects independently");
  await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), matching[1].ref);
  selected = (await inspect(page)).snapshot.selected;
  check(sameRef(selected?.ref, matching[1].ref), "the second duplicate GlobalId revision selects independently");
  await page.screenshot({ path: join(EVIDENCE_DIR, "duplicate-object-selection.png"), fullPage: true });

  results.duplicate = {
    globalId: matching[0].globalId,
    refs: matching.map(({ ref, expressId, targetCount }) => ({ ref, expressId, targetCount })),
  };

  const duplicateDispose = await page.evaluate(() => window.__modelshelfViewer?.dispose());
  results.disposalRuns.push(duplicateDispose);
  await verifyDisposed(page, duplicateDispose, duplicate.resources, "duplicate unload");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout: 180_000 },
  );
  const remounted = await inspect(page);
  check(
    activeWorkerCount === 1 &&
      remounted.resources.workers === 1 &&
      remounted.resources.batches === 2 &&
      remounted.resources.gpuGeometries > 0,
    "remount reacquires one Worker and batched GPU resources",
  );
  const remountDispose = await page.evaluate(() => window.__modelshelfViewer?.dispose());
  results.disposalRuns.push(remountDispose);
  await verifyDisposed(page, remountDispose, remounted.resources, "duplicate remount unload");

  await page.goto(`${appOrigin}/deliveries/empty`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout: 30_000 },
  );
  const empty = await inspect(page);
  const emptyModel = empty.snapshot.models[0];
  check(
    emptyModel?.status === "ready" && emptyModel.bounds === null,
    "a valid revision with no drawable geometry reaches ready",
  );
  check(
    emptyModel?.objectCount === 0 && empty.objects.length === 0,
    "an empty drawable revision exposes no selectable objects",
  );
  results.empty = {
    model: emptyModel,
    resources: empty.resources,
  };
  const emptyDispose = await page.evaluate(() => window.__modelshelfViewer?.dispose());
  results.disposalRuns.push(emptyDispose);
  await verifyDisposed(page, emptyDispose, empty.resources, "empty revision unload", 0);

  results.passed = true;
  console.log("viewer verification passed");
} finally {
  if (browser) await browser.close();
  await stopProcess(nextProcess);
  await closeServer(fixtureServer);
  writeFileSync(join(EVIDENCE_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(EVIDENCE_DIR, "verifier.log"), nextLogs.join(""));
}

function combinedDelivery() {
  return deliveryPayload("combined", "BLCJ S1000 combined delivery", [
    modelInfo("combined", "combined-arch", "ARCH", "Architecture", samples.ARCH),
    modelInfo("combined", "combined-struct", "STRUCT", "Structure", samples.STRUCT),
    modelInfo("combined", "combined-mep", "MEP", "MEP", samples.MEP),
  ]);
}

function duplicateDelivery() {
  return deliveryPayload("duplicate", "Duplicate GlobalId identity proof", [
    modelInfo("duplicate", "duplicate-a", "STRUCT", "Structure A", samples.STRUCT),
    modelInfo("duplicate", "duplicate-b", "STRUCT", "Structure B", samples.STRUCT),
  ]);
}

function emptyDelivery() {
  return deliveryPayload("empty", "Empty drawable geometry proof", [
    modelInfo("empty", "empty-model", "OTHER", "Empty IFC", emptySample, "IFC4"),
  ]);
}

function deliveryPayload(id, label, models) {
  return {
    delivery: {
      id,
      projectId: "viewer-verifier",
      label,
      deliveryDate: "2026-09-07",
      createdAt: "2026-09-07T00:00:00Z",
      finalizedAt: "2026-09-07T00:00:00Z",
      modelCount: models.length,
      productCount: 0,
    },
    models,
    runs: [],
    locked: true,
  };
}

function modelInfo(deliveryId, id, discipline, sourceModelName, sample, schemaLabel = "IFC2X3") {
  return {
    id,
    deliveryId,
    discipline,
    sourceModelId: `${id}-source`,
    sourceModelName,
    filename: sample.path.split("/").at(-1),
    contentSha256: sample.sha256,
    byteSize: sample.size,
    schemaLabel,
    entityCount: 0,
    productCount: 0,
    lengthToMetre: 0.001,
    parseMs: null,
    uploadedAt: "2026-09-07T00:00:00Z",
    originatingSystem: "viewer verifier",
  };
}

function sendJson(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function inspect(page) {
  const diagnostics = await page.evaluate(() => window.__modelshelfViewer?.inspect());
  if (!diagnostics) throw new Error("Viewer diagnostics are unavailable");
  return diagnostics;
}

function verifyCommonOrigin(diagnostics) {
  const origin = diagnostics.snapshot.origin;
  check(Array.isArray(origin) && origin.length === 3, "the delivery resolves one common origin");
  const expectedOffset = origin.map((coordinate) => -coordinate);
  check(
    diagnostics.renderer.roots.every(({ offset }) => distance(offset, expectedOffset) < 1e-6),
    "every model root receives the same common-origin offset",
  );
}

function verifyMetreScaleAndAlignment(states) {
  const ready = states.filter(({ status }) => status === "ready");
  const centers = [];
  for (const state of ready) {
    check(state.bounds !== null, `${state.model.discipline} exposes drawable bounds`);
    const span = state.bounds.max.map((value, axis) => value - state.bounds.min[axis]);
    check(Math.max(...span) > 5, `${state.model.discipline} geometry remains at building-scale metres`);
    check(Math.max(...span) < 1_000, `${state.model.discipline} geometry avoids a second unit expansion`);
    centers.push(state.bounds.min.map((value, axis) => (value + state.bounds.max[axis]) / 2));
  }
  for (let left = 0; left < centers.length; left += 1) {
    for (let right = left + 1; right < centers.length; right += 1) {
      check(distance(centers[left], centers[right]) < 100, "discipline bounds occupy one shared project frame");
    }
  }
}

async function pickVisibleObject(page, canvasBox) {
  const fractions = [0.5, 0.42, 0.58, 0.34, 0.66];
  for (const y of fractions) {
    for (const x of fractions) {
      await page.mouse.click(
        canvasBox.x + canvasBox.width * x,
        canvasBox.y + canvasBox.height * y,
      );
      await delay(80);
      const selected = (await inspect(page)).snapshot.selected;
      if (selected) return selected;
    }
  }
  throw new Error("No visible geometry could be selected through the canvas");
}

function findDuplicateGlobalId(objects) {
  const firstByGlobalId = new Map();
  for (const object of objects) {
    if (!object.globalId) continue;
    const previous = firstByGlobalId.get(object.globalId);
    if (previous && previous.ref.revisionId !== object.ref.revisionId) return [previous, object];
    firstByGlobalId.set(object.globalId, object);
  }
  throw new Error("No GlobalId appeared in both duplicate revisions");
}

function expectedObjectId(revisionId, expressId) {
  return `occ_${createHash("sha256").update(`${revisionId}:${expressId}`).digest("hex").slice(0, 16)}`;
}

function sameRef(left, right) {
  return Boolean(left && left.revisionId === right.revisionId && left.objectId === right.objectId);
}

async function verifyDisposed(
  page,
  stats,
  activeStats,
  label,
  minimumTextureRelease = activeStats.batches * 3,
) {
  if (!stats) throw new Error(`${label} did not return resource statistics`);
  check(
    stats.workers === 0 &&
      stats.renderLoops === 0 &&
      stats.renderers === 0 &&
      stats.batches === 0 &&
      stats.geometries === 0 &&
      stats.materials === 0,
    `${label} releases Worker and renderer ownership: ${JSON.stringify(stats)}`,
  );
  check(
    stats.gpuGeometries === 0 && stats.shaderPrograms === 0,
    `${label} releases uploaded GPU geometry and shader programs`,
  );
  check(
    stats.gpuTextures <= THREE_INTERNAL_TEXTURE_ALLOWANCE &&
      activeStats.gpuTextures - stats.gpuTextures >= minimumTextureRelease,
    `${label} releases every BatchedMesh GPU texture`,
  );
  await waitForCondition(() => activeWorkerCount === 0, 5_000);
  check(activeWorkerCount === 0, `${label} closes the observed browser Worker`);
  const firstFrame = (await inspect(page)).resources.renderFrame;
  await delay(150);
  const secondFrame = (await inspect(page)).resources.renderFrame;
  check(secondFrame === firstFrame, `${label} stops the observed render loop`);
}

async function waitForCondition(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await delay(25);
}

function distance(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function check(condition, label) {
  if (!condition) throw new Error(`FAIL - ${label}`);
  console.log(`ok - ${label}`);
  results.checks.push(label);
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen(server.address().port));
  });
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        rejectPort(new Error("Could not allocate an application port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForHttp(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Next exited before readiness with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (graceful) return;
  child.kill("SIGKILL");
  await exited;
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}
