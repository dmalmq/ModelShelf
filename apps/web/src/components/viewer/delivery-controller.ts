import type { DeliveryDetail, Discipline } from "@/lib/types";
import { modelForDelivery } from "./delivery-api";
import { parseWorkerResponse, type WorkerRequest, type WorkerResponse } from "./ifc-worker-protocol";
import { RendererOwner } from "./renderer-owner";
import {
  type Bounds3,
  type DeliveryModel,
  type DeliverySnapshot,
  type DeliveryViewerController,
  type FailureStage,
  type ModelLoadState,
  type ObjectRef,
  type RevisionId,
  type SelectionRecord,
  type ViewerDiagnostics,
  type ViewerRenderer,
  type ViewerResourceStats,
} from "./types";

interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

type WorkerFactory = () => WorkerLike;
type RendererFactory = (
  canvas: HTMLCanvasElement,
  onPick: (ref: ObjectRef) => void,
) => ViewerRenderer;

interface ControllerOptions {
  readonly delivery: DeliveryDetail;
  readonly canvas: HTMLCanvasElement;
  readonly workerFactory?: WorkerFactory;
  readonly rendererFactory?: RendererFactory;
}

interface RevisionSlot {
  readonly model: DeliveryModel;
  state: ModelLoadState;
  lastSequence: number;
  jobId: string | null;
  uploadedBatches: number;
  headerReceived: boolean;
  headerBounds: Bounds3 | null;
  objectCount: number;
}

export function createDeliveryViewer(options: ControllerOptions): DeliveryViewerController {
  const workerFactory = options.workerFactory ?? (() =>
    new Worker(new URL("./ifc-loader.worker.ts", import.meta.url), { type: "module" }));
  const rendererFactory = options.rendererFactory ?? ((canvas, onPick) =>
    new RendererOwner({ canvas, onPick }));
  return new DeliveryViewerControllerImpl(
    options.delivery,
    options.canvas,
    workerFactory,
    rendererFactory,
  );
}

class DeliveryViewerControllerImpl implements DeliveryViewerController {
  private readonly slots = new Map<RevisionId, RevisionSlot>();
  private readonly listeners = new Set<(snapshot: DeliverySnapshot) => void>();
  private readonly progressRevisionIds = new Set<RevisionId>();
  private readonly renderer: ViewerRenderer;
  private readonly workerFactory: WorkerFactory;
  private readonly delivery: DeliveryDetail;
  private worker: WorkerLike | null = null;
  private activeRevision: RevisionId | null = null;
  private selected: SelectionRecord | null = null;
  private origin: readonly [number, number, number] | null = null;
  private jobNumber = 0;
  private started = false;
  private initialReady = false;
  private disposed = false;

  constructor(
    delivery: DeliveryDetail,
    canvas: HTMLCanvasElement,
    workerFactory: WorkerFactory,
    rendererFactory: RendererFactory,
  ) {
    this.delivery = delivery;
    this.workerFactory = workerFactory;
    this.renderer = rendererFactory(canvas, (ref) => this.select(ref));

    for (const model of delivery.models) {
      const parsed = modelForDelivery(model);
      this.slots.set(parsed.revisionId, {
        model: parsed,
        state: { status: "queued", model: parsed },
        lastSequence: 0,
        jobId: null,
        uploadedBatches: 0,
        headerReceived: false,
        headerBounds: null,
        objectCount: 0,
      });
    }
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.runNext();
  }

  subscribe(listener: (snapshot: DeliverySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): DeliverySnapshot {
    return Object.freeze({
      delivery: this.delivery,
      models: Object.freeze([...this.slots.values()].map(({ state }) => state)),
      selected: this.selected,
      origin: this.origin,
      initialReady: this.initialReady,
      disposed: this.disposed,
    });
  }

  retry(revisionId: RevisionId): void {
    if (this.disposed) return;
    const slot = this.slots.get(revisionId);
    if (!slot || slot.state.status !== "failed") return;

    this.removeSelectionForRevision(revisionId);
    this.renderer.removeRevision(revisionId);
    slot.lastSequence = 0;
    slot.jobId = null;
    slot.uploadedBatches = 0;
    slot.headerReceived = false;
    slot.headerBounds = null;
    slot.objectCount = 0;
    slot.state = { status: "queued", model: slot.model };
    this.emit();
    this.runNext();
  }

  select(ref: ObjectRef | null): void {
    if (this.disposed) return;
    this.selected = ref === null ? null : this.renderer.selection(ref);
    this.renderer.select(this.selected);
    this.emit();
  }

  frame(refs: readonly ObjectRef[]): void {
    if (!this.disposed) this.renderer.frame(refs);
  }

  setDisciplineVisibility(discipline: Discipline, visible: boolean): void {
    if (!this.disposed) this.renderer.setDisciplineVisibility(discipline, visible);
  }

  fitAll(): void {
    if (!this.disposed) this.renderer.fitAll();
  }

  resourceStats(): ViewerResourceStats {
    const stats = this.renderer.resourceStats();
    return { ...stats, workers: this.worker === null ? 0 : 1 };
  }

  diagnostics(): ViewerDiagnostics {
    return {
      snapshot: this.snapshot(),
      resources: this.resourceStats(),
      renderer: this.renderer.diagnostics(),
      progressRevisionIds: [...this.progressRevisionIds],
      objects: this.renderer.selectionRecords().map((record) => ({
        ref: record.ref,
        expressId: record.expressId,
        globalId: record.globalId,
        targetCount: record.targets.length,
      })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.worker && this.activeRevision) {
      const jobId = this.slots.get(this.activeRevision)?.jobId;
      if (jobId) this.worker.postMessage({ type: "cancel", jobId });
    }
    this.worker?.terminate();
    this.worker = null;
    this.activeRevision = null;

    for (const slot of this.slots.values()) {
      slot.state = { status: "disposed", model: slot.model };
    }
    this.renderer.dispose();
    this.selected = null;
    this.listeners.clear();
  }

  private runNext(): void {
    if (this.disposed || this.activeRevision) return;
    const next = [...this.slots.values()].find(({ state }) => state.status === "queued");
    if (!next) {
      this.resolveSettledDelivery();
      return;
    }

    if (!this.worker) this.installWorker();
    const jobId = `${next.model.revisionId}\0${++this.jobNumber}`;
    next.jobId = jobId;
    next.lastSequence = 0;
    next.state = {
      status: "loading",
      model: next.model,
      phase: "download",
      loaded: 0,
      total: null,
    };
    this.activeRevision = next.model.revisionId;
    this.emit();
    this.worker?.postMessage({
      type: "load",
      jobId,
      revisionId: next.model.revisionId,
      discipline: next.model.discipline,
      fileUrl: next.model.fileUrl,
      wasmBaseUrl: "/wasm/",
    });
  }

  private installWorker(): void {
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.handleWorkerError(event.message || "IFC worker stopped unexpectedly");
    };
    this.worker = worker;
  }

  private handleWorkerMessage(value: unknown): void {
    if (this.disposed) return;
    const response = parseWorkerResponse(value);
    if (!response) {
      this.handleWorkerError(`IFC worker returned an invalid ${workerMessageType(value)} message`);
      return;
    }
    if (response.revisionId !== this.activeRevision) return;

    const slot = this.slots.get(response.revisionId);
    if (
      !slot ||
      !slot.jobId ||
      response.jobId !== slot.jobId ||
      response.sequence <= slot.lastSequence
    ) {
      return;
    }

    slot.lastSequence = response.sequence;
    try {
      this.applyResponse(slot, response);
    } catch (error: unknown) {
      this.worker?.terminate();
      this.worker = null;
      this.failSlot(slot, "upload", errorMessage(error), true);
    }
  }

  private applyResponse(slot: RevisionSlot, response: WorkerResponse): void {
    if (response.type === "progress") {
      this.progressRevisionIds.add(response.revisionId);
      if (slot.state.status === "loading") {
        slot.state = {
          ...slot.state,
          phase: response.phase,
          loaded: response.loaded,
          total: response.total,
        };
      }
      this.emit();
      return;
    }

    if (response.type === "header") {
      slot.uploadedBatches = 0;
      slot.headerReceived = true;
      slot.headerBounds = response.header.bounds;
      slot.objectCount = response.header.objectCount;
      this.renderer.uploadHeader(response.revisionId, response.header, slot.model);
      slot.state = {
        status: "uploading",
        model: slot.model,
        uploadedBatches: 0,
        totalBatches: response.header.batchCount,
      };
      this.emit();
      return;
    }

    if (response.type === "batch") {
      this.renderer.uploadBatch(
        response.revisionId,
        response.geometries,
        response.instances,
      );
      slot.uploadedBatches += 1;
      if (slot.state.status === "uploading") {
        slot.state = {
          ...slot.state,
          uploadedBatches: slot.uploadedBatches,
        };
      }
      this.worker?.postMessage({
        type: "ack",
        jobId: response.jobId,
        batchNumber: response.batchNumber,
      });
      this.emit();
      return;
    }

    if (response.type === "failed") {
      this.failSlot(slot, response.stage, response.message, response.retryable);
      return;
    }

    if (!slot.headerReceived) {
      this.failSlot(slot, "worker", "IFC worker completed without a geometry header", true);
      return;
    }
    slot.state = {
      status: "ready",
      model: slot.model,
      objectCount: slot.objectCount,
      bounds: slot.headerBounds,
    };
    this.finishActive(slot.model.revisionId);
  }

  private failSlot(
    slot: RevisionSlot,
    stage: FailureStage,
    message: string,
    retryable: boolean,
  ): void {
    this.renderer.removeRevision(slot.model.revisionId);
    this.removeSelectionForRevision(slot.model.revisionId);
    slot.state = {
      status: "failed",
      model: slot.model,
      stage,
      message,
      retryable,
    };
    this.finishActive(slot.model.revisionId);
  }

  private handleWorkerError(message: string): void {
    if (this.disposed) return;
    const revisionId = this.activeRevision;
    if (revisionId) {
      const slot = this.slots.get(revisionId);
      if (slot) {
        this.renderer.removeRevision(revisionId);
        this.removeSelectionForRevision(revisionId);
        slot.state = {
          status: "failed",
          model: slot.model,
          stage: "worker",
          message,
          retryable: true,
        };
      }
    }

    this.worker?.terminate();
    this.worker = null;
    if (revisionId) this.finishActive(revisionId);
  }

  private finishActive(revisionId: RevisionId): void {
    if (this.activeRevision !== revisionId) return;
    this.activeRevision = null;
    this.emit();
    this.resolveSettledDelivery();
    this.runNext();
  }

  private resolveSettledDelivery(): void {
    const unsettled = [...this.slots.values()].some(({ state }) =>
      state.status === "queued" || state.status === "loading" || state.status === "uploading");
    if (unsettled) return;

    let fitCamera = false;
    if (!this.initialReady) {
      this.initialReady = true;
    }
    if (!this.origin) {
      const readyBounds = [...this.slots.values()].flatMap(({ state }) =>
        state.status === "ready" && state.bounds ? [state.bounds] : []);
      this.origin = commonOrigin(readyBounds);
      fitCamera = this.origin !== null;
    }
    if (this.origin) this.renderer.setOrigin(this.origin);
    this.renderer.reveal(fitCamera);
    this.emit();
  }

  private removeSelectionForRevision(revisionId: RevisionId): void {
    if (this.selected?.ref.revisionId === revisionId) {
      this.selected = null;
      this.renderer.select(null);
    }
  }

  private emit(): void {
    if (this.disposed) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function commonOrigin(bounds: readonly Bounds3[]): [number, number, number] | null {
  if (bounds.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const bound of bounds) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bound.min[axis]);
      max[axis] = Math.max(max[axis], bound.max[axis]);
    }
  }

  return [
    Math.round((min[0] + max[0]) / 2),
    Math.round((min[1] + max[1]) / 2),
    Math.round((min[2] + max[2]) / 2),
  ];
}

function workerMessageType(value: unknown): string {
  if (typeof value !== "object" || value === null || !("type" in value)) return "unknown";
  return typeof value.type === "string" ? value.type : "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown viewer error";
}
