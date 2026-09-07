import type { Discipline } from "@/lib/types";
import { parseObjectId, parseRevisionId } from "./object-ref";
import type {
  Bounds3,
  FailureStage,
  LoadPhase,
  RevisionId,
  TransferGeometry,
  TransferInstance,
  WorkerHeader,
} from "./types";

export type WorkerRequest =
  | Readonly<{
      type: "load";
      jobId: string;
      revisionId: RevisionId;
      discipline: Discipline;
      fileUrl: string;
      wasmBaseUrl: string;
    }>
  | Readonly<{ type: "ack"; jobId: string; batchNumber: number }>
  | Readonly<{ type: "cancel"; jobId: string }>;

export type WorkerResponse =
  | Readonly<{
      type: "progress";
      jobId: string;
      revisionId: RevisionId;
      phase: LoadPhase;
      loaded: number;
      total: number | null;
      sequence: number;
    }>
  | Readonly<{
      type: "header";
      jobId: string;
      revisionId: RevisionId;
      header: WorkerHeader;
      sequence: number;
    }>
  | Readonly<{
      type: "batch";
      jobId: string;
      revisionId: RevisionId;
      batchNumber: number;
      geometries: readonly TransferGeometry[];
      instances: readonly TransferInstance[];
      sequence: number;
    }>
  | Readonly<{
      type: "complete";
      jobId: string;
      revisionId: RevisionId;
      sequence: number;
    }>
  | Readonly<{
      type: "failed";
      jobId: string;
      revisionId: RevisionId;
      stage: FailureStage;
      message: string;
      retryable: boolean;
      sequence: number;
    }>;

export function parseWorkerResponse(value: unknown): WorkerResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== "string") return null;

  const jobId = nonEmptyString(record.jobId);
  const revisionId = safeRevisionId(record.revisionId);
  const sequence = nonNegativeInteger(record.sequence);
  if (!jobId || !revisionId || sequence === null) return null;

  if (record.type === "progress") {
    const phase = parseLoadPhase(record.phase);
    const loaded = nonNegativeNumber(record.loaded);
    const total = record.total === null ? null : nonNegativeNumber(record.total);
    if (!phase || loaded === null || (record.total !== null && total === null)) return null;
    return { type: "progress", jobId, revisionId, phase, loaded, total, sequence };
  }

  if (record.type === "header") {
    const header = parseHeader(record.header);
    return header ? { type: "header", jobId, revisionId, header, sequence } : null;
  }

  if (record.type === "batch") {
    const batchNumber = nonNegativeInteger(record.batchNumber);
    if (batchNumber === null || !Array.isArray(record.geometries) || !Array.isArray(record.instances)) {
      return null;
    }
    const geometries: TransferGeometry[] = [];
    for (const value of record.geometries) {
      const geometry = parseGeometry(value);
      if (!geometry) return null;
      geometries.push(geometry);
    }
    const instances: TransferInstance[] = [];
    for (const value of record.instances) {
      const instance = parseInstance(value);
      if (!instance) return null;
      instances.push(instance);
    }
    return {
      type: "batch",
      jobId,
      revisionId,
      batchNumber,
      geometries,
      instances,
      sequence,
    };
  }

  if (record.type === "complete") {
    return { type: "complete", jobId, revisionId, sequence };
  }

  if (record.type === "failed") {
    const stage = parseFailureStage(record.stage);
    if (!stage || typeof record.message !== "string" || typeof record.retryable !== "boolean") {
      return null;
    }
    return {
      type: "failed",
      jobId,
      revisionId,
      stage,
      message: record.message,
      retryable: record.retryable,
      sequence,
    };
  }

  return null;
}

function parseHeader(value: unknown): WorkerHeader | null {
  const record = asRecord(value);
  if (!record) return null;
  const bounds = record.bounds === null ? null : parseBounds(record.bounds);
  const objectCount = nonNegativeInteger(record.objectCount);
  const uniqueGeometryCount = nonNegativeInteger(record.uniqueGeometryCount);
  const instanceCount = nonNegativeInteger(record.instanceCount);
  const vertexCount = nonNegativeInteger(record.vertexCount);
  const indexCount = nonNegativeInteger(record.indexCount);
  const batchCount = nonNegativeInteger(record.batchCount);
  if (
    (record.bounds !== null && bounds === null) ||
    objectCount === null ||
    uniqueGeometryCount === null ||
    instanceCount === null ||
    vertexCount === null ||
    indexCount === null ||
    batchCount === null
  ) {
    return null;
  }
  return {
    bounds,
    objectCount,
    uniqueGeometryCount,
    instanceCount,
    vertexCount,
    indexCount,
    batchCount,
  };
}

function parseGeometry(value: unknown): TransferGeometry | null {
  const record = asRecord(value);
  if (!record) return null;
  const geometryExpressId = nonNegativeInteger(record.geometryExpressId);
  const bounds = parseBounds(record.bounds);
  if (
    geometryExpressId === null ||
    !(record.positions instanceof Float32Array) ||
    !(record.normals instanceof Float32Array) ||
    !(record.indices instanceof Uint32Array) ||
    record.positions.length % 3 !== 0 ||
    record.normals.length !== record.positions.length ||
    !bounds
  ) {
    return null;
  }
  return {
    geometryExpressId,
    positions: record.positions,
    normals: record.normals,
    indices: record.indices,
    bounds,
  };
}

function parseInstance(value: unknown): TransferInstance | null {
  const record = asRecord(value);
  if (!record) return null;
  const expressId = nonNegativeInteger(record.expressId);
  const geometryExpressId = nonNegativeInteger(record.geometryExpressId);
  const objectId = safeObjectId(record.objectId);
  const discipline = parseDiscipline(record.discipline);
  const matrix = numberTuple(record.matrix, 16);
  const color = numberTuple(record.color, 4);
  if (
    expressId === null ||
    geometryExpressId === null ||
    !objectId ||
    !discipline ||
    !matrix ||
    !color ||
    !nullableString(record.globalId) ||
    !nullableString(record.name) ||
    typeof record.ifcType !== "string"
  ) {
    return null;
  }
  return {
    expressId,
    objectId,
    globalId: record.globalId,
    ifcType: record.ifcType,
    name: record.name,
    discipline,
    geometryExpressId,
    matrix,
    color: [color[0], color[1], color[2], color[3]],
  };
}

function parseBounds(value: unknown): Bounds3 | null {
  const record = asRecord(value);
  if (!record) return null;
  const min = numberTuple(record.min, 3);
  const max = numberTuple(record.max, 3);
  if (!min || !max) return null;
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
}

function parseLoadPhase(value: unknown): LoadPhase | null {
  return value === "download" || value === "parse" || value === "geometry" ? value : null;
}

function parseFailureStage(value: unknown): FailureStage | null {
  return value === "download" ||
    value === "parse" ||
    value === "geometry" ||
    value === "upload" ||
    value === "worker"
    ? value
    : null;
}

function parseDiscipline(value: unknown): Discipline | null {
  return value === "ARCH" || value === "STRUCT" || value === "MEP" || value === "OTHER"
    ? value
    : null;
}

function safeRevisionId(value: unknown): RevisionId | null {
  try {
    return parseRevisionId(value);
  } catch {
    return null;
  }
}

function safeObjectId(value: unknown): TransferInstance["objectId"] | null {
  try {
    return parseObjectId(value);
  } catch {
    return null;
  }
}

function numberTuple(value: unknown, length: number): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    return null;
  }
  return value;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
