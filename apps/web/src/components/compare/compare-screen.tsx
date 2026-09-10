// Complete comparison screen. One CombinedDeliveryViewer persists across the
// base/head toggle: side is state, the toggle swaps the loaded delivery and
// never remounts the viewer, so the shared camera survives. The change overlay
// is app-supplied generic highlight groups through the frozen
// DeliveryViewerController port. The panel below is hosted inside the viewer's
// Findings tab via the generic `inspector` seam: one list, never two.
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocaleSwitcher } from "../domain/locale-switcher";
import { useLocale } from "../locale-provider";
import { CHANGE_LABEL, COMPARE_COPY } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { fetchProject } from "@/lib/shelf-api";
import type {
  ChangeKind,
  DeliveryDetail,
  DeliverySummary,
  DiffSummary,
  RunDetail,
} from "@/lib/types";
import { fetchDelivery, viewerFileUrl } from "@/lib/viewer-adapter";
import type { DeliverySnapshot, DeliveryViewerController } from "model-viewer/core";
import { CombinedDeliveryViewer } from "model-viewer";
import {
  fetchCompleteModelDiff,
  fetchFindingDiff,
  FindingIncomparableError,
  ModelDiffProfileMismatchError,
} from "./compare-api";
import {
  activeRefOf,
  changeToHighlights,
  clearCompareOverlay,
  compareReadback,
  pushCompareOverlay,
  toViewerRefPlain,
  type CompareOverlayReadback,
} from "./compare-bridge";
import { CompareInspector } from "./compare-inspector";
import {
  ALL_SOURCES,
  compareReducer,
  filterCompareEntries,
  initialCompareState,
  type CompareSide,
} from "./compare-state";

const KIND_OPTIONS: readonly (ChangeKind | "all")[] = [
  "all",
  "added",
  "removed",
  "moved",
  "shape_changed",
  "properties_changed",
  "mixed",
  "unchanged",
];

function latestCompletedRunId(delivery: DeliveryDetail): string | null {
  const runs = [...delivery.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return runs.find((run) => run.status === "completed")?.id ?? runs[0]?.id ?? null;
}

const EMPTY_READBACK: CompareOverlayReadback = { matched: 0, selectedHidden: false, drawnKeys: [] };

/** A picker option always includes the pair in the URL, loaded or not. */
interface DeliveryOption {
  id: string;
  label: string;
  deliveryDate: string | null;
}

function deliveryOptionLabel(option: DeliveryOption): string {
  return option.deliveryDate ? `${option.label} — ${formatDate(option.deliveryDate)}` : option.label;
}

function deliveryOptionsFor(
  deliveries: readonly DeliverySummary[],
  pinned: readonly { id: string; detail: DeliveryDetail | null }[],
): DeliveryOption[] {
  const options = new Map<string, DeliveryOption>();
  for (const summary of deliveries) {
    options.set(summary.id, { id: summary.id, label: summary.label, deliveryDate: summary.deliveryDate });
  }
  for (const { id, detail } of pinned) {
    if (!id || options.has(id)) continue;
    options.set(id, {
      id,
      label: detail?.delivery.label ?? id,
      deliveryDate: detail?.delivery.deliveryDate ?? null,
    });
  }
  return [...options.values()];
}

export function CompareScreen({
  baseDeliveryId,
  headDeliveryId,
}: {
  baseDeliveryId: string;
  headDeliveryId: string;
}): React.JSX.Element {
  const { locale } = useLocale();
  const copy = COMPARE_COPY[locale];
  const router = useRouter();
  const [state, dispatch] = useReducer(compareReducer, initialCompareState);
  const [viewer, setViewer] = useState<DeliveryViewerController | null>(null);
  const [readback, setReadback] = useState<CompareOverlayReadback>(EMPTY_READBACK);
  const [readyModels, setReadyModels] = useState(0);
  const [basePicker, setBasePicker] = useState(baseDeliveryId);
  const [headPicker, setHeadPicker] = useState(headDeliveryId);
  const [projectDeliveries, setProjectDeliveries] = useState<readonly DeliverySummary[]>([]);
  const viewerRef = useRef<DeliveryViewerController | null>(null);
  const pairAbort = useRef<AbortController | null>(null);
  const findingAbort = useRef<AbortController | null>(null);

  const handleController = useCallback((controller: DeliveryViewerController | null) => {
    viewerRef.current = controller;
    setViewer(controller);
  }, []);

  // Swapping side swaps the delivery, and the viewer answers that by disposing
  // its controller and building a new one, so geometry always arrives after the
  // controller does. Counting ready models is the repaint signal: the overlay
  // and the framed selection both re-run as each revision lands.
  useEffect(() => {
    if (!viewer) {
      setReadyModels(0);
      return;
    }
    const countReady = (snapshot: DeliverySnapshot): number =>
      snapshot.models.filter((model) => model.status === "ready").length;
    setReadyModels(countReady(viewer.snapshot()));
    return viewer.subscribe((snapshot) => setReadyModels(countReady(snapshot)));
  }, [viewer]);

  // The pickers offer the project's own deliveries: a reviewer picks a pair by
  // label and date, never by pasting an id.
  useEffect(() => {
    const projectId = state.baseDelivery?.delivery.projectId;
    if (!projectId) return;
    const abort = new AbortController();
    void fetchProject(projectId, abort.signal)
      .then((detail) => {
        if (!abort.signal.aborted) setProjectDeliveries(detail.deliveries);
      })
      .catch(() => setProjectDeliveries([]));
    return () => abort.abort();
  }, [state.baseDelivery?.delivery.projectId]);

  // Delivery pair load: atomic reset first, then deliveries, model diff, runs.
  // Delivery and diff failures stay in their own statuses: a broken diff never
  // demotes loaded deliveries to the full-page error.
  useEffect(() => {
    pairAbort.current?.abort();
    findingAbort.current?.abort();
    const abort = new AbortController();
    pairAbort.current = abort;
    dispatch({ type: "SET_DELIVERIES", baseDeliveryId, headDeliveryId });
    dispatch({ type: "MODEL_DIFF_LOADING" });
    void (async () => {
      try {
        const [base, head] = await Promise.all([
          fetchDelivery(baseDeliveryId, abort.signal),
          fetchDelivery(headDeliveryId, abort.signal),
        ]);
        if (abort.signal.aborted) return;
        dispatch({ type: "DELIVERIES_READY", base, head });
        dispatch({ type: "SET_RUNS", baseRunId: latestCompletedRunId(base), headRunId: latestCompletedRunId(head) });
      } catch (reason: unknown) {
        if (abort.signal.aborted) return;
        dispatch({
          type: "DELIVERIES_FAILED",
          error: reason instanceof Error ? reason.message : "Deliveries could not be loaded",
        });
        return;
      }
      try {
        const response = await fetchCompleteModelDiff({ baseDeliveryId, headDeliveryId }, abort.signal);
        if (abort.signal.aborted) return;
        dispatch({ type: "MODEL_DIFF_READY", response });
      } catch (reason: unknown) {
        if (abort.signal.aborted) return;
        if (reason instanceof ModelDiffProfileMismatchError) {
          dispatch({
            type: "MODEL_DIFF_PROFILE_MISMATCH",
            error: reason.message,
          });
          return;
        }
        dispatch({
          type: "MODEL_DIFF_FAILED",
          error: reason instanceof Error ? reason.message : "Model diff could not be loaded",
        });
      }
    })();
    return () => abort.abort();
  }, [baseDeliveryId, headDeliveryId]);

  const deliveryOptions = useMemo(
    () =>
      deliveryOptionsFor(projectDeliveries, [
        { id: baseDeliveryId, detail: state.baseDelivery },
        { id: headDeliveryId, detail: state.headDelivery },
      ]),
    [projectDeliveries, baseDeliveryId, headDeliveryId, state.baseDelivery, state.headDelivery],
  );

  // Finding diff follows the run pair; run changes never touch model state.
  useEffect(() => {
    findingAbort.current?.abort();
    if (!state.baseRunId || !state.headRunId) return;
    const abort = new AbortController();
    findingAbort.current = abort;
    const { baseRunId, headRunId } = state;
    dispatch({ type: "FINDING_LOADING" });
    void fetchFindingDiff({ baseRunId, headRunId }, abort.signal)
      .then((response) => {
        if (abort.signal.aborted) return;
        dispatch({ type: "FINDING_READY", response });
      })
      .catch((reason: unknown) => {
        if (abort.signal.aborted) return;
        if (reason instanceof FindingIncomparableError) {
          dispatch({ type: "FINDING_INCOMPARABLE", error: reason.message, dimension: reason.dimension });
          return;
        }
        dispatch({
          type: "FINDING_FAILED",
          error: reason instanceof Error ? reason.message : "Finding diff could not be loaded",
        });
      });
    return () => abort.abort();
  }, [state.baseRunId, state.headRunId]);

  const filtered = useMemo(
    () => filterCompareEntries(state.changeIndex.entries, state.filters),
    [state.changeIndex, state.filters],
  );

  // Filters and diff loads repaint through the overlay without remounting.
  const highlights = useMemo(
    () => changeToHighlights(filtered, state.side),
    [filtered, state.side],
  );
  const combinedSummary = useMemo(() => {
    if (!state.modelDiff) return null;
    const totals: DiffSummary = {
      added: 0,
      removed: 0,
      unchanged: 0,
      moved: 0,
      shapeChanged: 0,
      propertiesChanged: 0,
      mixed: 0,
      uncertainMatches: 0,
    };
    for (const pair of state.modelDiff.pairs) {
      totals.added += pair.summary.added;
      totals.removed += pair.summary.removed;
      totals.unchanged += pair.summary.unchanged;
      totals.moved += pair.summary.moved;
      totals.shapeChanged += pair.summary.shapeChanged;
      totals.propertiesChanged += pair.summary.propertiesChanged;
      totals.mixed += pair.summary.mixed;
      totals.uncertainMatches += pair.summary.uncertainMatches;
    }
    return totals;
  }, [state.modelDiff]);
  useEffect(() => {
    const controller = viewerRef.current;
    if (!controller || state.modelDiffStatus !== "ready") return;
    if (filtered.length === 0) {
      clearCompareOverlay(controller);
      setReadback(EMPTY_READBACK);
      return;
    }
    setReadback(pushCompareOverlay(controller, highlights));
  }, [viewer, readyModels, highlights, filtered.length, state.modelDiffStatus, state.side]);

  useEffect(() => {
    const controller = viewerRef.current;
    if (!controller || state.selection == null) return;
    const index = state.changeIndex.byKey[state.selection];
    const entry = index === undefined ? null : (state.changeIndex.entries[index] ?? null);
    if (!entry) return;
    const ref = activeRefOf(entry.change, state.side);
    if (!ref) return;
    const parsed = toViewerRefPlain(ref);
    if (!parsed) return;
    controller.select(parsed);
    controller.frame([parsed]);
    setReadback(compareReadback(controller));
  }, [viewer, readyModels, state.selection, state.side, state.changeIndex]);

  function handleRunCreated(detail: RunDetail): void {
    dispatch({ type: "RUN_CREATED", detail });
  }

  function applyPickers(): void {
    if (!basePicker || !headPicker || (basePicker === baseDeliveryId && headPicker === headDeliveryId)) return;
    router.push(
      `/deliveries/compare?base=${encodeURIComponent(basePicker)}&head=${encodeURIComponent(headPicker)}`,
    );
  }

  const activeDeliveryId = state.side === "base" ? baseDeliveryId : headDeliveryId;
  const sources = state.modelDiff?.pairs ?? [];

  if (state.lifecycle === "failed") {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">{copy.unavailable}</h1>
          <p className="mt-2 text-sm text-destructive">{state.deliveryError}</p>
          <button
            type="button"
            className="mt-5 min-h-11 border border-border px-3 py-1.5 text-sm sm:min-h-8"
            onClick={() => window.location.reload()}
          >
            {copy.retry}
          </button>
        </div>
      </main>
    );
  }
  return (
    <div data-compare-screen>
      <div className="border-b border-border bg-card px-4 py-3" data-compare-toolbar>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end gap-x-4 gap-y-3">
          <label className="grid gap-1 text-xs" htmlFor="compare-base-delivery">
            <span className="font-medium">{copy.baseDelivery}</span>
            <select
              id="compare-base-delivery"
              data-compare-base-delivery
              className="min-h-11 w-full border border-border bg-background px-2 py-1.5 text-xs sm:min-h-8 sm:w-64"
              value={basePicker}
              onChange={(event) => setBasePicker(event.target.value)}
            >
              {deliveryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {deliveryOptionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs" htmlFor="compare-head-delivery">
            <span className="font-medium">{copy.headDelivery}</span>
            <select
              id="compare-head-delivery"
              data-compare-head-delivery
              className="min-h-11 w-full border border-border bg-background px-2 py-1.5 text-xs sm:min-h-8 sm:w-64"
              value={headPicker}
              onChange={(event) => setHeadPicker(event.target.value)}
            >
              {deliveryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {deliveryOptionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-compare-apply
            className="min-h-11 border border-border px-3 py-1.5 text-xs sm:min-h-8"
            onClick={applyPickers}
            disabled={!basePicker.trim() || !headPicker.trim()}
          >
            {copy.compare}
          </button>
          <div className="flex items-end gap-1.5" role="group" aria-label={copy.viewingSide}>
            <SideButton side="base" active={state.side === "base"} onClick={() => dispatch({ type: "SET_SIDE", side: "base" })}>
              {copy.base}
            </SideButton>
            <SideButton side="head" active={state.side === "head"} onClick={() => dispatch({ type: "SET_SIDE", side: "head" })}>
              {copy.head}
            </SideButton>
          </div>
          <label className="grid gap-1 text-xs" htmlFor="compare-kind-filter">
            <span className="font-medium">{copy.kind}</span>
            <select
              id="compare-kind-filter"
              data-compare-kind
              className="min-h-11 border border-border bg-background px-2 py-1.5 text-xs sm:min-h-8"
              value={state.filters.kind}
              onChange={(event) =>
                dispatch({
                  type: "SET_FILTERS",
                  filters: { ...state.filters, kind: event.target.value as ChangeKind | "all" },
                })
              }
            >
              {KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "all" ? copy.all : CHANGE_LABEL[locale][kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs" htmlFor="compare-confidence-filter">
            <span className="font-medium">{copy.confidence}</span>
            <select
              id="compare-confidence-filter"
              data-compare-confidence
              className="min-h-11 border border-border bg-background px-2 py-1.5 text-xs sm:min-h-8"
              value={state.filters.confidence}
              onChange={(event) =>
                dispatch({
                  type: "SET_FILTERS",
                  filters: { ...state.filters, confidence: event.target.value as "all" | "uncertain" },
                })
              }
            >
              <option value="all">{copy.all}</option>
              <option value="uncertain">{copy.uncertainOnly}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs" htmlFor="compare-source-filter">
            <span className="font-medium">{copy.source}</span>
            <select
              id="compare-source-filter"
              data-compare-source
              className="min-h-11 border border-border bg-background px-2 py-1.5 text-xs sm:min-h-8"
              value={state.filters.sourceModelId}
              onChange={(event) =>
                dispatch({ type: "SET_FILTERS", filters: { ...state.filters, sourceModelId: event.target.value } })
              }
            >
              <option value={ALL_SOURCES}>{copy.all}</option>
              {sources.map((pair) => (
                <option key={pair.sourceModelId} value={pair.sourceModelId}>
                  {pair.sourceModelName}
                </option>
              ))}
            </select>
          </label>
          <LocaleSwitcher />
        </div>
      </div>
      <CombinedDeliveryViewer
        deliveryId={activeDeliveryId}
        loadDelivery={fetchDelivery}
        resolveModelFileUrl={viewerFileUrl}
        onController={handleController}
        locale={locale}
        inspector={
          state.lifecycle === "loading" ? (
            <p className="text-xs text-muted-foreground" role="status">
              {copy.loading}
            </p>
          ) : (
            <div data-compare-panel>
              <CompareInspector
                side={state.side}
                entries={filtered}
                unfilteredCount={state.changeIndex.entries.length}
                summary={combinedSummary}
                selection={state.selection}
                onSelect={(key) => dispatch({ type: "SELECT_CHANGE", key })}
                onJumpSide={(side: CompareSide) => dispatch({ type: "SET_SIDE", side })}
                drawnKeys={readback.drawnKeys}
                undrawable={highlights.undrawable}
                overflow={highlights.overflow}
                modelStatus={state.modelDiffStatus}
                modelError={state.modelDiffError}
                baseDeliveryId={state.baseDeliveryId}
                headDeliveryId={state.headDeliveryId}
                baseRuns={state.baseDelivery?.runs ?? []}
                headRuns={state.headDelivery?.runs ?? []}
                baseRunId={state.baseRunId}
                headRunId={state.headRunId}
                onRunsChange={(baseRunId, headRunId) => dispatch({ type: "SET_RUNS", baseRunId, headRunId })}
                findingStatus={state.findingStatus}
                findingDiff={state.findingDiff}
                findingError={state.findingError}
                findingDimension={state.findingDimension}
                onRunCreated={handleRunCreated}
              />
            </div>
          )
        }
      />
    </div>
  );
}

function SideButton({
  side,
  active,
  onClick,
  children,
}: {
  side: "base" | "head";
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-compare-side={side}
      onClick={onClick}
      className={`min-h-11 border px-3 py-1.5 text-xs sm:min-h-8 ${active ? "border-primary bg-accent font-medium" : "border-border"}`}
    >
      {children}
    </button>
  );
}

