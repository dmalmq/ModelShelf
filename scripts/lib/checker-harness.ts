// Shared by scripts/qa-harness.ts and scripts/verify-api.ts: building the real
// binary once, an isolated free port per run, a CLI runner, a health-poll helper,
// and a tiny pass/fail tracker — so both scripts prove behavior against the same
// real process the same way instead of each reinventing it slightly differently.

import { spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const BIN_PATH = join(REPO_ROOT, "target", "debug", "modelshelf-checker");

export type CheckFn = (label: string, condition: unknown, detail?: string) => void;

export function createChecker(): { check: CheckFn; failureCount: () => number } {
  let failures = 0;
  function check(label: string, condition: unknown, detail?: string) {
    if (condition) {
      console.log(`ok - ${label}`);
    } else {
      failures += 1;
      console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
    }
  }
  return { check, failureCount: () => failures };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("expected a TCP port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export function runCli(
  args: readonly string[],
  { cwd = REPO_ROOT }: { cwd?: string } = {},
): SpawnSyncReturns<string> {
  return spawnSync(BIN_PATH, [...args], { cwd, encoding: "utf8" });
}

/** `child`, if given, is the spawned server: if it exits while we're still
 * polling, fail immediately with its exit info instead of waiting out the full
 * timeout for a process that will never answer. */
export async function waitForHealth(
  port: number,
  { timeoutMs = 10_000, child }: { timeoutMs?: number; child?: ChildProcess } = {},
): Promise<unknown> {
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
export async function stopProcess(
  child: ChildProcess | null | undefined,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

/** Builds the real binary, logging to `<runDir>/build.log`. Exits the process if
 * the build fails — every caller needs the real binary to do anything at all. */
export function buildBinary(runDir: string): void {
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

export type WorkerSync = {
  readonly ok: boolean;
  readonly status: number | null;
  readonly elapsedMs: number;
  readonly errorMessage: string | null;
};

/**
 * Always writes worker-sync evidence, then throws on failure so the caller
 * finally still flushes. Does not tee a CheckFn row into the api all log.
 */
export function preSyncIfcWorker(runDir: string): WorkerSync {
  const started = Date.now();
  const result = spawnSync("uv", ["sync", "--locked", "--project", "services/ifc-worker"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const elapsedMs = Date.now() - started;
  const errorMessage = result.error?.message ?? null;
  const status = result.status;
  const ok = status === 0 && result.error === undefined;
  writeFileSync(
    join(runDir, "worker-sync.log"),
    `${result.stdout ?? ""}${result.stderr ?? ""}${errorMessage ? `${errorMessage}\n` : ""}elapsedMs=${elapsedMs}\n`,
  );
  writeFileSync(join(runDir, "worker-sync.json"), `${JSON.stringify({ ok, status, elapsedMs })}\n`);
  if (!ok) {
    throw new Error(`worker pre-sync failed: status=${status} elapsedMs=${elapsedMs}`);
  }
  return { ok, status, elapsedMs, errorMessage };
}
