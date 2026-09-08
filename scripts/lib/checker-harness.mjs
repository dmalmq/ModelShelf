// Shared by scripts/qa-harness.mjs and scripts/verify-api.mjs: building the real
// binary once, an isolated free port per run, a CLI runner, a health-poll helper,
// and a tiny pass/fail tracker — so both scripts prove behavior against the same
// real process the same way instead of each reinventing it slightly differently.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const BIN_PATH = join(REPO_ROOT, "target", "debug", "modelshelf-checker");

export function createChecker() {
  let failures = 0;
  function check(label, condition, detail) {
    if (condition) {
      console.log(`ok - ${label}`);
    } else {
      failures += 1;
      console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
    }
  }
  return { check, failureCount: () => failures };
}

export async function freePort() {
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

export function runCli(args, { cwd = REPO_ROOT } = {}) {
  return spawnSync(BIN_PATH, args, { cwd, encoding: "utf8" });
}

/** `child`, if given, is the spawned server: if it exits while we're still
 * polling, fail immediately with its exit info instead of waiting out the full
 * timeout for a process that will never answer. */
export async function waitForHealth(port, { timeoutMs = 10_000, child } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `server process exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode})`,
      );
    }
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

/** Stops a spawned child robustly: a no-op if it has already exited on its own
 * (checking `.killed` instead — which only reflects "did we call .kill()", not
 * "has it exited" — would then await an "exit" event that already fired once,
 * before we ever attached this listener, and hang forever); SIGTERM with a
 * bounded wait otherwise, escalating to SIGKILL if that wait expires. */
export async function stopProcess(child, { timeoutMs = 5000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!exited && (child.exitCode === null && child.signalCode === null)) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

/** Builds the real binary, logging to `<runDir>/build.log`. Exits the process if
 * the build fails — every caller needs the real binary to do anything at all. */
export function buildBinary(runDir) {
  console.log("building modelshelf-checker...");
  const rustupCargo = join(homedir(), ".cargo", "bin", "cargo");
  const cargo = process.env.CARGO ?? (existsSync(rustupCargo) ? rustupCargo : "cargo");
  const build = spawnSync(cargo, ["build", "-p", "modelshelf-checker"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const output = `${build.stdout ?? ""}${build.stderr ?? ""}${build.error ? `${build.error.message}\n` : ""}`;
  writeFileSync(join(runDir, "build.log"), output);
  if (build.status !== 0 || !existsSync(BIN_PATH)) {
    console.error(`FAIL - cargo build succeeds: exit ${build.status}; see ${join(runDir, "build.log")}`);
    process.exit(1);
  }
  console.log("ok - cargo build succeeds");
}
