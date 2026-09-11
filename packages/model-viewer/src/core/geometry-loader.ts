import type {
  FailureStage,
  LoadPhase,
  TransferGeometry,
  TransferInstance,
  WorkerHeader,
} from "./viewer-types";
import type { DeliveryModel } from "./viewer-types";

/** Stream sink through which a geometry loader hands the controller a model's
 * parsed geometry and life-cycle events. The controller uploads to the renderer
 * as batches arrive, so real IFC payloads never buffer in memory. */
export interface GeometryLoadSink {
  progress(phase: LoadPhase, loaded: number, total: number | null): void;
  header(header: WorkerHeader): void;
  batch(geometries: readonly TransferGeometry[], instances: readonly TransferInstance[]): void;
  /** Resource accounting: the loader reports how many worker threads it keeps
   * alive, so the controller exposes the same `resourceStats().workers`
   * contract regardless of the driver in use. */
  workerCount(count: number): void;
}

/** A host-supplied pure-data loader. The default IFC loader lives in the
 * separate `model-viewer/ifc` entry; hosts may substitute fixtures or other
 * sources. Resolves when every batch was delivered; rejects with
 * `GeometryLoadError` carrying the failure stage and retryability. */
export type GeometryLoader = (
  model: DeliveryModel,
  sink: GeometryLoadSink,
  signal: AbortSignal,
) => Promise<void>;

export class GeometryLoadError extends Error {
  readonly stage: FailureStage;
  readonly retryable: boolean;

  constructor(stage: FailureStage, message: string, retryable: boolean) {
    super(message);
    this.stage = stage;
    this.retryable = retryable;
  }
}