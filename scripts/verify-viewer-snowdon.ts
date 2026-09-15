#!/usr/bin/env node
// `--scenario snowdon` prover for ticket 31. Fixture HTTP, not live ingest.
// Loads the four staged Snowdon Towers IFC4 files into one combined viewer
// and asserts a shared far-from-origin offset plus revision-qualified
// selection across the two MEP sources.

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { expressIdToObjectId } from "../packages/model-contracts-ts/src/express-id-mapping.ts";
import { evidenceDir, importChromium, readProofHost } from "./lib/browser-proof.ts";
import { REPO_ROOT, freePort, stopProcess } from "./lib/checker-harness.ts";

const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const EVIDENCE_DIR = evidenceDir("snowdon");
const SAMPLE_PATHS = {
  architecture: join(REPO_ROOT, "samples", "ifc", "snowdon-towers-architecture.ifc"),
  structure: join(REPO_ROOT, "samples", "ifc", "snowdon-towers-structure.ifc"),
  electrical: join(REPO_ROOT, "samples", "ifc", "snowdon-towers-electrical.ifc"),
  plumbing: join(REPO_ROOT, "samples", "ifc", "snowdon-towers-plumbing.ifc"),
};

function check(condition, label) {
  if (!condition) throw new Error(`FAIL - ${label}`);
  console.log(`ok - ${label}`);
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        rejectListen(new Error("snowdon fixture server has no address"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await delay(250);
  }
  throw new Error(`http://127.0.0.1:${port} did not answer`);
}

function loadSample(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run node scripts/stage-snowdon-models.ts`);
  }
  const bytes = readFileSync(path);
  return {
    path,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: statSync(path).size,
  };
}

function modelInfo(id, discipline, sourceModelName, sample) {
  return {
    id,
    deliveryId: "snowdon",
    discipline,
    sourceModelId: `${id}-source`,
    sourceModelName,
    filename: sample.path.split(/[/\\]/).at(-1),
    contentSha256: sample.sha256,
    byteSize: sample.size,
    schemaLabel: "IFC4",
    entityCount: 0,
    productCount: 0,
    lengthToMetre: 0.3048,
    parseMs: null,
    uploadedAt: "2026-08-24T00:00:00Z",
    originatingSystem: "snowdon verifier",
  };
}

function distance(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

export async function runSnowdonViewerScenario() {
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const samples = Object.fromEntries(Object.entries(SAMPLE_PATHS).map(([key, path]) => [key, loadSample(path)]));
  const revisionFiles = new Map([
    ["snowdon-architecture", samples.architecture],
    ["snowdon-structure", samples.structure],
    ["snowdon-electrical", samples.electrical],
    ["snowdon-plumbing", samples.plumbing],
  ]);
  const models = [
    modelInfo("snowdon-architecture", "ARCH", "Snowdon Towers Architectural", samples.architecture),
    modelInfo("snowdon-structure", "STRUCT", "Snowdon Towers Structural", samples.structure),
    modelInfo("snowdon-electrical", "MEP", "Snowdon Towers Electrical", samples.electrical),
    modelInfo("snowdon-plumbing", "MEP", "Snowdon Towers Plumbing", samples.plumbing),
  ];
  const delivery = {
    delivery: {
      id: "snowdon",
      projectId: "viewer-verifier",
      label: "Snowdon Towers four-discipline delivery",
      deliveryDate: "2026-08-24",
      createdAt: "2026-08-24T00:00:00Z",
      finalizedAt: "2026-08-24T00:00:00Z",
      modelCount: 4,
      productCount: 0,
    },
    models,
    runs: [],
    locked: true,
  };

  const fixtureServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://fixture.local");
    if (requestUrl.pathname === "/api/deliveries/snowdon") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(delivery));
      return;
    }
    const revisionId = /^\/api\/models\/([^/]+)\/file$/.exec(requestUrl.pathname)?.[1];
    const sample = revisionId ? revisionFiles.get(revisionId) : undefined;
    if (!sample) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
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
  const webBuild = spawnSync(
    process.execPath,
    [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "build"],
    {
      cwd: WEB_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CHECKER_ORIGIN: `http://127.0.0.1:${fixturePort}` },
    },
  );
  nextLogs.push(`next build exited ${webBuild.status}\n${String(webBuild.stdout).slice(-4000)}\n${String(webBuild.stderr).slice(-4000)}\n`);
  if (webBuild.status !== 0) {
    writeFileSync(join(runDir, "verifier.log"), nextLogs.join(""));
    throw new Error(`Next production build failed; see ${join(runDir, "verifier.log")}`);
  }
  const nextProcess = spawn(
    process.execPath,
    [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(appPort)],
    {
      cwd: WEB_ROOT,
      env: { ...process.env, CHECKER_ORIGIN: `http://127.0.0.1:${fixturePort}` },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nextProcess.stdout.on("data", (chunk) => nextLogs.push(String(chunk)));
  nextProcess.stderr.on("data", (chunk) => nextLogs.push(String(chunk)));

  let browser = null;
  const results = { passed: false, checks: [], origin: null, sharedGlobalId: null };
  try {
    await waitForPort(appPort);
    const { chromium } = await importChromium();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      window.__modelshelfViewerVerify = true;
    });
    const appOrigin = `http://127.0.0.1:${appPort}`;
    await page.goto(`${appOrigin}/deliveries/snowdon`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__modelshelfViewer?.inspect().snapshot.sources.every(({ status }) => status === "ready"),
      undefined,
      { timeout: 600_000 },
    );

    const inspect = async () => {
      const diagnostics = await page.evaluate(() => window.__modelshelfViewer?.inspect());
      if (!diagnostics) throw new Error("Viewer diagnostics are unavailable");
      return diagnostics;
    };

    const snapshot = await inspect();
    check(snapshot.snapshot.sources.length === 4, "the Snowdon delivery contains four model revisions");
    check(snapshot.snapshot.sources.every(({ status }) => status === "ready"), "all four Snowdon models are ready");
    check(snapshot.resources.batches === 4, "four batched model resources are active");
    check(snapshot.resources.workers === 1, "IFC parsing uses one dedicated browser Worker");
    check(snapshot.resources.renderers === 1, "one renderer owns the combined scene");

    const origin = snapshot.snapshot.origin;
    check(origin.frozen && Array.isArray(origin.offset) && origin.offset.length === 3, "the delivery resolves one common origin");
    const magnitude = Math.hypot(...origin.offset);
    check(magnitude > 400_000 && magnitude < 450_000, `shared origin sits ~425 km from world origin (${magnitude.toFixed(1)} m)`);
    const expectedOffset = origin.offset.map((coordinate) => -coordinate);
    check(
      snapshot.renderer.roots.every(({ offset }) => distance(offset, expectedOffset) < 1e-6),
      "every model root receives the same common-origin offset",
    );
    results.origin = origin;

    const ready = snapshot.snapshot.sources.filter(({ status }) => status === "ready");
    const centers = [];
    for (const state of ready) {
      check(state.bounds !== null, `${state.attributes.discipline} exposes drawable bounds`);
      const span = state.bounds.max.map((value, axis) => value - state.bounds.min[axis]);
      check(Math.max(...span) > 5, `${state.attributes.discipline} geometry remains at building-scale metres`);
      check(Math.max(...span) < 1_000, `${state.attributes.discipline} geometry is not a second unit expansion`);
      centers.push(state.bounds.min.map((value, axis) => (value + state.bounds.max[axis]) / 2));
    }
    for (let left = 0; left < centers.length; left += 1) {
      for (let right = left + 1; right < centers.length; right += 1) {
        check(distance(centers[left], centers[right]) < 100, "discipline bounds occupy one shared project frame");
      }
    }

    const electricalObjects = snapshot.objects.filter((object) => object.ref.revisionId === "snowdon-electrical");
    const plumbingObjects = snapshot.objects.filter((object) => object.ref.revisionId === "snowdon-plumbing");
    check(electricalObjects.length > 0 && plumbingObjects.length > 0, "electrical and plumbing expose selectable objects");
    const plumbingByGid = new Map(
      plumbingObjects.filter((object) => object.attributes.globalId).map((object) => [object.attributes.globalId, object]),
    );
    const shared = electricalObjects.find((object) => object.attributes.globalId && plumbingByGid.has(object.attributes.globalId));
    if (shared) {
      const other = plumbingByGid.get(shared.attributes.globalId);
      check(shared.ref.revisionId !== other.ref.revisionId, "shared GlobalId rows retain different revisions");
      check(shared.ref.objectId !== other.ref.objectId, "shared GlobalId rows receive different opaque object IDs");
      check(
        shared.ref.objectId === (await expressIdToObjectId(shared.ref.revisionId, Number(shared.attributes.expressId))),
        "electrical ObjectRef mapping matches the contract",
      );
      check(
        other.ref.objectId === (await expressIdToObjectId(other.ref.revisionId, Number(other.attributes.expressId))),
        "plumbing ObjectRef mapping matches the contract",
      );
      await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), shared.ref);
      let selected = (await inspect()).snapshot.selected;
      check(
        selected?.ref.revisionId === shared.ref.revisionId && selected?.ref.objectId === shared.ref.objectId,
        "selecting the electrical side of a shared GlobalId keeps that revision",
      );
      await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), other.ref);
      selected = (await inspect()).snapshot.selected;
      check(
        selected?.ref.revisionId === other.ref.revisionId && selected?.ref.objectId === other.ref.objectId,
        "selecting the plumbing side of a shared GlobalId keeps that revision",
      );
      results.sharedGlobalId = shared.attributes.globalId;
    } else {
      const electricalPick = electricalObjects[0];
      const plumbingPick = plumbingObjects[0];
      await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), electricalPick.ref);
      let selected = (await inspect()).snapshot.selected;
      check(
        selected?.ref.revisionId === "snowdon-electrical",
        "selecting an electrical object addresses that revision",
      );
      await page.evaluate((ref) => window.__modelshelfViewer?.select(ref), plumbingPick.ref);
      selected = (await inspect()).snapshot.selected;
      check(
        selected?.ref.revisionId === "snowdon-plumbing",
        "selecting a plumbing object addresses that revision",
      );
    }

    await page.screenshot({ path: join(runDir, "snowdon-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await delay(300);
    await page.screenshot({ path: join(runDir, "snowdon-mobile.png"), fullPage: true });
    results.host = await readProofHost({ browserVersion: browser.version(), page });
    results.passed = true;
    console.log("snowdon viewer verification passed");
  } finally {
    if (browser) await browser.close();
    await stopProcess(nextProcess);
    await closeServer(fixtureServer);
    writeFileSync(join(runDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    writeFileSync(join(runDir, "verifier.log"), nextLogs.join(""));
    console.log(`evidence written to ${runDir}`);
  }
}
