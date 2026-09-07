"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Focus, RotateCcw } from "lucide-react";
import type { Discipline, DeliveryDetail } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { fetchDelivery, modelForDelivery } from "./delivery-api";
import { createDeliveryViewer } from "./delivery-controller";
import { FindingInspector } from "./finding-inspector";
import { parseObjectRef } from "./object-ref";
import type {
  DeliverySnapshot,
  DeliveryViewerController,
  ModelLoadState,
  ObjectRef,
  ViewerDiagnostics,
  ViewerHighlight,
  ViewerResourceStats,
} from "./types";

interface CombinedDeliveryViewerProps {
  readonly deliveryId: string;
}

interface ViewerVerificationHandle {
  inspect(): ViewerDiagnostics;
  select(ref: ObjectRef): void;
  highlight(groups: ViewerHighlight[]): void;
  isolate(refs: ObjectRef[] | null): void;
  section(z: number | null): void;
  dim(opacity: number): void;
  fitAll(): void;
  dispose(): ViewerResourceStats;
}

declare global {
  interface Window {
    __modelshelfViewerVerify?: boolean;
    __modelshelfViewer?: ViewerVerificationHandle;
  }
}

const DISCIPLINES: readonly Discipline[] = ["ARCH", "STRUCT", "MEP", "OTHER"];
const DEFAULT_VISIBILITY: Readonly<Record<Discipline, boolean>> = {
  ARCH: true,
  STRUCT: true,
  MEP: true,
  OTHER: true,
};

export function CombinedDeliveryViewer({
  deliveryId,
}: CombinedDeliveryViewerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<DeliveryViewerController | null>(null);
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [latestSnapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<Discipline, boolean>>({
    ...DEFAULT_VISIBILITY,
  });
  const [panelTab, setPanelTab] = useState<"selection" | "findings">("selection");
  const [initialRunId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const run = new URLSearchParams(window.location.search).get("run");
    return run && run.trim().length > 0 ? run : null;
  });

  useEffect(() => {
    const abortController = new AbortController();
    setDelivery(null);
    setSnapshot(null);
    setError(null);
    setVisible({ ...DEFAULT_VISIBILITY });
    void fetchDelivery(deliveryId, abortController.signal)
      .then(setDelivery)
      .catch((reason: unknown) => {
        if (abortController.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Delivery could not be loaded");
      });
    return () => abortController.abort();
  }, [deliveryId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!delivery || !canvas) return;

    const controller = createDeliveryViewer({ delivery, canvas });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    if (window.__modelshelfViewerVerify) {
      window.__modelshelfViewer = {
        inspect: () => controller.diagnostics(),
        select: (ref) => controller.select(parseObjectRef(ref)),
        highlight: (groups) => controller.setHighlights(groups),
        isolate: (refs) => controller.isolate(refs),
        section: (z) => controller.setSectionZ(z),
        dim: (opacity) => controller.setDimOpacity(opacity),
        fitAll: () => controller.fitAll(),
        dispose: () => {
          controller.dispose();
          return controller.resourceStats();
        },
      };
    }
    controller.start();

    return () => {
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
      if (window.__modelshelfViewerVerify) {
        delete window.__modelshelfViewer;
      }
    };
  }, [delivery]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Delivery unavailable / デリバリーを開けません</h1>
          <p className="mt-2 text-sm text-destructive">{error}</p>
          <Button className="mt-5" onClick={() => window.location.reload()}>
            <RotateCcw />
            Retry / 再試行
          </Button>
        </div>
      </main>
    );
  }

  if (!delivery) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <p className="text-sm text-muted-foreground" role="status">
          Loading delivery / デリバリーを読み込み中
        </p>
      </main>
    );
  }

  const snapshot: DeliverySnapshot = latestSnapshot ?? {
    delivery,
    models: delivery.models.map((model) => ({ status: "queued", model: modelForDelivery(model) })),
    selected: null,
    origin: null,
    initialReady: false,
    disposed: false,
  };
  const selected = snapshot.selected;
  return (
    <main className="flex min-h-screen flex-col bg-background xl:h-screen xl:overflow-hidden">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2">
        <span className="text-sm font-semibold">ModelShelf</span>
        <span aria-hidden className="h-5 w-px bg-border" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{delivery.delivery.label}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {delivery.delivery.id} · {delivery.models.length} sources
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {snapshot.initialReady
              ? "Combined view / 結合ビュー"
              : "Preparing shared origin / 共通原点を準備中"}
          </span>
          <Button variant="outline" size="sm" onClick={() => controllerRef.current?.fitAll()}>
            <Focus />
            Fit all / 全体表示
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="order-2 border-b bg-card xl:order-1 xl:min-h-0 xl:border-b-0 xl:border-r">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Sources / ソース</h2>
            <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
              {readyCount(snapshot.models)} of {snapshot.models.length} ready
            </p>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:block xl:max-h-[calc(100vh-7rem)] xl:space-y-2 xl:overflow-y-auto">
            {snapshot.models.map((model) => (
              <SourceRow
                key={model.model.id}
                state={model}
                onRetry={() => controllerRef.current?.retry(model.model.revisionId)}
              />
            ))}
          </div>
        </aside>

        <section className="order-1 flex min-h-[58vh] min-w-0 flex-col bg-viewer xl:order-2 xl:min-h-0">
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Visibility / 表示</span>
            {DISCIPLINES.map((discipline) => (
              <button
                key={discipline}
                type="button"
                aria-pressed={visible[discipline]}
                className="inline-flex h-7 items-center gap-1.5 border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                onClick={() => {
                  const next = !visible[discipline];
                  setVisible((current) => ({ ...current, [discipline]: next }));
                  controllerRef.current?.setDisciplineVisibility(discipline, next);
                }}
              >
                {visible[discipline] ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                {discipline}
              </button>
            ))}
          </div>
          <div className="relative min-h-0 flex-1">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 size-full touch-none"
              aria-label="Combined IFC model viewer"
            />
            <div className="pointer-events-none absolute bottom-3 left-3 border border-border bg-card/90 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              <span className="sm:hidden">Drag to orbit · Pinch to zoom · Two-finger pan</span>
              <span className="hidden sm:inline">Drag to orbit · Right-drag to pan · Scroll to zoom</span>
            </div>
          </div>
          <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-card px-3 py-1 text-xs text-muted-foreground">
            <span>Origin / 原点</span>
            <span className="font-mono text-[11px] tabular-nums text-foreground">
              {snapshot.origin ? `${snapshot.origin.join(", ")} m` : "pending"}
            </span>
          </div>
        </section>

        <aside className="order-3 border-t bg-card xl:min-h-0 xl:border-l xl:border-t-0">
          <div className="flex gap-1 border-b px-4 py-2" role="tablist" aria-label="Inspector panels">
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "selection"}
              onClick={() => setPanelTab("selection")}
              className="px-2 py-1 text-sm font-semibold aria-selected:underline"
            >
              Selection / 選択
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === "findings"}
              onClick={() => setPanelTab("findings")}
              className="px-2 py-1 text-sm font-semibold aria-selected:underline"
            >
              Findings / 指摘
            </button>
          </div>
          {panelTab === "findings" ? (
            <div className="p-4">
              <FindingInspector
                delivery={delivery}
                getController={() => controllerRef.current}
                selected={selected}
                initialRunId={initialRunId}
              />
            </div>
          ) : (
          <div className="p-4">
            <p className="mb-2 text-xs text-muted-foreground">Revision-qualified object identity</p>
            {selected ? (
              <dl className="space-y-3 text-xs">
                <Info label="Revision ID" value={selected.ref.revisionId} />
                <Info label="Object ID" value={selected.ref.objectId} />
                <Info label="GlobalId" value={selected.globalId ?? "Not provided"} />
                <Info label="IFC type" value={selected.ifcType} />
                <Info label="Name" value={selected.name ?? "Unnamed"} />
                <Info label="Placed geometry" value={`${selected.targets.length}`} />
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  size="sm"
                  onClick={() => controllerRef.current?.frame([selected.ref])}
                >
                  <Focus />
                  Frame selection / 選択を表示
                </Button>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select model geometry to inspect its ObjectRef and source metadata.
              </p>
            )}
          </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function SourceRow({
  state,
  onRetry,
}: {
  readonly state: ModelLoadState;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const progress = progressPercent(state);
  return (
    <article
      className="border border-border bg-card p-3 xl:mb-2"
      data-model-id={state.model.id}
      data-status={state.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{state.model.sourceModelName}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{state.model.filename}</p>
        </div>
        <span className="shrink-0 bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
          {state.model.discipline}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className={state.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
          {statusLabel(state)}
        </span>
        {progress !== null ? <span className="tabular-nums">{progress}%</span> : null}
      </div>
      {progress !== null ? (
        <div className="mt-2 h-1 bg-secondary" aria-hidden>
          <div
            className="h-1 bg-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
      {state.status === "failed" ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs text-destructive">{state.message}</p>
          {state.retryable ? (
            <Button className="mt-2" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw />
              Retry / 再試行
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function progressPercent(state: ModelLoadState): number | null {
  if (state.status === "ready") return 100;
  if (state.status === "uploading") {
    if (state.totalBatches === 0) return 100;
    return Math.round((state.uploadedBatches / state.totalBatches) * 100);
  }
  if (state.status !== "loading" || state.total === null || state.total === 0) return null;
  return Math.min(100, Math.round((state.loaded / state.total) * 100));
}

function statusLabel(state: ModelLoadState): string {
  if (state.status === "loading") {
    if (state.phase === "download") return "Downloading / ダウンロード中";
    if (state.phase === "parse") return "Parsing / 解析中";
    return "Preparing geometry / ジオメトリ準備中";
  }
  if (state.status === "uploading") return "Uploading / GPUへ転送中";
  if (state.status === "ready") return "Ready / 読み込み済み";
  if (state.status === "failed") return "Failed / 読み込み失敗";
  if (state.status === "disposed") return "Unloaded / 解放済み";
  return "Queued / 待機中";
}

function readyCount(states: readonly ModelLoadState[]): number {
  return states.filter(({ status }) => status === "ready").length;
}

function Info({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  );
}
