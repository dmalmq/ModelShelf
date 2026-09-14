import type {
  Delivery,
  DeliveryDetail,
  Discipline,
  ModelInfo,
  ProcessingVersions,
  RunStatus,
  RunSummary,
} from "@/lib/types";

export async function fetchDelivery(deliveryId: string, signal?: AbortSignal): Promise<DeliveryDetail> {
  if (deliveryId.trim().length === 0) throw new Error("deliveryId must not be empty");

  const response = await fetch(`/api/deliveries/${encodeURIComponent(deliveryId)}`, { signal });
  if (!response.ok) throw new Error(`Delivery request failed with HTTP ${response.status}`);
  return parseDeliveryDetail(await response.json());
}

export function parseDeliveryDetail(value: unknown): DeliveryDetail {
  const record = requireRecord(value, "Delivery response");
  const delivery = parseDelivery(record.delivery);
  if (!Array.isArray(record.models)) throw new Error("Delivery response models must be an array");
  if (!Array.isArray(record.runs)) throw new Error("Delivery response runs must be an array");
  if (typeof record.locked !== "boolean") throw new Error("Delivery response locked must be boolean");

  const models = record.models.map(parseModel);
  const revisionIds = new Set<string>();
  for (const model of models) {
    if (model.deliveryId !== delivery.id) {
      throw new Error(`Model ${model.id} belongs to a different delivery`);
    }
    if (revisionIds.has(model.id)) throw new Error(`Delivery contains revision ${model.id} twice`);
    revisionIds.add(model.id);
  }

  return {
    delivery,
    models,
    runs: record.runs.map(parseRun),
    locked: record.locked,
  };
}

function parseDelivery(value: unknown): Delivery {
  const record = requireRecord(value, "Delivery payload");
  return {
    id: stringValue(record.id, "delivery.id"),
    projectId: stringValue(record.projectId, "delivery.projectId"),
    label: stringValue(record.label, "delivery.label"),
    deliveryDate: nullableString(record.deliveryDate, "delivery.deliveryDate"),
    createdAt: stringValue(record.createdAt, "delivery.createdAt"),
    finalizedAt: nullableString(record.finalizedAt, "delivery.finalizedAt"),
    modelCount: integerValue(record.modelCount, "delivery.modelCount"),
    productCount: integerValue(record.productCount, "delivery.productCount"),
  };
}

function parseModel(value: unknown): ModelInfo {
  const record = requireRecord(value, "Model payload");
  const lengthToMetre = numberValue(record.lengthToMetre, "model.lengthToMetre");
  if (lengthToMetre <= 0) throw new Error("model.lengthToMetre must be positive");

  return {
    id: nonEmptyString(record.id, "model.id"),
    deliveryId: stringValue(record.deliveryId, "model.deliveryId"),
    discipline: disciplineValue(record.discipline),
    sourceModelId: stringValue(record.sourceModelId, "model.sourceModelId"),
    sourceModelName: stringValue(record.sourceModelName, "model.sourceModelName"),
    filename: stringValue(record.filename, "model.filename"),
    contentSha256: stringValue(record.contentSha256, "model.contentSha256"),
    byteSize: integerValue(record.byteSize, "model.byteSize"),
    schemaLabel: stringValue(record.schemaLabel, "model.schemaLabel"),
    entityCount: integerValue(record.entityCount, "model.entityCount"),
    productCount: integerValue(record.productCount, "model.productCount"),
    lengthToMetre,
    parseMs: nullableNumber(record.parseMs, "model.parseMs"),
    uploadedAt: stringValue(record.uploadedAt, "model.uploadedAt"),
    originatingSystem: nullableString(record.originatingSystem, "model.originatingSystem"),
    processingVersions: parseProcessingVersions(record.processingVersions, "model.processingVersions"),
  };
}

export function parseProcessingVersions(value: unknown, field: string): ProcessingVersions | null {
  if (value == null) return null;
  const record = requireRecord(value, field);
  return {
    worker: nonEmptyString(record.worker, `${field}.worker`),
    ifcOpenShell: nonEmptyString(record.ifcOpenShell, `${field}.ifcOpenShell`),
    ifcTester: nonEmptyString(record.ifcTester, `${field}.ifcTester`),
    extraction: nonEmptyString(record.extraction, `${field}.extraction`),
    scopeSemantics: nonEmptyString(record.scopeSemantics, `${field}.scopeSemantics`),
  };
}

function parseRun(value: unknown): RunSummary {
  const record = requireRecord(value, "Run payload");
  return {
    id: stringValue(record.id, "run.id"),
    projectId: stringValue(record.projectId, "run.projectId"),
    deliveryId: stringValue(record.deliveryId, "run.deliveryId"),
    deliveryLabel: stringValue(record.deliveryLabel, "run.deliveryLabel"),
    packVersionId: stringValue(record.packVersionId, "run.packVersionId"),
    packName: stringValue(record.packName, "run.packName"),
    packVersion: integerValue(record.packVersion, "run.packVersion"),
    engineVersion: stringOrEmpty(record.engineVersion, "run.engineVersion"),
    parserVersion: stringOrEmpty(record.parserVersion, "run.parserVersion"),
    status: runStatusValue(record.status),
    error: nullableString(record.error, "run.error"),
    startedAt: stringValue(record.startedAt, "run.startedAt"),
    finishedAt: nullableString(record.finishedAt, "run.finishedAt"),
    durationMs: nullableNumber(record.durationMs, "run.durationMs"),
    passCount: integerValue(record.passCount, "run.passCount"),
    failCount: integerValue(record.failCount, "run.failCount"),
    notApplicableCount: integerValue(record.notApplicableCount, "run.notApplicableCount"),
    incompleteCount: integerValue(record.incompleteCount, "run.incompleteCount"),
    score: nullableNumber(record.score, "run.score"),
    findingCount: integerValue(record.findingCount, "run.findingCount"),
    failingObjectCount: integerValue(record.failingObjectCount, "run.failingObjectCount"),
  };
}

function disciplineValue(value: unknown): Discipline {
  if (value === "ARCH" || value === "STRUCT" || value === "MEP" || value === "OTHER") {
    return value;
  }
  throw new Error("model.discipline is invalid");
}

function runStatusValue(value: unknown): RunStatus {
  if (value === "running" || value === "completed" || value === "failed") return value;
  throw new Error("run.status is invalid");
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error(`${field} must be an object`);
  return Object.fromEntries(Object.entries(value));
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function stringOrEmpty(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (text.trim().length === 0) throw new Error(`${field} must not be empty`);
  return text;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new Error(`${field} must be a string or null`);
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return numberValue(value, field);
}
