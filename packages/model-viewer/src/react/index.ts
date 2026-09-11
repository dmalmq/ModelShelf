"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createModelViewer } from "../viewer";
import type { GeometryDriver, ModelViewer, ViewerScene, ViewerSnapshot } from "../types";

export interface UseModelViewerOptions {
  readonly scene: ViewerScene | null;
  readonly geometry: GeometryDriver | null;
  readonly selectionColor: string;
}

export interface ViewerCanvasProps {
  readonly ref: RefObject<HTMLCanvasElement | null>;
  readonly tabIndex: 0;
  readonly onKeyDown: (event: KeyboardEvent<HTMLCanvasElement>) => void;
}

export interface UseModelViewerResult {
  readonly viewer: ModelViewer | null;
  readonly snapshot: ViewerSnapshot | null;
  readonly canvasProps: ViewerCanvasProps;
}

export function useModelViewer(options: UseModelViewerOptions): UseModelViewerResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const [viewer, setViewer] = useState<ModelViewer | null>(null);
  const [snapshot, setSnapshot] = useState<ViewerSnapshot | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = options.scene;
    const geometry = options.geometry;
    if (!canvas || !scene || !geometry) {
      setViewer(null);
      setSnapshot(null);
      return;
    }
    const next = createModelViewer({
      canvas,
      scene,
      geometry,
      selectionColor: options.selectionColor,
    });
    viewerRef.current = next;
    const unsubscribe = next.subscribe(setSnapshot);
    next.start();
    setViewer(next);
    return () => {
      unsubscribe();
      next.dispose();
      if (viewerRef.current === next) viewerRef.current = null;
      setViewer(null);
      setSnapshot(null);
    };
  }, [options.scene, options.selectionColor, options.geometry]);

  const canvasProps = useMemo<ViewerCanvasProps>(
    () => ({
      ref: canvasRef,
      tabIndex: 0,
      onKeyDown: (event) => {
        const current = viewerRef.current;
        if (!current) return;
        if (event.key === "ArrowLeft") current.nudgeCamera(-1, 0);
        else if (event.key === "ArrowRight") current.nudgeCamera(1, 0);
        else if (event.key === "ArrowUp") current.nudgeCamera(0, 1);
        else if (event.key === "ArrowDown") current.nudgeCamera(0, -1);
        else if (event.key === "+" || event.key === "=") current.zoomCamera(0.85);
        else if (event.key === "-" || event.key === "_") current.zoomCamera(1.15);
        else if (event.key === "Home") current.fitAll();
        else return;
        event.preventDefault();
      },
    }),
    [],
  );

  return { viewer, snapshot, canvasProps };
}
