// Framework-independent viewer core types. This file never imports host
// application types: disciplines are plain strings, and the delivery is the
// minimal structural shape the viewer needs (id, label, models, runs, locked).

declare const revisionIdBrand: unique symbol;
declare const objectIdBrand: unique symbol;
declare const objectRefKeyBrand: unique symbol;

export type RevisionId = string & { readonly [revisionIdBrand]: "RevisionId" };
export type ObjectId = string & { readonly [objectIdBrand]: "ObjectId" };
export type ObjectRefKey = string & { readonly [objectRefKeyBrand]: "ObjectRefKey" };

/** Host-side discipline label; the core treats it as an opaque string. */
export type ModelDiscipline = string;

export type LoadPhase = "download" | "parse" | "geometry";
export type FailureStage = "download" | "parse" | "geometry" | "upload" | "worker";

export interface Bounds3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** Structural mirror of the host's model metadata. The host adapter maps its own
 * wire type onto this shape; the core never imports it. */
export interface ViewerModel {
  readonly id: string;
  readonly deliveryId: string;
  readonly discipline: ModelDiscipline;
  readonly sourceModelId: string;
  readonly sourceModelName: string;
  readonly filename: string;
  readonly contentSha256: string;
  readonly byteSize: number;
  readonly schemaLabel: string;
  readonly entityCount: number;
  readonly productCount: number;
  readonly lengthToMetre: number;
  readonly parseMs: number | null;
  readonly uploadedAt: string;
  readonly originatingSystem: string | null;
}

export interface ViewerDeliveryRecord {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly deliveryDate: string | null;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
  readonly modelCount: number;
  readonly productCount: number;
}

export interface ViewerRunSummary {
  readonly id: string;
  readonly status: string;
}

/** Structural mirror of the host's delivery detail payload. */
export interface ViewerDelivery {
  readonly delivery: ViewerDeliveryRecord;
  readonly models: readonly ViewerModel[];
  readonly runs: readonly ViewerRunSummary[];
  readonly locked: boolean;
}

export interface DeliveryModel extends ViewerModel {
  readonly revisionId: RevisionId;
  readonly fileUrl: string;
}

export interface ObjectRef {
  readonly revisionId: RevisionId;
  readonly objectId: ObjectId;
}

export interface TransferGeometry {
  readonly geometryExpressId: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Bounds3;
}

export interface TransferInstance {
  readonly expressId: number;
  readonly objectId: ObjectId;
  readonly globalId: string | null;
  readonly ifcType: string;
  readonly name: string | null;
  readonly discipline: ModelDiscipline;
  readonly geometryExpressId: number;
  readonly matrix: readonly number[];
  readonly color: readonly [number, number, number, number];
}

export interface WorkerHeader {
  readonly bounds: Bounds3 | null;
  readonly objectCount: number;
  readonly uniqueGeometryCount: number;
  readonly instanceCount: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly batchCount: number;
}

export type ModelLoadState =
  | Readonly<{ status: "queued"; model: DeliveryModel }>
  | Readonly<{
      status: "loading";
      model: DeliveryModel;
      phase: LoadPhase;
      loaded: number;
      total: number | null;
    }>
  | Readonly<{
      status: "uploading";
      model: DeliveryModel;
      uploadedBatches: number;
      totalBatches: number;
    }>
  | Readonly<{
      status: "ready";
      model: DeliveryModel;
      objectCount: number;
      bounds: Bounds3 | null;
    }>
  | Readonly<{
      status: "failed";
      model: DeliveryModel;
      stage: FailureStage;
      message: string;
      retryable: boolean;
    }>
  | Readonly<{ status: "disposed"; model: DeliveryModel }>;

export interface DrawTarget {
  readonly revisionId: RevisionId;
  readonly instanceId: number;
  readonly baseColor: readonly [number, number, number];
}

/** A paint group. Later groups win when an object appears in several groups. */
export interface ViewerHighlight {
  readonly refs: readonly ObjectRef[];
  /** CSS hex colour, e.g. "#e02424". */
  readonly color: string;
  readonly label?: string;
}

export interface SelectionRecord {
  readonly ref: ObjectRef;
  readonly expressId: number;
  readonly globalId: string | null;
  readonly ifcType: string;
  readonly name: string | null;
  readonly discipline: ModelDiscipline;
  readonly targets: readonly DrawTarget[];
}

export interface DeliverySnapshot {
  readonly delivery: ViewerDelivery;
  readonly models: readonly ModelLoadState[];
  readonly selected: SelectionRecord | null;
  readonly origin: readonly [number, number, number] | null;
  readonly initialReady: boolean;
  readonly disposed: boolean;
}

export interface ViewerResourceStats {
  readonly workers: number;
  readonly renderLoops: number;
  readonly renderers: number;
  readonly batches: number;
  readonly geometries: number;
  readonly materials: number;
  readonly gpuGeometries: number;
  readonly gpuTextures: number;
  readonly shaderPrograms: number;
  readonly renderFrame: number;
  readonly triangles: number;
}

export interface RendererDiagnostics {
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly roots: readonly Readonly<{
    revisionId: RevisionId;
    offset: readonly [number, number, number];
    visible: boolean;
  }>[];
  readonly highlightGroups: readonly Readonly<{
    label: string | null;
    color: string;
    requested: number;
    matched: number;
  }>[];
  readonly isolatedMatched: number | null;
  readonly selectedHidden: boolean;
  readonly clipping: boolean;
}

export interface ViewerDiagnostics {
  readonly snapshot: DeliverySnapshot;
  readonly resources: ViewerResourceStats;
  readonly renderer: RendererDiagnostics;
  readonly progressRevisionIds: readonly RevisionId[];
  readonly objects: readonly Readonly<{
    ref: ObjectRef;
    expressId: number;
    globalId: string | null;
    targetCount: number;
  }>[];
  readonly isolatedRequested: number | null;
  readonly sectionZ: number | null;
  readonly selectedHidden: boolean;
}

export interface DeliveryViewerController {
  start(): void;
  subscribe(listener: (snapshot: DeliverySnapshot) => void): () => void;
  snapshot(): DeliverySnapshot;
  retry(revisionId: RevisionId): void;
  select(ref: ObjectRef | null): void;
  frame(refs: readonly ObjectRef[]): void;
  setDisciplineVisibility(discipline: ModelDiscipline, visible: boolean): void;
  /** Paint revision-qualified paint groups; empty clears. Later groups win. */
  setHighlights(groups: readonly ViewerHighlight[]): void;
  /** Show only these objects; null clears. Composes with discipline visibility. */
  isolate(refs: readonly ObjectRef[] | null): void;
  /** Clip everything above z (metres, project origin); null removes the clip. */
  setSectionZ(z: number | null): void;
  /** Blend factor for non-highlighted objects while highlights are active, 0..1. */
  setDimOpacity(opacity: number): void;
  fitAll(): void;
  /** Move the camera and target in screen-relative increments. */
  nudgeCamera(horizontal: number, vertical: number): void;
  /** Scale camera distance from its target; values below 1 zoom in. */
  zoomCamera(factor: number): void;
  resourceStats(): ViewerResourceStats;
  diagnostics(): ViewerDiagnostics;
  dispose(): void;
}

export interface ViewerRenderer {
  uploadHeader(revisionId: RevisionId, header: WorkerHeader, model: DeliveryModel): void;
  uploadBatch(
    revisionId: RevisionId,
    geometries: readonly TransferGeometry[],
    instances: readonly TransferInstance[],
  ): void;
  removeRevision(revisionId: RevisionId): void;
  setOrigin(origin: readonly [number, number, number]): void;
  reveal(fitCamera: boolean): void;
  select(record: SelectionRecord | null): void;
  selection(ref: ObjectRef): SelectionRecord | null;
  selectionRecords(): readonly SelectionRecord[];
  frame(refs: readonly ObjectRef[]): void;
  setDisciplineVisibility(discipline: ModelDiscipline, visible: boolean): void;
  setHighlights(groups: readonly ViewerHighlight[]): void;
  isolate(refs: readonly ObjectRef[] | null): void;
  /** Clip above z in world coordinates; null removes the clip. */
  setSectionZ(worldZ: number | null): void;
  setDimOpacity(opacity: number): void;
  fitAll(): void;
  nudgeCamera(horizontal: number, vertical: number): void;
  zoomCamera(factor: number): void;
  diagnostics(): RendererDiagnostics;
  dispose(): void;
  resourceStats(): ViewerResourceStats;
}

export function revisionIdFrom(value: string): RevisionId {
  if (value.trim().length === 0) {
    throw new Error("revisionId must not be empty");
  }
  return value as RevisionId;
}

export function objectIdFrom(value: string): ObjectId {
  if (!/^occ_[0-9a-f]{16}$/.test(value)) {
    throw new Error("objectId must match occ_ plus 16 lowercase hex characters");
  }
  return value as ObjectId;
}

export function objectRefKey(ref: ObjectRef): ObjectRefKey {
  return `${ref.revisionId}\0${ref.objectId}` as ObjectRefKey;
}