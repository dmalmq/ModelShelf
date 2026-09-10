#!/usr/bin/env node
// Ticket 15 --scenario comparisons: proves the delivery comparison screen
// against real processes only — the real modelshelf-checker binary, the real
// ifc-worker ingestion queue, a real Next.js server, and real Chromium. No
// mocked diffs or viewer results.
//
// Why inline IFC, not packs/demo/fixtures: the demo fixtures model walls as
// IfcBlock CSG primitives, which the browser worker (web-ifc) cannot
// tessellate — StreamAllMeshes yields zero meshes, so no change ref could
// ever resolve to geometry. These fixtures reuse the BOX_IFC skeleton from
// the findings verifier (extruded IfcWallStandardCase-style SweptSolid,
// proven browser-tessellatable) with a controlled A/B layout:
//
//   base: U-0 P-0 S-0 M-0 R-0 R-1 D-a D-b E-0
//   head: U-0 P-0 S-0 M-0 A-0 A-1 D-a D-b E-0
//   U unchanged exact; P properties (REI30->REI60); S shape (2000->3000mm);
//   M moved 2m; R removed; A added; D duplicate GlobalId (unchanged,
//   heuristic); E missing GlobalId (unchanged, uncertain).
//
// Runs use a 3-spec pack: fire rating fails {R-0,U-0}/{A-0,U-0} (persisting),
// load-bearing fails {R-1}/{} (resolved), site width fails {}/{site}
// (introduced).
//
// UI proofs on /deliveries/compare?base=&head=: every controlled row listed;
// side toggle preserves filters and selection; added resolves head-side and
// removed base-side (void side shows a banner with a jump action); duplicate
// GlobalIds select independently; kind and confidence filters narrow the
// list; finding deltas group resolved/introduced/persisting; an incompatible
// run pair names its dimension with a rerun CTA; zero console/network errors.
//
// Evidence: .omo/evidence/modelshelf-prototype/ticket-15/run-<timestamp>/
// Usage: node scripts/verify-ui.mjs --scenario comparisons (or this file directly)

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";
import { BIN_PATH, REPO_ROOT, buildBinary, createChecker, freePort, runCli, stopProcess, waitForHealth } from "./lib/checker-harness.mjs";

const scenarioFlag = process.argv.indexOf("--scenario");
const scenario = scenarioFlag >= 0 ? process.argv[scenarioFlag + 1] : null;
if (scenario !== "comparisons") {
  console.error(`usage: node scripts/verify-ui.mjs --scenario comparisons (got ${scenario ?? "<none>"})`);
  process.exit(2);
}

if (process.env.HOME) {
  const cargoDir = `${process.env.HOME}/.cargo/bin`;
  if (!process.env.PATH.split(":").includes(cargoDir)) {
    process.env.PATH = `${cargoDir}:${process.env.PATH}`;
  }
}

// ---------------------------------------------------------------------------
// Inline fixtures (extruded walls tessellate in the browser worker)
// ---------------------------------------------------------------------------

const GUID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

function guid22(tag) {
  let hash = 2166136261;
  const src = `compare-ui:${tag}`;
  let out = "";
  for (let i = 0; i < 22; i += 1) {
    hash ^= src.charCodeAt(i % src.length) + i;
    hash = Math.imul(hash, 16777619);
    out += GUID_ALPHABET[(hash >>> 0) % 64];
  }
  return out;
}

const DUP_GUID = guid22("duplicate-wall");

function buildCompareIfc(filename, walls, siteWidth) {
  const out = [];
  let next = 1;
  const emit = (text) => {
    out.push(`#${next}=${text};`);
    next += 1;
    return next - 1;
  };
  const wallRefs = [];

  const p0 = emit(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const ax0 = emit(`IFCAXIS2PLACEMENT3D(#${p0},$,$)`);
  const ctx = emit(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${ax0},$)`);
  emit(`IFCUNITASSIGNMENT((#6))`);
  emit(`IFCPROJECT('${guid22(`${filename}:project`)}',$,'Compare',$,$,$,$,(#${ctx}),#4)`);
  emit(`IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)`);
  const dir = emit(`IFCDIRECTION((0.,0.,1.))`);

  for (const wall of walls) {
    const place = emit(`IFCCARTESIANPOINT((${wall.x}.,0.,0.))`);
    const place3d = emit(`IFCAXIS2PLACEMENT3D(#${place},$,$)`);
    const local = emit(`IFCLOCALPLACEMENT($,#${place3d})`);
    const shape = `#${next + 6}`;
    const globalId = wall.guid === null ? "$" : `'${wall.guid}'`;
    const wallRef = emit(`IFCWALL(${globalId},$,'${wall.name}',$,$,#${local},${shape},$,$)`);
    const p2d = emit(`IFCCARTESIANPOINT((0.,0.))`);
    const pl2d = emit(`IFCAXIS2PLACEMENT2D(#${p2d},$)`);
    const profile = emit(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${pl2d},${wall.length}.,200.)`);
    const solid = emit(`IFCEXTRUDEDAREASOLID(#${profile},#${ax0},#${dir},2500.)`);
    const rep = emit(`IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',(#${solid}))`);
    emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
    const props = [];
    if (wall.rating) {
      props.push(emit(`IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('${wall.rating}'),$)`));
    }
    if (wall.loadBearing) {
      props.push(emit(`IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$)`));
    }
    if (props.length > 0) {
      const pset = emit(
        `IFCPROPERTYSET('${guid22(`${filename}:${wall.name}:pset`)}',$,'Pset_WallCommon',$,(${props.map((p) => `#${p}`).join(",")}))`,
      );
      emit(
        `IFCRELDEFINESBYPROPERTIES('${guid22(`${filename}:${wall.name}:rel`)}',$,$,$,(#${wallRef}),#${pset})`,
      );
    }
    wallRefs.push(wallRef);
  }

  const siteLocal = emit(`IFCLOCALPLACEMENT($,#${ax0})`);
  let siteProps = null;
  if (siteWidth) {
    const prop = emit(`IFCPROPERTYSINGLEVALUE('EvacuationWidth',$,IFCLENGTHMEASURE(1800.),$)`);
    siteProps = emit(
      `IFCPROPERTYSET('${guid22(`${filename}:site:pset`)}',$,'Pset_SiteCommon',$,(#${prop}))`,
    );
  }
  const site = emit(
    `IFCSITE('${guid22("site")}',$,'CompareSite',$,$,#${siteLocal},$,$,.ELEMENT.,$)`,
  );
  if (siteProps !== null) {
    emit(
      `IFCRELDEFINESBYPROPERTIES('${guid22(`${filename}:site:rel`)}',$,$,$,(#${site}),#${siteProps})`,
    );
  }
  emit(`IFCRELAGGREGATES('${guid22(`${filename}:agg1`)}',$,$,$,#5,(#${site}))`);
  emit(`IFCRELAGGREGATES('${guid22(`${filename}:agg2`)}',$,$,$,#${site},(${wallRefs.map((w) => `#${w}`).join(",")}))`);

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('${filename}','2024-01-01T00:00:00',(''),(''),'ModelShelf verifier','ModelShelf verifier','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${out.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}

function rated(name, x, extra = {}) {
  return { name, guid: guid22(`wall:${name}`), x, length: 2000, rating: "REI30", loadBearing: true, ...extra };
}

const BASE_WALLS = [
  rated("U-0", 0, { rating: null }),
  rated("P-0", 4000),
  rated("S-0", 8000),
  rated("M-0", 12000),
  rated("R-0", 16000, { rating: null }),
  rated("R-1", 20000, { loadBearing: false }),
  rated("D-a", 24000, { guid: DUP_GUID }),
  rated("D-b", 28000, { guid: DUP_GUID }),
  rated("E-0", 32000, { guid: null }),
];

// Added walls are 1500 long, removed walls 2000: a differing shape fingerprint
// drops the leftover heuristic score to 0.20, below the 0.6 gate, so a removal
// and an addition never pair as one move. D-a/D-b (duplicate GlobalId) and E-0
// (no GlobalId) are the deliberate uncertain pairs.
const HEAD_WALLS = [
  rated("U-0", 0, { rating: null }),
  rated("P-0", 4000, { rating: "REI60" }),
  { ...rated("S-0", 8000), length: 3000 },
  rated("M-0", 14000),
  { ...rated("A-0", 36000, { rating: null }), length: 1500 },
  { ...rated("A-1", 40000), length: 1500 },
  rated("D-a", 24000, { guid: DUP_GUID }),
  rated("D-b", 28000, { guid: DUP_GUID }),
  rated("E-0", 32000, { guid: null }),
];

const SPEC_FIRE = "Wall declares a fire rating";
const SPEC_BEARING = "Wall declares a load-bearing use";
const SPEC_WIDTH = "Site declares an evacuation width";

function packXml() {
  const spec = (name, entity, pset, prop, dataType) => `    <specification name="${name}" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity>
          <name><simpleValue>${entity}</simpleValue></name>
        </entity>
      </applicability>
      <requirements>
        <property dataType="${dataType}">
          <propertySet><simpleValue>${pset}</simpleValue></propertySet>
          <baseName><simpleValue>${prop}</simpleValue></baseName>
        </property>
      </requirements>
    </specification>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<ids xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd" xmlns="http://standards.buildingsmart.org/IDS">
  <info>
    <title>Ticket 15 comparison pack</title>
    <description>Fire rating shifts objects (persisting), load-bearing resolves, site width introduces.</description>
  </info>
  <specifications>
${spec(SPEC_FIRE, "IFCWALL", "Pset_WallCommon", "FireRating", "IFCLABEL")}
${spec(SPEC_BEARING, "IFCWALL", "Pset_WallCommon", "LoadBearing", "IFCBOOLEAN")}
${spec(SPEC_WIDTH, "IFCSITE", "Pset_SiteCommon", "EvacuationWidth", "IFCLENGTHMEASURE")}
  </specifications>
</ids>
`;
}

function packMeta() {
  return {
    categories: [
      { id: "regulatory", label: "Regulatory" },
      { id: "safety", label: "Safety" },
    ],
    defaults: { severity: "high", categoryId: "regulatory" },
    specs: {
      [SPEC_FIRE]: { severity: "high", categoryId: "regulatory" },
      [SPEC_BEARING]: { severity: "high", categoryId: "regulatory" },
      [SPEC_WIDTH]: { severity: "critical", categoryId: "safety" },
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "ticket-15");

const runDir = join(EVIDENCE_ROOT, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(join(runDir, "snapshots"), { recursive: true });

const { check, failureCount } = createChecker();
const results = { scenario, passed: false, checks: [], ids: {} };
function record(label, condition, detail) {
  check(label, condition, detail);
  results.checks.push({ label, passed: Boolean(condition), detail: detail ?? null });
}
function snap(name, value) {
  writeFileSync(join(runDir, "snapshots", name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

buildBinary(runDir);

let dataDir = "";
let checkerProcess = null;
let nextProcess = null;
let browser = null;
let checkerLog = "";
let nextLog = "";
const browserLog = [];
const networkErrors = [];

async function api(origin, path, init) {
  const res = await fetch(`${origin}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
}

async function post(base, path, body) {
  return api(base, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pollUntil(label, fn, { intervalMs = 2000, timeoutMs = 600_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const outcome = await fn();
    if (outcome.done) return outcome.value ?? null;
    if (Date.now() > deadline) throw new Error(`${label} timed out: ${outcome.note ?? "no progress"}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function uploadBytes(base, sourceModelId, filename, bytes) {
  const form = new FormData();
  form.set("file", new Blob([bytes]), filename);
  const res = await fetch(`${base}/api/source-models/${sourceModelId}/revisions`, { method: "POST", body: form });
  return { status: res.status, json: await res.json() };
}

async function uploadFileAndAwait(base, sourceModelId, filename, bytes, timeoutMs = 600_000) {
  const enqueued = await uploadBytes(base, sourceModelId, filename, bytes);
  if (enqueued.status !== 202) return { enqueued, job: null };
  const job = await pollUntil(
    `job ${enqueued.json.id}`,
    async () => {
      const current = await api(base, `/api/jobs/${enqueued.json.id}`);
      if (!current.ok) return { done: false, note: `http ${current.status}` };
      if (current.json?.status === "completed" || current.json?.status === "failed") {
        return { done: true, value: current.json };
      }
      return { done: false, note: `status ${current.json?.status}` };
    },
    { intervalMs: 2000, timeoutMs },
  );
  return { enqueued, job };
}

async function main() {
  dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-ui-comparisons-"));

  const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
  writeFileSync(join(runDir, "seed.log"), `${seed.stdout}${seed.stderr}`);
  record("seed exits zero", seed.status === 0, `exit ${seed.status}: ${seed.stdout}${seed.stderr}`);

  const uvSync = spawnSync("uv", ["sync", "--locked", "--project", "services/ifc-worker"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  writeFileSync(join(runDir, "worker-sync.log"), `${uvSync.stdout ?? ""}${uvSync.stderr ?? ""}`);
  if (uvSync.status !== 0) console.error(`WARN - worker pre-sync failed, first job pays the cost: ${uvSync.stderr}`);

  const checkerPort = await freePort();
  checkerProcess = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(checkerPort)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  checkerProcess.stdout.on("data", (chunk) => (checkerLog += String(chunk)));
  checkerProcess.stderr.on("data", (chunk) => (checkerLog += String(chunk)));
  await waitForHealth(checkerPort, { child: checkerProcess, timeoutMs: 15_000 });
  record("checker becomes healthy", true);
  const checkerOrigin = `http://127.0.0.1:${checkerPort}`;

  // --- stage: pack, source, revisions, deliveries, runs (all API) ---
  const packV1 = (await post(checkerOrigin, "/api/packs/demo-pack/versions", { idsXml: packXml(), metadata: packMeta() })).json;
  record("comparison pack v1 is published", Boolean(packV1?.id), JSON.stringify(packV1));
  results.ids.packVersionId = packV1?.id ?? null;

  const source = (
    await post(checkerOrigin, "/api/projects/demo-project/source-models", { name: "Compare ARCH", discipline: "ARCH" })
  ).json;
  record("compare source is created", Boolean(source?.id), JSON.stringify(source));

  const baseBytes = Buffer.from(buildCompareIfc("cmp-base.ifc", BASE_WALLS, true), "utf8");
  const headBytes = Buffer.from(buildCompareIfc("cmp-head.ifc", HEAD_WALLS, false), "utf8");
  const revBase = await uploadFileAndAwait(checkerOrigin, source.id, "cmp-base.ifc", baseBytes);
  const revHead = await uploadFileAndAwait(checkerOrigin, source.id, "cmp-head.ifc", headBytes);
  record(
    "base and head revisions ingest via the real worker",
    revBase.job?.status === "completed" && revHead.job?.status === "completed",
    JSON.stringify({ base: revBase.job?.status, head: revHead.job?.status }),
  );
  if (revBase.job?.status !== "completed" || revHead.job?.status !== "completed") {
    throw new Error(`inline fixtures failed to ingest: ${JSON.stringify({ revBase: revBase.job, revHead: revHead.job })}`);
  }
  const revBaseId = revBase.job.modelRevisionId;
  const revHeadId = revHead.job.modelRevisionId;

  async function runOn(deliveryId, packVersionId) {
    const run = (await post(checkerOrigin, "/api/runs", { deliveryId, packVersionId })).json;
    if (run?.run?.status !== "completed" || run?.inputProvenance?.status !== "complete") {
      throw new Error(
        `run did not complete with pinned inputs: ${JSON.stringify({ status: run?.run?.status, provenance: run?.inputProvenance })}`,
      );
    }
    return run;
  }

  async function deliverAndRun(label, revisionId, packVersionId) {
    const delivery = (
      await post(checkerOrigin, "/api/projects/demo-project/deliveries", { label })
    ).json;
    const member = await post(checkerOrigin, `/api/deliveries/${delivery.id}/members`, {
      sourceModelId: source.id,
      modelRevisionId: revisionId,
    });
    if (!member.ok) throw new Error(`member add failed: ${JSON.stringify(member.json)}`);
    return { delivery, run: await runOn(delivery.id, packVersionId) };
  }

  const { delivery: delBase, run: runBase } = await deliverAndRun("Compare base", revBaseId, packV1.id);
  const { delivery: delHead, run: runHead } = await deliverAndRun("Compare head", revHeadId, packV1.id);
  results.ids.baseDeliveryId = delBase.id;
  results.ids.headDeliveryId = delHead.id;
  record("base and head deliveries each complete a run", Boolean(runBase.run?.id && runHead.run?.id), `${runBase.run?.id} / ${runHead.run?.id}`);

  // A second pack version, run on the head delivery itself: the reviewer can
  // reach the incompatible pair from the head run picker, which is where the
  // 409 has to be explained.
  const packV2 = (await post(checkerOrigin, "/api/packs/demo-pack/versions", { idsXml: packXml(), metadata: packMeta() })).json;
  const runHeadV2 = await runOn(delHead.id, packV2.id);
  results.ids.headRunV2Id = runHeadV2.run?.id ?? null;
  record("a head run under pack v2 stages the incomparable pair", Boolean(runHeadV2.run?.id), runHeadV2.run?.id);

  const diffRes = await api(
    checkerOrigin,
    `/api/diff/models?baseDeliveryId=${delBase.id}&headDeliveryId=${delHead.id}&limit=5000`,
  );
  snap("diff-models.json", diffRes.json);
  const pair = diffRes.json?.pairs?.[0];
  // Oracle by object, not by totals: each controlled edit names the kind and the
  // match confidence it must report.
  const ORACLE = {
    "U-0": { kind: "unchanged", confidence: "exact" },
    "P-0": { kind: "properties_changed", confidence: "exact" },
    "S-0": { kind: "shape_changed", confidence: "exact" },
    "M-0": { kind: "moved", confidence: "exact" },
    "R-0": { kind: "removed", confidence: "none" },
    "R-1": { kind: "removed", confidence: "none" },
    "A-0": { kind: "added", confidence: "none" },
    "A-1": { kind: "added", confidence: "none" },
    "D-a": { kind: "unchanged", confidence: "heuristic" },
    "D-b": { kind: "unchanged", confidence: "heuristic" },
    "E-0": { kind: "unchanged", confidence: "heuristic" },
    CompareSite: { kind: "properties_changed", confidence: "exact" },
  };
  const observed = new Map();
  for (const change of pair?.changes ?? []) {
    const name = change.head?.name ?? change.base?.name;
    observed.set(name, { kind: change.kind, confidence: change.confidence.kind });
  }
  const mismatched = Object.entries(ORACLE).filter(([name, want]) => {
    const got = observed.get(name);
    return got?.kind !== want.kind || got?.confidence !== want.confidence;
  });
  snap("change-oracle.json", { oracle: ORACLE, observed: Object.fromEntries(observed), mismatched });
  record("every controlled change reports its oracle kind and confidence",
    diffRes.ok && mismatched.length === 0,
    mismatched.length === 0 ? JSON.stringify(pair?.summary) : JSON.stringify(mismatched));
  record("uncertain matches are counted", pair?.summary?.uncertainMatches === 3,
    JSON.stringify(pair?.summary?.uncertainMatches));
  const findingRes = await api(checkerOrigin, `/api/diff/runs?baseRunId=${runBase.run.id}&headRunId=${runHead.run.id}`);
  snap("diff-runs.json", findingRes.json);
  record("finding diff groups resolved 1 / introduced 1 / persisting 1",
    findingRes.ok && findingRes.json?.resolved === 1 && findingRes.json?.introduced === 1 && findingRes.json?.persisting === 1,
    JSON.stringify({ resolved: findingRes.json?.resolved, introduced: findingRes.json?.introduced, persisting: findingRes.json?.persisting }));
  const refused = await api(checkerOrigin, `/api/diff/runs?baseRunId=${runBase.run.id}&headRunId=${runHeadV2.run.id}`);
  snap("diff-runs-refused.json", refused.json);
  record("pack v2 head run refuses with 409 pack_version_mismatch",
    refused.status === 409 && refused.json?.error?.code === "pack_version_mismatch",
    JSON.stringify(refused.json?.error));

  // --- web: build, serve, drive ---
  const webPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const buildEnv = { ...process.env, CHECKER_ORIGIN: checkerOrigin };
  const build = spawnSync(process.execPath, [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: WEB_ROOT,
    env: buildEnv,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(runDir, "next-build.log"), `${build.stdout ?? ""}${build.stderr ?? ""}`);
  record("production Next build succeeds", build.status === 0, `exit ${build.status}`);
  if (build.status !== 0) throw new Error("Next build failed; see next-build.log");

  nextProcess = spawn(
    process.execPath,
    [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(webPort)],
    { cwd: WEB_ROOT, env: buildEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  nextProcess.stdout.on("data", (chunk) => (nextLog += String(chunk)));
  nextProcess.stderr.on("data", (chunk) => (nextLog += String(chunk)));
  await pollUntil("next start", async () => {
    try {
      const res = await fetch(`${webOrigin}/`);
      return { done: res.ok, note: `http ${res.status}` };
    } catch {
      return { done: false, note: "connection refused" };
    }
  }, { intervalMs: 500, timeoutMs: 60_000 });
  record("production Next app serves the shelf", true);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__modelshelfViewerVerify = true;
  });
  // A refused comparison is a 409 the screen explains on purpose, and Chromium
  // logs every non-2xx response as a resource error. Those lines are the
  // browser narrating an expected answer, so they are not app errors; a
  // pageerror or any other console error still fails the run.
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/status of 409/.test(text)) return;
    browserLog.push(`console error: ${text}\n`);
  });
  page.on("pageerror", (error) => browserLog.push(`pageerror: ${error.stack ?? error.message}\n`));
  page.on("requestfailed", (request) => {
    networkErrors.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) networkErrors.push(`${response.status()} ${response.url()}`);
  });

  const compareUrl = `${webOrigin}/deliveries/compare?base=${delBase.id}&head=${delHead.id}`;
  await page.goto(compareUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-compare-screen]", { timeout: 30_000 });
  record("compare route renders from ?base= and ?head=", true, compareUrl);

  await page.waitForSelector('[data-change-row][data-change-kind="added"]', { timeout: 60_000 });
  for (const name of ["A-0", "A-1", "R-0", "R-1", "M-0", "P-0", "S-0", "U-0", "D-a", "D-b", "E-0"]) {
    await page.getByText(name, { exact: true }).first().waitFor({ timeout: 30_000 });
  }
  record("every controlled A/B change row is listed", true);
  const uncertainBadges = await page.locator("[data-uncertain-badge]").count();
  record("every uncertain match carries a text badge, and only those",
    uncertainBadges === 3, `${uncertainBadges} badges against uncertainMatches 3`);

  // Japanese is the default language. This box has no CJK font, so the
  // screenshots render kanji as tofu; the copy is asserted in the DOM, which is
  // what a reviewer's machine renders.
  const japaneseCopy = await page.evaluate(() => {
    const text = document.querySelector("[data-compare-screen]")?.textContent ?? "";
    return ["基準デリバリー", "先端デリバリー", "種別", "確度", "モデル差分", "指摘差分"].filter(
      (label) => !text.includes(label),
    );
  });
  record("every compare label carries its Japanese copy", japaneseCopy.length === 0, japaneseCopy.join(", "));

  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout: 360_000 },
  );
  record("base-side geometry loads in the viewer", true);
  const probe = await page.evaluate(() => {
    const diag = window.__modelshelfViewer?.inspect();
    return { objectCount: diag.objects.length, highlightGroups: diag.renderer.highlightGroups };
  });
  snap("viewer-diagnostics-base.json", probe);
  record("viewer holds drawable geometry for the inline fixtures", probe.objectCount > 0, `objects=${probe.objectCount}`);

  // Base side: removed resolves, added shows the head banner. Selecting a row
  // is the only thing allowed to move the camera.
  const cameraBefore = await camera(page);
  await rowByName(page, "R-0").click();
  await page.waitForSelector('[data-change-detail][data-change-kind="removed"]', { timeout: 30_000 });
  await page.waitForSelector('[data-change-detail] [data-frame-state="framed"]', { timeout: 30_000 });
  record("removed selection frames base-side geometry", true);
  const cameraFramed = await camera(page);
  record("selecting a change moves the camera to its geometry", cameraFramed !== cameraBefore,
    `${cameraBefore} -> ${cameraFramed}`);
  await page.screenshot({ path: join(runDir, "compare-base.png"), fullPage: true });

  await rowByName(page, "A-0").click();
  await page.waitForSelector('[data-side-banner="head"]', { timeout: 30_000 });
  record("added viewed from base shows the head banner", true);

  // Filters narrow the list; the toggle preserves filters and selection.
  const cameraBeforeFilter = await camera(page);
  await page.getByLabel(/種別 \/ Kind/).selectOption("moved");
  const movedRows = await page.locator("[data-change-row]").count();
  record("kind filter narrows to the moved row", movedRows === 1, `${movedRows} rows`);
  const cameraAfterFilter = await camera(page);
  record("filtering never moves the camera", cameraAfterFilter === cameraBeforeFilter,
    `${cameraBeforeFilter} -> ${cameraAfterFilter}`);
  await page.getByRole("button", { name: /先端 \/ Head/ }).click();
  await page.waitForFunction(
    () => window.__modelshelfViewer?.inspect().snapshot.models.every(({ status }) => status === "ready"),
    undefined,
    { timeout: 360_000 },
  );
  const kindValue = await page.getByLabel(/種別 \/ Kind/).inputValue();
  record("side toggle preserves filters", kindValue === "moved", `kind=${kindValue}`);
  await page.getByLabel(/種別 \/ Kind/).selectOption("all");
  // The kind-select re-render is async from the driver's view: poll for the
  // preserved selection instead of racing the commit with an immediate count.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-change-row][data-selected="true"]').length === 1,
    undefined,
    { timeout: 30_000 },
  );
  const stillSelected = await page.locator('[data-change-row][data-selected="true"]').count();
  record("side toggle preserves selection", stillSelected === 1, `${stillSelected} selected rows`);
  await page.waitForSelector("[data-change-detail] [data-frame-state=\"framed\"]", { timeout: 30_000 });
  record("added selection frames head-side geometry", true);

  // Head side: removed shows the base banner; the jump returns to base.
  await rowByName(page, "R-1").click();
  await page.waitForSelector('[data-side-banner="base"]', { timeout: 30_000 });
  record("removed viewed from head shows the base banner", true);
  await page.getByRole("button", { name: /基準で表示/ }).click();
  await page.waitForSelector("[data-change-detail] [data-frame-state=\"framed\"]", { timeout: 30_000 });
  record("banner jump returns to the side holding the geometry", true);

  // Uncertain rows name their basis; duplicate GlobalIds select independently.
  await page.getByLabel(/確度 \/ Confidence/).selectOption("uncertain");
  const uncertainRows = await page.locator("[data-change-row]").count();
  record("uncertainty filter keeps exactly the heuristic rows", uncertainRows === 3, `${uncertainRows} rows`);

  // Keyboard only: walk focus from the filters into the change list and
  // activate a row with Enter. No pointer events in this block.
  await page.getByLabel(/確度 \/ Confidence/).focus();
  let focusedRow = false;
  for (let step = 0; step < 30 && !focusedRow; step += 1) {
    await page.keyboard.press("Tab");
    focusedRow = await page.evaluate(() => document.activeElement?.hasAttribute("data-change-row") ?? false);
  }
  await page.keyboard.press("Enter");
  const keyboardSelected = await page.locator('[data-change-row][data-selected="true"]').count();
  record("a change row takes focus and activates from the keyboard",
    focusedRow && keyboardSelected === 1, `focusedRow=${focusedRow} selected=${keyboardSelected}`);
  await page.keyboard.press("Enter");
  record("the same key clears the selection", (await page.locator('[data-change-row][data-selected="true"]').count()) === 0);
  await rowByName(page, "D-a").click();
  await page.waitForSelector("[data-change-detail] [data-confidence]", { timeout: 30_000 });
  const dupAFramed = await page.getAttribute("[data-change-detail] [data-frame-state]", "data-frame-state").catch(() => null);
  record("duplicate GlobalId selects its own revision", dupAFramed === "framed", `frame-state=${dupAFramed}`);
  await rowByName(page, "D-b").click();
  await page.waitForSelector("[data-change-detail] [data-frame-state=\"framed\"]", { timeout: 30_000 });
  const dupDetail = await page.locator("[data-change-detail]").textContent();
  record("the second duplicate selects independently", (dupDetail ?? "").includes("D-b"), (dupDetail ?? "").slice(0, 160));
  await page.screenshot({ path: join(runDir, "compare-uncertain.png"), fullPage: true });
  await page.getByLabel(/確度 \/ Confidence/).selectOption("all");

  // Finding deltas group with both runs selected; the v2 head run refuses.
  await page.getByLabel(/基準ラン/).selectOption(runBase.run.id);
  await page.getByLabel(/先端ラン/).selectOption(runHead.run.id);
  await page.waitForSelector("[data-finding-delta-list]", { timeout: 60_000 });
  snap("finding-panel.txt", await page.locator("[data-compare-inspector]").innerText());
  for (const delta of ["resolved", "introduced", "persisting"]) {
    await page.waitForSelector(`[data-finding-delta="${delta}"]`, { timeout: 30_000 });
  }
  record("finding deltas group into resolved/introduced/persisting", true);
  await page.getByLabel(/先端ラン/).selectOption(runHeadV2.run.id);
  await page.waitForSelector("[data-finding-incomparable]", { timeout: 30_000 });
  const dimension = await page.getAttribute("[data-incomparable-dimension]", "data-incomparable-dimension");
  const rerunVisible = await page.getByRole("button", { name: /Rerun base/ }).isVisible();
  record("incomparable runs name their dimension with a rerun CTA",
    dimension === "pack_version_mismatch" && rerunVisible, `dimension=${dimension} rerun=${rerunVisible}`);

  record("zero console errors", browserLog.length === 0, browserLog.join("").slice(0, 2000));
  record("zero network errors", networkErrors.length === 0, networkErrors.join("\n").slice(0, 2000));

  results.passed = true;
  console.log("comparison verification passed");
}

function rowByName(page, name) {
  return page.locator("[data-change-row]").filter({ hasText: name });
}

/** Camera position as a comparable string; the viewer owns camera state. */
function camera(page) {
  return page.evaluate(() =>
    (window.__modelshelfViewer?.inspect().renderer.cameraPosition ?? []).map((n) => n.toFixed(3)).join(","),
  );
}

try {
  await main();
} catch (error) {
  results.error = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(results.error);
} finally {
  if (browser) await browser.close();
  await stopProcess(nextProcess);
  await stopProcess(checkerProcess);
  writeFileSync(join(runDir, "checker.log"), checkerLog);
  writeFileSync(join(runDir, "next.log"), nextLog);
  writeFileSync(join(runDir, "browser.log"), browserLog.join(""));
  writeFileSync(join(runDir, "network-errors.log"), networkErrors.join("\n"));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

snap("results.json", { ...results, failures: failureCount() });
console.log(`evidence written to ${runDir}`);
if (failureCount() > 0 || !results.passed) {
  console.error(`${failureCount()} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
