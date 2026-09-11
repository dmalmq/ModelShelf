import { IfcAPI } from "web-ifc";
import { ifcObjectId } from "./object-id";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { ObjectId } from "../object-ref";
import type { Bounds3, FailureStage } from "../types";
import type { GeometryHeader, TransferGeometry, TransferInstance } from "../geometry-driver.internal";

const BATCH_LIMIT_BYTES = 8 * 1024 * 1024;
const HASH_BATCH_SIZE = 128;

const activeJobs = new Set<string>();
const pendingAcks = new Map<string, () => void>();
let runningJobId: string | null = null;
let ifcApiPromise: Promise<IfcAPI> | null = null;
let ifcApiBaseUrl: string | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === "ack") {
    const key = ackKey(request.jobId, request.batchNumber);
    pendingAcks.get(key)?.();
    pendingAcks.delete(key);
    return;
  }

  if (request.type === "cancel") {
    activeJobs.delete(request.jobId);
    return;
  }

  if (runningJobId !== null) {
    post({
      type: "failed",
      jobId: request.jobId,
      revisionId: request.revisionId,
      stage: "worker",
      message: "The IFC worker is already loading another revision",
      retryable: true,
      sequence: 1,
    });
    return;
  }

  runningJobId = request.jobId;
  activeJobs.add(request.jobId);
  void loadRevision(request).finally(() => {
    activeJobs.delete(request.jobId);
    if (runningJobId === request.jobId) runningJobId = null;
  });
};

async function loadRevision(request: Extract<WorkerRequest, { type: "load" }>): Promise<void> {
  let api: IfcAPI | null = null;
  let modelId: number | null = null;
  let stage: FailureStage = "parse";
  let sequence = 0;

  try {
    post({
      type: "progress",
      jobId: request.jobId,
      revisionId: request.revisionId,
      phase: "parse",
      loaded: 0,
      total: null,
      sequence: ++sequence,
    });

    const wasmBaseUrl = new URL(
      request.wasmBaseUrl.endsWith("/") ? request.wasmBaseUrl : `${request.wasmBaseUrl}/`,
      self.location.origin,
    );
    api = await getIfcApi(wasmBaseUrl);
    const bytes = new Uint8Array(request.bytes);
    const openedModelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
    if (openedModelId < 0) throw new Error("web-ifc could not open the IFC file");
    modelId = openedModelId;

    stage = "geometry";
    const extracted = await extractModel(api, modelId, request);
    const batches = createBatches(extracted.geometries, extracted.instances);
    post({
      type: "progress",
      jobId: request.jobId,
      revisionId: request.revisionId,
      phase: "geometry",
      loaded: extracted.header.vertexCount,
      total: extracted.header.vertexCount,
      sequence: ++sequence,
    });
    post({
      type: "header",
      jobId: request.jobId,
      revisionId: request.revisionId,
      header: { ...extracted.header, batchCount: batches.length },
      sequence: ++sequence,
    });

    for (let batchNumber = 0; batchNumber < batches.length; batchNumber += 1) {
      if (!activeJobs.has(request.jobId)) return;
      const batch = batches[batchNumber];
      const response: WorkerResponse = {
        type: "batch",
        jobId: request.jobId,
        revisionId: request.revisionId,
        batchNumber,
        geometries: batch.geometries,
        instances: batch.instances,
        sequence: ++sequence,
      };
      post(response, transferables(response));
      await waitForAck(request.jobId, batchNumber);
    }

    if (activeJobs.has(request.jobId)) {
      post({
        type: "complete",
        jobId: request.jobId,
        revisionId: request.revisionId,
        sequence: ++sequence,
      });
    }
  } catch (error: unknown) {
    if (activeJobs.has(request.jobId)) {
      post({
        type: "failed",
        jobId: request.jobId,
        revisionId: request.revisionId,
        stage,
        message: errorMessage(error),
        retryable: false,
        sequence: ++sequence,
      });
    }
  } finally {
    if (api && modelId !== null && api.IsModelOpen(modelId)) api.CloseModel(modelId);
    clearJobAcks(request.jobId);
  }
}

async function getIfcApi(wasmBaseUrl: URL): Promise<IfcAPI> {
  const baseUrl = wasmBaseUrl.toString();
  if (ifcApiBaseUrl !== null && ifcApiBaseUrl !== baseUrl) {
    throw new Error("The IFC worker cannot change its WASM base URL");
  }
  if (!ifcApiPromise) {
    const api = new IfcAPI();
    ifcApiBaseUrl = baseUrl;
    ifcApiPromise = api.Init((path) => new URL(path, wasmBaseUrl).toString(), true)
      .then(() => api)
      .catch((error: unknown) => {
        ifcApiPromise = null;
        ifcApiBaseUrl = null;
        throw error;
      });
  }
  return ifcApiPromise;
}

interface MutableBounds {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

type RawInstance = Omit<TransferInstance, "objectId"> & { expressId: number };

interface ExtractedModel {
  readonly header: Omit<GeometryHeader, "batchCount">;
  readonly geometries: readonly TransferGeometry[];
  readonly instances: readonly TransferInstance[];
}

async function extractModel(
  api: IfcAPI,
  modelId: number,
  request: Extract<WorkerRequest, { type: "load" }>,
): Promise<ExtractedModel> {
  const geometryMap = new Map<string, TransferGeometry>();
  const skippedGeometryIds = new Set<string>();
  const rawInstances: RawInstance[] = [];
  const productIds = new Set<number>();
  const bounds = mutableBounds();
  let vertexCount = 0;
  let indexCount = 0;

  api.StreamAllMeshes(modelId, (mesh) => {
    const line: unknown = api.GetLine(modelId, mesh.expressID, false, false);
    const globalId = readString(line, "GlobalId");
    const name = readString(line, "Name");
    const ifcType = api.GetNameFromTypeCode(api.GetLineType(modelId, mesh.expressID));
    productIds.add(mesh.expressID);

    for (let index = 0; index < mesh.geometries.size(); index += 1) {
      const placed = mesh.geometries.get(index);
      const geometryId = String(placed.geometryExpressID);
      if (skippedGeometryIds.has(geometryId)) continue;
      let geometry = geometryMap.get(geometryId);
      if (!geometry) {
        const extracted = extractGeometry(api, modelId, placed.geometryExpressID, geometryId);
        if (!extracted) {
          skippedGeometryIds.add(geometryId);
          continue;
        }
        geometry = extracted;
        geometryMap.set(geometryId, geometry);
        vertexCount += geometry.positions.length / 3;
        indexCount += geometry.indices.length;
      }
      if (placed.flatTransformation.length !== 16) continue;
      const matrix = [...placed.flatTransformation];
      if (matrix.some((value) => !Number.isFinite(value))) continue;
      const color: TransferInstance["color"] = [
        placed.color.x,
        placed.color.y,
        placed.color.z,
        placed.color.w,
      ];
      if (color.some((value) => !Number.isFinite(value))) continue;
      const attributes: Record<string, string> = {
        ...request.attributes,
        expressId: String(mesh.expressID),
        ifcType,
      };
      if (globalId) attributes.globalId = globalId;
      rawInstances.push({
        expressId: mesh.expressID,
        geometryId,
        matrix,
        color,
        name,
        attributes,
      });
      expandBounds(bounds, geometry.bounds, matrix);
    }
  });

  const objectIds = await resolveObjectIds(request.revisionId, [...productIds]);
  const instances = rawInstances.map((instance): TransferInstance => {
    const objectId = objectIds.get(instance.expressId);
    if (!objectId) throw new Error(`ObjectRef mapping is missing for expressId ${instance.expressId}`);
    const { expressId: _expressId, ...rest } = instance;
    return { ...rest, objectId };
  });

  return {
    header: {
      bounds: hasFiniteBounds(bounds) ? immutableBounds(bounds) : null,
      objectCount: productIds.size,
      uniqueGeometryCount: geometryMap.size,
      instanceCount: instances.length,
      vertexCount,
      indexCount,
    },
    geometries: [...geometryMap.values()],
    instances,
  };
}

async function resolveObjectIds(
  revisionId: Extract<WorkerRequest, { type: "load" }>["revisionId"],
  expressIds: readonly number[],
): Promise<Map<number, ObjectId>> {
  const objectIds = new Map<number, ObjectId>();
  for (let offset = 0; offset < expressIds.length; offset += HASH_BATCH_SIZE) {
    const chunk = expressIds.slice(offset, offset + HASH_BATCH_SIZE);
    const resolved = await Promise.all(
      chunk.map(async (expressId) => [expressId, await ifcObjectId(revisionId, expressId)] as const),
    );
    for (const [expressId, objectId] of resolved) objectIds.set(expressId, objectId);
  }
  return objectIds;
}

function extractGeometry(api: IfcAPI, modelId: number, expressId: number, geometryId: string): TransferGeometry | null {
  const geometry = api.GetGeometry(modelId, expressId);
  try {
    const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
    const sourceIndices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
    if (vertices.length === 0 || vertices.length % 6 !== 0 || sourceIndices.length % 3 !== 0) {
      return null;
    }

    const vertexCount = vertices.length / 6;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(positions.length);
    const bounds = mutableBounds();

    for (let source = 0, target = 0; source < vertices.length; source += 6, target += 3) {
      const x = vertices[source];
      const y = vertices[source + 1];
      const z = vertices[source + 2];
      const nx = vertices[source + 3];
      const ny = vertices[source + 4];
      const nz = vertices[source + 5];
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z) ||
        !Number.isFinite(nx) ||
        !Number.isFinite(ny) ||
        !Number.isFinite(nz)
      ) {
        return null;
      }
      positions[target] = x;
      positions[target + 1] = y;
      positions[target + 2] = z;
      normals[target] = nx;
      normals[target + 1] = ny;
      normals[target + 2] = nz;
      expandBoundsPoint(bounds, x, y, z);
    }
    for (let index = 0; index < sourceIndices.length; index += 1) {
      if (sourceIndices[index] >= vertexCount) return null;
    }

    return {
      geometryId,
      positions,
      normals,
      indices: new Uint32Array(sourceIndices),
      bounds: immutableBounds(bounds),
    };
  } finally {
    geometry.delete();
  }
}

interface TransferBatch {
  readonly geometries: TransferGeometry[];
  readonly instances: TransferInstance[];
}

function createBatches(
  geometries: readonly TransferGeometry[],
  instances: readonly TransferInstance[],
): readonly TransferBatch[] {
  const instancesByGeometry = new Map<string, TransferInstance[]>();
  for (const instance of instances) {
    const entries = instancesByGeometry.get(instance.geometryId) ?? [];
    entries.push(instance);
    instancesByGeometry.set(instance.geometryId, entries);
  }

  const batches: TransferBatch[] = [];
  let current: TransferBatch = { geometries: [], instances: [] };
  let currentBytes = 0;

  for (const geometry of geometries) {
    const geometryBytes = geometry.positions.byteLength + geometry.normals.byteLength + geometry.indices.byteLength;
    if (current.geometries.length > 0 && currentBytes + geometryBytes > BATCH_LIMIT_BYTES) {
      batches.push(current);
      current = { geometries: [], instances: [] };
      currentBytes = 0;
    }
    current.geometries.push(geometry);
    current.instances.push(...(instancesByGeometry.get(geometry.geometryId) ?? []));
    currentBytes += geometryBytes;
  }

  if (current.geometries.length > 0) batches.push(current);
  return batches;
}

function post(response: WorkerResponse, transferables: readonly Transferable[] = []): void {
  self.postMessage(response, { transfer: [...transferables] });
}

function transferables(response: Extract<WorkerResponse, { type: "batch" }>): Transferable[] {
  const result: Transferable[] = [];
  for (const geometry of response.geometries) {
    result.push(geometry.positions.buffer, geometry.normals.buffer, geometry.indices.buffer);
  }
  return result;
}

function waitForAck(jobId: string, batchNumber: number): Promise<void> {
  return new Promise((resolve) => {
    pendingAcks.set(ackKey(jobId, batchNumber), resolve);
  });
}

function ackKey(jobId: string, batchNumber: number): string {
  return `${jobId}\0${batchNumber}`;
}

function clearJobAcks(jobId: string): void {
  const prefix = `${jobId}\0`;
  for (const key of pendingAcks.keys()) {
    if (key.startsWith(prefix)) pendingAcks.delete(key);
  }
}

function mutableBounds(): MutableBounds {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

function hasFiniteBounds(bounds: MutableBounds): boolean {
  return (
    Number.isFinite(bounds.min[0]) &&
    Number.isFinite(bounds.min[1]) &&
    Number.isFinite(bounds.min[2]) &&
    Number.isFinite(bounds.max[0]) &&
    Number.isFinite(bounds.max[1]) &&
    Number.isFinite(bounds.max[2])
  );
}

function immutableBounds(bounds: MutableBounds): Bounds3 {
  return {
    min: [bounds.min[0], bounds.min[1], bounds.min[2]],
    max: [bounds.max[0], bounds.max[1], bounds.max[2]],
  };
}

function expandBounds(bounds: MutableBounds, local: Bounds3, matrix: readonly number[]): void {
  for (const x of [local.min[0], local.max[0]]) {
    for (const y of [local.min[1], local.max[1]]) {
      for (const z of [local.min[2], local.max[2]]) {
        expandBoundsPoint(
          bounds,
          matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
          matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
          matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        );
      }
    }
  }
}

function expandBoundsPoint(bounds: MutableBounds, x: number, y: number, z: number): void {
  bounds.min[0] = Math.min(bounds.min[0], x);
  bounds.min[1] = Math.min(bounds.min[1], y);
  bounds.min[2] = Math.min(bounds.min[2], z);
  bounds.max[0] = Math.max(bounds.max[0], x);
  bounds.max[1] = Math.max(bounds.max[1], y);
  bounds.max[2] = Math.max(bounds.max[2], z);
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = Object.fromEntries(Object.entries(value));
  const property = record[key];
  if (typeof property === "string") return property;
  if (typeof property !== "object" || property === null) return null;
  const nested = Object.fromEntries(Object.entries(property));
  return typeof nested.value === "string" ? nested.value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown IFC worker error";
}
