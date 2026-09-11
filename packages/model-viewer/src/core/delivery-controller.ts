import { modelForDelivery } from "./delivery-model";
import { RendererOwner } from "./renderer-owner";
import {
  type Bounds3,
  type DeliveryModel,
  type DeliverySnapshot,
  type DeliveryViewerController,
  type FailureStage,
  type ModelDiscipline,
  type ModelLoadState,
  type ObjectRef,
  type RevisionId,
  type SelectionRecord,
  type ViewerDelivery,
  type ViewerDiagnostics,
  type ViewerHighlight,
  type ViewerModel,
  type ViewerRenderer,
  type ViewerResourceStats,
} from "./viewer-types";
import { GeometryLoadError, type GeometryLoader, type GeometryLoadSink } from "./geometry-loader";

export type RendererFactory = (
  canvas: HTMLCanvasElement,
  onPick: (ref: ObjectRef) => void,
) => ViewerRenderer;

export type ModelFileUrlResolver = (model: ViewerModel) => string;

export interface DeliveryViewerOptions {
  readonly delivery: ViewerDelivery;
  readonly canvas: HTMLCanvasElement;
  /** Produces geometry for each model. The IFC driver is `model-viewer/ifc`;
   * hosts may substitute their own source. */
  readonly geometryLoader: GeometryLoader;
  /** Resolves each host model descriptor to its loadable resource. */
  readonly modelFileUrl: ModelFileUrlResolver;
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

export function createDeliveryViewer(options: DeliveryViewerOptions): DeliveryViewerController {
  const rendererFactory = options.rendererFactory ?? ((canvas, onPick) =>
    new RendererOwner({ canvas, onPick }));
  return new DeliveryViewerControllerImpl(
    options.delivery,
    options.canvas,
    options.geometryLoader,
    rendererFactory,
    options.modelFileUrl,
  );
}

class DeliveryViewerControllerImpl implements DeliveryViewerController {
  private readonly slots = new Map<RevisionId, RevisionSlot>();
  private readonly listeners = new Set<(snapshot: DeliverySnapshot) => void>();
  private readonly progressRevisionIds = new Set<RevisionId>();
  private readonly renderer: ViewerRenderer;
  private readonly geometryLoader: GeometryLoader;
  private readonly abort = new AbortController();
  private readonly delivery: ViewerDelivery;
  private activeRevision: RevisionId | null = null;
  private selected: SelectionRecord | null = null;
  private origin: readonly [number, number, number] | null = null;
  private jobNumber = 0;
  private started = false;
  private initialReady = false;
  private disposed = false;
  private isolatedRequested: number | null = null;
  private sectionZ: number | null = null;
  private liveWorkers = 0;

  constructor(
    delivery: ViewerDelivery,
    canvas: HTMLCanvasElement,
    geometryLoader: GeometryLoader,
    rendererFactory: RendererFactory,
    modelFileUrl: ModelFileUrlResolver,
  ) {
    this.delivery = delivery;
    this.geometryLoader = geometryLoader;
    this.renderer = rendererFactory(canvas, (ref) => this.select(ref));

    for (const model of delivery.models) {
      const parsed = modelForDelivery(model, modelFileUrl(model));
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

  setDisciplineVisibility(discipline: ModelDiscipline, visible: boolean): void {
    if (!this.disposed) this.renderer.setDisciplineVisibility(discipline, visible);
  }

  setHighlights(groups: readonly ViewerHighlight[]): void {
    if (this.disposed) return;
    this.renderer.setHighlights(groups);
    this.emit();
  }

  isolate(refs: readonly ObjectRef[] | null): void {
    if (this.disposed) return;
    this.isolatedRequested = refs === null ? null : refs.length;
    this.renderer.isolate(refs);
    this.emit();
  }

  setSectionZ(z: number | null): void {
    if (this.disposed) return;
    if (z !== null && !Number.isFinite(z)) throw new Error("section Z must be a finite number");
    this.sectionZ = z;
    this.applySection();
    this.emit();
  }

  setDimOpacity(opacity: number): void {
    if (this.disposed) return;
    this.renderer.setDimOpacity(opacity);
    this.emit();
  }

  fitAll(): void {
    if (!this.disposed) this.renderer.fitAll();
  }

  nudgeCamera(horizontal: number, vertical: number): void {
    if (!this.disposed) this.renderer.nudgeCamera(horizontal, vertical);
  }

  zoomCamera(factor: number): void {
    if (!this.disposed) this.renderer.zoomCamera(factor);
  }

  resourceStats(): ViewerResourceStats {
    const stats = this.renderer.resourceStats();
    return { ...stats, workers: this.liveWorkers };
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
      isolatedRequested: this.isolatedRequested,
      sectionZ: this.sectionZ,
      selectedHidden: this.renderer.diagnostics().selectedHidden,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.liveWorkers = 0;

    for (const slot of this.slots.values()) {
      slot.state = { status: "disposed", model: slot.model };
    }
    this.renderer.dispose();
    this.selected = null;
    this.isolatedRequested = null;
    this.sectionZ = null;
    this.listeners.clear();
  }

  private runNext(): void {
    if (this.disposed || this.activeRevision) return;
    const next = [...this.slots.values()].find(({ state }) => state.status === "queued");
    if (!next) {
      this.resolveSettledDelivery();
      return;
    }

    const jobId = `${next.model.revisionId}\u0000${++this.jobNumber}`;
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

    const sink: GeometryLoadSink = {
      workerCount: (count) => {
        this.liveWorkers = count;
      },
      progress: (phase, loaded, total) => {
        if (this.disposed || this.activeRevision !== next.model.revisionId) return;
        if (next.state.status === "loading") {
          this.progressRevisionIds.add(next.model.revisionId);
          next.state = { ...next.state, phase, loaded, total };
          this.emit();
        }
      },
      header: (header) => {
        if (this.disposed || this.activeRevision !== next.model.revisionId) return;
        next.uploadedBatches = 0;
        next.headerReceived = true;
        next.headerBounds = header.bounds;
        next.objectCount = header.objectCount;
        this.renderer.uploadHeader(next.model.revisionId, header, next.model);
        next.state = {
          status: "uploading",
          model: next.model,
          uploadedBatches: 0,
          totalBatches: header.batchCount,
        };
        this.emit();
      },
      batch: (geometries, instances) => {
        if (this.disposed || this.activeRevision !== next.model.revisionId) return;
        this.renderer.uploadBatch(next.model.revisionId, geometries, instances);
        next.uploadedBatches += 1;
        if (next.state.status === "uploading") {
          next.state = { ...next.state, uploadedBatches: next.uploadedBatches };
        }
        this.emit();
      },
    };

    this.geometryLoader(next.model, sink, this.abort.signal)
      .then(() => {
        if (this.disposed || this.activeRevision !== next.model.revisionId) return;
        if (!next.headerReceived) {
          this.failSlot(next, "worker", "geometry loader completed without a geometry header", true);
          return;
        }
        next.state = {
          status: "ready",
          model: next.model,
          objectCount: next.objectCount,
          bounds: next.headerBounds,
        };
        this.finishActive(next.model.revisionId);
      })
      .catch((error) => {
        if (this.disposed || this.activeRevision !== next.model.revisionId) return;
        const known = error instanceof GeometryLoadError ? error : null;
        this.failSlot(next, known?.stage ?? "worker", known?.message ?? errorMessage(error), known?.retryable ?? true);
      });
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
    this.applySection();
    this.renderer.reveal(fitCamera);
    this.emit();
  }

  private applySection(): void {
    if (this.sectionZ === null) {
      this.renderer.setSectionZ(null);
      return;
    }
    if (!this.origin) return;
    this.renderer.setSectionZ(this.sectionZ - this.origin[2]);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown viewer error";
}