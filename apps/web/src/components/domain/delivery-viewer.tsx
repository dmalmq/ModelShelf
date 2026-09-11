"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Eye, EyeOff, Focus, RotateCcw } from "lucide-react";
import { revisionIdFrom, type GeometryDriver, type ModelViewer, type SourceState, type ViewerScene } from "model-viewer";
import { useModelViewer } from "model-viewer/react";
import type { Discipline, DeliveryDetail, ModelInfo } from "@/lib/types";
import { VIEWER_COPY, type Locale } from "@/lib/i18n";
import { VIEWER_HIGHLIGHT } from "@/lib/palette";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { useVerificationHandle } from "./verification-handle";

interface DeliveryViewerProps {
  readonly delivery: DeliveryDetail | null;
  readonly scene: ViewerScene | null;
  readonly geometry: GeometryDriver | null;
  readonly onViewer?: (viewer: ModelViewer | null) => void;
  readonly inspector: React.ReactNode;
  readonly presentation?: "desk" | "meeting";
}

const DISCIPLINES: readonly Discipline[] = ["ARCH", "STRUCT", "MEP", "OTHER"];

export function DeliveryViewer({
  delivery,
  scene,
  geometry,
  onViewer,
  inspector,
  presentation = "desk",
}: DeliveryViewerProps): React.JSX.Element {
  const { locale } = useLocale();
  const copy = VIEWER_COPY[locale];
  const { viewer, snapshot, canvasProps } = useModelViewer({
    scene,
    geometry,
    selectionColor: VIEWER_HIGHLIGHT.selection,
  });
  useVerificationHandle(viewer);
  const [hidden, setHidden] = useState<string[]>([]);
  const [panelTab, setPanelTab] = useState<"selection" | "findings">("findings");
  const keyboardHelpId = useId();

  useEffect(() => {
    onViewer?.(viewer);
    return () => onViewer?.(null);
  }, [viewer, onViewer]);

  useEffect(() => {
    viewer?.setHidden("discipline", hidden);
  }, [viewer, hidden]);

  const stateOf = useMemo(
    () => new Map<string, SourceState>(snapshot?.sources.map((source) => [source.revisionId, source]) ?? []),
    [snapshot],
  );

  if (!delivery) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <p className="text-sm text-muted-foreground" role="status">
          {copy.loadingDelivery}
        </p>
      </main>
    );
  }

  const selected = snapshot?.selected ?? null;
  const origin = snapshot?.origin;
  const originText =
    origin?.frozen && origin.offset ? `${origin.offset.join(", ")} m` : copy.pending;

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
            {snapshot?.initialReady ? copy.combinedView : copy.preparingOrigin}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            data-viewer-fit
            onClick={() => viewer?.fitAll()}
          >
            <Focus />
            {copy.fitAll}
          </Button>
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
              {copy.readyCount(readyCount(snapshot?.sources ?? []), delivery.models.length)}
            </p>
          </div>
          <div
            className={
              presentation === "meeting"
                ? "grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3"
                : "grid gap-2 p-3 sm:grid-cols-2 xl:block xl:max-h-[calc(100vh-7rem)] xl:space-y-2 xl:overflow-y-auto"
            }
          >
            {delivery.models.map((model) => (
              <SourceRow
                key={model.id}
                model={model}
                state={stateOf.get(model.id)}
                onRetry={() => viewer?.retry(revisionIdFrom(model.id))}
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
            {DISCIPLINES.map((discipline) => (
              <button
                key={discipline}
                type="button"
                aria-pressed={!hidden.includes(discipline)}
                className="inline-flex min-h-11 items-center gap-1.5 border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground sm:min-h-8"
                data-discipline-toggle={discipline}
                onClick={() => {
                  const next = hidden.includes(discipline)
                    ? hidden.filter((value) => value !== discipline)
                    : [...hidden, discipline];
                  setHidden(next);
                  viewer?.setHidden("discipline", next);
                }}
              >
                {hidden.includes(discipline) ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                {discipline}
              </button>
            ))}
          </div>
          <div className="viewer-plate relative min-h-0 flex-1">
            <canvas
              {...canvasProps}
              className="absolute inset-0 size-full touch-none"
              aria-label={copy.canvasLabel}
              aria-describedby={keyboardHelpId}
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
            <span className="font-mono text-xs tabular-nums text-foreground">{originText}</span>
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
                <Info label={copy.globalId} value={selected.attributes.globalId ?? copy.notProvided} />
                <Info label={copy.ifcType} value={selected.attributes.ifcType ?? copy.notProvided} />
                <Info label={copy.name} value={selected.name ?? copy.unnamed} />
                <Info label={copy.placedGeometry} value={`${selected.placements}`} />
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  size="sm"
                  onClick={() => viewer?.select(selected.ref, { frame: true })}
                >
                  <Focus />
                  {copy.frameSelection}
                </Button>
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
  model,
  state,
  onRetry,
  locale,
}: {
  readonly model: ModelInfo;
  readonly state: SourceState | undefined;
  readonly onRetry: () => void;
  readonly locale: Locale;
}): React.JSX.Element {
  const status = state?.status ?? "queued";
  const progress = progressPercent(state);
  return (
    <article
      className="border border-border bg-card p-3 xl:mb-2"
      data-model-id={model.id}
      data-status={status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{model.sourceModelName}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{model.filename}</p>
        </div>
        <span className="shrink-0 bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
          {model.discipline}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className={status === "failed" ? "text-destructive" : "text-muted-foreground"}>
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
      {state?.status === "failed" ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs text-destructive">{state.message}</p>
          {state.retryable ? (
            <Button
              className="mt-2 min-h-11 sm:min-h-8"
              variant="outline"
              size="sm"
              onClick={onRetry}
              data-viewer-retry
            >
              <RotateCcw />
              {VIEWER_COPY[locale].retry}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function progressPercent(state: SourceState | undefined): number | null {
  if (!state) return null;
  if (state.status === "ready") return 100;
  if (state.status === "uploading") {
    if (state.totalChunks === 0) return 100;
    return Math.round((state.uploadedChunks / state.totalChunks) * 100);
  }
  if (state.status !== "loading" || state.total === null || state.total === 0) return null;
  return Math.min(100, Math.round((state.loaded / state.total) * 100));
}

function statusLabel(state: SourceState | undefined, locale: Locale): string {
  const copy = VIEWER_COPY[locale];
  if (!state) return copy.queued;
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

function readyCount(states: readonly SourceState[]): number {
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
