"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Focus, RotateCcw } from "lucide-react";

import type {
  DeliverySnapshot,
  DeliveryViewerController,
  ModelDiscipline,
  ModelLoadState,
  ObjectRef,
  ViewerDelivery,
  ViewerDiagnostics,
  ViewerHighlight,
  ViewerResourceStats,
} from "./core/viewer-types";
import { createDeliveryViewer, type ModelFileUrlResolver } from "./core/delivery-controller";
import { modelForDelivery } from "./core/delivery-model";
import { parseObjectRef } from "./core/object-ref";
import type { GeometryLoader } from "./core/geometry-loader";
import { createIfcGeometryLoader } from "./core/ifc-loader";

export interface LoadDelivery {
  (deliveryId: string, signal?: AbortSignal): Promise<ViewerDelivery>;
}

export interface CombinedDeliveryViewerProps {
  readonly deliveryId: string;
  /** Host supplies the wire fetch that turns a delivery id into a
   * `ViewerDelivery`. The core never knows how bytes reach the host. */
  readonly loadDelivery: LoadDelivery;
  /** Host controls how model descriptors resolve to loadable resources. */
  readonly resolveModelFileUrl: ModelFileUrlResolver;
  /** Optional geometry driver. Defaults to the real IFC path (`model-viewer/ifc`). */
  readonly geometryLoader?: GeometryLoader;
  /** Directory that serves `web-ifc.wasm`. Ignored when `geometryLoader` is provided. */
  readonly wasmBaseUrl?: string;
  /**
   * Controller seam for the host review panel: the viewer publishes its
   * controller here (or null on dispose) so the panel drives highlights
   * through the generic controller only. No host types cross this seam.
   */
  readonly onController?: (controller: DeliveryViewerController | null) => void;
  /** Host-provided inspector for the Findings tab. The viewer never learns finding types. */
  readonly inspector: React.ReactNode;
  /** Host-selected language for the viewer chrome. */
  readonly locale?: ViewerLocale;
  /** Layout mode for desktop and meeting presentation surfaces. */
  readonly presentation?: "desk" | "meeting";
}

interface ViewerVerificationHandle {
  inspect(): ViewerDiagnostics;
  select(ref: ObjectRef | null): void;
  highlight(groups: ViewerHighlight[]): void;
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
    __modelshelfViewers?: ViewerVerificationHandle[];
  }
}

const DEFAULT_VISIBILITY: Readonly<Record<ModelDiscipline, boolean>> = {
  ARCH: true,
  STRUCT: true,
  MEP: true,
  OTHER: true,
};

function disciplinesInDelivery(delivery: ViewerDelivery): ModelDiscipline[] {
  const seen = new Set<ModelDiscipline>();
  const disciplines: ModelDiscipline[] = [];
  for (const model of delivery.models) {
    if (seen.has(model.discipline)) continue;
    seen.add(model.discipline);
    disciplines.push(model.discipline);
  }
  return disciplines;
}

function visibleWithDelivery(current: Record<ModelDiscipline, boolean>, delivery: ViewerDelivery): Record<ModelDiscipline, boolean> {
  const next = { ...current };
  for (const discipline of disciplinesInDelivery(delivery)) {
    if (next[discipline] === undefined) next[discipline] = true;
  }
  return next;
}

export type ViewerLocale = "ja" | "en";

interface ViewerCopy {
  readonly deliveryUnavailable: string;
  readonly retry: string;
  readonly loadingDelivery: string;
  readonly sourceCount: (count: number) => string;
  readonly combinedView: string;
  readonly preparingOrigin: string;
  readonly fitAll: string;
  readonly sources: string;
  readonly readyCount: (ready: number, total: number) => string;
  readonly visibility: string;
  readonly canvasLabel: string;
  readonly touchHelp: string;
  readonly pointerHelp: string;
  readonly keyboardHelp: string;
  readonly origin: string;
  readonly pending: string;
  readonly inspectorPanels: string;
  readonly selection: string;
  readonly findings: string;
  readonly objectIdentity: string;
  readonly revisionId: string;
  readonly objectId: string;
  readonly globalId: string;
  readonly ifcType: string;
  readonly name: string;
  readonly placedGeometry: string;
  readonly frameSelection: string;
  readonly noSelection: string;
  readonly notProvided: string;
  readonly unnamed: string;
  readonly downloading: string;
  readonly parsing: string;
  readonly preparingGeometry: string;
  readonly uploading: string;
  readonly ready: string;
  readonly failed: string;
  readonly unloaded: string;
  readonly queued: string;
}

const VIEWER_COPY: Record<ViewerLocale, ViewerCopy> = {
  ja: {
    deliveryUnavailable: "デリバリーを開けません",
    retry: "再試行",
    loadingDelivery: "デリバリーを読み込み中",
    sourceCount: (count) => `${count}ソース`,
    combinedView: "結合ビュー",
    preparingOrigin: "共通原点を準備中",
    fitAll: "全体表示",
    sources: "ソース",
    readyCount: (ready, total) => `${total}件中${ready}件を読み込み済み`,
    visibility: "表示",
    canvasLabel: "結合IFCモデルビューア",
    touchHelp: "ドラッグ: 回転 · ピンチ: ズーム · 2本指: 移動",
    pointerHelp: "ドラッグ: 回転 · 右ドラッグ: 移動 · スクロール: ズーム",
    keyboardHelp: "矢印: 移動 · +/−: ズーム · Home: 全体表示",
    origin: "原点",
    pending: "準備中",
    inspectorPanels: "詳細パネル",
    selection: "選択",
    findings: "指摘",
    objectIdentity: "リビジョンを含むオブジェクト識別子",
    revisionId: "リビジョンID",
    objectId: "オブジェクトID",
    globalId: "GlobalId",
    ifcType: "IFCタイプ",
    name: "名称",
    placedGeometry: "配置ジオメトリ",
    frameSelection: "選択を表示",
    noSelection: "モデルのジオメトリを選択すると、オブジェクト識別子とソース情報を確認できます。",
    notProvided: "未登録",
    unnamed: "名称なし",
    downloading: "ダウンロード中",
    parsing: "解析中",
    preparingGeometry: "ジオメトリ準備中",
    uploading: "GPUへ転送中",
    ready: "読み込み済み",
    failed: "読み込み失敗",
    unloaded: "解放済み",
    queued: "待機中",
  },
  en: {
    deliveryUnavailable: "Delivery unavailable",
    retry: "Retry",
    loadingDelivery: "Loading delivery",
    sourceCount: (count) => `${count} ${count === 1 ? "source" : "sources"}`,
    combinedView: "Combined view",
    preparingOrigin: "Preparing shared origin",
    fitAll: "Fit all",
    sources: "Sources",
    readyCount: (ready, total) => `${ready} of ${total} ready`,
    visibility: "Visibility",
    canvasLabel: "Combined IFC model viewer",
    touchHelp: "Drag: orbit · Pinch: zoom · Two-finger drag: pan",
    pointerHelp: "Drag: orbit · Right-drag: pan · Scroll: zoom",
    keyboardHelp: "Arrows: pan · +/−: zoom · Home: fit all",
    origin: "Origin",
    pending: "Pending",
    inspectorPanels: "Inspector panels",
    selection: "Selection",
    findings: "Findings",
    objectIdentity: "Revision-qualified object identity",
    revisionId: "Revision ID",
    objectId: "Object ID",
    globalId: "GlobalId",
    ifcType: "IFC type",
    name: "Name",
    placedGeometry: "Placed geometry",
    frameSelection: "Frame selection",
    noSelection: "Select model geometry to inspect its object identity and source metadata.",
    notProvided: "Not provided",
    unnamed: "Unnamed",
    downloading: "Downloading",
    parsing: "Parsing",
    preparingGeometry: "Preparing geometry",
    uploading: "Uploading to GPU",
    ready: "Ready",
    failed: "Failed",
    unloaded: "Unloaded",
    queued: "Queued",
  },
};

const DEFAULT_LOCALE: ViewerLocale = "ja";


export function CombinedDeliveryViewer({
  deliveryId,
  loadDelivery,
  resolveModelFileUrl,
  geometryLoader,
  wasmBaseUrl,
  onController,
  inspector,
  locale = DEFAULT_LOCALE,
  presentation = "desk",
}: CombinedDeliveryViewerProps): React.JSX.Element {
  const copy = VIEWER_COPY[locale];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<DeliveryViewerController | null>(null);
  const [delivery, setDelivery] = useState<ViewerDelivery | null>(null);
  const [latestSnapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<ModelDiscipline, boolean>>({
    ...DEFAULT_VISIBILITY,
  });
  const [panelTab, setPanelTab] = useState<"selection" | "findings">("findings");
  const keyboardHelpId = useId();
  const onControllerRef = useRef(onController);
  onControllerRef.current = onController;
  const resolveModelFileUrlRef = useRef(resolveModelFileUrl);
  resolveModelFileUrlRef.current = resolveModelFileUrl;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  function handleCanvasKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>): void {
    const controller = controllerRef.current;
    if (!controller) return;
    if (event.key === "ArrowLeft") controller.nudgeCamera(-1, 0);
    else if (event.key === "ArrowRight") controller.nudgeCamera(1, 0);
    else if (event.key === "ArrowUp") controller.nudgeCamera(0, 1);
    else if (event.key === "ArrowDown") controller.nudgeCamera(0, -1);
    else if (event.key === "+" || event.key === "=") controller.zoomCamera(0.85);
    else if (event.key === "-" || event.key === "_") controller.zoomCamera(1.15);
    else if (event.key === "Home") controller.fitAll();
    else return;
    event.preventDefault();
  }

  useEffect(() => {
    const abortController = new AbortController();
    setDelivery(null);
    setSnapshot(null);
    setError(null);
    setVisible({ ...DEFAULT_VISIBILITY });
    void loadDelivery(deliveryId, abortController.signal)
      .then((loaded) => {
        setVisible((current) => visibleWithDelivery(current, loaded));
        setDelivery(loaded);
      })
      .catch((reason: unknown) => {
        if (abortController.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Delivery could not be loaded");
      });
    return () => abortController.abort();
  }, [deliveryId, loadDelivery]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!delivery || !canvas) return;

    const controller = createDeliveryViewer({
      delivery,
      canvas,
      geometryLoader: geometryLoader ?? createIfcGeometryLoader({ wasmBaseUrl }),
      modelFileUrl: (model) => resolveModelFileUrlRef.current(model),
    });
    const verificationHandle: ViewerVerificationHandle = {
      inspect: () => controller.diagnostics(),
      select: (ref) => controller.select(ref === null ? null : parseObjectRef(ref)),
      highlight: (groups) => controller.setHighlights(groups),
      isolate: (refs) => controller.isolate(refs),
      section: (z) => controller.setSectionZ(z),
      dim: (opacity) => controller.setDimOpacity(opacity),
      fitAll: () => controller.fitAll(),
      nudgeCamera: (horizontal, vertical) => controller.nudgeCamera(horizontal, vertical),
      zoomCamera: (factor) => controller.zoomCamera(factor),
      dispose: () => {
        controller.dispose();
        return controller.resourceStats();
      },
    };
    controllerRef.current = controller;
    onControllerRef.current?.(controller);
    const unsubscribe = controller.subscribe(setSnapshot);
    if (window.__modelshelfViewerVerify) {
      window.__modelshelfViewer = verificationHandle;
      window.__modelshelfViewers = [...(window.__modelshelfViewers ?? []), verificationHandle];
    }
    controller.start();
    for (const [discipline, shown] of Object.entries(visibleRef.current)) {
      if (shown === false) controller.setDisciplineVisibility(discipline, false);
    }

    return () => {
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
      onControllerRef.current?.(null);
      if (window.__modelshelfViewerVerify) {
        const remaining = (window.__modelshelfViewers ?? []).filter(
          (candidate) => candidate !== verificationHandle,
        );
        if (remaining.length > 0) {
          window.__modelshelfViewers = remaining;
          window.__modelshelfViewer = remaining[remaining.length - 1];
        } else {
          delete window.__modelshelfViewers;
          delete window.__modelshelfViewer;
        }
      }
    };
  }, [delivery, geometryLoader, wasmBaseUrl]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">{copy.deliveryUnavailable}</h1>
          <p className="mt-2 text-sm text-destructive">{error}</p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium whitespace-nowrap text-foreground transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
            data-viewer-retry
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="size-3.5" />
            {copy.retry}
          </button>
        </div>
      </main>
    );
  }

  if (!delivery) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <p className="text-sm text-muted-foreground" role="status">
          {copy.loadingDelivery}
        </p>
      </main>
    );
  }

  const snapshot: DeliverySnapshot = latestSnapshot ?? {
    delivery,
    models: delivery.models.map((model) => ({
      status: "queued",
      model: modelForDelivery(model, resolveModelFileUrl(model)),
    })),
    selected: null,
    origin: null,
    initialReady: false,
    disposed: false,
  };
  const selected = snapshot.selected;
  return (
    <main
      className={
        presentation === "meeting"
          ? "flex min-h-[calc(100vh-8rem)] flex-col bg-background"
          : "flex min-h-screen flex-col bg-background xl:h-screen xl:overflow-hidden"
      }
      data-presentation={presentation}
    >
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2">
        <span className="text-sm font-semibold">ModelShelf</span>
        <span aria-hidden className="h-5 w-px bg-border" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{delivery.delivery.label}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {delivery.delivery.id} · {copy.sourceCount(delivery.models.length)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {snapshot.initialReady ? copy.combinedView : copy.preparingOrigin}
          </span>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium whitespace-nowrap text-foreground transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
            data-viewer-fit
            onClick={() => controllerRef.current?.fitAll()}
          >
            <Focus className="size-3.5" />
            {copy.fitAll}
          </button>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 ${
          presentation === "meeting"
            ? "xl:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)]"
            : "xl:grid-cols-[300px_minmax(0,1fr)_320px]"
        }`}
      >
        <aside
          className={
            presentation === "meeting"
              ? "order-3 border-t bg-card xl:col-span-2"
              : "order-2 border-b bg-card xl:order-1 xl:min-h-0 xl:border-b-0 xl:border-r"
          }
        >
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">{copy.sources}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
              {copy.readyCount(readyCount(snapshot.models), snapshot.models.length)}
            </p>
          </div>
          <div
            className={
              presentation === "meeting"
                ? "grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3"
                : "grid gap-2 p-3 sm:grid-cols-2 xl:block xl:max-h-[calc(100vh-7rem)] xl:space-y-2 xl:overflow-y-auto"
            }
          >
            {snapshot.models.map((model) => (
              <SourceRow
                key={model.model.id}
                state={model}
                onRetry={() => controllerRef.current?.retry(model.model.revisionId)}
                locale={locale}
              />
            ))}
          </div>
        </aside>

        <section
          className={`order-1 flex min-h-[58vh] min-w-0 flex-col bg-viewer xl:order-2 ${
            presentation === "meeting" ? "xl:min-h-[68vh]" : "xl:min-h-0"
          }`}
        >
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5">
            <span className="mr-1 text-xs text-muted-foreground">{copy.visibility}</span>
            {disciplinesInDelivery(delivery).map((discipline) => {
              const shown = visible[discipline] !== false;
              return (
                <button
                  key={discipline}
                  type="button"
                  aria-pressed={shown}
                  className="inline-flex min-h-11 items-center gap-1.5 border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground sm:min-h-8"
                  data-discipline-toggle={discipline}
                  onClick={() => {
                    const next = !shown;
                    setVisible((current) => ({ ...current, [discipline]: next }));
                    controllerRef.current?.setDisciplineVisibility(discipline, next);
                  }}
                >
                  {shown ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                  {discipline}
                </button>
              );
            })}
          </div>
          <div className="viewer-plate relative min-h-0 flex-1">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 size-full touch-none"
              aria-label={copy.canvasLabel}
              aria-describedby={keyboardHelpId}
              tabIndex={0}
              onKeyDown={handleCanvasKeyDown}
            />
            <div
              id={keyboardHelpId}
              className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] border border-border bg-card/90 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm"
            >
              <span className="sm:hidden">{copy.touchHelp}</span>
              <span className="hidden sm:inline">{copy.pointerHelp} · {copy.keyboardHelp}</span>
            </div>
          </div>
          <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-card px-3 py-1 text-xs text-muted-foreground">
            <span>{copy.origin}</span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {snapshot.origin ? `${snapshot.origin.join(", ")} m` : copy.pending}
            </span>
          </div>
        </section>

        <aside
          className={
            presentation === "meeting"
              ? "order-2 border-t bg-card xl:order-2 xl:min-h-0 xl:border-l xl:border-t-0"
              : "order-3 border-t bg-card xl:min-h-0 xl:border-l xl:border-t-0"
          }
        >
          <div className="flex gap-1 border-b px-4 py-2" role="tablist" aria-label={copy.inspectorPanels}>
            <button
              type="button"
              role="tab"
              data-inspector-tab="selection"
              aria-selected={panelTab === "selection"}
              onClick={() => setPanelTab("selection")}
              className="min-h-11 px-2 py-1 text-sm font-semibold aria-selected:underline"
            >
              {copy.selection}
            </button>
            <button
              type="button"
              role="tab"
              data-inspector-tab="findings"
              aria-selected={panelTab === "findings"}
              onClick={() => setPanelTab("findings")}
              className="min-h-11 px-2 py-1 text-sm font-semibold aria-selected:underline"
            >
              {copy.findings}
            </button>
          </div>
          {panelTab === "findings" ? (
            <div
              className={`space-y-4 overflow-y-auto p-4 ${
                presentation === "meeting" ? "max-h-[75vh]" : "max-h-[calc(100vh-12rem)]"
              }`}
            >
              {inspector}
            </div>
          ) : (
          <div className="p-4">
            <p className="mb-2 text-xs text-muted-foreground">{copy.objectIdentity}</p>
            {selected ? (
              <dl className="space-y-3 text-xs">
                <Info label={copy.revisionId} value={selected.ref.revisionId} />
                <Info label={copy.objectId} value={selected.ref.objectId} />
                <Info label={copy.globalId} value={selected.globalId ?? copy.notProvided} />
                <Info label={copy.ifcType} value={selected.ifcType} />
                <Info label={copy.name} value={selected.name ?? copy.unnamed} />
                <Info label={copy.placedGeometry} value={`${selected.targets.length}`} />
                <button
                  type="button"
                  className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium whitespace-nowrap text-foreground transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                  onClick={() => controllerRef.current?.frame([selected.ref])}
                >
                  <Focus className="size-3.5" />
                  {copy.frameSelection}
                </button>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{copy.noSelection}</p>
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
  locale,
}: {
  readonly state: ModelLoadState;
  readonly onRetry: () => void;
  readonly locale: ViewerLocale;
}): React.JSX.Element {
  const copy = VIEWER_COPY[locale];
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
        <span className="shrink-0 bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
          {state.model.discipline}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className={state.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
          {statusLabel(state, locale)}
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
            <button
              type="button"
              className="mt-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium whitespace-nowrap text-foreground transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
              onClick={onRetry}
              data-viewer-retry
            >
              <RotateCcw className="size-3.5" />
              {copy.retry}
            </button>
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

function statusLabel(state: ModelLoadState, locale: ViewerLocale): string {
  const copy = VIEWER_COPY[locale];
  if (state.status === "loading") {
    if (state.phase === "download") return copy.downloading;
    if (state.phase === "parse") return copy.parsing;
    return copy.preparingGeometry;
  }
  if (state.status === "uploading") return copy.uploading;
  if (state.status === "ready") return copy.ready;
  if (state.status === "failed") return copy.failed;
  if (state.status === "disposed") return copy.unloaded;
  return copy.queued;
}

function readyCount(states: readonly ModelLoadState[]): number {
  return states.filter(({ status }) => status === "ready").length;
}

function Info({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}