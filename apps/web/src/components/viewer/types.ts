// Viewer contract shared by the scorecard/compare pages and the WebGL viewer.
// The pages import ONLY from this module and mount `IfcViewer` via next/dynamic.

import type { Discipline } from "@/lib/types";

export interface ViewerModelSource {
  modelId: string;
  discipline: Discipline;
  filename: string;
  /** Same-origin URL streaming the immutable IFC bytes, e.g. /api/models/<id>/file */
  url: string;
}

/** A paint group. Later groups win when an object appears in several groups. */
export interface ViewerHighlight {
  globalIds: string[];
  /** CSS hex colour, e.g. "#e02424". */
  color: string;
  label?: string;
}

export interface ViewerSelection {
  globalId: string;
  modelId: string;
  ifcType: string;
  name: string | null;
  expressId: number;
}

export interface ViewerModelReady {
  modelId: string;
  productCount: number;
  storeys: string[];
  /** Global ids present in this model — pages use it to warn about stale findings. */
  globalIdCount: number;
}

export interface ViewerProgress {
  modelId: string;
  phase: "download" | "parse" | "geometry" | "upload" | "done";
  loaded: number;
  total: number;
}

export interface IfcViewerHandle {
  /** Frame the given objects; no-op when none are loaded. */
  zoomToObjects(globalIds: string[]): void;
  /** Hide everything except these objects. */
  isolate(globalIds: string[]): void;
  clearIsolation(): void;
  /** Outline + frame a single object, or clear with null. */
  select(globalId: string | null): void;
  setStoreyFilter(storey: string | null): void;
  setDisciplineVisibility(discipline: Discipline, visible: boolean): void;
  /** Clip everything above z (metres, project origin); null removes the clip. */
  setSectionZ(z: number | null): void;
  /** Global transparency for non-highlighted objects, 0..1. */
  setDimOpacity(opacity: number): void;
  fitAll(): void;
}

export interface IfcViewerProps {
  models: ViewerModelSource[];
  highlights?: ViewerHighlight[];
  /** Render non-highlighted geometry translucent so highlights read clearly. */
  dimOthers?: boolean;
  onSelect?: (selection: ViewerSelection | null) => void;
  onProgress?: (progress: ViewerProgress) => void;
  onReady?: (models: ViewerModelReady[]) => void;
  onError?: (error: { modelId: string; message: string }) => void;
  className?: string;
}
