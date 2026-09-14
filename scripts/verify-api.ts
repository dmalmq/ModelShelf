#!/usr/bin/env node
// Real end-to-end API verification against a real, isolated modelshelf-checker
// process.
//
// `--scenario revisions` proves the source-model/revision/delivery data model:
// two same-discipline sources coexisting, revision reuse without re-uploading,
// finalize freezing membership, and that a finalize racing a membership edit
// never lands in a corrupted state. Uploads use the committed self-authored
// `packs/demo/fixtures/base.ifc`, the real async job queue, and the real
// ifc-worker.
//
// `--scenario worker-failure` proves the job queue's contract (ticket 04):
// every named failure mode (malformed/truncated stdout, duplicate terminal
// results, wrong job id, nonzero exit, bad artifact hash, a path escaping the
// job's own output directory, an unsupported protocol version) fails the job
// without publishing anything; at most one heavy job ever runs at a time; a
// job still 'running' when the process is killed is recovered as 'failed' on
// restart; and retrying is idempotent and, against the real worker, actually
// succeeds. The failure modes are produced by a real subprocess
// (scripts/fixtures/fake-worker.ts) substituted in via `--worker-command` —
// real processes producing real bad output, not a mocked validation result.
//
// `--scenario first-loop` proves one complete review loop (ticket 09): seed a
// delivery from uploaded revisions, score it against a published pack, page a
// grouped finding past its samples, and resolve one member to its full object
// record — with invalid bytes and an empty model proving honest failure and
// empty-geometry states along the way. No mocked checker or viewer results.
//
// `--scenario comparisons` proves revision comparison with explicit match
// confidence (ticket 13): two MEP sources in one delivery never cross-match,
// every controlled A/B change in `packs/demo/fixtures` appears with correct
// source/revision and confidence, pagination reassembles deterministically,
// legacy rows fail loudly with `fingerprint_profile_mismatch`, and
// re-uploading the same bytes appends a new revision without touching history.
// `--scenario finding-comparisons` proves run comparison is gated on compatible
// checking settings (ticket 14): a base/corrected/empty run trio yields
// introduced/resolved/persisting outcomes, and each compat dimension (pack
// version, IDS/metadata digests, scope text, source membership, engine
// profile, provenance, completion, review-incomplete) plus a failed run and
// uncertain GlobalId identity refuses or holds honestly with its own code.
//
// `--scenario restart` proves restart durability (ticket 16): a finalized
// delivery built from real-worker revisions and a completed run are re-read
// from a fresh serve process on the same data dir and port — same finalizedAt
// and modelCount, identical revision-file bytes, same run id/status/scorecard
// finding count, same object detail — and re-running seed changes nothing.
//
// `--scenario all` runs all seven scenarios sequentially (revisions,
// worker-failure, checks, first-loop, comparisons, finding-comparisons,
// restart), each keeping its own evidence/run-dir logic as a standalone run;
// it appends every scenario's stdout/stderr to one aggregate all.log under
// ticket-16, writes a per-scenario pass/fail + check-count summary.json, and
// exits nonzero if any scenario failed.
//        node scripts/verify-api.ts --scenario worker-failure
//        node scripts/verify-api.ts --scenario checks
//        node scripts/verify-api.ts --scenario first-loop
//        node scripts/verify-api.ts --scenario comparisons
//        node scripts/verify-api.ts --scenario restart
//        node scripts/verify-api.ts --scenario all

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { BIN_PATH, REPO_ROOT, buildBinary, createChecker, freePort, runCli, stopProcess, waitForHealth } from "./lib/checker-harness.ts";
import { expressIdToObjectId } from "../packages/model-contracts-ts/src/express-id-mapping.ts";

const FAKE_WORKER = join(REPO_ROOT, "scripts", "fixtures", "fake-worker.ts");
const FIXTURES_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "base.ifc");
const FIXTURES_IDS = join(REPO_ROOT, "packs", "demo", "fixtures.ids");
const DEMO_PACKS_DIR = join(REPO_ROOT, "packs", "demo");
const DEMO_SAMPLES_DIR = join(REPO_ROOT, "samples", "ifc");

/** The seven runnable scenarios, in the fixed order `--scenario all` runs them. */
const SCENARIOS = ["revisions", "worker-failure", "checks", "first-loop", "comparisons", "finding-comparisons", "restart"];

/** Evidence root key per scenario — identical to the pre-`all` behavior for the
 * six historical scenarios; `restart` owns ticket-16. */
function scenarioEvidenceDir(scenario) {
  return scenario === "checks"
    ? "task-6"
    : scenario === "decisions"
      ? "review-decisions"
      : scenario === "first-loop"
        ? "task-9"
        : scenario === "comparisons"
          ? "ticket-13"
          : scenario === "finding-comparisons"
            ? "ticket-14"
            : scenario === "restart"
              ? "ticket-16"
              : "task-2";
}

function requireScenario() {
  const flagIndex = process.argv.indexOf("--scenario");
  const scenario = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (scenario !== "all" && !SCENARIOS.includes(scenario) && scenario !== "decisions") {
    console.error(`usage: node scripts/verify-api.ts --scenario revisions|worker-failure|checks|decisions|first-loop|comparisons|finding-comparisons|restart|all (got ${scenario ?? "<none>"})`);
    process.exit(2);
  }
  return scenario;
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** POSTs the self-authored demo IFC as `filename`; does not wait on the resulting job. */
async function uploadRaw(base, sourceModelId, filename) {
  const bytes = await readFileAsync(FIXTURES_IFC);
  return uploadBytes(base, sourceModelId, filename, bytes);
}

async function uploadBytes(base, sourceModelId, filename, bytes) {
  const form = new FormData();
  form.set("file", new Blob([bytes]), filename);
  const res = await fetch(`${base}/api/source-models/${sourceModelId}/revisions`, { method: "POST", body: form });
  return { status: res.status, json: await res.json() };
}

async function pollJob(base, jobId, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { json } = await api(base, "GET", `/api/jobs/${jobId}`);
    if (json.status === "completed" || json.status === "failed") return json;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms`);
}

/** Uploads and polls to a terminal state. `{ enqueued, job }`; `job` is null if
 * the upload itself was rejected (never reached the queue). */
async function uploadAndAwaitRevision(base, sourceModelId, filename) {
  const enqueued = await uploadRaw(base, sourceModelId, filename);
  if (enqueued.status !== 202) return { enqueued, job: null };
  const job = await pollJob(base, enqueued.json.id);
  return { enqueued, job };
}

function shQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function fakeWorkerCommand(mode) {
  return `${shQuote(process.execPath)} ${shQuote(FAKE_WORKER)} ${mode} --request {request}`;
}

async function startServer(dataDir, workerCommand, extraEnv = {}) {
  const port = await freePort();
  const args = ["serve", "--data-dir", dataDir, "--port", String(port)];
  if (workerCommand) {
    args.push("--worker-command", workerCommand);
  }
  const child = spawn(BIN_PATH, args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  let logText = "";
  child.stdout.on("data", (chunk) => (logText += chunk));
  child.stderr.on("data", (chunk) => (logText += chunk));
  await waitForHealth(port, { child });
  return { child, port, base: `http://127.0.0.1:${port}`, getLog: () => logText };
}

/** Like `startServer` but binds an explicit port — the restart scenario needs
 * the replacement process on the exact same port as the one it replaced. */
async function startServerOnPort(dataDir, port) {
  const child = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logText = "";
  child.stdout.on("data", (chunk) => (logText += chunk));
  child.stderr.on("data", (chunk) => (logText += chunk));
  await waitForHealth(port, { child });
  return { child, port, base: `http://127.0.0.1:${port}`, getLog: () => logText };
}

/** Recursively sorts object keys so identical data serializes identically
 * regardless of key order — the basis for the restart scenario's digest. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]);
  }
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

// ---------------------------------------------------------------------------
// scenario: revisions
// ---------------------------------------------------------------------------

async function runRevisionsScenario(base, dataDir, check, log) {
  // --- two separately named MEP sources coexist in one delivery ---
  const delivery1 = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Delivery 1" })).json;
  const mechanical = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Mechanical", discipline: "MEP" })).json;
  const plumbing = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Plumbing", discipline: "MEP" })).json;
  check("two source models created", Boolean(mechanical.id && plumbing.id), JSON.stringify({ mechanical, plumbing }));

  const rev1 = await uploadAndAwaitRevision(base, mechanical.id, "mechanical-v1.ifc");
  const rev2 = await uploadAndAwaitRevision(base, plumbing.id, "plumbing-v1.ifc");
  check(
    "both uploads are queued as jobs (202) and complete via the real worker",
    rev1.enqueued.status === 202 && rev2.enqueued.status === 202 &&
      rev1.job?.status === "completed" && rev2.job?.status === "completed",
    JSON.stringify({ rev1, rev2 }),
  );
  const rev1Id = rev1.job.modelRevisionId;
  const rev2Id = rev2.job.modelRevisionId;
  const blobDirEarly = join(dataDir, "blobs");
  check(
    "uploading identical bytes to two different source models writes exactly one blob (content-addressed)",
    readdirSync(blobDirEarly).length === 1,
    `blob count = ${readdirSync(blobDirEarly).length}`,
  );
  const rev1Objects = (await api(base, "GET", `/api/models/${rev1Id}/objects?limit=1`)).json;
  const rev2Objects = (await api(base, "GET", `/api/models/${rev2Id}/objects?limit=1`)).json;
  check(
    "the real worker extracted the self-authored demo fixture's 141 objects for each revision",
    rev1Objects.total === 141 && rev2Objects.total === 141,
    JSON.stringify({ rev1Total: rev1Objects.total, rev2Total: rev2Objects.total }),
  );

  await api(base, "POST", `/api/deliveries/${delivery1.id}/members`, { sourceModelId: mechanical.id, modelRevisionId: rev1Id });
  const afterBoth = (await api(base, "POST", `/api/deliveries/${delivery1.id}/members`, { sourceModelId: plumbing.id, modelRevisionId: rev2Id })).json;
  check(
    "two same-discipline (MEP) source models coexist in one delivery",
    afterBoth.models.length === 2 && new Set(afterBoth.models.map((m) => m.sourceModelName)).size === 2,
    JSON.stringify(afterBoth.models.map((m) => ({ name: m.sourceModelName, discipline: m.discipline }))),
  );
  log("delivery-1-after-both-members.json", afterBoth);

  // --- a second delivery reuses an unchanged revision without copying its source bytes ---
  const blobDir = join(dataDir, "blobs");
  const blobCountBefore = readdirSync(blobDir).length;
  const delivery2 = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Delivery 2" })).json;
  const reuse = (await api(base, "POST", `/api/deliveries/${delivery2.id}/members`, { sourceModelId: mechanical.id, modelRevisionId: rev1Id })).json;
  const blobCountAfter = readdirSync(blobDir).length;
  check(
    "second delivery reuses the revision (same model id, no new blob written)",
    reuse.models[0]?.id === rev1Id && blobCountAfter === blobCountBefore,
    JSON.stringify({ reuseModelId: reuse.models[0]?.id, expected: rev1Id, blobCountBefore, blobCountAfter }),
  );

  // --- finalize freezes membership; later edits are rejected ---
  const finalized = (await api(base, "POST", `/api/deliveries/${delivery1.id}/finalize`, {})).json;
  check("finalize sets finalizedAt and locks the delivery", Boolean(finalized.delivery.finalizedAt) && finalized.locked === true, JSON.stringify(finalized.delivery));

  const struct = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Structural East", discipline: "STRUCT" })).json;
  const structRev = await uploadAndAwaitRevision(base, struct.id, "struct.ifc");
  const rejectedEdit = await api(base, "POST", `/api/deliveries/${delivery1.id}/members`, { sourceModelId: struct.id, modelRevisionId: structRev.job.modelRevisionId });
  check("membership edit after finalize is rejected (409 delivery_locked)", rejectedEdit.status === 409 && rejectedEdit.json.error.code === "delivery_locked", JSON.stringify(rejectedEdit));

  const secondFinalize = await api(base, "POST", `/api/deliveries/${delivery1.id}/finalize`, {});
  check(
    "finalizing an already-finalized delivery is idempotent",
    secondFinalize.status === 200 && secondFinalize.json.delivery.finalizedAt === finalized.delivery.finalizedAt,
    JSON.stringify(secondFinalize.json.delivery),
  );

  // --- concurrent finalize + membership edit never corrupts state ---
  const raceDelivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Race Delivery" })).json;
  const concurrency = 20;
  const finalizeCalls = Array.from({ length: concurrency }, () => api(base, "POST", `/api/deliveries/${raceDelivery.id}/finalize`, {}));
  const memberCalls = Array.from({ length: concurrency }, () => api(base, "POST", `/api/deliveries/${raceDelivery.id}/members`, { sourceModelId: mechanical.id, modelRevisionId: rev1Id }));
  const [finalizeResults, memberResults] = await Promise.all([Promise.all(finalizeCalls), Promise.all(memberCalls)]);
  const finalizedTimestamps = new Set(finalizeResults.map((r) => r.json.delivery.finalizedAt));
  const memberSuccesses = memberResults.filter((r) => r.status === 200).length;
  const memberRejections = memberResults.filter((r) => r.status === 409).length;
  const finalState = (await api(base, "GET", `/api/deliveries/${raceDelivery.id}`)).json;
  log("race-delivery-final-state.json", { finalizeResults, memberResults, finalState });
  check(
    `${concurrency} concurrent finalize calls all agree on one finalizedAt`,
    finalizeResults.every((r) => r.status === 200) && finalizedTimestamps.size === 1,
    JSON.stringify([...finalizedTimestamps]),
  );
  check(
    `${concurrency} concurrent membership edits each either fully succeeded or were rejected — none silently dropped or partially applied`,
    memberSuccesses + memberRejections === concurrency,
    JSON.stringify({ memberSuccesses, memberRejections, concurrency }),
  );
  check(
    "final membership count matches exactly the member calls that actually reported success (no edit applied after the finalize it lost to)",
    finalState.delivery.modelCount === (memberSuccesses > 0 ? 1 : 0),
    JSON.stringify({ modelCount: finalState.delivery.modelCount, memberSuccesses }),
  );

  // --- rejections that don't depend on timing ---
  const duplicateName = await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Mechanical", discipline: "MEP" });
  check("duplicate source model name is rejected (400)", duplicateName.status === 400, JSON.stringify(duplicateName));

  const unknownDiscipline = await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Weird", discipline: "NOPE" });
  check("unknown discipline is rejected (400)", unknownDiscipline.status === 400, JSON.stringify(unknownDiscipline));

  const missingSourceModel = await uploadRaw(base, "does-not-exist", "x.ifc");
  check("uploading to a nonexistent source model is rejected (404), synchronously, without ever creating a job", missingSourceModel.status === 404, JSON.stringify(missingSourceModel));

  const mismatchedPairing = await api(base, "POST", `/api/deliveries/${delivery2.id}/members`, { sourceModelId: plumbing.id, modelRevisionId: rev1Id });
  check("adding a revision under the wrong source model is rejected (400)", mismatchedPairing.status === 400, JSON.stringify(mismatchedPairing));

  // --- object payloads carry the shared occurrence ID, and the original IFC is retrievable ---
  const objects = (await api(base, "GET", `/api/models/${rev1Id}/objects?limit=500`)).json;
  const firstObject = objects.objects[0];
  check(
    "object payloads include the shared ref (revisionId/objectId), not just the raw expressId",
    Boolean(firstObject?.ref?.revisionId === rev1Id && firstObject?.ref?.objectId?.startsWith("occ_")),
    JSON.stringify(firstObject),
  );
  const propertyObject = objects.objects.find((item) => item.name?.startsWith("PropChange-"));
  const detail = propertyObject
    ? (await api(base, "GET", `/api/objects/${propertyObject.id}`)).json
    : null;
  const sampleProp = detail?.properties?.[0];
  check(
    "a fixture object with properties round-trips the shared record (values, ordered, origin)",
    Boolean(propertyObject)
      && Array.isArray(detail?.properties)
      && sampleProp
      && Array.isArray(sampleProp.values)
      && typeof sampleProp.ordered === "boolean"
      && (sampleProp.origin === "occurrence" || sampleProp.origin === "type"),
    JSON.stringify({ propertyObject, sampleProp }),
  );
  const fileRes = await fetch(`${base}/api/models/${rev1Id}/file`);
  check("the original uploaded IFC is retrievable byte-for-byte via /file", fileRes.status === 200 && Number(fileRes.headers.get("content-length")) > 0, `status=${fileRes.status}`);

  const idsXml = await readFileAsync(join(REPO_ROOT, "packs", "demo", "blcj-s1000-v1.ids"), "utf8");
  const packVersion = (await api(base, "POST", "/api/packs/demo-pack/versions", { idsXml })).json;
  const run = await api(base, "POST", "/api/runs", { deliveryId: delivery1.id, packVersionId: packVersion.id });
  log("run-input-provenance.json", run.json);
  const provenance = run.json?.inputProvenance;
  check(
    "a newly created run reports complete input provenance for its pinned models",
    run.status === 200 && provenance?.status === "complete" && (provenance.reason == null || provenance.reason === ""),
    JSON.stringify({ status: run.status, provenance, modelCount: run.json?.models?.length }),
  );

  const sources = (await api(base, "GET", "/api/projects/demo-project/source-models")).json;
  const mechanicalReloaded = Array.isArray(sources) ? sources.find((item) => item.id === mechanical.id) : null;
  const revSummary = mechanicalReloaded?.revisions?.find((item) => item.id === rev1Id);
  const revisionVersions = revSummary?.processingVersions;
  check(
    "a completed ingest records processingVersions.worker on the revision",
    typeof revisionVersions?.worker === "string" && revisionVersions.worker.length > 0,
    JSON.stringify(revisionVersions),
  );
  check(
    "the revision processing envelope includes ifcOpenShell, ifcTester, extraction, and scopeSemantics",
    typeof revisionVersions?.ifcOpenShell === "string" && revisionVersions.ifcOpenShell.length > 0
      && typeof revisionVersions?.ifcTester === "string" && revisionVersions.ifcTester.length > 0
      && typeof revisionVersions?.extraction === "string" && revisionVersions.extraction.length > 0
      && typeof revisionVersions?.scopeSemantics === "string" && revisionVersions.scopeSemantics.length > 0,
    JSON.stringify(revisionVersions),
  );
  const deliveryVersions = afterBoth.models.find((item) => item.id === rev1Id)?.processingVersions;
  check(
    "delivery ModelInfo exposes the same processingVersions.worker",
    deliveryVersions?.worker === revisionVersions?.worker,
    JSON.stringify({ deliveryVersions, revisionVersions }),
  );
  const runModelVersions = Array.isArray(run.json?.models)
    ? run.json.models.find((item) => item.id === rev1Id)?.processingVersions
    : null;
  check(
    "run ModelInfo processingVersions matches the revision envelope",
    runModelVersions?.worker === revisionVersions?.worker
      && runModelVersions?.ifcOpenShell === revisionVersions?.ifcOpenShell
      && runModelVersions?.ifcTester === revisionVersions?.ifcTester
      && runModelVersions?.extraction === revisionVersions?.extraction
      && runModelVersions?.scopeSemantics === revisionVersions?.scopeSemantics,
    JSON.stringify({ runModelVersions, revisionVersions }),
  );
  check(
    "a settled run records ifctester/ plus the revision ifcTester",
    typeof run.json?.run?.engineVersion === "string"
      && run.json.run.engineVersion.startsWith("ifctester/")
      && run.json.run.engineVersion === `ifctester/${revisionVersions?.ifcTester}`
      && typeof run.json?.run?.parserVersion === "string"
      && run.json.run.parserVersion.startsWith("ifcopenshell/")
      && run.json.run.parserVersion === `ifcopenshell/${revisionVersions?.ifcOpenShell}`,
    JSON.stringify({
      engineVersion: run.json?.run?.engineVersion,
      parserVersion: run.json?.run?.parserVersion,
      revisionVersions,
    }),
  );
}

async function runRevisionsScenarioTop(runDir, check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-api-data-"));
  let serverProcess;
  let serverLog = "";
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed succeeds", seed.status === 0, seed.stderr);

    const port = await freePort();
    serverProcess = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (chunk) => (serverLog += chunk));
    serverProcess.stderr.on("data", (chunk) => (serverLog += chunk));
    await waitForHealth(port, { child: serverProcess });

    const base = `http://127.0.0.1:${port}`;
    await runRevisionsScenario(base, dataDir, check, log);
  } finally {
    await stopProcess(serverProcess);
    writeFileSync(join(runDir, "serve.log"), serverLog);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// scenario: comparisons (ticket 13)
// ---------------------------------------------------------------------------

const COMPARISONS_BASE_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "base.ifc");
const COMPARISONS_HEAD_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "head.ifc");
const COMPARISONS_ORACLE = join(REPO_ROOT, "packs", "demo", "fixtures", "oracle.json");

const DUMP_OBJECTS_PY = `import sqlite3, json, sys
db, rev = sys.argv[1], sys.argv[2]
con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
rows = con.execute("SELECT ref_object_id, express_id, profile_version, profile_id, fp_properties, fp_placement, fp_shape, fp_combined FROM objects WHERE model_id = ? ORDER BY express_id", (rev,)).fetchall()
print(json.dumps([{"object_id": r[0], "express_id": r[1], "profile_version": r[2], "profile_id": r[3], "fp_properties": r[4], "fp_placement": r[5], "fp_shape": r[6], "fp_combined": r[7]} for r in rows]))`;

const INSERT_LEGACY_PY = `import sqlite3, sys, datetime
db, src, rev = sys.argv[1], sys.argv[2], sys.argv[3]
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
con = sqlite3.connect(db)
con.execute("INSERT INTO model_revisions (id, source_model_id, filename, content_sha256, byte_size, schema_label, entity_count, product_count, length_to_metre, storage_path, header_json, parse_ms, uploaded_at, provenance) VALUES (?, ?, 'legacy.ifc', ?, 1, 'IFC4', 0, 0, 1.0, 'blobs/legacy', NULL, NULL, ?, 'complete')", (rev, src, "0" * 64, now))
con.execute("INSERT INTO objects (id, model_id, express_id, global_id, ifc_type, name, placement_json, fp_properties, fp_placement, fp_shape, fp_combined, ref_object_id) VALUES ('legacy-obj-1', ?, 1, 'legacy-gid', 'IfcWall', 'LegacyWall', NULL, 'p', 'l', 's', 'c', 'occ_legacy')", (rev,))
con.commit()
print("inserted")`;

function runPython(dbPath, script, args = []) {
  const res = spawnSync("python3", ["-c", script, dbPath, ...args], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`python3 failed: ${res.stderr}`);
  return res.stdout;
}

function comparisonsCargo() {
  const rustupCargo = join(homedir(), ".cargo", "bin", "cargo");
  return process.env.CARGO ?? (existsSync(rustupCargo) ? rustupCargo : "cargo");
}

async function runComparisonsScenario(runDir, check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-api-comparisons-"));
  let server;
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed succeeds", seed.status === 0, seed.stderr);

    server = await startServer(dataDir);
    const base = server.base;
    const dbPath = join(dataDir, "modelshelf.db");

    const mech = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Mechanical", discipline: "MEP" })).json;
    const plumb = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Plumbing", discipline: "MEP" })).json;
    check("two MEP sources created", Boolean(mech.id && plumb.id), JSON.stringify({ mech, plumb }));

    const mechBase = await uploadFileAndAwait(base, mech.id, "mech-base.ifc", COMPARISONS_BASE_IFC);
    const mechHead = await uploadFileAndAwait(base, mech.id, "mech-head.ifc", COMPARISONS_HEAD_IFC);
    const plumbBase = await uploadFileAndAwait(base, plumb.id, "plumb-base.ifc", COMPARISONS_BASE_IFC);
    check(
      "all three fixture revisions ingest via the real worker",
      mechBase.job?.status === "completed" && mechHead.job?.status === "completed" && plumbBase.job?.status === "completed",
      JSON.stringify({ mechBase: mechBase.job?.status, mechHead: mechHead.job?.status, plumbBase: plumbBase.job?.status }),
    );
    const revBase = mechBase.job.modelRevisionId;
    const revHead = mechHead.job.modelRevisionId;
    const revPlumb = plumbBase.job.modelRevisionId;

    // --- ingest stores the example's digests (ticket 13, unit 3) ---
    const attemptDir = join(dataDir, "jobs", mechBase.enqueued.json.id, "attempt-0");
    const manifest = JSON.parse(readFileSync(join(attemptDir, "manifest.json"), "utf8"));
    check(
      "the real attempt carries semantic + geometry artifacts",
      Boolean(manifest.artifacts?.semantic?.path && manifest.artifacts?.geometry?.path),
      JSON.stringify(Object.keys(manifest.artifacts ?? {})),
    );
    const fpOut = join(runDir, "fingerprints-example.jsonl");
    const fpRun = spawnSync(
      comparisonsCargo(),
      ["run", "--quiet", "-p", "fingerprint", "--example", "fingerprint_worker", "--",
        manifest.artifacts.semantic.path, manifest.artifacts.geometry.path, fpOut],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    check("fingerprint_worker example runs on the real attempt artifacts", fpRun.status === 0, fpRun.stderr);
    const dbRows = JSON.parse(runPython(dbPath, DUMP_OBJECTS_PY, [revBase]));
    const exampleById = new Map(
      readFileSync(fpOut, "utf8").trim().split("\n").filter(Boolean).map((line) => {
        const row = JSON.parse(line);
        return [row.object_id, row];
      }),
    );
    const digestMismatches = [];
    for (const row of dbRows) {
      const ex = exampleById.get(row.object_id);
      const ok = ex
        && row.profile_version === "fp-v1"
        && row.profile_version === ex.profile_version
        && /^[0-9a-f]{64}$/.test(row.profile_id ?? "")
        && row.profile_id === ex.profile_id
        && row.fp_properties === ex.fp_properties
        && row.fp_placement === ex.fp_placement
        && row.fp_shape === ex.fp_shape
        && row.fp_combined === ex.fp_combined;
      if (!ok) digestMismatches.push(row.object_id);
    }
    check(
      `stored digests equal the example output for all ${dbRows.length} objects under fp-v1`,
      dbRows.length === 141 && digestMismatches.length === 0 && exampleById.size === 141,
      JSON.stringify({ stored: dbRows.length, example: exampleById.size, mismatches: digestMismatches.slice(0, 5) }),
    );
    log("ingest-digest-proof.json", { stored: dbRows.length, example: exampleById.size, mismatches: digestMismatches });

    // --- deliveries: base vs head, plumbing reuses its revision ---
    const delBase = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Compare base" })).json;
    await api(base, "POST", `/api/deliveries/${delBase.id}/members`, { sourceModelId: mech.id, modelRevisionId: revBase });
    await api(base, "POST", `/api/deliveries/${delBase.id}/members`, { sourceModelId: plumb.id, modelRevisionId: revPlumb });
    const delHead = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Compare head" })).json;
    await api(base, "POST", `/api/deliveries/${delHead.id}/members`, { sourceModelId: mech.id, modelRevisionId: revHead });
    await api(base, "POST", `/api/deliveries/${delHead.id}/members`, { sourceModelId: plumb.id, modelRevisionId: revPlumb });

    const diffUrl = (extra) => `/api/diff/models?baseDeliveryId=${delBase.id}&headDeliveryId=${delHead.id}${extra}`;
    const diff = (await api(base, "GET", diffUrl("&limit=5000"))).json;
    log("diff-unpaged.json", diff);
    check("two pairs, one per source model", diff.pairs?.length === 2, JSON.stringify(diff.pairs?.length));
    const bySource = new Map(diff.pairs.map((p) => [p.sourceModelId, p]));
    check(
      "pairs are keyed by source membership — two MEP sources never cross-match",
      bySource.has(mech.id) && bySource.has(plumb.id)
        && bySource.get(mech.id).sourceModelName === "Mechanical"
        && bySource.get(plumb.id).sourceModelName === "Plumbing",
      JSON.stringify(diff.pairs.map((p) => ({ sourceModelId: p.sourceModelId, sourceModelName: p.sourceModelName }))),
    );

    const plumbPair = bySource.get(plumb.id);
    const zeroed = plumbPair.summary
      && Object.values(plumbPair.summary).every((v) => v === 0);
    check(
      "reused revision short-circuits: reusedRevision, empty changes, zeroed summary, same model id",
      plumbPair.reusedRevision === true && plumbPair.total === 0 && plumbPair.changes.length === 0 && zeroed
        && plumbPair.baseModelId === revPlumb && plumbPair.headModelId === revPlumb,
      JSON.stringify({ reusedRevision: plumbPair.reusedRevision, total: plumbPair.total, summary: plumbPair.summary }),
    );

    const mechPair = bySource.get(mech.id);
    check(
      "mechanical pair compares distinct revisions",
      mechPair.reusedRevision === false && mechPair.baseModelId === revBase && mechPair.headModelId === revHead,
      JSON.stringify({ reusedRevision: mechPair.reusedRevision, base: mechPair.baseModelId, head: mechPair.headModelId }),
    );
    const nameOf = (c) => (c.head ?? c.base)?.name;
    const ofKind = (kind) => mechPair.changes.filter((c) => c.kind === kind);
    const sortedNames = (list) => list.map(nameOf).sort();
    check(
      "oracle group counts: added/removed/properties/shape/moved 3 each, no mixed",
      mechPair.summary.added === 3 && mechPair.summary.removed === 3
        && mechPair.summary.propertiesChanged === 3 && mechPair.summary.shapeChanged === 3
        && mechPair.summary.moved === 3 && mechPair.summary.mixed === 0,
      JSON.stringify(mechPair.summary),
    );
    check("added names match the oracle", JSON.stringify(sortedNames(ofKind("added"))) === JSON.stringify(["Added-0", "Added-1", "Added-2"]), JSON.stringify(sortedNames(ofKind("added"))));
    check("removed names match the oracle", JSON.stringify(sortedNames(ofKind("removed"))) === JSON.stringify(["Removed-0", "Removed-1", "Removed-2"]), JSON.stringify(sortedNames(ofKind("removed"))));
    check("properties_changed names match the oracle", JSON.stringify(sortedNames(ofKind("properties_changed"))) === JSON.stringify(["PropChange-0", "PropChange-1", "PropChange-2"]), JSON.stringify(sortedNames(ofKind("properties_changed"))));
    check("shape_changed names match the oracle", JSON.stringify(sortedNames(ofKind("shape_changed"))) === JSON.stringify(["ShapeChange-0", "ShapeChange-1", "ShapeChange-2"]), JSON.stringify(sortedNames(ofKind("shape_changed"))));
    check("moved names match the oracle", JSON.stringify(sortedNames(ofKind("moved"))) === JSON.stringify(["Moved-0", "Moved-1", "Moved-2"]), JSON.stringify(sortedNames(ofKind("moved"))));
    check(
      "property edits report REI30 -> REI60 before/after",
      ofKind("properties_changed").every((c) => {
        const row = c.propertyChanges.find((p) => p.pset === "Pset_WallCommon" && p.name === "FireRating");
        return row && row.base === "REI30" && row.head === "REI60";
      }),
      JSON.stringify(ofKind("properties_changed").map((c) => c.propertyChanges)),
    );
    check(
      "moves report ~0.5 m displacement",
      ofKind("moved").every((c) => Math.abs(c.movedDistanceM - 0.5) < 1e-9),
      JSON.stringify(ofKind("moved").map((c) => c.movedDistanceM)),
    );
    const rotated = mechPair.changes.filter((c) => (nameOf(c) ?? "").startsWith("Rotated-"));
    log("rotated-behavior.json", rotated);
    check(
      "rotated walls assert actual behavior: origin-only measurement sees zero displacement (unchanged + sub-threshold note, recorded limitation)",
      rotated.length === 3 && rotated.every((c) => c.kind === "unchanged" && c.confidence.kind === "exact"
        && (c.movedDistanceM ?? -1) === 0 && c.notes.some((n) => n.includes("sub-threshold"))),
      JSON.stringify(rotated.map((c) => ({ name: nameOf(c), kind: c.kind, confidence: c.confidence, movedDistanceM: c.movedDistanceM, notes: c.notes }))),
    );
    const ambiguous = mechPair.changes.filter((c) => ["Duplicate-A", "Duplicate-B", "EmptyGlobalId"].includes(nameOf(c)));
    check(
      "duplicate + empty GlobalIds are never exact",
      ambiguous.length === 3 && ambiguous.every((c) => c.confidence.kind !== "exact"),
      JSON.stringify(ambiguous.map((c) => ({ name: nameOf(c), confidence: c.confidence, notes: c.notes }))),
    );
    const spatial = mechPair.changes.filter((c) => ["Demo Building", "1F", "Demo Site"].includes(nameOf(c)));
    check(
      "regenerated spatial GlobalIds match as explicit heuristic candidates, never exact",
      spatial.length === 3 && spatial.every((c) => c.kind === "unchanged" && c.confidence.kind === "heuristic"
        && (c.base?.globalId ?? null) !== (c.head?.globalId ?? null)),
      JSON.stringify(spatial.map((c) => ({ name: nameOf(c), base: c.base?.globalId, head: c.head?.globalId, confidence: c.confidence }))),
    );
    check(
      "uncertain matches are counted: 2 duplicate + 1 empty + 3 regenerated-spatial",
      mechPair.summary.uncertainMatches === 6,
      JSON.stringify(mechPair.summary.uncertainMatches),
    );
    check(
      "120 repeated walls stay unchanged",
      ofKind("unchanged").filter((c) => (nameOf(c) ?? "").startsWith("Repeat-")).length === 120,
      JSON.stringify(ofKind("unchanged").length),
    );
    check(
      "every change side names its own revision (base→base, head→head)",
      mechPair.changes.every((c) => (!c.base || c.base.revisionId === revBase) && (!c.head || c.head.revisionId === revHead)),
      JSON.stringify(mechPair.changes.slice(0, 2)),
    );
    const allRefs = mechPair.changes.flatMap((c) => [c.base, c.head].filter(Boolean));
    check(
      "no mechanical change references the plumbing revision — sources never cross-match",
      allRefs.length > 0 && allRefs.every((r) => r.revisionId !== revPlumb && r.objectId.startsWith("occ_")),
      JSON.stringify({ refs: allRefs.length, sample: allRefs[0] }),
    );

    // --- pagination reassembles deterministically ---
    const paged = [];
    let pagedTotal = -1;
    for (let offset = 0; ; offset += 25) {
      const page = (await api(base, "GET", diffUrl(`&limit=25&offset=${offset}`))).json;
      const pair = page.pairs.find((p) => p.sourceModelId === mech.id);
      if (offset === 0) pagedTotal = pair.total;
      paged.push(...pair.changes);
      if (pair.changes.length < 25) break;
    }
    check(
      "paged total matches the unpaged total",
      pagedTotal === mechPair.total,
      JSON.stringify({ pagedTotal, unpaged: mechPair.total }),
    );
    check(
      "limit/offset pages reassemble to the unpaged order",
      JSON.stringify(paged) === JSON.stringify(mechPair.changes),
      JSON.stringify({ paged: paged.length, unpaged: mechPair.changes.length }),
    );
    const movedPage = (await api(base, "GET", diffUrl("&kind=moved&limit=5000"))).json.pairs.find((p) => p.sourceModelId === mech.id);
    check(
      "kind filter pages moved only with pre-page total",
      movedPage.total === 3 && movedPage.changes.length === 3 && movedPage.changes.every((c) => c.kind === "moved"),
      JSON.stringify({ total: movedPage.total, kinds: movedPage.changes.map((c) => c.kind) }),
    );
    const pastEnd = (await api(base, "GET", diffUrl("&limit=5&offset=10000"))).json.pairs.find((p) => p.sourceModelId === mech.id);
    check(
      "offset past the end returns empty changes with total intact",
      pastEnd.changes.length === 0 && pastEnd.total === mechPair.total,
      JSON.stringify({ changes: pastEnd.changes.length, total: pastEnd.total }),
    );

    // --- legacy rows fail loudly (profile mismatch), never as fake objects ---
    const legacySrc = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "LegacySrc", discipline: "OTHER" })).json;
    runPython(dbPath, INSERT_LEGACY_PY, [legacySrc.id, "legacy-rev-1"]);
    const delLegacy = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Legacy drop" })).json;
    await api(base, "POST", `/api/deliveries/${delLegacy.id}/members`, { sourceModelId: legacySrc.id, modelRevisionId: "legacy-rev-1" });
    const delEmpty = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Empty drop" })).json;
    const bad = await api(base, "GET", `/api/diff/models?baseDeliveryId=${delLegacy.id}&headDeliveryId=${delEmpty.id}&limit=5000`);
    log("profile-mismatch.json", bad.json);
    check(
      "legacy-sentinel rows → 409 fingerprint_profile_mismatch naming recompute",
      bad.status === 409 && bad.json?.error?.code === "fingerprint_profile_mismatch" && /re-uploading/.test(bad.json?.error?.message ?? ""),
      JSON.stringify(bad),
    );

    // --- re-upload appends; history is never rewritten ---
    const blobCountBefore = readdirSync(join(dataDir, "blobs")).length;
    const reup = await uploadFileAndAwait(base, mech.id, "mech-base-reupload.ifc", COMPARISONS_BASE_IFC);
    check("re-upload of identical bytes completes", reup.job?.status === "completed", JSON.stringify(reup.job?.status));
    const revReup = reup.job.modelRevisionId;
    check("re-upload mints a new revision id", revReup !== revBase, JSON.stringify({ revReup, revBase }));
    check(
      "identical bytes reuse the stored blob (content-addressed)",
      readdirSync(join(dataDir, "blobs")).length === blobCountBefore,
      JSON.stringify({ before: blobCountBefore, after: readdirSync(join(dataDir, "blobs")).length }),
    );
    const oldRows = JSON.parse(runPython(dbPath, DUMP_OBJECTS_PY, [revBase]));
    const newRows = JSON.parse(runPython(dbPath, DUMP_OBJECTS_PY, [revReup]));
    const oldByExpress = new Map(oldRows.map((r) => [r.express_id, r.fp_combined]));
    const historyKept = newRows.length === oldRows.length
      && newRows.every((r) => oldByExpress.get(r.express_id) === r.fp_combined)
      && newRows.every((r) => r.profile_version === "fp-v1");
    check(
      "old rows keep old digests while the new revision carries current-profile digests (append-only)",
      historyKept,
      JSON.stringify({ old: oldRows.length, new: newRows.length }),
    );
    const delReup = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Reupload" })).json;
    await api(base, "POST", `/api/deliveries/${delReup.id}/members`, { sourceModelId: mech.id, modelRevisionId: revReup });
    const sameDiff = (await api(base, "GET", `/api/diff/models?baseDeliveryId=${delBase.id}&headDeliveryId=${delReup.id}&limit=5000`)).json;
    const samePair = sameDiff.pairs.find((p) => p.sourceModelId === mech.id);
    log("reupload-diff.json", samePair?.summary);
    check(
      "identical content across revisions diffs fully unchanged (no false adds/removes)",
      samePair.reusedRevision === false && samePair.total === 141 && samePair.summary.unchanged === 141
        && samePair.summary.added === 0 && samePair.summary.removed === 0,
      JSON.stringify(samePair?.summary),
    );
  } finally {
    if (server) {
      log("comparisons-serve.log", server.getLog());
      await stopProcess(server.child);
    }
    rmSync(dataDir, { recursive: true, force: true });

  }
}
// ---------------------------------------------------------------------------
// scenario: finding-comparisons (ticket 14)
// ---------------------------------------------------------------------------

const FINDING_BASE_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "base.ifc");
const FINDING_HEAD_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "head.ifc");

function dbGet(dbPath, query) {
  return runPython(dbPath, `import sqlite3,sys
con = sqlite3.connect(sys.argv[1])
row = con.execute(sys.argv[2]).fetchone()
print("" if row is None or row[0] is None else row[0])`, [query]).trim();
}

function dbExec(dbPath, ...statements) {
  runPython(dbPath, `import sqlite3,sys
con = sqlite3.connect(sys.argv[1])
for s in sys.argv[2:]:
    con.execute(s)
con.commit()`, statements);
}

async function runFindingComparisonsScenario(runDir, check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-api-finding-comparisons-"));
  let server;
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed succeeds", seed.status === 0, seed.stderr);

    server = await startServer(dataDir);
    const base = server.base;
    const dbPath = join(dataDir, "modelshelf.db");

    const packMeta = {
      categories: [{ id: "regulatory", label: "Regulatory" }],
      defaults: { severity: "high", categoryId: "regulatory" },
      specs: {
        "Wall declares a fire rating": { severity: "high", categoryId: "regulatory", disciplines: ["ARCH"] },
      },
    };
    const idsXml = await readFileAsync(FIXTURES_IDS, "utf8");
    const packV1 = (await api(base, "POST", "/api/packs/demo-pack/versions", { idsXml, metadata: packMeta })).json;
    check("fixtures pack v1 is published", Boolean(packV1?.id), JSON.stringify(packV1));

    const east = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "East", discipline: "ARCH" })).json;
    check("east source created", Boolean(east.id), JSON.stringify(east));

    async function deliverAndRun(label, revisionId, packVersionId, members) {
      const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label })).json;
      for (const [sourceModelId, modelRevisionId] of members) {
        const res = await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId, modelRevisionId });
        check(`member added to ${label}`, res.status === 200, JSON.stringify({ status: res.status, body: res.json }));
      }
      const run = (await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId })).json;
      check(
        `${label} run completes with pinned complete inputs`,
        run?.run?.status === "completed" && run?.inputProvenance?.status === "complete",
        JSON.stringify({ status: run?.run?.status, provenance: run?.inputProvenance }),
      );
      return { delivery, run };
    }

    const diffRuns = (baseRunId, headRunId) =>
      api(base, "GET", `/api/diff/runs?baseRunId=${baseRunId}&headRunId=${headRunId}`);

    async function expect409(label, baseRunId, headRunId, code, messageFragment, expectRerun = true) {
      const res = await diffRuns(baseRunId, headRunId);
      log(`refused-${label}.json`, res.json);
      check(
        `${label} refuses with 409 ${code}`,
        res.status === 409 && res.json?.error?.code === code
          && (!expectRerun || /rerun one or both sides/.test(res.json?.error?.message ?? ""))
          && (res.json?.error?.message ?? "").includes(messageFragment),
        JSON.stringify({ status: res.status, error: res.json?.error }),
      );
    }

    // --- happy path: base, corrected, and empty runs ---
    const revBase = (await uploadFileAndAwait(base, east.id, "east-base.ifc", FINDING_BASE_IFC)).job;
    const revHead = (await uploadFileAndAwait(base, east.id, "east-head.ifc", FINDING_HEAD_IFC)).job;
    check(
      "base and corrected revisions ingest via the real worker",
      revBase?.status === "completed" && revHead?.status === "completed",
      JSON.stringify({ base: revBase?.status, head: revHead?.status }),
    );
    const { run: runA } = await deliverAndRun("Base drop", revBase.modelRevisionId, packV1.id, [[east.id, revBase.modelRevisionId]]);
    const { delivery: delB, run: runB } = await deliverAndRun("Corrected drop", revHead.modelRevisionId, packV1.id, [[east.id, revHead.modelRevisionId]]);
    // A second run on the same delivery: identical findings, used for the
    // uncertainty probe below.
    const runB2 = (await api(base, "POST", "/api/runs", { deliveryId: delB.id, packVersionId: packV1.id })).json;
    check(
      "a second run on the same delivery completes identically",
      runB2?.run?.status === "completed" && runB2?.inputProvenance?.status === "complete",
      JSON.stringify({ status: runB2?.run?.status, provenance: runB2?.inputProvenance }),
    );

    const happy = await diffRuns(runA.run.id, runB.run.id);
    log("diff-base-corrected.json", happy.json);
    check(
      "base vs corrected compares 200 with consistent counts",
      happy.status === 200
        && happy.json?.resolved + happy.json?.introduced + happy.json?.persisting === happy.json?.changes?.length,
      JSON.stringify({ status: happy.status, resolved: happy.json?.resolved, introduced: happy.json?.introduced, persisting: happy.json?.persisting }),
    );

    const self = await diffRuns(runA.run.id, runA.run.id);
    const findingCount = self.json?.persisting ?? 0;
    check(
      "a run compared with itself is fully persisting (proves findings exist)",
      self.status === 200 && findingCount >= 1 && self.json?.resolved === 0 && self.json?.introduced === 0,
      JSON.stringify({ status: self.status, persisting: self.json?.persisting }),
    );

    const emptyEnqueued = await uploadBytes(base, east.id, "empty.ifc", EMPTY_IFC);
    const emptyJob = await pollJob(base, emptyEnqueued.json.id, { timeoutMs: 120_000 });
    check("empty model ingests", emptyJob?.status === "completed", JSON.stringify(emptyJob?.status));
    const { run: runEmpty } = await deliverAndRun("Empty drop", emptyJob.modelRevisionId, packV1.id, [[east.id, emptyJob.modelRevisionId]]);

    const toEmpty = await diffRuns(runA.run.id, runEmpty.run.id);
    check(
      "base vs empty resolves every finding and introduces none",
      toEmpty.status === 200 && toEmpty.json?.resolved === findingCount && toEmpty.json?.introduced === 0,
      JSON.stringify({ status: toEmpty.status, resolved: toEmpty.json?.resolved, introduced: toEmpty.json?.introduced }),
    );
    const fromEmpty = await diffRuns(runEmpty.run.id, runA.run.id);
    check(
      "empty vs base introduces every finding and resolves none",
      fromEmpty.status === 200 && fromEmpty.json?.introduced === findingCount && fromEmpty.json?.resolved === 0,
      JSON.stringify({ status: fromEmpty.status, introduced: fromEmpty.json?.introduced, resolved: fromEmpty.json?.resolved }),
    );

    // --- pack version dimension: a second published version never compares ---
    const packV2 = (await api(base, "POST", "/api/packs/demo-pack/versions", { idsXml, metadata: packMeta })).json;
    check("fixtures pack v2 is published", packV2?.id !== packV1.id, JSON.stringify(packV2?.id));
    const { run: runV2 } = await deliverAndRun("V2 drop", revBase.modelRevisionId, packV2.id, [[east.id, revBase.modelRevisionId]]);
    // pack_version_mismatch keeps its historical message (no rerun phrase).
    await expect409("pack-version", runA.run.id, runV2.run.id, "pack_version_mismatch", "pack versions", false);

    // --- membership dimension: a delivery with a different source set ---
    const west = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "West", discipline: "ARCH" })).json;
    const westRev = (await uploadFileAndAwait(base, west.id, "west-base.ifc", FINDING_BASE_IFC)).job;
    check("west revision ingests", westRev?.status === "completed", JSON.stringify(westRev?.status));
    const { run: runWide } = await deliverAndRun(
      "Wide drop",
      revBase.modelRevisionId,
      packV1.id,
      [[east.id, revBase.modelRevisionId], [west.id, westRev.modelRevisionId]],
    );
    await expect409("membership", runA.run.id, runWide.run.id, "scope_mismatch", "membership");

    // --- stored-row dimensions, mutated one at a time with restore ---
    async function expect409AfterUpdate(label, column, tempValue, code, messageFragment) {
      const prev = dbGet(dbPath, `SELECT ${column} FROM runs WHERE id='${runB.run.id}'`);
      dbExec(dbPath, `UPDATE runs SET ${column}='${tempValue}' WHERE id='${runB.run.id}'`);
      await expect409(label, runA.run.id, runB.run.id, code, messageFragment);
      dbExec(dbPath, `UPDATE runs SET ${column}='${prev}' WHERE id='${runB.run.id}'`);
    }
    await expect409AfterUpdate("scope-text", "scope_json", '{"ARCH":[]}', "scope_mismatch", "scope text");
    await expect409AfterUpdate("engine-profile", "engine_profile_json", '{"worker":"9.9.9"}', "engine_profile_mismatch", runA.run.id);
    await expect409AfterUpdate("ids-digest", "ids_sha256", "deadbeef", "pack_digest_mismatch", "ids_sha256");
    await expect409AfterUpdate("provenance", "input_provenance", "incomplete", "provenance_incomplete", runB.run.id);
    await expect409AfterUpdate("review-incomplete", "incomplete_count", "1", "run_incomplete", runB.run.id);
    const restored = await diffRuns(runA.run.id, runB.run.id);
    check("restored rows compare 200 again", restored.status === 200, JSON.stringify({ status: restored.status }));

    // --- empty pins: a run with no recorded snapshot cannot prove its inputs ---
    const { run: runUnpinned } = await deliverAndRun("Unpinned drop", revBase.modelRevisionId, packV1.id, [[east.id, revBase.modelRevisionId]]);
    dbExec(dbPath, `DELETE FROM run_models WHERE run_id='${runUnpinned.run.id}'`);
    await expect409("empty-pins", runA.run.id, runUnpinned.run.id, "provenance_incomplete", runUnpinned.run.id);

    // --- failed run via a bad upload: corrupt the stored blob, then check ---
    const badSrc = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "BadSrc", discipline: "ARCH" })).json;
    const badRev = await uploadFileAndAwait(base, badSrc.id, "bad.ifc", FINDING_HEAD_IFC);
    check("bad-source revision ingests", badRev.job?.status === "completed", JSON.stringify(badRev.job?.status));
    const badSha = dbGet(dbPath, `SELECT content_sha256 FROM model_revisions WHERE id='${badRev.job.modelRevisionId}'`);
    writeFileSync(join(dataDir, "blobs", badSha), "corrupted-by-verify-scenario");
    const badDelivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Bad drop" })).json;
    await api(base, "POST", `/api/deliveries/${badDelivery.id}/members`, { sourceModelId: badSrc.id, modelRevisionId: badRev.job.modelRevisionId });
    const badRun = (await api(base, "POST", "/api/runs", { deliveryId: badDelivery.id, packVersionId: packV1.id })).json;
    log("failed-run.json", { status: badRun?.run?.status, error: badRun?.run?.error });
    check(
      "checking a corrupted upload fails the run instead of scoring it",
      badRun?.run?.status === "failed" && Boolean(badRun?.run?.error),
      JSON.stringify({ status: badRun?.run?.status, error: badRun?.run?.error }),
    );
    await expect409("failed-run", runA.run.id, badRun.run.id, "run_not_completed", badRun.run.id);

    // --- uncertain identity: objects without a GlobalId never resolve ---
    const sameInput = await diffRuns(runB.run.id, runB2.run.id);
    check(
      "two runs on one delivery are fully persisting before the probe",
      sameInput.status === 200 && sameInput.json?.persisting >= 1
        && sameInput.json?.resolved === 0 && sameInput.json?.introduced === 0,
      JSON.stringify({ status: sameInput.status, persisting: sameInput.json?.persisting }),
    );
    const probeKey = dbGet(
      dbPath,
      `SELECT finding_key FROM findings WHERE run_id='${runB2.run.id}' AND object_count > 0 ORDER BY sort_index LIMIT 1`,
    );
    check("probe finding selected", probeKey.length > 0, probeKey);
    dbExec(
      dbPath,
      `UPDATE finding_objects SET global_id = NULL WHERE finding_id IN
         (SELECT id FROM findings WHERE run_id = '${runB2.run.id}' AND finding_key = '${probeKey}')`,
    );
    const probed = await diffRuns(runB.run.id, runB2.run.id);
    log("uncertain-identity.json", probed.json);
    const probeChange = (probed.json?.changes ?? []).find((c) => c.findingKey === probeKey);
    check(
      "a finding with uncertain identity stays persisting, never resolved",
      probed.status === 200 && probeChange?.delta === "persisting" && probed.json?.resolved === 0,
      JSON.stringify({ status: probed.status, probe: probeChange }),
    );
    check(
      "no synthetic occurrence ids leak into object lists",
      probed.status === 200 && !JSON.stringify(probed.json).includes("express:"),
      JSON.stringify((probed.json?.changes ?? []).flatMap((c) => c.resolvedObjects ?? []).slice(0, 3)),
    );
  } finally {
    if (server) {
      log("finding-comparisons-serve.log", server.getLog());
      await stopProcess(server.child);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}


// ---------------------------------------------------------------------------
// scenario: worker-failure
// ---------------------------------------------------------------------------

async function checkJobFails(check, label, base, sourceModelId, filename) {
  const enqueued = await uploadRaw(base, sourceModelId, filename);
  if (enqueued.status !== 202) {
    check(label, false, `expected upload to enqueue (202), got ${enqueued.status}: ${JSON.stringify(enqueued.json)}`);
    return null;
  }
  const job = await pollJob(base, enqueued.json.id);
  check(label, job.status === "failed" && Boolean(job.error), JSON.stringify(job));
  return job;
}

const FAILURE_MODES = [
  "malformed-stdout",
  "duplicate-result",
  "wrong-job-id",
  "nonzero-exit",
  "bad-artifact-hash",
  "path-escape",
  "schema-version-mismatch",
  "symlink-escape",
  "manifest-symlink-escape",
  "bad-render-schema",
];

async function runFailureModes(dataDir, check, log) {
  for (const mode of FAILURE_MODES) {
    const server = await startServer(dataDir, fakeWorkerCommand(mode));
    try {
      const sourceModel = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: `Failure ${mode}`, discipline: "OTHER" })).json;
      const job = await checkJobFails(check, `worker failure mode "${mode}" leaves the job failed, not published`, server.base, sourceModel.id, `${mode}.ifc`);
      if (mode === "manifest-symlink-escape") {
        check(
          `"${mode}" job error names the filesystem link`,
          typeof job?.error === "string" && job.error.includes("filesystem link"),
          JSON.stringify(job),
        );
      }
      const sourceModels = (await api(server.base, "GET", "/api/projects/demo-project/source-models")).json;
      const reloaded = sourceModels.find((s) => s.id === sourceModel.id);
      check(
        `"${mode}" never created a model_revisions row for the failed job`,
        Boolean(reloaded) && reloaded.revisions.length === 0,
        JSON.stringify({ job, reloaded }),
      );
    } finally {
      log(`failure-mode-${mode}.log`, server.getLog());
      await stopProcess(server.child);
    }
  }
}

async function checkConcurrency(dataDir, check, log) {
  const server = await startServer(dataDir, fakeWorkerCommand("slow-success"), { FAKE_WORKER_DELAY_MS: "700" });
  try {
    const jobIds = [];
    for (let i = 0; i < 4; i += 1) {
      const sourceModel = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: `Concurrency ${i}`, discipline: "OTHER" })).json;
      const enqueued = await uploadRaw(server.base, sourceModel.id, `concurrent-${i}.ifc`);
      jobIds.push(enqueued.json.id);
    }

    let maxRunning = 0;
    let statuses = [];
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      statuses = await Promise.all(
        jobIds.map((id) => api(server.base, "GET", `/api/jobs/${id}`).then((r) => r.json.status)),
      );
      maxRunning = Math.max(maxRunning, statuses.filter((s) => s === "running").length);
      if (statuses.every((s) => s === "completed" || s === "failed")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    check("simultaneous uploads never exceed one active (running) job at a time", maxRunning <= 1, `observed max concurrent running = ${maxRunning}`);
    check("all concurrently queued jobs eventually completed", statuses.every((s) => s === "completed"), JSON.stringify(statuses));
  } finally {
    log("concurrency.log", server.getLog());
    await stopProcess(server.child);
  }
}

async function checkRestartRecovery(check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-worker-failure-restart-"));
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("restart-recovery: seed succeeds", seed.status === 0, seed.stderr);

    const server1 = await startServer(dataDir, fakeWorkerCommand("hang"), { FAKE_WORKER_DELAY_MS: "8000" });
    const sourceModel = (await api(server1.base, "POST", "/api/projects/demo-project/source-models", { name: "Restart Target", discipline: "OTHER" })).json;
    const enqueued = await uploadRaw(server1.base, sourceModel.id, "restart.ifc");
    check("restart-recovery: upload enqueues a job", enqueued.status === 202, JSON.stringify(enqueued));

    let running = false;
    const runningDeadline = Date.now() + 5000;
    while (Date.now() < runningDeadline && !running) {
      const job = (await api(server1.base, "GET", `/api/jobs/${enqueued.json.id}`)).json;
      running = job.status === "running";
      if (!running) await new Promise((r) => setTimeout(r, 50));
    }
    check("restart-recovery: the job reaches 'running' before the simulated crash", running, "");

    const pidPath = join(dataDir, "jobs", enqueued.json.id, "attempt-0", "worker.pid");
    let workerPid = existsSync(pidPath) ? Number(readFileSync(pidPath, "utf8")) : NaN;
    const pidDeadline = Date.now() + 2000;
    while (!Number.isInteger(workerPid) && Date.now() < pidDeadline) {
      await new Promise((r) => setTimeout(r, 50));
      workerPid = existsSync(pidPath) ? Number(readFileSync(pidPath, "utf8")) : NaN;
    }
    check("restart-recovery: hang worker wrote its pid", Number.isInteger(workerPid), pidPath);

    server1.child.kill("SIGKILL");
    await new Promise((resolve) => server1.child.once("exit", resolve));
    log("restart-server-1.log", server1.getLog());

    let workerGone = false;
    const goneDeadline = Date.now() + 2000;
    while (Date.now() < goneDeadline && Number.isInteger(workerPid)) {
      try {
        process.kill(workerPid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        workerGone = true;
        break;
      }
    }
    check("restart-recovery: the old worker process is gone after the checker is killed", workerGone, `pid=${workerPid}`);

    // Default worker command: this half proves a *real* recovery, not just a
    // status flip — the retry below actually re-runs the real ifc-worker.
    const server2 = await startServer(dataDir, undefined);
    try {
      const recovered = (await api(server2.base, "GET", `/api/jobs/${enqueued.json.id}`)).json;
      check(
        "restart-recovery: a job still 'running' when the process was killed is recovered as 'failed' on restart",
        recovered.status === "failed" && /restart/i.test(recovered.error ?? ""),
        JSON.stringify(recovered),
      );

      await api(server2.base, "POST", `/api/jobs/${enqueued.json.id}/retry`, {});
      const finished = await pollJob(server2.base, enqueued.json.id, { timeoutMs: 20_000 });
      check(
        "restart-recovery: retrying the recovered job succeeds via the real worker",
        finished.status === "completed" && Boolean(finished.modelRevisionId),
        JSON.stringify(finished),
      );
      check(
        "restart-recovery: retry uses a new attempt directory and keeps the previous attempt",
        existsSync(join(dataDir, "jobs", enqueued.json.id, "attempt-0"))
          && existsSync(join(dataDir, "jobs", enqueued.json.id, "attempt-1")),
        "",
      );

      const secondRetry = (await api(server2.base, "POST", `/api/jobs/${enqueued.json.id}/retry`, {})).json;
      check(
        "restart-recovery: retrying an already-completed job is an idempotent no-op",
        secondRetry.status === "completed" && secondRetry.modelRevisionId === finished.modelRevisionId,
        JSON.stringify(secondRetry),
      );
    } finally {
      log("restart-server-2.log", server2.getLog());
      await stopProcess(server2.child);
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function runWorkerFailureScenario(check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-worker-failure-"));
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed succeeds", seed.status === 0, seed.stderr);

    await runFailureModes(dataDir, check, log);
    await checkConcurrency(dataDir, check, log);
    await checkParserIndependentPublish(dataDir, check, log);
    await checkSeedDoesNotRecoverLiveJobs(dataDir, check, log);
    await checkExclusiveServeLock(dataDir, check, log);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
  await checkRestartRecovery(check, log);
  await checkSharedWorkerGate(check, log);
  await checkRunInterruptedIsRecoverable(check, log);
  await checkOrphanedWorkerGroup(check, log);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkOrphanedWorkerGroup(check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-worker-orphan-"));
  let childPid;
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("orphan-group: seed succeeds", seed.status === 0, seed.stderr);

    const hanging = await startServer(dataDir, fakeWorkerCommand("hang-child"), { FAKE_WORKER_DELAY_MS: "8000" });
    let leaderPid;
    try {
      const sourceModel = (await api(hanging.base, "POST", "/api/projects/demo-project/source-models", { name: "Orphan Group", discipline: "OTHER" })).json;
      const enqueued = await uploadRaw(hanging.base, sourceModel.id, "orphan.ifc");
      check("orphan-group: upload enqueues a job", enqueued.status === 202, JSON.stringify(enqueued));

      let running = false;
      const runningDeadline = Date.now() + 5000;
      while (Date.now() < runningDeadline && !running) {
        const job = (await api(hanging.base, "GET", `/api/jobs/${enqueued.json.id}`)).json;
        running = job.status === "running";
        if (!running) await new Promise((r) => setTimeout(r, 50));
      }
      check("orphan-group: the job reaches 'running' before the simulated crash", running, "");

      const attemptDir = join(dataDir, "jobs", enqueued.json.id, "attempt-0");
      const leaderPath = join(attemptDir, "worker.pid");
      const childPath = join(attemptDir, "worker.child.pid");
      const pidDeadline = Date.now() + 2000;
      while (Date.now() < pidDeadline && (!Number.isInteger(leaderPid) || !Number.isInteger(childPid))) {
        if (existsSync(leaderPath)) leaderPid = Number(readFileSync(leaderPath, "utf8"));
        if (existsSync(childPath)) childPid = Number(readFileSync(childPath, "utf8"));
        if (!Number.isInteger(leaderPid) || !Number.isInteger(childPid)) await new Promise((r) => setTimeout(r, 50));
      }
      check("orphan-group: hang-child wrote leader and grandchild pids", Number.isInteger(leaderPid) && Number.isInteger(childPid), JSON.stringify({ leaderPid, childPid }));

      hanging.child.kill("SIGKILL");
      await new Promise((resolve) => hanging.child.once("exit", resolve));

      const goneDeadline = Date.now() + 2000;
      while (Date.now() < goneDeadline && pidAlive(leaderPid)) {
        await new Promise((r) => setTimeout(r, 50));
      }
      check("orphan-group: PDEATHSIG kills the recorded leader", !pidAlive(leaderPid), `leader=${leaderPid}`);
      check("orphan-group: a grandchild in the same group survives the leader", pidAlive(childPid), `child=${childPid}`);
    } finally {
      log("orphan-group-hang.log", hanging.getLog());
    }

    const recovered = await startServer(dataDir, undefined);
    try {
      const goneDeadline = Date.now() + 2000;
      while (Date.now() < goneDeadline && pidAlive(childPid)) {
        await new Promise((r) => setTimeout(r, 50));
      }
      check("orphan-group: adopt kills leftover members of the recorded group", !pidAlive(childPid), `child=${childPid}`);
      check("orphan-group: the stale slot file was reconciled away", readSlotFile(dataDir) === null, "");
    } finally {
      log("orphan-group-recovered.log", recovered.getLog());
      await stopProcess(recovered.child);
    }
  } finally {
    if (pidAlive(childPid)) {
      try { process.kill(childPid, "SIGKILL"); } catch {}
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function liveWorkerPids(checkerPid) {
  const out = spawnSync("pgrep", ["-P", String(checkerPid)], { encoding: "utf8" });
  if (out.status === 1) return [];
  if (out.status !== 0) throw new Error(`pgrep failed: ${out.stderr}`);
  return out.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function readSlotFile(dataDir) {
  const path = join(dataDir, "worker.slot");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function setupRunnableDelivery(base, name) {
  const source = (await api(base, "POST", "/api/projects/demo-project/source-models", { name, discipline: "ARCH" })).json;
  const uploaded = await uploadAndAwaitRevision(base, source.id, `${name}.ifc`);
  const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: name })).json;
  const member = await api(base, "POST", `/api/deliveries/${delivery.id}/members`, {
    sourceModelId: source.id,
    modelRevisionId: uploaded.job.modelRevisionId,
  });
  const finalized = await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {});
  return { source, uploaded, delivery, member, finalized };
}

async function checkSharedWorkerGate(check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-worker-slot-"));
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("shared-gate: seed succeeds", seed.status === 0, seed.stderr);

    const server = await startServer(dataDir, fakeWorkerCommand("slow-success"), { FAKE_WORKER_DELAY_MS: "700" });
    try {
      const first = await setupRunnableDelivery(server.base, "Gate A");
      const second = await setupRunnableDelivery(server.base, "Gate B");
      check(
        "shared-gate: two deliveries ingested",
        first.uploaded.job?.status === "completed" && second.uploaded.job?.status === "completed"
          && first.finalized.status === 200 && second.finalized.status === 200,
        JSON.stringify({ first: first.uploaded.job, second: second.uploaded.job }),
      );
      const idsXml = await readFileAsync(FIXTURES_IDS, "utf8");
      const pack = (await api(server.base, "POST", "/api/packs/demo-pack/versions", { idsXml })).json;
      check("shared-gate: pack version published", Boolean(pack?.id), JSON.stringify(pack));

      const extraA = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: "Gate Upload A", discipline: "OTHER" })).json;
      const extraB = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: "Gate Upload B", discipline: "OTHER" })).json;

      const runA = api(server.base, "POST", "/api/runs", { deliveryId: first.delivery.id, packVersionId: pack.id });
      const runB = api(server.base, "POST", "/api/runs", { deliveryId: second.delivery.id, packVersionId: pack.id });
      const uaP = uploadRaw(server.base, extraA.id, "gate-a.ifc");
      const ubP = uploadRaw(server.base, extraB.id, "gate-b.ifc");

      let runsSettled = false;
      let runPair = null;
      Promise.all([runA, runB]).then((pair) => {
        runPair = pair;
        runsSettled = true;
      }, () => {
        runsSettled = true;
      });

      let ua;
      let ub;
      const uploadsReady = Promise.all([uaP, ubP]).then((pair) => {
        ua = pair[0];
        ub = pair[1];
        return pair;
      });

      let maxLive = 0;
      let slotDisagreed = false;
      let sawValidate = false;
      let sawInspect = false;
      let jobStatuses = [];
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const live = liveWorkerPids(server.child.pid);
        maxLive = Math.max(maxLive, live.length);
        const slot = readSlotFile(dataDir);
        if (slot?.kind === "validate") sawValidate = true;
        if (slot?.kind === "inspect") sawInspect = true;
        if (slot && Number.isInteger(slot.pid) && live.length > 0 && !live.includes(slot.pid)) {
          const liveAgain = liveWorkerPids(server.child.pid);
          maxLive = Math.max(maxLive, liveAgain.length);
          if (liveAgain.length > 0 && !liveAgain.includes(slot.pid)) slotDisagreed = true;
        }
        if (ua?.json?.id && ub?.json?.id) {
          jobStatuses = await Promise.all(
            [ua.json.id, ub.json.id].map((id) => api(server.base, "GET", `/api/jobs/${id}`).then((r) => r.json.status)),
          );
        }
        if (runsSettled && jobStatuses.every((s) => s === "completed" || s === "failed")) break;
        await new Promise((r) => setTimeout(r, 25));
      }

      const [a, b] = runPair ?? await Promise.all([runA, runB]);
      await uploadsReady;
      check("shared-gate: racing uploads enqueued", ua.status === 202 && ub.status === 202, JSON.stringify({ ua, ub }));
      const jobA = await pollJob(server.base, ua.json.id);
      const jobB = await pollJob(server.base, ub.json.id);

      check("shared-gate: at most one live worker subprocess across runs and ingestion", maxLive <= 1, `maxLive=${maxLive}`);
      check("shared-gate: the probe actually observed a worker", maxLive >= 1, `maxLive=${maxLive}`);
      check("shared-gate: a validate invocation occupied the slot", sawValidate, "");
      check("shared-gate: an inspect invocation occupied the slot", sawInspect, "");
      check("shared-gate: slot file pid stayed in the live set when present", !slotDisagreed, "");
      check(
        "shared-gate: both racing runs reached a terminal status",
        a.status === 200 && b.status === 200
          && ["completed", "failed"].includes(a.json?.run?.status)
          && ["completed", "failed"].includes(b.json?.run?.status),
        JSON.stringify({ a: a.json?.run, b: b.json?.run }),
      );
      check(
        "shared-gate: both racing uploads completed",
        jobA?.status === "completed" && jobB?.status === "completed",
        JSON.stringify({ jobA, jobB }),
      );
      check("shared-gate: slot file is gone after everything settled", readSlotFile(dataDir) === null, "");
    } finally {
      log("shared-gate.log", server.getLog());
      await stopProcess(server.child);
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function checkRunInterruptedIsRecoverable(check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-run-restart-"));
  const dbPath = join(dataDir, "modelshelf.db");
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("run-restart: seed succeeds", seed.status === 0, seed.stderr);

    const setup = await startServer(dataDir, fakeWorkerCommand("slow-success"), { FAKE_WORKER_DELAY_MS: "50" });
    let deliveryId;
    let packVersionId;
    try {
      const ready = await setupRunnableDelivery(setup.base, "Interrupted");
      check("run-restart: delivery ingested", ready.uploaded.job?.status === "completed", JSON.stringify(ready.uploaded.job));
      const idsXml = await readFileAsync(FIXTURES_IDS, "utf8");
      const pack = (await api(setup.base, "POST", "/api/packs/demo-pack/versions", { idsXml })).json;
      check("run-restart: pack version published", Boolean(pack?.id), JSON.stringify(pack));
      deliveryId = ready.delivery.id;
      packVersionId = pack.id;
    } finally {
      log("run-restart-setup.log", setup.getLog());
      await stopProcess(setup.child);
    }

    const hanging = await startServer(dataDir, fakeWorkerCommand("hang"), { FAKE_WORKER_DELAY_MS: "8000" });
    let runId;
    let slot;
    try {
      const postPromise = api(hanging.base, "POST", "/api/runs", { deliveryId, packVersionId });
      postPromise.catch(() => {});

      const runningDeadline = Date.now() + 5000;
      while (Date.now() < runningDeadline && !runId) {
        const detail = (await api(hanging.base, "GET", `/api/deliveries/${deliveryId}`)).json;
        const running = (detail.runs ?? []).find((r) => r.status === "running");
        if (running) runId = running.id;
        else await new Promise((r) => setTimeout(r, 50));
      }
      check("run-restart: the run reaches 'running' before the simulated crash", Boolean(runId), "");

      const slotDeadline = Date.now() + 2000;
      while (Date.now() < slotDeadline && !slot) {
        slot = readSlotFile(dataDir);
        if (!slot) await new Promise((r) => setTimeout(r, 50));
      }
      check("run-restart: slot file names a validate invocation", Boolean(slot?.pid) && slot?.kind === "validate", JSON.stringify(slot));

      hanging.child.kill("SIGKILL");
      await new Promise((resolve) => hanging.child.once("exit", resolve));

      let workerGone = false;
      const goneDeadline = Date.now() + 2000;
      while (Date.now() < goneDeadline && Number.isInteger(slot?.pid)) {
        try {
          process.kill(slot.pid, 0);
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          workerGone = true;
          break;
        }
      }
      check("run-restart: the old worker process is gone after the checker is killed", workerGone, `pid=${slot?.pid}`);
    } finally {
      log("run-restart-hang.log", hanging.getLog());
    }

    const recoveredServer = await startServer(dataDir, undefined);
    try {
      const recovered = (await api(recoveredServer.base, "GET", `/api/runs/${runId}`)).json;
      check(
        "run-restart: a run still 'running' at kill is 'failed' with an explicit restart reason",
        recovered.run.status === "failed" && /restart/i.test(recovered.run.error ?? ""),
        JSON.stringify(recovered.run),
      );
      check(
        "run-restart: an interrupted run is not a clean scorecard",
        recovered.scorecard.length === 0 && recovered.specs.length === 0
          && recovered.run.passCount === 0 && recovered.run.failCount === 0 && recovered.run.score === null,
        JSON.stringify({ scorecard: recovered.scorecard, specs: recovered.specs, run: recovered.run }),
      );
      check(
        "run-restart: no run is left running",
        dbGet(dbPath, "SELECT COUNT(*) FROM runs WHERE status='running'") === "0",
        "",
      );
      check("run-restart: the stale slot file was reconciled away", readSlotFile(dataDir) === null, "");

      const retried = await api(recoveredServer.base, "POST", "/api/runs", { deliveryId, packVersionId });
      check(
        "run-restart: a fresh POST on the same delivery completes with a new run id",
        retried.status === 200 && retried.json?.run?.status === "completed" && retried.json?.run?.id !== runId,
        JSON.stringify({ status: retried.status, run: retried.json?.run }),
      );
      const delivery = (await api(recoveredServer.base, "GET", `/api/deliveries/${deliveryId}`)).json;
      check(
        "run-restart: latest delivery run is the new completed run",
        delivery.runs?.[0]?.id === retried.json.run.id && delivery.runs?.[0]?.status === "completed",
        JSON.stringify(delivery.runs?.slice(0, 2)),
      );
    } finally {
      log("run-restart-recovered.log", recoveredServer.getLog());
      await stopProcess(recoveredServer.child);
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function checkParserIndependentPublish(dataDir, check, log) {
  const server = await startServer(dataDir, fakeWorkerCommand("slow-success"), { FAKE_WORKER_DELAY_MS: "50" });
  try {
    const sourceModel = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: "Garbage IFC", discipline: "OTHER" })).json;
    const enqueued = await uploadBytes(server.base, sourceModel.id, "not-ifc.bin", Buffer.from("this is not IFC"));
    check("garbage upload still enqueues", enqueued.status === 202, JSON.stringify(enqueued));
    const job = await pollJob(server.base, enqueued.json.id);
    check(
      "a successful worker publishes a revision even when the custom parser cannot read the bytes",
      job.status === "completed" && Boolean(job.modelRevisionId),
      JSON.stringify(job),
    );
  } finally {
    log("parser-independent.log", server.getLog());
    await stopProcess(server.child);
  }
}

async function checkSeedDoesNotRecoverLiveJobs(dataDir, check, log) {
  const server = await startServer(dataDir, fakeWorkerCommand("hang"), { FAKE_WORKER_DELAY_MS: "8000" });
  try {
    const sourceModel = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: "Seed During Job", discipline: "OTHER" })).json;
    const enqueued = await uploadRaw(server.base, sourceModel.id, "seed-during.ifc");
    let running = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !running) {
      const job = (await api(server.base, "GET", `/api/jobs/${enqueued.json.id}`)).json;
      running = job.status === "running";
      if (!running) await new Promise((r) => setTimeout(r, 50));
    }
    check("seed-during-job: job is running", running, "");
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed-during-job: seed exits 0", seed.status === 0, seed.stderr);
    const after = (await api(server.base, "GET", `/api/jobs/${enqueued.json.id}`)).json;
    check(
      "seed does not mark a live job interrupted",
      after.status === "running",
      JSON.stringify(after),
    );
  } finally {
    log("seed-during-job.log", server.getLog());
    await stopProcess(server.child);
  }
}

async function checkExclusiveServeLock(dataDir, check, log) {
  const server = await startServer(dataDir, fakeWorkerCommand("slow-success"));
  try {
    const port = await freePort();
    const second = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    second.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        second.kill("SIGKILL");
        resolve("timeout");
      }, 4000);
      second.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    check(
      "a second serve against the same data directory exits instead of recovering live jobs",
      code !== 0 && code !== "timeout" && /already owns/i.test(stderr),
      JSON.stringify({ code, stderr }),
    );
  } finally {
    log("exclusive-lock.log", server.getLog());
    await stopProcess(server.child);
  }
}

// ---------------------------------------------------------------------------
// scenario: checks (ticket 06)
// ---------------------------------------------------------------------------

async function uploadFileAndAwait(base, sourceModelId, filename, filePath, timeoutMs = 120_000) {
  const bytes = await readFileAsync(filePath);
  const enqueued = await uploadBytes(base, sourceModelId, filename, bytes);
  if (enqueued.status !== 202) return { enqueued, job: null };
  const job = await pollJob(base, enqueued.json.id, { timeoutMs });
  return { enqueued, job };
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
    offset += limit;
  }
  return { total, objects };
}

function nearlyEqual(left, right, epsilon = 1e-9) {
  return Math.abs(left - right) < epsilon;
}

function lengthScaleSet(models) {
  return (models ?? []).map((model) => model.lengthToMetre);
}

function matchesScalePair(actual, expected) {
  if (actual.length !== expected.length) return false;
  const remaining = [...expected];
  for (const value of actual) {
    const index = remaining.findIndex((candidate) => nearlyEqual(value, candidate));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function fireRatingFinding(runJson) {
  const findings = runJson?.scorecard?.flatMap((band) => band.categories.flatMap((c) => c.findings)) ?? [];
  return findings.find((finding) => finding.specName === "Wall declares a fire rating") ?? findings[0];
}

async function runArchPair(base, packVersionId, label, leftPath, leftName, rightPath, rightName) {
  const left = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: `${label} left`, discipline: "ARCH" })).json;
  const right = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: `${label} right`, discipline: "ARCH" })).json;
  const leftRev = await uploadFileAndAwait(base, left.id, leftName, leftPath);
  const rightRev = await uploadFileAndAwait(base, right.id, rightName, rightPath);
  const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label })).json;
  await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: left.id, modelRevisionId: leftRev.job.modelRevisionId });
  await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: right.id, modelRevisionId: rightRev.job.modelRevisionId });
  await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {});
  return api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId });
}

async function assertMixedUnitDelivery(base, packVersionId, mixed, idsBase, check, log) {
  const fixturesDir = join(REPO_ROOT, "packs", "demo", "fixtures");
  const metricPath = join(fixturesDir, mixed.metricIfc);
  const imperialPath = join(fixturesDir, mixed.imperialIfc);
  const metricRun = await runArchPair(base, packVersionId, "Metric equivalent", metricPath, mixed.metricIfc, metricPath, `copy-${mixed.metricIfc}`);
  const mixedRun = await runArchPair(base, packVersionId, "Mixed units", metricPath, mixed.metricIfc, imperialPath, mixed.imperialIfc);
  log("metric-equivalent-run.json", metricRun.json);
  log("mixed-units-run.json", mixedRun.json);
  const metricFinding = fireRatingFinding(metricRun.json);
  const mixedFinding = fireRatingFinding(mixedRun.json);
  const expectedCount = idsBase.fail * 2;
  check(
    "metric {base, base} FireRating objectCount is idsSummary.base.fail * 2",
    metricRun.status === 200 && metricRun.json?.run?.status === "completed" && metricFinding?.objectCount === expectedCount,
    JSON.stringify({ status: metricRun.status, count: metricFinding?.objectCount, expectedCount }),
  );
  check(
    "metric {base, base} lengthToMetre is {1, 1}",
    matchesScalePair(lengthScaleSet(metricRun.json?.models), [mixed.metricLengthToMetre, mixed.metricLengthToMetre]),
    JSON.stringify(lengthScaleSet(metricRun.json?.models)),
  );
  check(
    "mixed {base, foot} FireRating objectCount equals the metric equivalent",
    mixedRun.status === 200 && mixedRun.json?.run?.status === "completed" && mixedFinding?.objectCount === expectedCount && mixedFinding?.objectCount === metricFinding?.objectCount,
    JSON.stringify({ mixed: mixedFinding?.objectCount, metric: metricFinding?.objectCount, expectedCount }),
  );
  check(
    "mixed {base, foot} lengthToMetre is {1, 0.3048}",
    matchesScalePair(lengthScaleSet(mixedRun.json?.models), [mixed.metricLengthToMetre, mixed.imperialLengthToMetre]),
    JSON.stringify(lengthScaleSet(mixedRun.json?.models)),
  );
  check(
    "mixed-unit FireRating identity is not comparison summary.mixed",
    mixedRun.json?.summary === undefined && mixedRun.json?.run?.incompleteCount === 0 && mixedFinding?.objectCount === expectedCount,
    JSON.stringify({ summary: mixedRun.json?.summary, incompleteCount: mixedRun.json?.run?.incompleteCount }),
  );
}

async function assertUnsupportedRuleRun(base, packVersionId, rule, check, log, dataDir) {
  const ifcPath = join(REPO_ROOT, "packs", "demo", "fixtures", rule.modelIfc);
  const source = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "IFC2X3 wall", discipline: "ARCH" })).json;
  const revision = await uploadFileAndAwait(base, source.id, rule.modelIfc, ifcPath);
  check(
    "ifc2x3-wall ingest completes",
    revision.job?.status === "completed",
    JSON.stringify(revision.job),
  );
  const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Unsupported rule" })).json;
  await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: source.id, modelRevisionId: revision.job.modelRevisionId });
  await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {});
  const run = await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId });
  log("unsupported-rule-run.json", run.json);
  check(
    "unsupported-rule run completed with passCount 0 and failCount 0",
    run.status === 200 && run.json?.run?.status === "completed" && run.json?.run?.passCount === 0 && run.json?.run?.failCount === 0,
    JSON.stringify({ status: run.status, run: run.json?.run }),
  );
  const specs = run.json?.specs ?? [];
  check(
    "unsupported-rule specs[].outcome is review_incomplete",
    specs.length >= 1 && specs.every((spec) => spec.outcome === "review_incomplete") && run.json?.run?.incompleteCount >= 1,
    JSON.stringify(specs),
  );
  const reviewIncomplete = run.json?.reviewIncomplete ?? [];
  check(
    "unsupported-rule reviewIncomplete is nonempty and every item is incomplete",
    reviewIncomplete.length >= 1 && reviewIncomplete.every((item) => item.incomplete === true),
    JSON.stringify(reviewIncomplete),
  );
  const decided = (run.json?.scorecard ?? []).flatMap((band) => band.categories.flatMap((c) => c.findings));
  check(
    "unsupported-rule spec is absent from scorecard pass/fail bands",
    decided.every((finding) => finding.specName !== "Wall declares a fire rating" || finding.incomplete === true),
    JSON.stringify(decided.map((finding) => ({ specName: finding.specName, incomplete: finding.incomplete }))),
  );
  const modelId = run.json?.models?.[0]?.id;
  const manifestPath = join(dataDir, "runs", run.json?.run?.id, modelId, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const diagnostics = (manifest?.diagnostics ?? []).join(" ").toLowerCase();
  check(
    "worker manifest.diagnostics mentions unsupported or schema",
    Boolean(manifest) && (rule.diagnosticSubstrings ?? []).every((needle) => diagnostics.includes(String(needle).toLowerCase())),
    JSON.stringify({ manifestPath, diagnostics: manifest?.diagnostics, exists: existsSync(manifestPath) }),
  );
}

async function runChecksScenario(runDir, check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-api-checks-"));
  let server;
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
    check("seed succeeds", seed.status === 0, seed.stderr);

    server = await startServer(dataDir);
    const { base } = server;

    const invalidMeta = await api(base, "POST", "/api/packs/demo-pack/versions", {
      idsXml: await readFileAsync(FIXTURES_IDS, "utf8"),
      metadata: { defaults: { severity: "urgent" } },
    });
    check(
      "invalid pack metadata is rejected",
      invalidMeta.status === 400 && invalidMeta.json?.error?.code === "bad_request",
      JSON.stringify(invalidMeta),
    );

    const malformedIds = await api(base, "POST", "/api/packs/demo-pack/versions", { idsXml: "<not-ids/>" });
    check(
      "malformed IDS is rejected at publication",
      malformedIds.status === 422 && malformedIds.json?.error?.code === "parse_failed",
      JSON.stringify(malformedIds),
    );

    const idsXml = await readFileAsync(FIXTURES_IDS, "utf8");
    const packVersion = (
      await api(base, "POST", "/api/packs/demo-pack/versions", {
        idsXml,
        metadata: {
          categories: [{ id: "regulatory", label: "Regulatory" }],
          defaults: { severity: "high", categoryId: "regulatory" },
          specs: {
            "Wall declares a fire rating": {
              severity: "high",
              categoryId: "regulatory",
              disciplines: ["ARCH"],
            },
          },
        },
      })
    ).json;
    check("scoped fixtures pack version is published", Boolean(packVersion?.id), JSON.stringify(packVersion));

    const east = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Architecture East", discipline: "ARCH" })).json;
    const west = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Architecture West", discipline: "ARCH" })).json;
    const mep = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Mechanical", discipline: "MEP" })).json;

    const eastRev = await uploadFileAndAwait(base, east.id, "east.ifc", FIXTURES_IFC);
    const westRev = await uploadFileAndAwait(base, west.id, "west.ifc", FIXTURES_IFC);
    const mepRev = await uploadFileAndAwait(base, mep.id, "mep.ifc", FIXTURES_IFC);
    check(
      "two ARCH revisions and one MEP revision ingest",
      eastRev.job?.status === "completed" && westRev.job?.status === "completed" && mepRev.job?.status === "completed",
      JSON.stringify({ east: eastRev.job, west: westRev.job, mep: mepRev.job }),
    );
    const eastId = eastRev.job.modelRevisionId;
    const westId = westRev.job.modelRevisionId;
    const mepId = mepRev.job.modelRevisionId;

    const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Scoped drop" })).json;
    await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: east.id, modelRevisionId: eastId });
    await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: west.id, modelRevisionId: westId });
    await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: mep.id, modelRevisionId: mepId });
    await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {});

    const run = await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId: packVersion.id });
    log("scoped-run.json", run.json);
    check(
      "run completes with pinned complete provenance and three models",
      run.status === 200 &&
        run.json?.run?.status === "completed" &&
        run.json?.inputProvenance?.status === "complete" &&
        run.json?.models?.length === 3,
      JSON.stringify({ status: run.status, provenance: run.json?.inputProvenance, models: run.json?.models?.map((m) => m.id) }),
    );
    const pinnedIds = new Set(run.json.models.map((m) => m.id));
    check(
      "pinned models are the exact delivery members",
      pinnedIds.has(eastId) && pinnedIds.has(westId) && pinnedIds.has(mepId) && pinnedIds.size === 3,
      JSON.stringify([...pinnedIds]),
    );

    const findings = run.json.scorecard?.flatMap((band) => band.categories.flatMap((c) => c.findings)) ?? [];
    check("the fire-rating rule produces one grouped finding", findings.length >= 1, JSON.stringify(findings.map((f) => ({ title: f.title, objectCount: f.objectCount }))));
    const finding = findings.find((f) => f.specName === "Wall declares a fire rating") ?? findings[0];
    check(
      "two ARCH files contribute 270 affected objects; the excluded MEP file does not",
      finding?.objectCount === 270 && finding.sampleObjects.length === 25,
      JSON.stringify({ objectCount: finding?.objectCount, sample: finding?.sampleObjects?.length }),
    );
    const sample = finding.sampleObjects[0];
    check(
      "finding objects carry the shared ObjectRef used by rendering",
      Boolean(sample?.ref?.revisionId && sample?.ref?.objectId?.startsWith("occ_")),
      JSON.stringify(sample),
    );
    const sampleModelIds = new Set(finding.sampleObjects.map((o) => o.modelId));
    check("sample objects only come from ARCH revisions", ![...sampleModelIds].includes(mepId), JSON.stringify([...sampleModelIds]));

    const paged = await pageAllFindingObjects(base, finding.id);
    const pageModelIds = new Set(paged.objects.map((o) => o.modelId));
    check(
      "paging retrieves every affected object beyond the first 25",
      paged.total === 270 && paged.objects.length === 270,
      JSON.stringify({ total: paged.total, retrieved: paged.objects.length }),
    );
    check(
      "paged members are the two ARCH revisions only",
      pageModelIds.size === 2 && pageModelIds.has(eastId) && pageModelIds.has(westId) && !pageModelIds.has(mepId),
      JSON.stringify([...pageModelIds]),
    );
    check(
      "every paged object has a revision-qualified ref",
      paged.objects.every((o) => o.ref?.revisionId === o.modelId && typeof o.ref?.objectId === "string" && o.ref.objectId.startsWith("occ_")),
      JSON.stringify(paged.objects[100]),
    );

    const oracle = JSON.parse(readFileSync(join(REPO_ROOT, "packs", "demo", "fixtures", "oracle.json"), "utf8"));
    await assertMixedUnitDelivery(base, packVersion.id, oracle.proofs.mixed_units, oracle.idsSummary.base, check, log);
    await assertUnsupportedRuleRun(base, packVersion.id, oracle.proofs.unsupported_rule, check, log, dataDir);

    const beforeRestart = {
      runId: run.json.run.id,
      modelIds: run.json.models.map((m) => m.id),
      hashes: run.json.models.map((m) => m.contentSha256),
    };
    await stopProcess(server.child);
    server = await startServer(dataDir);
    const after = (await api(server.base, "GET", `/api/runs/${beforeRestart.runId}`)).json;
    log("run-after-restart.json", after);
    check(
      "a run retains its exact input list after restart",
      after.inputProvenance?.status === "complete" &&
        JSON.stringify(after.models.map((m) => m.id)) === JSON.stringify(beforeRestart.modelIds) &&
        JSON.stringify(after.models.map((m) => m.contentSha256)) === JSON.stringify(beforeRestart.hashes),
      JSON.stringify({ before: beforeRestart, after: after.models?.map((m) => ({ id: m.id, hash: m.contentSha256 })) }),
    );
    const missingConditionalEvidence = await api(server.base, "POST", `/api/runs/${beforeRestart.runId}/decisions`, {
      outcome: "conditional_accept",
      rationale: "The condition must cite the finding it binds.",
      citedFindingIds: [],
    });
    check(
      "conditional acceptance requires a cited finding",
      missingConditionalEvidence.status === 400 && missingConditionalEvidence.json?.error?.code === "bad_request",
      JSON.stringify(missingConditionalEvidence),
    );

    const firstDecision = await api(server.base, "POST", `/api/runs/${beforeRestart.runId}/decisions`, {
      outcome: "conditional_accept",
      rationale: "Accept subject to resolving the cited requirement.",
      citedFindingIds: [finding.id],
    });
    check(
      "conditional decision persists its rationale and cited evidence",
      firstDecision.status === 200 &&
        firstDecision.json?.outcome === "conditional_accept" &&
        firstDecision.json?.citedFindingIds?.[0] === finding.id &&
        firstDecision.json?.evidence?.packVersion === run.json.run.packVersion,
      JSON.stringify(firstDecision),
    );

    const rejectedWithoutSupersession = await api(server.base, "POST", `/api/runs/${beforeRestart.runId}/decisions`, {
      outcome: "accept",
      rationale: "A second decision must name the decision it supersedes.",
      citedFindingIds: [finding.id],
    });
    check(
      "a second current decision requires explicit supersession",
      rejectedWithoutSupersession.status === 409 && rejectedWithoutSupersession.json?.error?.code === "decision_conflict",
      JSON.stringify(rejectedWithoutSupersession),
    );

    const secondDecision = await api(server.base, "POST", `/api/runs/${beforeRestart.runId}/decisions`, {
      outcome: "accept",
      rationale: "The cited requirement was reviewed again and is now accepted.",
      citedFindingIds: [finding.id],
      supersedesDecisionId: firstDecision.json?.id,
    });
    check(
      "a changed decision appends a successor instead of replacing history",
      secondDecision.status === 200 &&
        secondDecision.json?.outcome === "accept" &&
        secondDecision.json?.supersedesDecisionId === firstDecision.json?.id,
      JSON.stringify(secondDecision),
    );

    const decisionHistory = await api(server.base, "GET", `/api/runs/${beforeRestart.runId}/decisions`);
    const oldDecision = decisionHistory.json?.history?.find((candidate) => candidate.id === firstDecision.json?.id);
    check(
      "decision history exposes one current record and the superseded predecessor",
      decisionHistory.status === 200 &&
        decisionHistory.json?.current?.id === secondDecision.json?.id &&
        decisionHistory.json?.history?.length === 2 &&
        oldDecision?.supersededBy === secondDecision.json?.id,
      JSON.stringify(decisionHistory),
    );

  } finally {
    if (server) {
      log("checks-serve.log", server.getLog());
      await stopProcess(server.child);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// scenario: first-loop (ticket 09)
// ---------------------------------------------------------------------------

const EMPTY_IFC = Buffer.from(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('empty.ifc','2026-09-07T00:00:00',(),(),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'Verifier',$,$,$,$,$);
#2=IFCORGANIZATION($,'ModelShelf',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','First loop prover','PROVER');
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

async function expectedObjectId(revisionId, expressId) {
  return expressIdToObjectId(revisionId, expressId);
}

async function runFirstLoopScenario(runDir, check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-api-first-loop-"));
  const phases = [];
  async function phase(name, fn) {
    const started = Date.now();
    const out = await fn();
    phases.push({ name, ms: Date.now() - started });
    return out;
  }
  let server;
  try {
    await phase("seed", async () => {
      const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", dataDir, "--samples-dir", dataDir]);
      check("seed succeeds", seed.status === 0, seed.stderr);
    });

    server = await phase("serve", async () => startServer(dataDir));
    const { base } = server;

    const packVersion = await phase("publish-pack", async () =>
      (
        await api(base, "POST", "/api/packs/demo-pack/versions", {
          idsXml: await readFileAsync(FIXTURES_IDS, "utf8"),
          metadata: {
            categories: [{ id: "regulatory", label: "Regulatory" }],
            defaults: { severity: "high", categoryId: "regulatory" },
            specs: {
              "Wall declares a fire rating": { severity: "high", categoryId: "regulatory", disciplines: ["ARCH"] },
            },
          },
        })
      ).json,
    );
    check("fixtures pack version is published", Boolean(packVersion?.id), JSON.stringify(packVersion));

    const east = await phase("create-models", async () =>
      (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "East", discipline: "ARCH" })).json,
    );
    const west = (
      await api(base, "POST", "/api/projects/demo-project/source-models", { name: "West", discipline: "ARCH" })
    ).json;

    const garbage = await phase("invalid-upload", async () => {
      const enqueued = await uploadBytes(base, east.id, "garbage.ifc", Buffer.from("not an IFC file at all"));
      if (enqueued.status !== 202) return { enqueued, job: null };
      return { enqueued, job: await pollJob(base, enqueued.json.id, { timeoutMs: 120_000 }) };
    });
    check(
      "invalid IFC bytes fail the job without publishing a revision",
      garbage.job?.status === "failed" && !garbage.job?.modelRevisionId,
      JSON.stringify(garbage.job),
    );

    const empty = await phase("empty-upload", async () => {
      const enqueued = await uploadBytes(base, east.id, "empty.ifc", EMPTY_IFC);
      if (enqueued.status !== 202) return { enqueued, job: null };
      return { enqueued, job: await pollJob(base, enqueued.json.id, { timeoutMs: 120_000 }) };
    });
    check(
      "a valid model with no drawable geometry ingests honestly",
      empty.job?.status === "completed" && empty.job?.modelRevisionId,
      JSON.stringify(empty.job),
    );

    const { eastId, westId } = await phase("ingest", async () => {
      const eastRev = await uploadFileAndAwait(base, east.id, "east.ifc", FIXTURES_IFC);
      const westRev = await uploadFileAndAwait(base, west.id, "west.ifc", FIXTURES_IFC);
      check(
        "both fixture revisions ingest",
        eastRev.job?.status === "completed" && westRev.job?.status === "completed",
        JSON.stringify({ east: eastRev.job?.status, west: westRev.job?.status }),
      );
      return { eastId: eastRev.job.modelRevisionId, westId: westRev.job.modelRevisionId };
    });

    const delivery = await phase("deliver", async () => {
      const created = (
        await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "First loop" })
      ).json;
      await api(base, "POST", `/api/deliveries/${created.id}/members`, { sourceModelId: east.id, modelRevisionId: eastId });
      await api(base, "POST", `/api/deliveries/${created.id}/members`, { sourceModelId: west.id, modelRevisionId: westId });
      const finalized = (await api(base, "POST", `/api/deliveries/${created.id}/finalize`, {})).json;
      check("delivery finalizes with two members", finalized?.models?.length === 2, JSON.stringify(finalized?.models?.length));
      return created;
    });

    const run = await phase("run", async () =>
      (await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId: packVersion.id })).json,
    );
    log("first-loop-run.json", run);
    check(
      "the run completes against pinned complete inputs",
      run?.run?.status === "completed" && run?.inputProvenance?.status === "complete",
      JSON.stringify({ status: run?.run?.status, provenance: run?.inputProvenance }),
    );

    const member = await phase("resolve-object", async () => {
      const findings = run.scorecard?.flatMap((band) => band.categories.flatMap((c) => c.findings)) ?? [];
      const finding = findings.find((f) => f.specName === "Wall declares a fire rating") ?? findings[0];
      check("the fire-rating rule groups one finding", Boolean(finding) && finding.objectCount > 0, JSON.stringify(findings.map((f) => f.specName)));
      const paged = await pageAllFindingObjects(base, finding.id);
      check(
        "paging retrieves every affected member",
        paged.total === finding.objectCount && paged.objects.length === finding.objectCount,
        JSON.stringify({ total: paged.total, retrieved: paged.objects.length }),
      );
      const first = paged.objects[0];
      check(
        "the member ref matches the shared occurrence-identity contract",
        first?.ref?.revisionId === first?.modelId && first?.ref?.objectId === (await expectedObjectId(first.modelId, first.expressId)),
        JSON.stringify(first?.ref),
      );
      const detail = (await api(base, "GET", `/api/objects/${first.objectId}`)).json;
      check(
        "the member resolves to its full object record",
        detail?.id === first.objectId && detail?.ifcType === first.ifcType && detail?.globalId === first.globalId && Array.isArray(detail?.properties),
        JSON.stringify({ id: detail?.id, ifcType: detail?.ifcType }),
      );
      return { findingId: finding.id, objectId: first.objectId };
    });

    const reread = (await api(base, "GET", `/api/runs/${run.run.id}`)).json;
    check(
      "retained run results stay readable",
      reread?.run?.status === "completed" && (reread?.scorecard?.flatMap((band) => band.categories.flatMap((c) => c.findings)) ?? []).length > 0,
      JSON.stringify(reread?.run?.status),
    );

    log("first-loop-phases.json", { phases, findingId: member.findingId, objectId: member.objectId });
  } finally {
    if (server) {
      log("first-loop-serve.log", server.getLog());
      await stopProcess(server.child);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// scenario: restart (ticket 16)
// ---------------------------------------------------------------------------

async function runRestartScenario(runDir, check, log) {
  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-api-restart-"));
  let server;
  try {
    const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", DEMO_PACKS_DIR, "--samples-dir", DEMO_SAMPLES_DIR]);
    check("restart: seed succeeds", seed.status === 0, seed.stderr);
    check("restart: seed loads demo pack versions", /\(\+[1-9]\d* pack version/.test(seed.stdout), seed.stdout);

    server = await startServerOnPort(dataDir, await freePort());
    const base = server.base;

    const packVersion = (
      await api(base, "POST", "/api/packs/demo-pack/versions", {
        idsXml: await readFileAsync(FIXTURES_IDS, "utf8"),
        metadata: {
          categories: [{ id: "regulatory", label: "Regulatory" }],
          defaults: { severity: "high", categoryId: "regulatory" },
          specs: {
            "Wall declares a fire rating": { severity: "high", categoryId: "regulatory", disciplines: ["ARCH"] },
          },
        },
      })
    ).json;
    check("restart: fixtures pack version is published", Boolean(packVersion?.id), JSON.stringify(packVersion));

    const east = (await api(base, "POST", "/api/projects/demo-project/source-models", { name: "Restart East", discipline: "ARCH" })).json;
    check("restart: source model created", Boolean(east.id), JSON.stringify(east));

    // Real worker ingestion, exactly like the comparisons scenario.
    const ingested = await uploadFileAndAwait(base, east.id, "east.ifc", FIXTURES_IFC);
    check("restart: revision ingests via the real worker", ingested.job?.status === "completed", JSON.stringify(ingested.job?.status));
    const revisionId = ingested.job.modelRevisionId;

    const delivery = (await api(base, "POST", "/api/projects/demo-project/deliveries", { label: "Restart drop" })).json;
    const member = await api(base, "POST", `/api/deliveries/${delivery.id}/members`, { sourceModelId: east.id, modelRevisionId: revisionId });
    check("restart: delivery member attached", member.status === 200, JSON.stringify({ status: member.status, body: member.json }));
    const finalized = (await api(base, "POST", `/api/deliveries/${delivery.id}/finalize`, {})).json;
    check("restart: delivery finalizes with one pinned model", finalized?.delivery?.modelCount === 1, JSON.stringify(finalized?.delivery));

    const runRes = await api(base, "POST", "/api/runs", { deliveryId: delivery.id, packVersionId: packVersion.id });
    check(
      "restart: run completes against the real worker",
      runRes.status === 200 && runRes.json?.run?.status === "completed",
      JSON.stringify({ status: runRes.status, run: runRes.json?.run?.status }),
    );
    const runId = runRes.json.run.id;

    const objects = (await api(base, "GET", `/api/models/${revisionId}/objects?limit=1`)).json;
    const object = objects.objects?.[0];
    check("restart: the revision's objects are retrievable", Boolean(object?.id) && objects.total >= 1, JSON.stringify({ total: objects.total, first: object?.id }));
    const objectId = object?.id;

    async function snapshotState() {
      const deliveryResponse = (await api(base, "GET", `/api/deliveries/${delivery.id}`)).json;
      const fileRes = await fetch(`${base}/api/models/${revisionId}/file`);
      const fileSha256 = createHash("sha256").update(new Uint8Array(await fileRes.arrayBuffer())).digest("hex");
      const run = (await api(base, "GET", `/api/runs/${runId}`)).json;
      const object = (await api(base, "GET", `/api/objects/${objectId}`)).json;
      return { deliveryResponse, fileSha256, run, object };
    }

    const before = await snapshotState();
    const sourceSha256 = createHash("sha256").update(await readFileAsync(FIXTURES_IFC)).digest("hex");
    check(
      "restart: the revision file is the exact uploaded fixture bytes",
      before.fileSha256 === sourceSha256,
      JSON.stringify({ fileSha256: before.fileSha256, sourceSha256 }),
    );

    // --- stop the server and bring up a fresh one on the same data dir and port ---
    log("restart-serve-1.log", server.getLog());
    await stopProcess(server.child);
    server = null;
    server = await startServerOnPort(dataDir, Number(base.slice(base.lastIndexOf(":") + 1)));

    const after = await snapshotState();
    log("restart-state.json", { before, after });
    check(
      "restart: delivery, revision file, run, and object re-verify byte-identically (canonical sha256)",
      canonicalDigest(after) === canonicalDigest(before),
      JSON.stringify({ before: canonicalDigest(before), after: canonicalDigest(after) }),
    );
    check(
      "restart: the delivery keeps its finalizedAt and modelCount",
      after.deliveryResponse?.delivery?.finalizedAt === before.deliveryResponse?.delivery?.finalizedAt
        && after.deliveryResponse?.delivery?.modelCount === before.deliveryResponse?.delivery?.modelCount,
      JSON.stringify({
        before: { finalizedAt: before.deliveryResponse?.delivery?.finalizedAt, modelCount: before.deliveryResponse?.delivery?.modelCount },
        after: { finalizedAt: after.deliveryResponse?.delivery?.finalizedAt, modelCount: after.deliveryResponse?.delivery?.modelCount },
      }),
    );
    check(
      "restart: the revision file bytes are identical",
      after.fileSha256 === before.fileSha256,
      JSON.stringify({ before: before.fileSha256, after: after.fileSha256 }),
    );
    const findingCount = (response) =>
      (response?.scorecard ?? []).flatMap((band) => band.categories.flatMap((c) => c.findings)).length;
    check(
      "restart: the run keeps its id, completed status, and scorecard finding count",
      after.run?.run?.id === before.run?.run?.id
        && before.run?.run?.status === "completed" && after.run?.run?.status === "completed"
        && findingCount(after.run) === findingCount(before.run) && findingCount(before.run) >= 1,
      JSON.stringify({
        before: { id: before.run?.run?.id, status: before.run?.run?.status, findings: findingCount(before.run) },
        after: { id: after.run?.run?.id, status: after.run?.run?.status, findings: findingCount(after.run) },
      }),
    );
    check(
      "restart: the object detail survives restart",
      after.object?.id === before.object?.id && Array.isArray(after.object?.properties),
      JSON.stringify({ before: before.object?.id, after: after.object?.id }),
    );

    // --- seed against the live data dir is still idempotent ---
    const reseed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", DEMO_PACKS_DIR, "--samples-dir", DEMO_SAMPLES_DIR]);
    check(
      "restart: re-running seed is idempotent (exit 0, state unchanged)",
      reseed.status === 0
        && /\(\+0 pack version/.test(reseed.stdout)
        && canonicalDigest(await snapshotState()) === canonicalDigest(before),
      JSON.stringify({ exit: reseed.status, seedOut: (reseed.stdout ?? "").trim(), seedErr: (reseed.stderr ?? "").trim() }),
    );

    log("restart-serve-2.log", server.getLog());
  } finally {
    if (server) await stopProcess(server.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

async function runScenarioByName(scenario, runDir, check, log) {
  if (scenario === "revisions") return runRevisionsScenarioTop(runDir, check, log);
  if (scenario === "worker-failure") return runWorkerFailureScenario(check, log);
  if (scenario === "checks" || scenario === "decisions") return runChecksScenario(runDir, check, log);
  if (scenario === "first-loop") return runFirstLoopScenario(runDir, check, log);
  if (scenario === "comparisons") return runComparisonsScenario(runDir, check, log);
  if (scenario === "finding-comparisons") return runFindingComparisonsScenario(runDir, check, log);
  return runRestartScenario(runDir, check, log);
}

/** `--scenario all`: runs every SCENARIOS entry sequentially, each with its own
 * checker and evidence/run-dir exactly as a standalone run (no shared state),
 * tees every scenario's stdout/stderr into `<allRunDir>/all.log`, writes a
 * per-scenario pass/fail + check-count summary.json under ticket-16, and exits
 * nonzero if any scenario failed. */
async function runAllScenarios() {
  const aggregateRoot = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "ticket-16");
  mkdirSync(aggregateRoot, { recursive: true });
  const allRunDir = join(aggregateRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(allRunDir, { recursive: true });

  // Tee console output into all.log while still forwarding to the terminal.
  const realLog = console.log;
  const realError = console.error;
  const tee = { buffer: "", ok: 0, fail: 0 };
  console.log = (...args) => {
    const line = args.join(" ");
    if (line.startsWith("ok - ")) tee.ok += 1;
    else if (line.startsWith("FAIL - ")) tee.fail += 1;
    tee.buffer += `${line}\n`;
    realLog(...args);
  };
  console.error = (...args) => {
    const line = args.join(" ");
    if (line.startsWith("FAIL - ")) tee.fail += 1;
    tee.buffer += `${line}\n`;
    realError(...args);
  };
  const allLogPath = join(allRunDir, "all.log");
  const flush = (name) => {
    const chunk = tee.buffer;
    tee.buffer = "";
    tee.ok = 0;
    tee.fail = 0;
    if (chunk) writeFileSync(allLogPath, `===== ${name} =====\n${chunk}`, { flag: "a" });
  };

  const summary = { scenario: "all", runDir: allRunDir, scenarios: [] };
  try {
    flush("build");
    buildBinary(allRunDir);
    flush("build");
    for (const name of SCENARIOS) {
      const entry = { scenario: name };
      try {
        const { check } = createChecker();
        const evidenceRoot = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", scenarioEvidenceDir(name));
        mkdirSync(evidenceRoot, { recursive: true });
        const runDir = join(evidenceRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
        mkdirSync(runDir, { recursive: true });
        const log = (fileName, value) =>
          writeFileSync(join(runDir, fileName), typeof value === "string" ? value : JSON.stringify(value, null, 2));
        await runScenarioByName(name, runDir, check, log);
        entry.checks = tee.ok + tee.fail;
        entry.failures = tee.fail;
        entry.passed = tee.fail === 0;
        entry.runDir = runDir;
      } catch (err) {
        entry.checks = tee.ok + tee.fail;
        entry.failures = tee.fail;
        entry.passed = false;
        entry.error = err instanceof Error ? err.message : String(err);
      } finally {
        flush(name);
      }
      summary.scenarios.push(entry);
    }
    summary.failed = summary.scenarios.some((s) => !s.passed);
    summary.failures = summary.scenarios.reduce((total, s) => total + (s.failures ?? 0), 0);
  } finally {
    console.log = realLog;
    console.error = realError;
    writeFileSync(join(allRunDir, "summary.json"), JSON.stringify(summary, null, 2));
  }

  console.log(`\nevidence written to ${allRunDir}`);
  if (summary.failed) {
    const failedNames = summary.scenarios.filter((s) => !s.passed).map((s) => s.scenario).join(", ");
    console.error(`\n${failedNames} scenario(s) failed`);
    process.exit(1);
  }
  console.log("\nall scenarios passed");
}

async function main() {
  const scenario = requireScenario();
  if (scenario === "all") {
    await runAllScenarios();
    return;
  }
  const { check, failureCount } = createChecker();
  const evidenceRoot = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", scenarioEvidenceDir(scenario));
  mkdirSync(evidenceRoot, { recursive: true });
  const runDir = join(evidenceRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const log = (name, value) =>
    writeFileSync(join(runDir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));

  buildBinary(runDir);

  await runScenarioByName(scenario, runDir, check, log);

  console.log(`\nevidence written to ${runDir}`);
  if (failureCount() > 0) {
    console.error(`\n${failureCount()} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
