#!/usr/bin/env node
// Proves the ingestion-side fingerprint contract against the real checker and
// the real ifc-worker: fresh revisions store real per-component digests under a
// recorded profile, a genuine A/B change classifies correctly through
// /api/diff/models, and revisions whose digests predate profiles are refused
// rather than reported unchanged.
//
// Usage: node scripts/verify-fingerprints.mjs

import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BIN_PATH,
  REPO_ROOT,
  buildBinary,
  createChecker,
  freePort,
  runCli,
  stopProcess,
  waitForHealth,
} from "./lib/checker-harness.mjs";

const SENTINEL = "incomplete:waiting-for-normalized-snapshot";

async function startServer(dataDir) {
  const port = await freePort();
  const child = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let logText = "";
  child.stdout.on("data", (chunk) => (logText += chunk));
  child.stderr.on("data", (chunk) => (logText += chunk));
  await waitForHealth(port, { child });
  return { child, base: `http://127.0.0.1:${port}`, getLog: () => logText };
}

async function api(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function upload(base, sourceModelId, filePath, filename) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), filename);
  const created = await api(base, `/api/source-models/${sourceModelId}/revisions`, {
    method: "POST",
    body: form,
  });
  const jobId = created.body?.id ?? created.body?.jobId;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await api(base, `/api/jobs/${jobId}`);
    if (job.body?.status === "completed") return job.body.modelRevisionId ?? job.body.model_revision_id;
    if (job.body?.status === "failed") throw new Error(`ingestion failed: ${JSON.stringify(job.body)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("ingestion timed out");
}

// Node's built-in SQLite reader. Used only to inspect what ingestion actually
// wrote and to forge pre-profile rows; the service is never bypassed for writes
// that the assertions depend on.
function sqliteQuery(dbPath, sql) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).get();
  } finally {
    db.close();
  }
}

function sqliteExec(dbPath, sql) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

async function main() {
  const { check, failureCount } = createChecker();
  const runDir = await mkdtemp(join(tmpdir(), "verify-fp-"));
  buildBinary(runDir);
  const dataDir = join(runDir, "data");
  const server = await startServer(dataDir);
  const { base } = server;

  try {
    runCli(["seed", "--data-dir", dataDir]);
    const projects = await api(base, "/api/projects");
    const projectId = (Array.isArray(projects.body) ? projects.body[0]?.id : null) ?? "demo-project";

    const mk = async (name) => {
      const created = await api(base, `/api/projects/${projectId}/source-models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, discipline: "ARCH" }),
      });
      return created.body.id;
    };
    const baseSource = await mk("Fixture A");
    const headSource = await mk("Fixture B");

    const baseRev = await upload(base, baseSource, join(REPO_ROOT, "packs/demo/fixtures/base.ifc"), "base.ifc");
    const headRev = await upload(base, headSource, join(REPO_ROOT, "packs/demo/fixtures/head.ifc"), "head.ifc");

    const dbPath = join(dataDir, "modelshelf.db");

    // 1. Real digests, not the sentinel, with a recorded profile.
    const sentinel = sqliteQuery(
      dbPath,
      `SELECT COUNT(*) AS n FROM objects WHERE fp_combined = '${SENTINEL}' OR fp_properties = '${SENTINEL}';`,
    );
    check("no freshly ingested object carries the sentinel", sentinel.n === 0, `got ${sentinel.n}`);

    const shapes = sqliteQuery(
      dbPath,
      `SELECT COUNT(*) AS total, COUNT(DISTINCT fp_combined) AS combined,
              COUNT(DISTINCT fp_profile_id) AS profiles,
              SUM(CASE WHEN length(fp_combined) = 64 THEN 1 ELSE 0 END) AS full64
         FROM objects WHERE model_id = '${baseRev}';`,
    );
    check("every base object has a full 64-hex combined digest",
      shapes.total > 0 && shapes.full64 === shapes.total, JSON.stringify(shapes));
    check("one profile id covers the revision", shapes.profiles === 1, JSON.stringify(shapes));
    check("digests actually vary across objects", shapes.combined > 1, JSON.stringify(shapes));

    const components = sqliteQuery(
      dbPath,
      `SELECT COUNT(*) AS n FROM objects WHERE model_id = '${baseRev}'
         AND fp_properties <> fp_placement AND fp_placement <> fp_shape;`,
    );
    check("the three components are independent digests", components.n === shapes.total,
      `${components.n} of ${shapes.total}`);

    // 2. A real A/B change classifies through the live endpoint.
    const deliveryOf = async (sourceModelId, revisionId, label) => {
      const created = await api(base, `/api/projects/${projectId}/deliveries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const deliveryId = created.body.id;
      const member = await api(base, `/api/deliveries/${deliveryId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceModelId, modelRevisionId: revisionId }),
      });
      if (!member.body?.models?.length) {
        throw new Error(`member not attached: ${JSON.stringify(member.body)}`);
      }
      return deliveryId;
    };
    const baseDelivery = await deliveryOf(baseSource, baseRev, "Base drop");
    const headDelivery = await deliveryOf(headSource, headRev, "Head drop");

    const diff = await api(
      base,
      `/api/diff/models?baseDeliveryId=${baseDelivery}&headDeliveryId=${headDelivery}&limit=5000`,
    );
    check("model diff returns 200 for profile-matched revisions", diff.status === 200, JSON.stringify(diff.body).slice(0, 200));
    const summary = diff.body?.pairs?.[0]?.summary ?? {};
    check(
      "the A/B pair reproduces the ticket-12 result",
      summary.moved === 6 && summary.shapeChanged === 3 && summary.propertiesChanged === 3
        && summary.added === 3 && summary.removed === 3,
      JSON.stringify(summary),
    );
    // The pre-fix failure mode was silent: sentinel digests made every matched
    // pair look identical, and a rotation displaces no origin so it survived the
    // sub-threshold forgiveness. Assert the rotations specifically.
    const changes = diff.body?.pairs?.[0]?.changes ?? [];
    const rotated = changes.filter((change) =>
      (change.notes ?? []).some((note) => note.includes("rotation changed")));
    check(
      "rotations are reported as placement changes, not swallowed as unchanged",
      rotated.length === 3 && rotated.every((change) => change.kind === "moved"),
      JSON.stringify(rotated.map((c) => [c.kind, c.notes])).slice(0, 300),
    );
    check(
      "translated objects are measured from the translation column",
      changes.filter((c) => c.kind === "moved" && (c.movedDistanceM ?? 0) > 0).length === 3,
      JSON.stringify(changes.filter((c) => c.kind === "moved").map((c) => c.movedDistanceM)),
    );

    // 3. Pre-profile rows are refused, never reported unchanged.
    sqliteExec(
      dbPath,
      `UPDATE objects SET fp_profile_id = NULL, fp_properties = '${SENTINEL}', fp_placement = '${SENTINEL}',
              fp_shape = '${SENTINEL}', fp_combined = '${SENTINEL}' WHERE model_id = '${headRev}';`,
    );
    const refused = await api(
      base,
      `/api/diff/models?baseDeliveryId=${baseDelivery}&headDeliveryId=${headDelivery}&limit=5000`,
    );
    check("sentinel-era revisions are refused, not compared", refused.status === 409, `status ${refused.status}`);
    check(
      "the refusal names the fingerprint profile as the reason",
      refused.body?.error?.code === "fingerprint_profile_mismatch",
      JSON.stringify(refused.body).slice(0, 200),
    );

    // 4. A different profile is refused too.
    sqliteExec(
      dbPath,
      `UPDATE objects SET fp_profile_id = 'some-other-profile', fp_properties = 'a', fp_placement = 'b',
              fp_shape = 'c', fp_combined = 'd' WHERE model_id = '${headRev}';`,
    );
    const mismatched = await api(
      base,
      `/api/diff/models?baseDeliveryId=${baseDelivery}&headDeliveryId=${headDelivery}&limit=5000`,
    );
    check("a differing profile is refused", mismatched.status === 409, `status ${mismatched.status}`);
    check(
      "the refusal names both profiles",
      typeof mismatched.body?.error?.message === "string"
        && mismatched.body.error.message.includes("some-other-profile"),
      JSON.stringify(mismatched.body).slice(0, 200),
    );
  } finally {
    await stopProcess(server.child);
    await rm(runDir, { recursive: true, force: true });
  }

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
