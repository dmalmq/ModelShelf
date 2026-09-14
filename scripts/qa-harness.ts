#!/usr/bin/env node
// Smoke-tests the modelshelf-checker service against a real, isolated process:
// build, seed twice (with packs/demo/fixtures.ids, so pack-version idempotency
// is actually exercised, not just the empty-packs-dir no-op case), start serve, hit
// /api/health twice, reject an unknown CLI command, then tear everything down.
// Every process/port/data-dir it touches is its own; nothing here reads or
// deletes anything outside its own temp dir and evidence dir. Cleanup and log
// capture happen in `finally`, so a server that crashes before answering health
// still gets its log written and its temp dirs removed, not left as orphans.
//
// Usage: node scripts/qa-harness.ts

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BIN_PATH, REPO_ROOT, buildBinary, createChecker, freePort, runCli, stopProcess, waitForHealth } from "./lib/checker-harness.ts";

const ORACLE = join(REPO_ROOT, "packs", "demo", "fixtures", "oracle.json");

const EVIDENCE_DIR = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "task-1");
const SAMPLE_IDS =
  process.env.MODELSHELF_QA_IDS ?? join(REPO_ROOT, "packs", "demo", "fixtures.ids");

async function main() {
  const { check, failureCount } = createChecker();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });

  buildBinary(runDir);

  let dataDir;
  let packsDir;
  let serverProcess;
  let serverLog = "";

  try {
    const empty = JSON.parse(readFileSync(ORACLE, "utf8")).proofs.empty_catalog;
    const missingPath = join(tmpdir(), `modelshelf-qa-missing-${process.pid}`);
    if (existsSync(missingPath)) {
      throw new Error(`missing-path fixture already exists: ${missingPath}`);
    }
    await assertHonestEmpty(check, missingPath, "missing path", empty);
    await assertHonestEmpty(check, mkdtempSync(join(tmpdir(), "modelshelf-qa-unseeded-")), "unseeded dir", empty);

    dataDir = mkdtempSync(join(tmpdir(), "modelshelf-qa-data-"));
    packsDir = mkdtempSync(join(tmpdir(), "modelshelf-qa-packs-"));
    if (!existsSync(SAMPLE_IDS)) {
      throw new Error(`seed IDS fixture is missing: ${SAMPLE_IDS}`);
    }
    cpSync(SAMPLE_IDS, join(packsDir, "sample.ids"));
    // --- unknown CLI command exits nonzero with usage ---
    const bogus = runCli(["definitely-not-a-command"]);
    check("unknown command exits nonzero", bogus.status !== 0, `exit ${bogus.status}`);
    check(
      "unknown command prints usage",
      /USAGE/.test(bogus.stdout + bogus.stderr),
      "no USAGE text in output",
    );
    writeFileSync(join(runDir, "invalid-cli.log"), (bogus.stdout ?? "") + (bogus.stderr ?? ""));

    // --- --help exits zero with usage ---
    const help = runCli(["--help"]);
    check("--help exits zero", help.status === 0, `exit ${help.status}`);
    check("--help prints usage", /USAGE/.test(help.stdout + help.stderr), "no USAGE text in output");

    // --- seed twice against the same fresh data dir, with a real pack file: one
    // copy of each entity, including pack *versions* (not just tenant/project/pack) ---
    const seed1 = runCli(["seed", "--data-dir", dataDir, "--packs-dir", packsDir, "--samples-dir", packsDir]);
    const seed2 = runCli(["seed", "--data-dir", dataDir, "--packs-dir", packsDir, "--samples-dir", packsDir]);
    writeFileSync(
      join(runDir, "seed.log"),
      `--- run 1 ---\n${seed1.stdout}${seed1.stderr}\n--- run 2 ---\n${seed2.stdout}${seed2.stderr}`,
    );
    check("first seed exits zero", seed1.status === 0, `exit ${seed1.status}`);
    check("second seed exits zero", seed2.status === 0, `exit ${seed2.status}`);
    check(
      "first seed adds one pack version, second seed adds none (idempotent)",
      /\(\+1 pack version\(s\)\)/.test(seed1.stdout) && /\(\+0 pack version\(s\)\)/.test(seed2.stdout),
      `run1=${seed1.stdout.trim()} run2=${seed2.stdout.trim()}`,
    );

    // --- serve starts on an isolated, unused port; health responds; projects/packs
    // read back one each, and the pack has exactly one version (not two) ---
    const port = await freePort();
    serverProcess = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (chunk) => (serverLog += chunk));
    serverProcess.stderr.on("data", (chunk) => (serverLog += chunk));

    const health = await waitForHealth(port, { child: serverProcess });
    check("health responds with status ok", health.status === "ok", JSON.stringify(health));
    check("health reports engine/parser/schema versions", Boolean(health.engineVersion && health.parserVersion && health.schemaVersion), JSON.stringify(health));

    const projects = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    check("exactly one seeded project", Array.isArray(projects) && projects.length === 1, JSON.stringify(projects));

    const packs = await (await fetch(`http://127.0.0.1:${port}/api/packs`)).json();
    check("exactly one seeded pack", Array.isArray(packs) && packs.length === 1, JSON.stringify(packs));
    check(
      "the pack has exactly one version despite two seed runs",
      packs[0]?.versions?.length === 1,
      JSON.stringify(packs[0]?.versions),
    );

    writeFileSync(join(runDir, "health-response.json"), JSON.stringify(health, null, 2));
    writeFileSync(join(runDir, "projects-response.json"), JSON.stringify(projects, null, 2));
    writeFileSync(join(runDir, "packs-response.json"), JSON.stringify(packs, null, 2));
  } finally {
    await stopProcess(serverProcess);
    writeFileSync(join(runDir, "serve.log"), serverLog);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (packsDir) rmSync(packsDir, { recursive: true, force: true });
  }

  console.log(`\nevidence written to ${runDir}`);
  if (failureCount() > 0) {
    console.error(`\n${failureCount()} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

async function serveBare(dataDir: string): Promise<{ port: number; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth(port, { child });
  return { port, child };
}

async function listCatalog(port: number): Promise<{ projects: unknown[]; packs: unknown[] }> {
  const projects = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
  const packs = await (await fetch(`http://127.0.0.1:${port}/api/packs`)).json();
  return { projects, packs };
}

async function assertHonestEmpty(
  check: (label: string, condition: unknown, detail?: string) => void,
  dataDir: string,
  label: string,
  expected: { projects: number; packs: number },
): Promise<void> {
  let child: ChildProcess | undefined;
  try {
    const served = await serveBare(dataDir);
    child = served.child;
    const catalog = await listCatalog(served.port);
    check(
      `${label}: GET /api/projects length ${expected.projects}`,
      Array.isArray(catalog.projects) && catalog.projects.length === expected.projects,
      JSON.stringify(catalog.projects),
    );
    check(
      `${label}: GET /api/packs length ${expected.packs}`,
      Array.isArray(catalog.packs) && catalog.packs.length === expected.packs,
      JSON.stringify(catalog.packs),
    );
  } finally {
    await stopProcess(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
