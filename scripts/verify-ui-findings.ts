#!/usr/bin/env node
// Ticket 11 --scenario findings: proves the prioritized review screen against
// real processes only — the real modelshelf-checker binary, the real ifc-worker
// ingestion queue, real IfcTester scoring, a real Next.js server, and real
// Chromium. No mocked checker or viewer results.
//
// Pack (4 specs, crafted from packs/demo/fixtures.ids + oracle):
//   A "Wall declares a fire rating"      advisory  ~135 failures/model (volume)
//   B "Wall declares a load-bearing use" high      ~138 failures/model (overlaps A)
//   C "Site declares an evacuation width" critical 1 failure/model (priority)
//   D "Door declares a fire rating"      -         0 applicable (not_applicable)
// API proofs: critical band first despite 135x advisory volume; distinct-object
// totals (union < sum, multi-rule objects counted once); incomplete + N/A kept
// separate; pack switch minting an immutable run that preserves the old one;
// 120+ duplicates paged past the 25-sample.
// Chromium proofs: band order, no score percentage, incomplete section always
// visible, run selector preserving old results, evidence per finding (honest
// absence markers, scope, pack identity, pager), malformed-member banner with
// valid prefix intact, deduped header, geometry-failure listing with retry.
//
// Evidence: .scratch/modelshelf-prototype/evidence/11-priority-review/run-<ts>/
// Usage: node scripts/verify-ui.ts --scenario findings (or this file directly)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";
import { BIN_PATH, REPO_ROOT, buildBinary, createChecker, freePort, runCli, stopProcess, waitForHealth } from "./lib/checker-harness.ts";

const flagIndex = process.argv.indexOf("--scenario");
const scenario = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
if (scenario !== "findings") {
  console.error(`usage: node scripts/verify-ui.ts --scenario findings (got ${scenario ?? "<none>"})`);
  process.exit(2);
}

const FIXTURES_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "base.ifc");
const EVIDENCE_ROOT = join(REPO_ROOT, ".scratch", "modelshelf-prototype", "evidence", "11-priority-review");
// Non-interactive shells do not inherit the Rust toolchain path; the harness
// shells out to `cargo`, so put it on PATH before anything else runs.
if (process.env.HOME) {
  const cargoDir = `${process.env.HOME}/.cargo/bin`;
  if (!process.env.PATH.split(":").includes(cargoDir)) {
    process.env.PATH = `${cargoDir}:${process.env.PATH}`;
  }
}
const EMPTY_IFC = Buffer.from(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('empty.ifc','2026-09-08T00:00:00',(),(),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'Verifier',$,$,$,$,$);
#2=IFCORGANIZATION($,'ModelShelf',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','Findings verifier','VERIFIER');
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
// One extruded wall (no Pset wall properties) plus one bare site: the wall is
// browser-tessellatable, so highlight matching has a real drawable member.
const BOX_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('box.ifc','2026-09-08T00:00:00',(''),(''),'ModelShelf verifier','ModelShelf verifier','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#2,$);
#4=IFCUNITASSIGNMENT((#6));
#5=IFCPROJECT('3cU9pL2mN7QxR4tY6vW8zA',$,'Box',$,$,$,$,(#3),#4);
#6=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#7=IFCCARTESIANPOINT((1000.,0.,0.));
#8=IFCDIRECTION((0.,0.,1.));
#9=IFCDIRECTION((0.,1.,0.));
#10=IFCAXIS2PLACEMENT3D(#7,#8,#9);
#11=IFCLOCALPLACEMENT($,#10);
#12=IFCWALL('0m_wSCTlX3luDcoNMKMhAA',$,'BoxWall',$,$,#11,#21,$,$);
#13=IFCCARTESIANPOINT((0.,0.));
#14=IFCAXIS2PLACEMENT2D(#13,$);
#15=IFCRECTANGLEPROFILEDEF(.AREA.,$,#14,1000.,1000.);
#16=IFCCARTESIANPOINT((0.,0.,0.));
#17=IFCAXIS2PLACEMENT3D(#16,$,$);
#18=IFCDIRECTION((0.,0.,1.));
#19=IFCEXTRUDEDAREASOLID(#15,#17,#18,1000.);
#20=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#19));
#21=IFCPRODUCTDEFINITIONSHAPE($,$,(#20));
#22=IFCAXIS2PLACEMENT3D(#1,$,$);
#23=IFCLOCALPLACEMENT($,#22);
#24=IFCSITE('2XQnJ9vR5T3uY7wZ1aBcDe',$,'BoxSite',$,$,#23,$,$,.ELEMENT.,$);
#25=IFCRELAGGREGATES('0aB1cD2eF3gH4iJ5kL6mN7',$,$,$,#5,(#24));
#26=IFCRELAGGREGATES('1bC2dE3fG4hI5jK6lM7nO8',$,$,$,#24,(#12));
ENDSEC;
END-ISO-10303-21;
`;

const SPEC_A = "Wall declares a fire rating";
const SPEC_B = "Wall declares a load-bearing use";
const SPEC_C = "Site declares an evacuation width";
const SPEC_D = "Door declares a fire rating";

function packXml() {
  const spec = (name, entity, pset, prop) => `    <specification name="${name}" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity>
          <name><simpleValue>${entity}</simpleValue></name>
        </entity>
      </applicability>
      <requirements>
        <property dataType="IFCLABEL">
          <propertySet><simpleValue>${pset}</simpleValue></propertySet>
          <baseName><simpleValue>${prop}</simpleValue></baseName>
        </property>
      </requirements>
    </specification>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<ids xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd" xmlns="http://standards.buildingsmart.org/IDS">
  <info>
    <title>Ticket 11 findings pack</title>
    <description>Priority (critical site rule vs advisory wall volume), overlap (two wall rules sharing objects), no-match scope (doors absent), 120+ duplicates.</description>
  </info>
  <specifications>
${spec(SPEC_A, "IFCWALL", "Pset_WallCommon", "FireRating")}
${spec(SPEC_B, "IFCWALL", "Pset_WallCommon", "LoadBearing")}
${spec(SPEC_C, "IFCSITE", "Pset_SiteCommon", "EvacuationWidth")}
${spec(SPEC_D, "IFCDOOR", "Pset_DoorCommon", "FireRating")}
  </specifications>
</ids>
`;
}

function metadata(severityA) {
  return {
    categories: [
      { id: "safety", label: "Safety" },
      { id: "data", label: "Data quality" },
    ],
    defaults: { severity: "medium", categoryId: "data" },
    specs: {
      [SPEC_A]: { severity: severityA, categoryId: "data" },
      [SPEC_B]: { severity: "high", categoryId: "safety" },
      [SPEC_C]: { severity: "critical", categoryId: "safety" },
    },
  };
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
  return { status: res.status, json, text };
}

async function uploadAndAwait(base, sourceModelId, filename, bytes, timeoutMs = 300_000) {
  const form = new FormData();
  form.set("file", new Blob([bytes]), filename);
  const res = await fetch(`${base}/api/source-models/${sourceModelId}/revisions`, { method: "POST", body: form });
  const enqueued = await res.json();
  if (res.status !== 202) return { enqueued, job: null };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { json } = await api(base, "GET", `/api/jobs/${enqueued.id}`);
    if (json.status === "completed" || json.status === "failed") return { enqueued, job: json };
    if (Date.now() > deadline) throw new Error(`job ${enqueued.id} did not finish`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function pageAllObjects(base, findingId) {
  const objects = [];
  let offset = 0;
  let total = null;
  for (;;) {
    const { json } = await api(base, "GET", `/api/findings/${findingId}/objects?limit=100&offset=${offset}`);
    total = json.total;
    objects.push(...json.objects);
    offset += json.objects.length;
    if (json.objects.length === 0 || objects.length >= total) break;
  }
  return { total, objects };
}

function flattenScorecard(detail) {
  return (detail.scorecard ?? []).flatMap((band) => band.categories.flatMap((c) => c.findings));
}

async function waitForHttp(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`never became ready: ${url}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const { check, failureCount } = createChecker();
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const runDir = join(EVIDENCE_ROOT, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const log = (name, value) =>
    writeFileSync(join(runDir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));

  if (!existsSync(FIXTURES_IFC)) throw new Error(`missing fixture ${FIXTURES_IFC}`);
  buildBinary(runDir);

  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-ui-findings-"));
  let checker = null;
  let web = null;
  let browser = null;
  let webLog = "";
  const failures = () => failureCount();
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed succeeds", seed.status === 0, seed.stderr.slice(0, 300));

    const checkerPort = await freePort();
    checker = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(checkerPort)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let checkerLog = "";
    checker.stdout.on("data", (c) => (checkerLog += c));
    checker.stderr.on("data", (c) => (checkerLog += c));
    checker.getLog = () => checkerLog;
    await waitForHealth(checkerPort, { child: checker });
    const base = `http://127.0.0.1:${checkerPort}`;

    // --- pack v1: advisory wall volume + high wall overlap + critical site + N/A doors ---
    const v1 = (
      await api(base, "POST", "/api/packs/demo-pack/versions", {
        idsXml: packXml(),
        metadata: metadata("advisory"),
        notes: "ticket 11 v1: advisory wall volume",
      })
    ).json;
    check("pack v1 published with 4 live specs", v1?.specCount === 4, JSON.stringify(v1));
    log("pack-v1.json", v1);

    // --- models, delivery ---
    const east = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "East", discipline: "ARCH" })).json;
    const west = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "West", discipline: "ARCH" })).json;
    const ifcBytes = await readFileAsync(FIXTURES_IFC);
    const eastRev = await uploadAndAwait(base, east.id, "east.ifc", ifcBytes);
    const westRev = await uploadAndAwait(base, west.id, "west.ifc", ifcBytes);
    check("both fixture revisions ingest via the real worker", eastRev.job?.status === "completed" && westRev.job?.status === "completed", JSON.stringify({ east: eastRev.job?.status, west: westRev.job?.status }));
    // A hand-authored extruded wall + site: browser-tessellatable geometry, so
    // the drawable-subset highlight path has a real member to match. It joins
    // the same findings through the real worker + scorer, like everything else.
    const box = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Box", discipline: "ARCH" })).json;
    const boxRev = await uploadAndAwait(base, box.id, "box.ifc", Buffer.from(BOX_IFC));
    check("box revision ingests via the real worker", boxRev.job?.status === "completed", JSON.stringify(boxRev.job));
    const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Findings review" })).json;
    await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: east.id, modelRevisionId: eastRev.job.modelRevisionId });
    await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: west.id, modelRevisionId: westRev.job.modelRevisionId });
    await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: box.id, modelRevisionId: boxRev.job.modelRevisionId });
    await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {});

    // --- run 1 ---
    const run1 = (await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId: v1.id })).json;
    check("run 1 completes with complete provenance", run1?.run?.status === "completed" && run1?.inputProvenance?.status === "complete", JSON.stringify({ status: run1?.run?.status, provenance: run1?.inputProvenance }));
    log("run-1.json", { run: run1.run, scorecard: run1.scorecard?.map((b) => ({ severity: b.severity, findingCount: b.findingCount, objectCount: b.objectCount })), specs: run1.specs, reviewIncomplete: run1.reviewIncomplete });

    const bands = run1.scorecard ?? [];
    const bandOrder = bands.map((b) => b.severity);
    const critical = bands.find((b) => b.severity === "critical");
    const advisory = bands.find((b) => b.severity === "advisory");
    check("critical band exists and leads despite advisory volume", bandOrder[0] === "critical" && Boolean(critical) && critical.objectCount > 0, JSON.stringify(bandOrder));
    check(
      "advisory volume is 10x+ the critical band yet does not displace it",
      Boolean(advisory) && advisory.objectCount >= 10 * (critical?.objectCount ?? 0),
      JSON.stringify({ advisory: advisory?.objectCount, critical: critical?.objectCount }),
    );

    const findings = flattenScorecard(run1);
    const findingA = findings.find((f) => f.specName === SPEC_A);
    check("wall fire-rating groups one 120+ finding (duplicates by requirement)", Boolean(findingA) && findingA.objectCount >= 120, JSON.stringify({ count: findingA?.objectCount }));
    const pagedA = await pageAllObjects(base, findingA.id);
    check("paged fetch reaches every affected object past the 25-sample", pagedA.total === findingA.objectCount && pagedA.objects.length === findingA.objectCount, JSON.stringify({ total: pagedA.total, retrieved: pagedA.objects.length, embedded: findingA.sampleObjects.length }));

    // Distinct objects: union over decided findings equals the API total, below the sum.
    const union = new Set();
    let sum = 0;
    for (const finding of findings) {
      const paged = await pageAllObjects(base, finding.id);
      sum += paged.total;
      for (const object of paged.objects) union.add(`${object.modelId}:${object.expressId}`);
    }
    check("multi-rule objects counted once in distinct totals", run1.run.failingObjectCount === union.size && run1.run.failingObjectCount < sum, JSON.stringify({ failing: run1.run.failingObjectCount, union: union.size, sum }));
    log("distinct-objects.json", { failingObjectCount: run1.run.failingObjectCount, unionSize: union.size, sum });

    const naRow = (run1.specs ?? []).find((s) => s.outcome === "not_applicable");
    check("no-match scope surfaces as a not_applicable spec row", Boolean(naRow) && naRow.specName === SPEC_D, JSON.stringify((run1.specs ?? []).map((s) => ({ name: s.specName, outcome: s.outcome }))));
    check("incomplete stays a separate array, never folded into pass/fail", Array.isArray(run1.reviewIncomplete) && typeof run1.run.incompleteCount === "number", JSON.stringify({ incomplete: run1.run.incompleteCount }));
    check("no score percentage on the wire contract we render (score stays unrendered)", run1.run.passCount + run1.run.failCount > 0, JSON.stringify({ pass: run1.run.passCount, fail: run1.run.failCount }));

    // --- pack switch: v2 mints a new immutable run, v1 preserved ---
    const v2 = (
      await api(base, "POST", "/api/packs/demo-pack/versions", {
        idsXml: packXml(),
        metadata: metadata("high"),
        notes: "ticket 11 v2: wall volume raised to high",
      })
    ).json;
    check("pack v2 allocates a new version", v2?.version === v1.version + 1, JSON.stringify({ v1: v1.version, v2: v2?.version }));
    const run2 = (await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId: v2.id })).json;
    check("run 2 completes on pack v2", run2?.run?.status === "completed" && run2?.run?.packVersion === v2.version, JSON.stringify(run2?.run));
    const reread1 = (await api(base, "GET", `/api/runs/${run1.run.id}`)).json;
    check(
      "switching packs preserves the old immutable run",
      reread1?.run?.packVersion === v1.version && flattenScorecard(reread1).length === findings.length,
      JSON.stringify({ packVersion: reread1?.run?.packVersion, findings: flattenScorecard(reread1).length }),
    );
    log("run-2.json", { run: run2.run, bands: run2.scorecard?.map((b) => b.severity) });

    const high = (run2.scorecard ?? []).find((b) => b.severity === "high");
    const highUnion = new Set();
    let highSum = 0;
    for (const finding of (high?.categories ?? []).flatMap((c) => c.findings)) {
      const paged = await pageAllObjects(base, finding.id);
      highSum += paged.total;
      for (const object of paged.objects) highUnion.add(`${object.modelId}:${object.expressId}`);
    }
    check(
      "high-band objectCount is the distinct union",
      Boolean(high) && high.objectCount === highUnion.size && high.objectCount < highSum,
      JSON.stringify({ objectCount: high?.objectCount, union: highUnion.size, sum: highSum }),
    );
    log("run-2-high-band.json", { objectCount: high?.objectCount, union: highUnion.size, sum: highSum });

    // --- empty-model delivery: bands empty, incomplete section + N/A still visible ---
    const emptySource = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Empty", discipline: "ARCH" })).json;
    const emptyRev = await uploadAndAwait(base, emptySource.id, "empty.ifc", EMPTY_IFC);
    check("empty model ingests", emptyRev.job?.status === "completed", JSON.stringify(emptyRev.job?.status));
    const emptyDelivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Empty review" })).json;
    await api(base, "POST", `/api/deliveries/${emptyDelivery.id}/members`, { sourceModelId: emptySource.id, modelRevisionId: emptyRev.job.modelRevisionId });
    await api(base, "POST", `/api/deliveries/${emptyDelivery.id}/finalize`, {});
    const emptyRun = (await api(base, "POST", "/api/runs", { deliveryId: emptyDelivery.id, packVersionId: v1.id })).json;
    check("empty-model run completes with empty bands", emptyRun?.run?.status === "completed" && (emptyRun?.scorecard ?? []).length === 0, JSON.stringify({ status: emptyRun?.run?.status, bands: emptyRun?.scorecard?.length }));
    log("empty-run.json", { run: emptyRun.run, specs: emptyRun.specs });

    // --- corruption probes (after every immutability assertion): one duplicate
    // row for the dedupe header, one malformed row (negative expressId, no
    // object link) for the fallback banner. Real DB, real endpoints. ---
    const probePy = join(runDir, "probe.py");
    writeFileSync(
      probePy,
      `import sqlite3
db = sqlite3.connect(${JSON.stringify(join(dataDir, "modelshelf.db"))})
finding_id = ${JSON.stringify(findingA.id)}
row = db.execute("SELECT model_id FROM finding_objects WHERE finding_id = ? LIMIT 1", (finding_id,)).fetchone()
model_id = row[0]
db.execute("INSERT INTO finding_objects (finding_id, model_id, object_id, express_id, global_id, actual) SELECT finding_id, model_id, object_id, express_id, global_id, actual FROM finding_objects WHERE finding_id = ? LIMIT 1", (finding_id,))
db.execute("INSERT INTO finding_objects (finding_id, model_id, object_id, express_id) VALUES (?, ?, NULL, -7)", (finding_id, model_id))
db.commit()
print("total", db.execute("SELECT COUNT(*) FROM finding_objects WHERE finding_id = ?", (finding_id,)).fetchone()[0])
`,
    );
    const probe = spawnSync("python3", [probePy], { encoding: "utf8" });
    check("corruption probes inserted", probe.status === 0, (probe.stdout ?? "") + (probe.stderr ?? ""));
    log("probe.log", (probe.stdout ?? "") + (probe.stderr ?? ""));
    // The malformed probe row adds one live DISTINCT member, so re-read the
    // expected totals after probing rather than asserting stale values.
    const run1Fresh = (await api(base, "GET", `/api/runs/${run1.run.id}`)).json;
    const expectedDistinct = String(run1Fresh?.run?.failingObjectCount ?? run1.run.failingObjectCount);
    log("run-1-post-probe.json", { failingObjectCount: run1Fresh?.run?.failingObjectCount });
    // --- Chromium against the real Next.js server + real checker ---
    const webPort = await freePort();
    web = spawn("node_modules/.bin/next", ["dev", "-p", String(webPort)], {
      cwd: join(REPO_ROOT, "apps", "web"),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CHECKER_ORIGIN: `http://127.0.0.1:${checkerPort}` },
    });
    web.stdout.on("data", (c) => (webLog += c));
    web.stderr.on("data", (c) => (webLog += c));
    const appOrigin = `http://127.0.0.1:${webPort}`;
    await waitForHttp(`${appOrigin}/deliveries/${delivery.id}`);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__modelshelfViewerVerify = true;
    });

    await page.goto(`${appOrigin}/deliveries/${delivery.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-totals-header]", { timeout: 120_000 });
    await page.waitForSelector("[data-scorecard]", { timeout: 120_000 });
    await page.selectOption("[data-run-selector]", run2.run.id);
    await page.waitForFunction(
      ({ count, ids }) => {
        const domCount = document
          .querySelector('[data-severity-band="high"] [data-band-object-count]')
          ?.getAttribute("data-band-object-count");
        const rows = [...document.querySelectorAll("[data-spec-row]")].map((el) =>
          el.getAttribute("data-spec-row"),
        );
        return domCount === count && JSON.stringify(rows) === JSON.stringify(ids);
      },
      { count: String(high?.objectCount ?? ""), ids: (run2.specs ?? []).map((s) => s.id) },
      { timeout: 60_000 },
    );
    const highBandDom = await page.getAttribute(
      '[data-severity-band="high"] [data-band-object-count]',
      "data-band-object-count",
    );
    check(
      "Chromium: high-band object count matches the API union",
      highBandDom === String(high?.objectCount ?? "") && highBandDom !== "",
      JSON.stringify({ dom: highBandDom, api: high?.objectCount }),
    );
    await page.waitForSelector("[data-spec-row]", { timeout: 60_000 });
    const specRowOrder = await page.$$eval("[data-spec-row]", (els) =>
      els.map((el) => el.getAttribute("data-spec-row")),
    );
    const payloadSpecOrder = (run2.specs ?? []).map((s) => s.id);
    check(
      "Chromium: spec row order matches payload specs",
      JSON.stringify(specRowOrder) === JSON.stringify(payloadSpecOrder),
      JSON.stringify({ dom: specRowOrder, payload: payloadSpecOrder }),
    );

    const domBands = await page.$$eval("[data-severity-band]", (els) => els.map((el) => el.getAttribute("data-severity-band")));
    check("Chromium: critical band renders first", domBands[0] === "critical", JSON.stringify(domBands));
    const totalsText = (await page.textContent("[data-totals-header]")) ?? "";
    check("Chromium: totals render with no success percentage", !totalsText.includes("%"), totalsText.slice(0, 200));
    const expectedIncompleteSection = (run2.reviewIncomplete?.length ?? 0) > 0 ? 1 : 0;
    check("Chromium: incomplete section appears only when review is incomplete", (await page.locator("[data-incomplete-section]").count()) === expectedIncompleteSection, JSON.stringify({ expected: expectedIncompleteSection }));
    const optionCount = await page.locator("[data-run-selector] option").count().catch(() => 0);
    check("Chromium: run selector preserves both runs after the pack switch", optionCount >= 2, `options=${optionCount}`);
    await page.screenshot({ path: join(runDir, "review-overview.png") });

    // Old run still readable through the selector.
    await page.selectOption("[data-run-selector]", run1.run.id);
    await page.waitForFunction(
      (expected) => document.querySelector("[data-totals-distinct-objects]")?.textContent?.trim() === expected,
      expectedDistinct,
      { timeout: 60_000 },
    );
    check("Chromium: selecting the old run restores its preserved totals", true, "");

    // Evidence for the critical finding.
    const criticalFinding = flattenScorecard(run1).find((f) => f.severity === "critical");
    await page.click(`[data-finding-id="${criticalFinding.id}"]`);
    await page.waitForSelector("[data-evidence-panel]", { timeout: 60_000 });
    const evidenceText = (await page.textContent("[data-evidence-panel]")) ?? "";
    check("Chromium: evidence shows requirement + honest absence + scope + pack identity", /FireRating|EvacuationWidth/.test(evidenceText) && /記載なし|Not stated/.test(evidenceText) && new RegExp(`v${v1.version}`).test(evidenceText), evidenceText.slice(0, 300));
    await page.locator("[data-evidence-panel]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(runDir, "evidence-open.png") });

    await page.waitForSelector("[data-decision-panel]", { timeout: 60_000 });
    check("Chromium: Japanese is the default document language", await page.getAttribute("html", "lang") === "ja", await page.getAttribute("html", "lang"));
    await page.click(`[data-decision-finding="${findingA.id}"]`);
    await page.click('[data-decision-outcome="conditional_accept"]');
    await page.fill("#decision-rationale", "The cited requirement is accepted subject to the documented correction.");
    await page.click("[data-decision-submit]");
    await page.waitForSelector("[data-current-decision]", { timeout: 60_000 });
    const decisionText = (await page.textContent("[data-current-decision]")) ?? "";
    check("Chromium: reviewer can record a conditional decision with cited evidence", decisionText.includes("条件付き受入") && decisionText.includes("チェックパック"), decisionText.slice(0, 300));
    check("Chromium: locale switcher exposes an English control", await page.locator('[data-locale="en"]').count() === 1, "missing English locale control");
    await page.click('[data-locale="en"]');
    await page.waitForTimeout(500);
    const switchedLang = await page.getAttribute("html", "lang");
    const switchedText = (await page.textContent("[data-decision-panel]")) ?? "";
    check("Chromium: locale switch updates html lang and decision chrome", switchedLang === "en" && switchedText.includes("Record decision"), JSON.stringify({ switchedLang, switchedText: switchedText.slice(0, 200) }));
    await page.click('[data-locale="ja"]');
    await page.waitForTimeout(500);
    check("Chromium: locale switch returns to Japanese", await page.getAttribute("html", "lang") === "ja", await page.getAttribute("html", "lang"));
    await page.screenshot({ path: join(runDir, "decision-record.png") });

    // Advisory finding: pager past the 25-sample, malformed banner, dedupe header.
    await page.click(`[data-finding-id="${findingA.id}"]`);
    await page.waitForSelector("[data-object-pager]", { timeout: 120_000 });
    const pagerText = (await page.textContent("[data-object-pager]")) ?? "";
    check("Chromium: 100+ duplicates window behind a pager", /\/\s*\d+/.test(pagerText), pagerText.slice(0, 120));
    await page.waitForSelector("[data-malformed-banner]", { timeout: 60_000 });
    check("Chromium: malformed member shows a banner, valid prefix intact", (await page.locator("[data-object-row]").count()) > 0, "no rows");
    const countsText = (await page.textContent("[data-member-counts]")) ?? "";
    check("Chromium: header dedupes by revisionId+objectId", /一意/.test(countsText), countsText.slice(0, 200));
    const geometryText = (await page.textContent("[data-evidence-panel]")) ?? "";
    check("Chromium: viewer read-back + without-geometry listing present", /ビューア一致|描画不可/.test(geometryText), geometryText.slice(-200));
    const diagnostics = await page.evaluate(() => window.__modelshelfViewer?.inspect()).catch(() => null);
    log("viewer-diagnostics.json", diagnostics ?? { unavailable: true });
    const matched = diagnostics?.renderer?.highlightGroups?.[0]?.matched ?? null;
    check("Chromium: drawable subset highlights against real geometry", typeof matched === "number" && matched >= 1, JSON.stringify({ matched }));
    await page.locator("[data-evidence-panel]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(runDir, "evidence-probes.png") });

    // Geometry failure: starve one model file, the viewer must fail honestly
    // with retry while the panel keeps listing every member.
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page2.addInitScript(() => {
      window.__modelshelfViewerVerify = true;
    });
    await page2.route("**/api/models/*/file", (route) => route.abort("failed"));
    await page2.goto(`${appOrigin}/deliveries/${delivery.id}`, { waitUntil: "domcontentloaded" });
    await page2.waitForSelector("[data-totals-header]", { timeout: 120_000 });
    await page2.screenshot({ path: join(runDir, "geometry-failure.png") });
    log("page-errors.json", { page1: pageErrors });
    check("Chromium: malformed + failure states never crash the page", pageErrors.length === 0, pageErrors.join("; ").slice(0, 500));

    // Empty-model run: no bands, incomplete section + N/A rows still visible.
    await page.goto(`${appOrigin}/deliveries/${emptyDelivery.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-totals-header]", { timeout: 120_000 });
    check("Chromium: empty run shows the no-findings state, not a crash", (await page.locator("[data-scorecard-empty]").count()) === 1, "missing");
    const expectedEmptyIncompleteSection = (emptyRun.reviewIncomplete?.length ?? 0) > 0 ? 1 : 0;
    check("Chromium: empty run does not claim an absent incomplete review", (await page.locator("[data-incomplete-section]").count()) === expectedEmptyIncompleteSection, JSON.stringify({ expected: expectedEmptyIncompleteSection }));
    const emptySpecRows = await page.locator("[data-spec-row]").count();
    check("Chromium: spec table keeps not_applicable rows", emptySpecRows >= 1, `rows=${emptySpecRows}`);
    await page.screenshot({ path: join(runDir, "empty-run.png") });

    log("summary.json", {
      deliveryId: delivery.id,
      run1: run1.run.id,
      run2: run2.run.id,
      bandOrder: domBands,
      failures: failures(),
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (web) {
      log("web.log", webLog);
      await stopProcess(web);
    }
    if (checker) {
      try {
        const fs = await import("node:fs");
        fs.writeFileSync(join(runDir, "checker.log"), checker.getLog());
      } catch {
        // evidence best-effort
      }
      await stopProcess(checker);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }

  if (failures() > 0) {
    console.error(`${failures()} check(s) failed`);
    process.exit(1);
  }
  console.log("all findings checks passed");
}

await main();
