"use client";

import { useEffect, useRef } from "react";
import {
  NO_OVERLAY,
  parseObjectRef,
  type HighlightGroup,
  type ModelViewer,
  type ObjectRef,
  type Overlay,
  type ViewerDiagnostics,
  type ViewerResourceStats,
} from "model-viewer";

interface ViewerVerificationHandle {
  inspect(): ViewerDiagnostics;
  select(ref: ObjectRef | null): void;
  highlight(groups: HighlightGroup[]): void;
  isolate(refs: ObjectRef[] | null): void;
  section(z: number | null): void;
  dim(opacity: number): void;
  fitAll(): void;
  nudgeCamera(horizontal: number, vertical: number): void;
  zoomCamera(factor: number): void;
  dispose(): ViewerResourceStats;
}

declare global {
  interface Window {
    __modelshelfViewerVerify?: boolean;
    __modelshelfViewer?: ViewerVerificationHandle;
  }
}

export function useVerificationHandle(viewer: ModelViewer | null): void {
  const draft = useRef<Overlay>({ ...NO_OVERLAY });

  useEffect(() => {
    draft.current = { ...NO_OVERLAY };
    if (!viewer || !window.__modelshelfViewerVerify) return;
    window.__modelshelfViewer = {
      inspect: () => viewer.diagnostics(),
      select: (ref) => viewer.select(ref === null ? null : parseObjectRef(ref)),
      highlight: (groups) => {
        draft.current = { ...draft.current, highlights: groups };
        viewer.applyOverlay(draft.current);
      },
      isolate: (refs) => {
        draft.current = { ...draft.current, isolate: refs };
        viewer.applyOverlay(draft.current);
      },
      section: (z) => viewer.setSectionZ(z),
      dim: (opacity) => {
        draft.current = { ...draft.current, dimOpacity: opacity };
        viewer.applyOverlay(draft.current);
      },
      fitAll: () => viewer.fitAll(),
      nudgeCamera: (horizontal, vertical) => viewer.nudgeCamera(horizontal, vertical),
      zoomCamera: (factor) => viewer.zoomCamera(factor),
      dispose: () => {
        viewer.dispose();
        return viewer.resourceStats();
      },
    };
    return () => {
      delete window.__modelshelfViewer;
    };
  }, [viewer]);
}
