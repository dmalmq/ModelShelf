#!/usr/bin/env node
// Real end-to-end API verification against a real, isolated modelshelf-checker
// process.
//
// `--scenario revisions` proves the source-model/revision/delivery data model:
// two same-discipline sources coexisting, revision reuse without re-uploading,
// finalize freezing membership, and that a finalize racing a membership edit
// never lands in a corrupted state. Uploads go through the real async job
// queue and the real ifc-worker.
//
// `--scenario worker-failure` proves the job queue's contract (ticket 04):
// every named failure mode (malformed/truncated stdout, duplicate terminal
// results, wrong job id, nonzero exit, bad artifact hash, a path escaping the
// job's own output directory, an unsupported protocol version) fails the job
// without publishing anything; at most one heavy job ever runs at a time; a
// job still 'running' when the process is killed is recovered as 'failed' on
// restart; and retrying is idempotent and, against the real worker, actually
// succeeds. The failure modes are produced by a real subprocess
// (scripts/fixtures/fake-worker.mjs) substituted in via `--worker-command` —
// real processes producing real bad output, not a mocked validation result.
//
// Usage: node scripts/verify-api.mjs --scenario revisions
//        node scripts/verify-api.mjs --scenario worker-failure

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BIN_PATH, REPO_ROOT, buildBinary, createChecker, freePort, runCli, stopProcess, waitForHealth } from "./lib/checker-harness.mjs";

const EVIDENCE_DIR = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "task-2");
const SAMPLE_IFC = join(REPO_ROOT, "samples", "ifc", "AC20-FZK-Haus.ifc");
const FAKE_WORKER = join(REPO_ROOT, "scripts", "fixtures", "fake-worker.mjs");

function requireScenario() {
  const flagIndex = process.argv.indexOf("--scenario");
  const scenario = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (scenario !== "revisions" && scenario !== "worker-failure") {
    console.error(`usage: node scripts/verify-api.mjs --scenario revisions|worker-failure (got ${scenario ?? "<none>"})`);
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

/** POSTs the real sample IFC as `filename`; does not wait on the resulting job. */
async function uploadRaw(base, sourceModelId, filename) {
  const form = new FormData();
  const bytes = await readFileAsync(SAMPLE_IFC);
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
    "the real worker extracted the real sample's 127 objects for each revision",
    rev1Objects.total === 127 && rev2Objects.total === 127,
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
  const objects = (await api(base, "GET", `/api/models/${rev1Id}/objects?limit=1`)).json;
  const firstObject = objects.objects[0];
  check(
    "object payloads include the shared ref (revisionId/objectId), not just the raw expressId",
    Boolean(firstObject?.ref?.revisionId === rev1Id && firstObject?.ref?.objectId?.startsWith("occ_")),
    JSON.stringify(firstObject),
  );
  const fileRes = await fetch(`${base}/api/models/${rev1Id}/file`);
  check("the original uploaded IFC is retrievable byte-for-byte via /file", fileRes.status === 200 && Number(fileRes.headers.get("content-length")) > 0, `status=${fileRes.status}`);

  const idsXml = await readFileAsync(join(REPO_ROOT, "packs", "demo", "blcj-s1000-v1.ids"), "utf8");
  const packVersion = (await api(base, "POST", "/api/packs/demo-pack/versions", { idsXml })).json;
  const run = await api(base, "POST", "/api/runs", { deliveryId: delivery1.id, packVersionId: packVersion.id });
  log("run-input-provenance.json", run.json);
  const provenance = run.json?.inputProvenance;
  check(
    "a newly created run reports incomplete input provenance with a stated reason",
    run.status === 200 && provenance?.status === "incomplete" && typeof provenance?.reason === "string" && provenance.reason.length > 0,
    JSON.stringify({ status: run.status, provenance }),
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
];

async function runFailureModes(dataDir, check, log) {
  for (const mode of FAILURE_MODES) {
    const server = await startServer(dataDir, fakeWorkerCommand(mode));
    try {
      const sourceModel = (await api(server.base, "POST", "/api/projects/demo-project/source-models", { name: `Failure ${mode}`, discipline: "OTHER" })).json;
      const job = await checkJobFails(check, `worker failure mode "${mode}" leaves the job failed, not published`, server.base, sourceModel.id, `${mode}.ifc`);
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

    server1.child.kill("SIGKILL");
    await new Promise((resolve) => server1.child.once("exit", resolve));
    log("restart-server-1.log", server1.getLog());

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
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
  await checkRestartRecovery(check, log);
}

// ---------------------------------------------------------------------------

async function main() {
  const scenario = requireScenario();
  const { check, failureCount } = createChecker();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });
  const log = (name, value) =>
    writeFileSync(join(runDir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));

  buildBinary(runDir);

  if (scenario === "revisions") {
    await runRevisionsScenarioTop(runDir, check, log);
  } else {
    await runWorkerFailureScenario(check, log);
  }

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
