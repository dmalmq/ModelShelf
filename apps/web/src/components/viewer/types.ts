import type {
  Discipline,
  DeliveryDetail,
  ModelInfo,
  ObjectRef as SharedObjectRef,
} from "@/lib/types";

declare const revisionIdBrand: unique symbol;
declare const objectIdBrand: unique symbol;
declare const objectRefKeyBrand: unique symbol;

export type RevisionId = string & { readonly [revisionIdBrand]: "RevisionId" };
export type ObjectId = string & { readonly [objectIdBrand]: "ObjectId" };
export type ObjectRefKey = string & { readonly [objectRefKeyBrand]: "ObjectRefKey" };

export type LoadPhase = "download" | "parse" | "geometry";
export type FailureStage = "download" | "parse" | "geometry" | "upload" | "worker";

export interface Bounds3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface DeliveryModel extends ModelInfo {
  readonly revisionId: RevisionId;
  readonly fileUrl: string;
}

export interface ObjectRef extends SharedObjectRef {
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
  readonly discipline: Discipline;
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

export interface SelectionRecord {
  readonly ref: ObjectRef;
  readonly expressId: number;
  readonly globalId: string | null;
  readonly ifcType: string;
  readonly name: string | null;
  readonly discipline: Discipline;
  readonly targets: readonly DrawTarget[];
}

export interface DeliverySnapshot {
  readonly delivery: DeliveryDetail;
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
}

export interface RendererDiagnostics {
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly roots: readonly Readonly<{
    revisionId: RevisionId;
    offset: readonly [number, number, number];
    visible: boolean;
  }>[];
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
}

export interface DeliveryViewerController {
  start(): void;
  subscribe(listener: (snapshot: DeliverySnapshot) => void): () => void;
  snapshot(): DeliverySnapshot;
  retry(revisionId: RevisionId): void;
  select(ref: ObjectRef | null): void;
  frame(refs: readonly ObjectRef[]): void;
  setDisciplineVisibility(discipline: Discipline, visible: boolean): void;
  fitAll(): void;
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
  setDisciplineVisibility(discipline: Discipline, visible: boolean): void;
  fitAll(): void;
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
