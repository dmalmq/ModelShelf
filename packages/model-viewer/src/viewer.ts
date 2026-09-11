import { internDriver, GeometryLoadError, type GeometryLoadSink, type InternalGeometryDriver } from "./geometry-driver.internal";
import { SceneOwner } from "./scene";
import { refKey } from "./object-ref";
import type { ObjectRef, RevisionId } from "./object-ref";
import type {
  Bounds3,
  FailureStage,
  ModelViewer,
  ModelViewerOptions,
  Overlay,
  OverlayResult,
  SharedOrigin,
  SourceState,
  ViewerDiagnostics,
  ViewerResourceStats,
  ViewerSnapshot,
  ViewerSource,
} from "./types";

interface RevisionSlot {
  readonly revisionId: RevisionId;
  readonly attributes: ViewerSource["attributes"];
  state: SourceState;
  abort: AbortController | null;
  headerReceived: boolean;
  headerBounds: Bounds3 | null;
  objectCount: number;
}

export function createModelViewer(options: ModelViewerOptions): ModelViewer {
  return new ModelViewerImpl(options);
}

class ModelViewerImpl implements ModelViewer {
  private readonly slots = new Map<RevisionId, RevisionSlot>();
  private readonly listeners = new Set<(snapshot: ViewerSnapshot) => void>();
  private readonly progressRevisionIds = new Set<RevisionId>();
  private readonly scene: SceneOwner;
  private readonly driver: InternalGeometryDriver;
  private selected: ReturnType<SceneOwner["selectedObject"]> = null;
  private origin: SharedOrigin = { frozen: false };
  private started = false;
  private initialReady = false;
  private disposed = false;
  private pumping = false;
  private isolatedRequested: number | null = null;
  private sectionZ: number | null = null;
  private workers = 0;

  constructor(options: ModelViewerOptions) {
    this.driver = internDriver(options.geometry);
    this.scene = new SceneOwner({
      canvas: options.canvas,
      selectionColor: options.selectionColor,
      onPick: (ref) => this.select(ref),
    });
    for (const source of options.scene.sources) {
      this.slots.set(source.revisionId, {
        revisionId: source.revisionId,
        attributes: source.attributes,
        state: { status: "queued", revisionId: source.revisionId, attributes: source.attributes },
        abort: null,
        headerReceived: false,
        headerBounds: null,
        objectCount: 0,
      });
    }
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    void this.runLoop();
  }

  subscribe(listener: (snapshot: ViewerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ViewerSnapshot {
    return Object.freeze({
      sources: Object.freeze([...this.slots.values()].map(({ state }) => state)),
      selected: this.selected,
      selectionHidden: this.scene.selectedHidden(),
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
    this.scene.removeRevision(revisionId);
    slot.abort = null;
    slot.headerReceived = false;
    slot.headerBounds = null;
    slot.objectCount = 0;
    slot.state = { status: "queued", revisionId: slot.revisionId, attributes: slot.attributes };
    this.emit();
    void this.runLoop();
  }

  select(ref: ObjectRef | null, options?: { readonly frame?: boolean }): void {
    if (this.disposed) return;
    const record = ref === null ? null : this.scene.selection(ref);
    this.selected = record === null
      ? null
      : { ref: record.ref, name: record.name, attributes: record.attributes, placements: record.targets.length };
    this.scene.select(record);
    if (options?.frame && record) this.scene.frame([record.ref]);
    this.emit();
  }

  applyOverlay(overlay: Overlay): OverlayResult {
    if (this.disposed) {
      return { groups: [], isolatedMatched: null, missing: [], selectionHidden: false };
    }
    this.scene.setDimOpacity(overlay.dimOpacity);
    const groups = this.scene.setHighlights(overlay.highlights);
    this.isolatedRequested = overlay.isolate === null ? null : overlay.isolate.length;
    this.scene.isolate(overlay.isolate);
    if (overlay.frame !== null) this.scene.frame(overlay.frame);

    const missing: ObjectRef[] = [];
    const seen = new Set<string>();
    const requested = [
      ...overlay.highlights.flatMap((group) => group.refs),
      ...(overlay.isolate ?? []),
      ...(overlay.frame ?? []),
    ];
    for (const ref of requested) {
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.scene.hasObject(ref)) missing.push(ref);
    }
    this.emit();
    return {
      groups,
      isolatedMatched: overlay.isolate === null ? null : this.scene.countIsolatedMatched(),
      missing,
      selectionHidden: this.scene.selectedHidden(),
    };
  }

  setHidden(attribute: string, values: readonly string[]): void {
    if (this.disposed) return;
    this.scene.setHidden(attribute, values);
    this.emit();
  }

  setSectionZ(z: number | null): void {
    if (this.disposed) return;
    if (z !== null && !Number.isFinite(z)) throw new Error("section Z must be a finite number");
    this.sectionZ = z;
    this.applySection();
    this.emit();
  }

  fitAll(): void {
    if (!this.disposed) this.scene.fitAll();
  }

  nudgeCamera(horizontal: number, vertical: number): void {
    if (!this.disposed) this.scene.nudgeCamera(horizontal, vertical);
  }

  zoomCamera(factor: number): void {
    if (!this.disposed) this.scene.zoomCamera(factor);
  }

  resourceStats(): ViewerResourceStats {
    const stats = this.scene.resourceStats();
    return { ...stats, workers: this.disposed ? 0 : this.workers };
  }

  diagnostics(): ViewerDiagnostics {
    return {
      snapshot: this.snapshot(),
      resources: this.resourceStats(),
      renderer: this.scene.diagnostics(),
      progressRevisionIds: [...this.progressRevisionIds],
      objects: this.scene.objectEntries(),
      isolatedRequested: this.isolatedRequested,
      sectionZ: this.sectionZ,
      selectedHidden: this.scene.selectedHidden(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.abort?.abort();
      slot.abort = null;
      slot.state = { status: "disposed", revisionId: slot.revisionId, attributes: slot.attributes };
    }
    this.driver.dispose();
    this.workers = 0;
    this.scene.dispose();
    this.selected = null;
    this.isolatedRequested = null;
    this.sectionZ = null;
    this.listeners.clear();
  }

  private async runLoop(): Promise<void> {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.disposed) return;
        const next = [...this.slots.values()].find(({ state }) => state.status === "queued");
        if (!next) {
          this.resolveSettledDelivery();
          if ([...this.slots.values()].some(({ state }) => state.status === "queued")) continue;
          return;
        }
        await this.loadSlot(next);
      }
    } finally {
      this.pumping = false;
      if (!this.disposed && [...this.slots.values()].some(({ state }) => state.status === "queued")) {
        void this.runLoop();
      }
    }
  }

  private async loadSlot(slot: RevisionSlot): Promise<void> {
    const abort = new AbortController();
    slot.abort = abort;
    slot.state = {
      status: "loading",
      revisionId: slot.revisionId,
      attributes: slot.attributes,
      phase: "download",
      loaded: 0,
      total: null,
    };
    this.emit();

    const sink: GeometryLoadSink = {
      progress: (phase, loaded, total) => {
        this.progressRevisionIds.add(slot.revisionId);
        if (slot.state.status === "loading") {
          slot.state = { ...slot.state, phase, loaded, total };
          this.emit();
        }
      },
      header: (header) => {
        this.scene.uploadHeader(slot.revisionId, header);
        slot.headerReceived = true;
        slot.headerBounds = header.bounds;
        slot.objectCount = header.objectCount;
        slot.state = {
          status: "uploading",
          revisionId: slot.revisionId,
          attributes: slot.attributes,
          uploadedChunks: 0,
          totalChunks: header.batchCount,
        };
        this.emit();
      },
      batch: (geometries, instances) => {
        this.scene.uploadBatch(slot.revisionId, geometries, instances);
        if (slot.state.status === "uploading") {
          slot.state = { ...slot.state, uploadedChunks: slot.state.uploadedChunks + 1 };
          this.emit();
        }
      },
      workerCount: (count) => {
        this.workers = count;
      },
    };

    try {
      await this.driver.load(
        { revisionId: slot.revisionId, attributes: slot.attributes },
        sink,
        abort.signal,
      );
      if (this.disposed || abort.signal.aborted) return;
      if (!slot.headerReceived) {
        this.failSlot(slot, "worker", "geometry driver completed without a header", true);
        return;
      }
      slot.state = {
        status: "ready",
        revisionId: slot.revisionId,
        attributes: slot.attributes,
        objectCount: slot.objectCount,
        bounds: slot.headerBounds,
      };
      this.emit();
    } catch (error: unknown) {
      if (this.disposed || abort.signal.aborted) return;
      if (error instanceof GeometryLoadError) {
        this.failSlot(slot, error.stage, error.message, error.retryable);
        return;
      }
      this.failSlot(slot, "worker", errorMessage(error), true);
    }
  }

  private failSlot(slot: RevisionSlot, stage: FailureStage, message: string, retryable: boolean): void {
    this.scene.removeRevision(slot.revisionId);
    this.removeSelectionForRevision(slot.revisionId);
    slot.state = {
      status: "failed",
      revisionId: slot.revisionId,
      attributes: slot.attributes,
      stage,
      message,
      retryable,
    };
    this.emit();
  }

  private resolveSettledDelivery(): void {
    const unsettled = [...this.slots.values()].some(({ state }) =>
      state.status === "queued" || state.status === "loading" || state.status === "uploading");
    if (unsettled) return;

    let fitCamera = false;
    if (!this.initialReady) this.initialReady = true;
    if (!this.origin.frozen) {
      const readyBounds = [...this.slots.values()].flatMap(({ state }) =>
        state.status === "ready" && state.bounds ? [state.bounds] : []);
      const offset = commonOrigin(readyBounds);
      this.origin = { frozen: true, offset };
      fitCamera = offset !== null;
    }
    if (this.origin.frozen && this.origin.offset) this.scene.setOrigin(this.origin.offset);
    this.applySection();
    this.scene.reveal(fitCamera);
    this.emit();
  }

  private applySection(): void {
    if (this.sectionZ === null) {
      this.scene.setSectionZ(null);
      return;
    }
    if (!this.origin.frozen || this.origin.offset === null) return;
    this.scene.setSectionZ(this.sectionZ - this.origin.offset[2]);
  }

  private removeSelectionForRevision(revisionId: RevisionId): void {
    if (this.selected?.ref.revisionId === revisionId) {
      this.selected = null;
      this.scene.select(null);
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
