#!/usr/bin/env node
// Smoke-tests the modelshelf-checker service against a real, isolated process:
// build, seed twice, start serve, hit /api/health twice, reject an unknown CLI
// command, then tear everything down. Every process/port/data-dir it touches is
// its own; nothing here reads or deletes anything outside its own temp dir and
// evidence dir.
//
// Usage: node scripts/qa-harness.mjs

import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EVIDENCE_DIR = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "task-1");
const BIN_PATH = join(REPO_ROOT, "target", "debug", "modelshelf-checker");

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function runCli(args, { cwd = REPO_ROOT } = {}) {
  return spawnSync(BIN_PATH, args, { cwd, encoding: "utf8" });
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // service not accepting connections yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`service did not become healthy within ${timeoutMs}ms`);
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const runDir = join(EVIDENCE_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });

  console.log("building modelshelf-checker...");
  const build = spawnSync("cargo", ["build", "-p", "modelshelf-checker"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  writeFileSync(join(runDir, "build.log"), build.stdout + build.stderr);
  check("cargo build succeeds", build.status === 0, `exit ${build.status}`);
  if (build.status !== 0 || !existsSync(BIN_PATH)) {
    console.error("cannot continue without a built binary; see build.log");
    process.exit(1);
  }

  const dataDir = mkdtempSync(join(tmpdir(), "modelshelf-qa-data-"));
  const packsDir = mkdtempSync(join(tmpdir(), "modelshelf-qa-packs-"));
  let serverProcess;

  try {
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

    // --- seed twice against the same fresh data dir: one copy of each entity ---
    const seed1 = runCli(["seed", "--data-dir", dataDir, "--packs-dir", packsDir, "--samples-dir", packsDir]);
    const seed2 = runCli(["seed", "--data-dir", dataDir, "--packs-dir", packsDir, "--samples-dir", packsDir]);
    writeFileSync(
      join(runDir, "seed.log"),
      `--- run 1 ---\n${seed1.stdout}${seed1.stderr}\n--- run 2 ---\n${seed2.stdout}${seed2.stderr}`,
    );
    check("first seed exits zero", seed1.status === 0, `exit ${seed1.status}`);
    check("second seed exits zero", seed2.status === 0, `exit ${seed2.status}`);
    check(
      "seed is idempotent (same ids, no growth reported)",
      seed1.stdout.trim() === seed2.stdout.trim(),
      `run1=${seed1.stdout.trim()} run2=${seed2.stdout.trim()}`,
    );

    // --- serve starts on an isolated, unused port; health responds; projects/packs read back one each ---
    const port = await freePort();
    serverProcess = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(port)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverLog = "";
    serverProcess.stdout.on("data", (chunk) => (serverLog += chunk));
    serverProcess.stderr.on("data", (chunk) => (serverLog += chunk));

    const health = await waitForHealth(port);
    check("health responds with status ok", health.status === "ok", JSON.stringify(health));
    check("health reports engine/parser/schema versions", Boolean(health.engineVersion && health.parserVersion && health.schemaVersion), JSON.stringify(health));

    const projects = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
    check("exactly one seeded project", Array.isArray(projects) && projects.length === 1, JSON.stringify(projects));

    const packs = await (await fetch(`http://127.0.0.1:${port}/api/packs`)).json();
    check("exactly one seeded pack", Array.isArray(packs) && packs.length === 1, JSON.stringify(packs));

    writeFileSync(join(runDir, "serve.log"), serverLog);
    writeFileSync(join(runDir, "health-response.json"), JSON.stringify(health, null, 2));
    writeFileSync(join(runDir, "projects-response.json"), JSON.stringify(projects, null, 2));
    writeFileSync(join(runDir, "packs-response.json"), JSON.stringify(packs, null, 2));
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => serverProcess.once("exit", resolve));
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(packsDir, { recursive: true, force: true });
  }

  console.log(`\nevidence written to ${runDir}`);
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
