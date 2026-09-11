import type { ObjectId, ObjectRef, RevisionId } from "./object-ref";

declare const geometryDriverBrand: unique symbol;
declare const viewerSceneBrand: unique symbol;

export type Attributes = Readonly<Record<string, string>>;

export interface Bounds3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export type LoadPhase = "download" | "parse" | "geometry";
export type FailureStage = "download" | "parse" | "geometry" | "upload" | "worker";

export interface ViewerSource {
  readonly revisionId: RevisionId;
  readonly attributes: Attributes;
}

export type SharedOrigin =
  | { readonly frozen: false }
  | { readonly frozen: true; readonly offset: readonly [number, number, number] | null };

export type ViewerScene = {
  readonly [viewerSceneBrand]?: true;
  readonly sources: readonly ViewerSource[];
};

export interface GeometryDriver {
  readonly [geometryDriverBrand]: true;
}

export type Matrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type Rgba = readonly [number, number, number, number];

export interface PreparedGeometry {
  readonly id: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Bounds3;
}

export interface PreparedInstance {
  readonly objectId: ObjectId;
  readonly geometryId: string;
  readonly matrix: Matrix4;
  readonly color: Rgba;
  readonly name?: string | null;
  readonly attributes?: Attributes;
}

export interface PreparedModel {
  readonly bounds: Bounds3 | null;
  readonly geometries: readonly PreparedGeometry[];
  readonly instances: readonly PreparedInstance[];
}

export interface PreparedGeometryDriverOptions {
  readonly load: (
    source: ViewerSource,
    signal: AbortSignal,
  ) => PreparedModel | Promise<PreparedModel>;
}

interface SourceStateBase {
  readonly revisionId: RevisionId;
  readonly attributes: Attributes;
}

export type SourceState =
  | Readonly<SourceStateBase & { status: "queued" }>
  | Readonly<SourceStateBase & {
      status: "loading";
      phase: LoadPhase;
      loaded: number;
      total: number | null;
    }>
  | Readonly<SourceStateBase & {
      status: "uploading";
      uploadedChunks: number;
      totalChunks: number;
    }>
  | Readonly<SourceStateBase & {
      status: "ready";
      objectCount: number;
      bounds: Bounds3 | null;
    }>
  | Readonly<SourceStateBase & {
      status: "failed";
      stage: FailureStage;
      message: string;
      retryable: boolean;
    }>
  | Readonly<SourceStateBase & { status: "disposed" }>;

export interface SelectedObject {
  readonly ref: ObjectRef;
  readonly name: string | null;
  readonly attributes: Attributes;
  readonly placements: number;
}

export interface ViewerSnapshot {
  readonly sources: readonly SourceState[];
  readonly selected: SelectedObject | null;
  readonly selectionHidden: boolean;
  readonly origin: SharedOrigin;
  readonly initialReady: boolean;
  readonly disposed: boolean;
}

export interface HighlightGroup {
  readonly refs: readonly ObjectRef[];
  readonly color: string;
  readonly label?: string;
}

export interface Overlay {
  readonly highlights: readonly HighlightGroup[];
  readonly isolate: readonly ObjectRef[] | null;
  readonly dimOpacity: number;
  readonly frame: readonly ObjectRef[] | null;
}

export const NO_OVERLAY: Overlay = {
  highlights: [],
  isolate: null,
  dimOpacity: 1,
  frame: null,
};

export interface HighlightResult {
  readonly label: string | null;
  readonly color: string;
  readonly requested: number;
  readonly matched: number;
}

export interface OverlayResult {
  readonly groups: readonly HighlightResult[];
  readonly isolatedMatched: number | null;
  readonly missing: readonly ObjectRef[];
  readonly selectionHidden: boolean;
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

export interface SceneDiagnostics {
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly roots: readonly Readonly<{
    revisionId: RevisionId;
    offset: readonly [number, number, number];
    visible: boolean;
  }>[];
  readonly highlightGroups: readonly HighlightResult[];
  readonly isolatedMatched: number | null;
  readonly clipping: boolean;
}

export interface ViewerDiagnostics {
  readonly snapshot: ViewerSnapshot;
  readonly resources: ViewerResourceStats;
  readonly renderer: SceneDiagnostics;
  readonly progressRevisionIds: readonly RevisionId[];
  readonly objects: readonly Readonly<{
    ref: ObjectRef;
    name: string | null;
    attributes: Attributes;
    targetCount: number;
  }>[];
  readonly isolatedRequested: number | null;
  readonly sectionZ: number | null;
  readonly selectedHidden: boolean;
}

export type Unsubscribe = () => void;

export interface ModelViewerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly scene: ViewerScene;
  readonly geometry: GeometryDriver;
  readonly selectionColor: string;
}

export interface ModelViewer {
  start(): void;
  subscribe(listener: (snapshot: ViewerSnapshot) => void): Unsubscribe;
  snapshot(): ViewerSnapshot;
  retry(revisionId: RevisionId): void;
  select(ref: ObjectRef | null, options?: { readonly frame?: boolean }): void;
  applyOverlay(overlay: Overlay): OverlayResult;
  missing(refs: readonly ObjectRef[]): readonly ObjectRef[];
  setHidden(attribute: string, values: readonly string[]): void;
  setSectionZ(z: number | null): void;
  fitAll(): void;
  nudgeCamera(horizontal: number, vertical: number): void;
  zoomCamera(factor: number): void;
  resourceStats(): ViewerResourceStats;
  diagnostics(): ViewerDiagnostics;
  dispose(): void;
}
