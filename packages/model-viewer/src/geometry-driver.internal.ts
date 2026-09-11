import type { GeometryDriver } from "./types";
import type { FailureStage, LoadPhase, ViewerSource } from "./types";
import type { Bounds3 } from "./types";
import type { ObjectId } from "./object-ref";

export const GEOMETRY_DRIVER = Symbol("model-viewer.GeometryDriver");

export interface GeometryHeader {
  readonly bounds: Bounds3 | null;
  readonly objectCount: number;
  readonly uniqueGeometryCount: number;
  readonly instanceCount: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly batchCount: number;
}

export interface TransferGeometry {
  readonly geometryId: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Bounds3;
}

export interface TransferInstance {
  readonly objectId: ObjectId;
  readonly geometryId: string;
  readonly matrix: readonly number[];
  readonly color: readonly [number, number, number, number];
  readonly name: string | null;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface GeometryLoadSink {
  progress(phase: LoadPhase, loaded: number, total: number | null): void;
  header(header: GeometryHeader): void;
  batch(geometries: readonly TransferGeometry[], instances: readonly TransferInstance[]): void;
  workerCount(count: number): void;
}

export type GeometryLoader = (
  source: ViewerSource,
  sink: GeometryLoadSink,
  signal: AbortSignal,
) => Promise<void>;

export interface InternalGeometryDriver {
  readonly [GEOMETRY_DRIVER]: true;
  load: GeometryLoader;
  workerCount(): number;
  dispose(): void;
}

export function internDriver(driver: GeometryDriver): InternalGeometryDriver {
  if (typeof driver !== "object" || driver === null || !(GEOMETRY_DRIVER in driver)) {
    throw new Error("GeometryDriver must be created by model-viewer");
  }
  return driver as unknown as InternalGeometryDriver;
}

export class GeometryLoadError extends Error {
  readonly stage: FailureStage;
  readonly retryable: boolean;

  constructor(stage: FailureStage, message: string, retryable: boolean) {
    super(message);
    this.stage = stage;
    this.retryable = retryable;
  }
}
