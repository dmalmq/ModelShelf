import { Ajv2020 } from "ajv/dist/2020.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const WORKER_SCHEMA_DIR = join(REPO_ROOT, "schemas", "worker", "v2");
const MODEL_SCHEMA_DIR = join(REPO_ROOT, "schemas", "model", "v1");

function loadProtocolVersionFromSchema(): 2 {
  const schema = JSON.parse(
    readFileSync(join(WORKER_SCHEMA_DIR, "protocol-version.schema.json"), "utf8"),
  ) as { const?: unknown };
  if (schema.const !== 2) {
    throw new Error("protocol-version.schema.json const must be 2");
  }
  return 2;
}

export const PROTOCOL_VERSION: 2 = loadProtocolVersionFromSchema();

export type WorkerRequest = {
  protocolVersion: 2;
  jobId: string;
  operation: "inspect" | "validate";
  model: { path: string; sha256: string; revisionId: string };
  ids: null | { path: string; sha256: string; specificationIds: string[] | null };
  outputDir: string;
  settings: { geometry: boolean };
};

let cachedAjv: Ajv2020 | undefined;

function schemaFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".schema.json"));
}

export function loadEnvelopeAjv(): Ajv2020 {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const file of schemaFiles(WORKER_SCHEMA_DIR)) {
    ajv.addSchema(JSON.parse(readFileSync(join(WORKER_SCHEMA_DIR, file), "utf8")));
  }
  for (const file of schemaFiles(MODEL_SCHEMA_DIR)) {
    ajv.addSchema(JSON.parse(readFileSync(join(MODEL_SCHEMA_DIR, file), "utf8")));
  }
  cachedAjv = ajv;
  return ajv;
}

function formatAjvErrors(errors: unknown): string {
  const list = (errors ?? []) as Array<{ instancePath: string; message?: string }>;
  return list.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ");
}

export function validateKind(schemaId: string, payload: unknown): void {
  const validate = loadEnvelopeAjv().getSchema(schemaId);
  if (!validate) {
    throw new Error(`no schema registered for ${schemaId}`);
  }
  if (!validate(payload)) {
    throw new Error(`${schemaId}: ${formatAjvErrors(validate.errors)}`);
  }
}

export function parseWorkerRequest(payload: unknown): WorkerRequest {
  try {
    validateKind("request.schema.json", payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid worker request: ${message}`);
  }
  return payload as WorkerRequest;
}
