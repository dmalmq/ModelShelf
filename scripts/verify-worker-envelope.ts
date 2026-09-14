#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadEnvelopeAjv,
  parseWorkerRequest,
  PROTOCOL_VERSION,
  validateKind,
} from "./lib/worker-envelope.ts";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(REPO_ROOT, "schemas", "worker", "v2");
const KINDS_PATH = join(SCHEMA_DIR, "kinds.json");
const FAKE_WORKER = join(REPO_ROOT, "scripts", "fixtures", "fake-worker.ts");

type KindRow = {
  schema: string;
  python: string | null;
  rust: string;
  dumpKeys: string[];
  valid: string[];
  invalid: string[];
};

type Catalog = {
  protocolVersion: number;
  schemaDir: string;
  modelSchemaDir: string;
  contractDoc: string;
  kinds: KindRow[];
  defs: string[];
};

type DumpPayload = {
  protocolVersion: number;
  goldens: Record<string, unknown>;
  properties: Record<string, string[]>;
};

function fail(reason: string): never {
  console.error(`FAIL - ${reason}`);
  process.exit(1);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      sorted[key] = canonicalize(object[key]);
    }
    return sorted;
  }
  return value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function keySet(values: string[]): string {
  return [...new Set(values)].sort().join(",");
}

function listedSchemaFiles(catalog: Catalog): Set<string> {
  const listed = new Set<string>();
  for (const kind of catalog.kinds) listed.add(kind.schema);
  for (const def of catalog.defs) listed.add(def);
  return listed;
}

function schemaPropertyNames(schemaId: string, schemas: Map<string, Record<string, unknown>>): string[] {
  const schema = schemas.get(schemaId);
  if (!schema) fail(`${schemaId} is not a loaded schema`);
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties as Record<string, unknown>);
}

function loadWorkerSchemas(): Map<string, Record<string, unknown>> {
  const schemas = new Map<string, Record<string, unknown>>();
  for (const name of readdirSync(SCHEMA_DIR)) {
    if (!name.endsWith(".schema.json")) continue;
    schemas.set(name, readJson(join(SCHEMA_DIR, name)) as Record<string, unknown>);
  }
  return schemas;
}

function spawnDump(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): DumpPayload {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as DumpPayload;
  if (typeof parsed.protocolVersion !== "number" || !parsed.goldens || !parsed.properties) {
    throw new Error(`${command} dump JSON is missing protocolVersion/goldens/properties`);
  }
  return parsed;
}

function pythonDump(env?: NodeJS.ProcessEnv): DumpPayload {
  return spawnDump(
    "uv",
    ["run", "--locked", "--project", "services/ifc-worker", "python", "-m", "ifc_worker.envelope_dump"],
    { env },
  );
}

function rustDump(manifestPath = join(REPO_ROOT, "Cargo.toml"), env?: NodeJS.ProcessEnv): DumpPayload {
  return spawnDump(
    "cargo",
    ["run", "-q", "-p", "modelshelf-checker", "--manifest-path", manifestPath, "--", "dump-worker-envelope"],
    { env },
  );
}

function walkFiles(dir: string, skip: Set<string>, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, skip, out);
    else out.push(path);
  }
}

function checkLivePaths(): void {
  const unpublishedName = "worker-v" + "1.md";
  const unpublishedSchema = "schemas/worker-v" + "1";
  if (existsSync(join(REPO_ROOT, "docs", "contracts", unpublishedName))) {
    fail("docs/contracts/" + unpublishedName + " still exists; live contract is worker-v2.md");
  }
  if (!existsSync(join(REPO_ROOT, "docs", "contracts", "worker-v2.md"))) {
    fail("docs/contracts/worker-v2.md is missing");
  }
  if (existsSync(join(REPO_ROOT, unpublishedSchema + ".schema.json"))) {
    fail(unpublishedSchema + ".schema.json must not be published");
  }
  const skip = new Set([
    ".git",
    "node_modules",
    "target",
    "dist",
    ".venv",
    ".omo",
    "reviews",
  ]);
  const files: string[] = [];
  walkFiles(REPO_ROOT, skip, files);
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    if (rel.startsWith("docs/reviews/") || rel === "scripts/verify-worker-envelope.ts") {
      continue;
    }
    let text: string;
    try {
      if (statSync(file).size > 2_000_000) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("docs/contracts/" + unpublishedName) || text.includes(unpublishedName)) {
      hits.push(`${rel} cites ${unpublishedName}`);
    }
    if (text.includes(unpublishedSchema)) {
      hits.push(`${rel} cites ${unpublishedSchema}`);
    }
  }
  if (hits.length > 0) {
    fail(`live unpublished-v1 citations remain: ${hits.join("; ")}`);
  }
}

function checkCatalog(catalog: Catalog): void {
  if (catalog.protocolVersion !== PROTOCOL_VERSION) {
    fail(`kinds.json protocolVersion ${catalog.protocolVersion} != schema const ${PROTOCOL_VERSION}`);
  }
  const protocolSchema = readJson(join(SCHEMA_DIR, "protocol-version.schema.json")) as { const?: unknown };
  if (protocolSchema.const !== PROTOCOL_VERSION) {
    fail("protocol-version.schema.json const drifted from PROTOCOL_VERSION");
  }
  const listed = listedSchemaFiles(catalog);
  for (const name of readdirSync(SCHEMA_DIR)) {
    if (!name.endsWith(".schema.json")) continue;
    if (!listed.has(name)) fail(`unlisted schema file ${name}`);
  }
  for (const name of listed) {
    if (!existsSync(join(SCHEMA_DIR, name))) fail(`kinds.json lists missing ${name}`);
  }
  const renamed = join(SCHEMA_DIR, "fixtures/invalid/schema/request-job-id-renamed.json");
  if (!existsSync(renamed)) fail("request-job-id-renamed.json is missing");
}

function checkAjv(catalog: Catalog): void {
  const ajv = loadEnvelopeAjv();
  if (!ajv.getSchema("artifact-contents.schema.json")) {
    fail("artifact-contents.schema.json did not compile");
  }
  for (const kind of catalog.kinds) {
    for (const rel of kind.valid) {
      const payload = rel.endsWith(".ndjson")
        ? null
        : readJson(join(SCHEMA_DIR, rel));
      if (payload !== null) {
        try {
          validateKind(kind.schema, payload);
        } catch (err) {
          fail(`${rel} should be valid ${kind.schema}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    for (const rel of kind.invalid) {
      const payload = readJson(join(SCHEMA_DIR, rel));
      const validate = ajv.getSchema(kind.schema);
      if (!validate) fail(`no schema registered for ${kind.schema}`);
      if (validate(payload)) {
        fail(`${rel} should fail ${kind.schema}`);
      }
    }
  }
  const ndjson = readFileSync(join(SCHEMA_DIR, "fixtures/valid/stdout-inspect.ndjson"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  for (const [index, line] of ndjson.entries()) {
    try {
      validateKind("stdout-event.schema.json", JSON.parse(line));
    } catch (err) {
      fail(`stdout-inspect.ndjson line ${index + 1}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function checkDumps(catalog: Catalog, python: DumpPayload, rust: DumpPayload): void {
  if (python.protocolVersion !== PROTOCOL_VERSION) {
    fail(`python dump protocolVersion ${python.protocolVersion} != ${PROTOCOL_VERSION}`);
  }
  if (rust.protocolVersion !== PROTOCOL_VERSION) {
    fail(`rust dump protocolVersion ${rust.protocolVersion} != ${PROTOCOL_VERSION}`);
  }
  const schemas = loadWorkerSchemas();
  for (const kind of catalog.kinds) {
    for (const rel of kind.valid) {
      if (!rel.endsWith(".json")) continue;
      const dumpKey = rel.split("/").pop()?.replace(/\.json$/, "");
      if (!dumpKey) continue;
      const golden = readJson(join(SCHEMA_DIR, rel));
      if (!deepEqual(python.goldens[dumpKey], golden)) {
        fail(`python dump ${dumpKey} drifted from ${rel}`);
      }
      if (!deepEqual(rust.goldens[dumpKey], golden)) {
        fail(`rust dump ${dumpKey} drifted from ${rel}`);
      }
    }
    if (!kind.python) continue;
    const schemaKeys = keySet(schemaPropertyNames(kind.schema, schemas));
    const pythonKeys = keySet(python.properties[kind.schema] ?? []);
    const rustKeys = keySet(rust.properties[kind.schema] ?? []);
    if (schemaKeys !== pythonKeys) {
      fail(`property set ${kind.schema}: schema {${schemaKeys}} != python {${pythonKeys}}`);
    }
    if (schemaKeys !== rustKeys) {
      fail(`property set ${kind.schema}: schema {${schemaKeys}} != rust {${rustKeys}}`);
    }
  }
}

function checkFakeWorker(): void {
  const tmp = mkdtempSync(join(tmpdir(), "worker-envelope-fake-"));
  try {
    const outputDir = join(tmp, "out");
    mkdirSync(outputDir);
    const inspect = readJson(join(SCHEMA_DIR, "fixtures/valid/request-inspect.json")) as {
      outputDir: string;
      model: { path: string };
    };
    inspect.outputDir = outputDir;
    inspect.model.path = join(tmp, "unused.ifc");
    const requestPath = join(tmp, "request.json");
    writeFileSync(requestPath, JSON.stringify(inspect));
    parseWorkerRequest(JSON.parse(readFileSync(requestPath, "utf8")));
    const result = spawnSync(process.execPath, [FAKE_WORKER, "slow-success", "--request", requestPath], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { ...process.env, FAKE_WORKER_DELAY_MS: "0" },
    });
    if (result.status !== 0) {
      fail(`fake-worker slow-success exited ${result.status}: ${result.stderr}`);
    }
    const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      validateKind("stdout-event.schema.json", JSON.parse(line));
    }
    const manifest = readJson(join(outputDir, "manifest.json"));
    validateKind("manifest.schema.json", manifest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function check(): void {
  const catalog = readJson(KINDS_PATH) as Catalog;
  checkCatalog(catalog);
  checkLivePaths();
  checkAjv(catalog);
  let python: DumpPayload;
  let rust: DumpPayload;
  try {
    python = pythonDump();
  } catch (err) {
    fail(`python dump: ${err instanceof Error ? err.message : err}`);
  }
  try {
    rust = rustDump();
  } catch (err) {
    fail(`rust dump: ${err instanceof Error ? err.message : err}`);
  }
  checkDumps(catalog, python, rust);
  try {
    checkFakeWorker();
  } catch (err) {
    fail(`fake-worker: ${err instanceof Error ? err.message : err}`);
  }
  console.log("ok - worker envelope dump-lock");
}

function copyRustWorkspace(dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of ["Cargo.toml", "Cargo.lock"]) {
    cpSync(join(REPO_ROOT, name), join(dest, name));
  }
  cpSync(join(REPO_ROOT, "crates"), join(dest, "crates"), { recursive: true });
  cpSync(join(REPO_ROOT, "services", "checker"), join(dest, "services", "checker"), {
    recursive: true,
    filter: (src) => !src.includes("/target/"),
  });
}

function proveRename(): void {
  const tmp = mkdtempSync(join(tmpdir(), "worker-envelope-rename-"));
  let detected = false;
  const reasons: string[] = [];
  try {
    const pyRoot = join(tmp, "python");
    mkdirSync(pyRoot);
    cpSync(join(REPO_ROOT, "services/ifc-worker/src/ifc_worker"), join(pyRoot, "ifc_worker"), {
      recursive: true,
    });
    const protocol = join(pyRoot, "ifc_worker", "protocol.py");
    writeFileSync(protocol, readFileSync(protocol, "utf8").replaceAll("jobId", "taskId"));
    try {
      const python = spawnDump("uv", [
        "run",
        "--locked",
        "--project",
        "services/ifc-worker",
        "python",
        "-c",
        [
          "import json, sys",
          `sys.path.insert(0, ${JSON.stringify(pyRoot)})`,
          "from ifc_worker.envelope_dump import dump_envelope_goldens",
          "print(json.dumps(dump_envelope_goldens()))",
        ].join("; "),
      ]);
      const golden = readJson(join(SCHEMA_DIR, "fixtures/valid/request-inspect.json"));
      if (!deepEqual(python.goldens["request-inspect"], golden)) {
        detected = true;
        reasons.push("python dump no longer matches request-inspect.json");
      } else {
        reasons.push("python dump still matched after jobId rename");
      }
    } catch (err) {
      detected = true;
      reasons.push(`python dump failed after rename: ${err instanceof Error ? err.message : err}`);
    }

    const rustRoot = join(tmp, "rust");
    copyRustWorkspace(rustRoot);
    const rustFile = join(rustRoot, "services/checker/src/worker_envelope.rs");
    writeFileSync(
      rustFile,
      readFileSync(rustFile, "utf8").replaceAll('rename = "jobId"', 'rename = "taskId"'),
    );
    try {
      const rust = rustDump(join(rustRoot, "Cargo.toml"), {
        ...process.env,
        CARGO_TARGET_DIR: join(REPO_ROOT, "target"),
      });
      const golden = readJson(join(SCHEMA_DIR, "fixtures/valid/request-inspect.json"));
      if (!deepEqual(rust.goldens["request-inspect"], golden)) {
        detected = true;
        reasons.push("rust dump no longer matches request-inspect.json");
      } else {
        reasons.push("rust dump still matched after jobId rename");
      }
    } catch (err) {
      detected = true;
      reasons.push(`rust dump failed after rename: ${err instanceof Error ? err.message : err}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!detected) {
    console.error(`FAIL - rename was not detected (${reasons.join("; ")})`);
    process.exit(2);
  }
  console.error(`FAIL - ${reasons.join("; ")}`);
  process.exit(1);
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const flag = argv[0];
  if (flag === "--prove-rename") {
    proveRename();
    return;
  }
  if (flag !== "--check") {
    console.error("usage: node scripts/verify-worker-envelope.ts --check|--prove-rename");
    process.exit(2);
  }
  check();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
