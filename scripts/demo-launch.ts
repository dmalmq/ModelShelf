#!/usr/bin/env node
// One-command local ModelShelf demo launcher (ticket 16): builds the checker,
// seeds the demo data directory, serves the API with the pinned real worker,
// starts the Next.js web app, and shuts both children down on SIGINT/SIGTERM.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { BIN_PATH, REPO_ROOT, stopProcess, waitForHealth } from "./lib/checker-harness.ts";

const DEFAULT_DATA_DIR = "./data";
const DEFAULT_PORT = 8787;
const WEB_PORT = 3210;
// The pinned real worker (IfcOpenShell/IfcTester ==0.8.5); `{request}` is
// replaced by the checker with the absolute path to the job's request.json.
const WORKER_COMMAND = "uv run --locked --project services/ifc-worker ifc-worker --request {request}";
const CARGO_PATH = process.env.CARGO ?? (
  existsSync(join(homedir(), ".cargo", "bin", "cargo")) ? join(homedir(), ".cargo", "bin", "cargo") : "cargo"
);

function usage() {
  console.log(`usage: node scripts/demo-launch.ts [options]

Starts the complete ModelShelf local demo: builds the checker, seeds the
demo data, serves the API, launches the web app, and stops both services on
SIGINT/SIGTERM or when either child exits unexpectedly.

Options:
  --data-dir <dir>   data directory to seed and serve (default: ${DEFAULT_DATA_DIR})
  --port <port>      port for the checker API (default: ${DEFAULT_PORT})
  --help             show this help and exit

The launcher sets CHECKER_ORIGIN to the selected API origin.
`);
}

function parseArgs(argv) {
  const options = { dataDir: DEFAULT_DATA_DIR, port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help") {
      options.help = true;
      return options;
    }
    if (flag === "--data-dir") {
      const value = argv[i + 1];
      if (!value) {
        console.error("--data-dir needs a value");
        process.exit(2);
      }
      options.dataDir = value;
      i += 1;
    } else if (flag === "--port") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        console.error("--port needs a positive integer");
        process.exit(2);
      }
      options.port = value;
      i += 1;
    } else {
      console.error(`unknown flag: ${flag}`);
      usage();
      process.exit(2);
    }
  }
  return options;
}

function resolveDataDir(value) {
  return isAbsolute(value) ? value : join(REPO_ROOT, value);
}

/** Polls the given origin/page until it answers with an ok status. */
async function waitForWeb(port, { child, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`web dev server exited before answering (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {
      // not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`http://127.0.0.1:${port} did not answer within ${timeoutMs}ms`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const dataDir = resolveDataDir(options.dataDir);
  const port = options.port;
  const apiOrigin = `http://127.0.0.1:${port}`;

  let serveProcess;
  let webProcess;
  let shuttingDown = false;
  async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nstopping ModelShelf demo...");
    await stopProcess(webProcess);
    await stopProcess(serveProcess);
    console.log("demo stopped");
    process.exit(exitCode);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  function watchForUnexpectedExit(name, child) {
    let observed = false;
    const report = (reason) => {
      if (observed || shuttingDown) return;
      observed = true;
      console.error(`\n${name} exited unexpectedly (${reason}).`);
      void shutdown(1);
    };
    child.once("error", (error) => report(`spawn error: ${error.message}`));
    child.once("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      report(reason);
    });
    if (child.exitCode !== null || child.signalCode !== null) {
      const reason = child.signalCode ? `signal ${child.signalCode}` : `exit code ${String(child.exitCode)}`;
      report(reason);
    }
  }

  // 1. build the checker once
  console.log("building modelshelf-checker...");
  const build = spawnSync(CARGO_PATH, ["build", "-p", "modelshelf-checker"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (build.status !== 0) {
    console.error("cargo build failed; re-run with: cargo build -p modelshelf-checker");
    process.exit(1);
  }

  // 2. seed the demo tenant/project/pack idempotently
  console.log(`seeding ${dataDir}...`);
  const seed = spawnSync(
    BIN_PATH,
    ["seed", "--data-dir", dataDir, "--packs-dir", "packs/demo", "--samples-dir", "samples/ifc"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  if (seed.status !== 0) {
    console.error(`seed failed (exit ${seed.status}); re-run with: ${BIN_PATH} seed --data-dir ${dataDir} --packs-dir packs/demo --samples-dir samples/ifc`);
    process.exit(1);
  }

  // 3. serve the API with the pinned real worker
  serveProcess = spawn(
    BIN_PATH,
    ["serve", "--data-dir", dataDir, "--port", String(port), "--worker-command", WORKER_COMMAND],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  watchForUnexpectedExit("checker", serveProcess);
  try {
    await waitForHealth(port, { child: serveProcess, timeoutMs: 15_000 });
  } catch (err) {
    if (serveProcess.exitCode === null && serveProcess.signalCode === null) await stopProcess(serveProcess);
    console.error(err.message);
    process.exit(1);
  }
  console.log(`API healthy at ${apiOrigin}`);

  // 4. start the web app (Next on 3210), pointed at this API
  webProcess = spawn("npm", ["--prefix", "apps/web", "run", "dev"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CHECKER_ORIGIN: apiOrigin },
    stdio: "inherit",
  });
  watchForUnexpectedExit("web", webProcess);
  try {
    await waitForWeb(WEB_PORT, { child: webProcess });
  } catch (err) {
    await stopProcess(webProcess);
    await stopProcess(serveProcess);
    console.error(err.message);
    process.exit(1);
  }

  // 5. demo URLs and stop instructions
  console.log(`
ModelShelf demo is running.

  Shelf:      http://127.0.0.1:${WEB_PORT}/
  Compare:    http://127.0.0.1:${WEB_PORT}/deliveries/compare

  API:   ${apiOrigin}
  Data:  ${dataDir}

Stop the demo with Ctrl-C (SIGINT).`);

  // Idle until a signal arrives; the timer keeps the event loop alive.
  while (!shuttingDown) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});