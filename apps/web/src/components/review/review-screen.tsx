// Complete review screen. The panel below is hosted inside the viewer's
// Findings tab (via the generic `inspector` seam), replacing the first-loop
// flat list — one list, never two. Composition order is fixed: run header
// (rule totals vs distinct objects vs N/A vs incomplete, never a percentage),
// provenance notice (only when incomplete), scorecard tree (bands then
// categories then requirement rows), evidence, incomplete section, spec table,
// pack history / run creation. One reducer owns run lifecycle + selection +
// filters + members so finding and run switches clear dependents atomically.
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { REVIEW_COPY, VIEWER_COPY } from "@/lib/i18n";
import { ProvenanceNotice } from "../domain/provenance-notice";
import type { DeliveryDetail, Finding, RunDetail, Severity } from "@/lib/types";
import { fetchDelivery } from "@/lib/delivery-api";
import { fetchRunDetail } from "@/lib/findings-api";
import type { ModelViewer } from "model-viewer";
import { DeliveryViewer } from "../domain/delivery-viewer";
import { ifcGeometryFor, viewerSceneFor } from "@/lib/viewer-sources";
import { useLocale } from "../locale-provider";
import { DecisionPanel } from "./decision-panel";
import { EvidencePanel } from "./evidence-panel";
import { PackSelection } from "./pack-selection";
import { initialReviewState, reviewReducer } from "./review-state";
import { IncompleteSection, ScorecardTree, SpecTable } from "./scorecard";
import { TotalsHeader } from "./totals-header";
import { clearFindingFromViewer } from "./viewer-bridge";

function flattenFindings(detail: RunDetail): Finding[] {
  return detail.scorecard.flatMap((band) => band.categories.flatMap((category) => category.findings));
}

export function ReviewScreen({
  deliveryId,
  presentation = "desk",
}: {
  readonly deliveryId: string;
  readonly presentation?: "desk" | "meeting";
}): React.JSX.Element {
  const { locale } = useLocale();
  const reviewCopy = REVIEW_COPY[locale];
  const viewerCopy = VIEWER_COPY[locale];
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);
  const [viewer, setViewer] = useState<ModelViewer | null>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  const [creating, setCreating] = useState(false);

  const handleViewer = useCallback((next: ModelViewer | null) => {
    viewerRef.current = next;
    setViewer(next);
  }, []);

  const models = delivery?.models;
  const scene = useMemo(() => (models ? viewerSceneFor({ models }) : null), [models]);
  const geometry = useMemo(() => (models ? ifcGeometryFor() : null), [models]);

  useEffect(() => {
    const abort = new AbortController();
    setDelivery(null);
    setDeliveryError(null);
    dispatch({ type: "RESET_RUN" });
    void fetchDelivery(deliveryId, abort.signal)
      .then((loaded) => {
        if (abort.signal.aborted) return;
        setDelivery(loaded);
      })
      .catch((reason: unknown) => {
        if (abort.signal.aborted) return;
        setDeliveryError(reason instanceof Error ? reason.message : "Delivery could not be loaded");
      });
    return () => abort.abort();
  }, [deliveryId]);

  const loadRun = useCallback((runId: string) => {
    // A superseded response must never overwrite a newer selection.
    runAbort.current?.abort();
    const abort = new AbortController();
    runAbort.current = abort;
    dispatch({ type: "RUN_LOADING", runId });
    void fetchRunDetail(runId, abort.signal)
      .then((detail) => {
        if (abort.signal.aborted) return;
        dispatch({ type: "RUN_READY", runId, detail });
      })
      .catch((reason: unknown) => {
        if (abort.signal.aborted) return;
        dispatch({ type: "RUN_FAILED", error: reason instanceof Error ? reason.message : "Run could not be loaded" });
      });
    return () => abort.abort();
  }, []);

  // Initial run: ?run= wins, else the latest completed run, else the latest run.
  useEffect(() => {
    if (!delivery || state.lifecycle !== "idle") return;
    const param = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("run");
    const runs = [...delivery.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const initial =
      (param && runs.some((run) => run.id === param) && param) ??
      runs.find((run) => run.status === "completed")?.id ??
      runs[0]?.id ??
      null;
    if (initial) loadRun(initial);
  }, [delivery, state.lifecycle, loadRun]);

  // Review-incomplete findings are selectable evidence too: a reviewer must be
  // able to open the reason, not just read that something was undecided.
  const findings = state.detail
    ? [...flattenFindings(state.detail), ...state.detail.reviewIncomplete]
    : [];
  const selectedFinding = findings.find((finding) => finding.id === state.selection.findingId) ?? null;

  function handleSelect(band: Severity | null, categoryId: string | null, findingId: string | null): void {
    if (findingId === null && viewerRef.current) {
      try {
        clearFindingFromViewer(viewerRef.current);
      } catch {
        // Viewer not ready yet; the panel simply lists without highlights.
      }
    }
    dispatch({ type: "SELECT_FINDING", band, categoryId, findingId });
  }

  function handleRunCreated(detail: RunDetail): void {
    // A new run is immutable history from birth: patch the local delivery copy
    // so the run selector preserves both old and new results without refetch.
    setDelivery((current) =>
      current ? { ...current, runs: [...current.runs, detail.run] } : current,
    );
    dispatch({ type: "RUN_READY", runId: detail.run.id, detail });
  }

  if (deliveryError) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">{viewerCopy.deliveryUnavailable}</h1>
          <p className="mt-2 text-sm text-destructive">{deliveryError}</p>
          <button
            type="button"
            className="mt-5 border border-border px-3 py-1.5 text-sm"
            onClick={() => window.location.reload()}
          >
            {viewerCopy.retry}
          </button>
        </div>
      </main>
    );
  }

  return (
    <div data-review-screen>
      <DeliveryViewer
        delivery={delivery}
        scene={scene}
        geometry={geometry}
        onViewer={handleViewer}
        presentation={presentation}
        inspector={
          !delivery ? (
            <p className="text-xs text-muted-foreground" role="status">
              {viewerCopy.loadingDelivery}
            </p>
          ) : (
            <div className="space-y-4" data-review-panel>
              <PackSelection
                delivery={delivery}
                selectedRunId={state.runId}
                creating={creating}
                onSelectRun={loadRun}
                onRunCreated={handleRunCreated}
                onCreatingChange={setCreating}
              />

              {state.lifecycle === "loading" || (state.lifecycle === "idle" && state.runId) ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {reviewCopy.loadingRun}
                </p>
              ) : state.lifecycle === "failed" ? (
                <div className="border border-destructive/40 p-3 text-xs" data-run-failed>
                  <p className="font-medium">{reviewCopy.runUnavailable}</p>
                  <p className="mt-1 text-destructive">{state.error}</p>
                  <div className="mt-2 flex gap-1.5">
                    {state.runId && (
                      <button
                        type="button"
                        className="border border-border px-2 py-1"
                        onClick={() => state.runId && loadRun(state.runId)}
                      >
                        {viewerCopy.retry}
                      </button>
                    )}
                  </div>
                </div>
              ) : state.detail ? (
                <>
                  <TotalsHeader run={state.detail.run} presentation={presentation} />
                  <ProvenanceNotice
                    status={state.detail.inputProvenance.status}
                    reason={state.detail.inputProvenance.reason}
                  />
                  <ScorecardTree
                    bands={state.detail.scorecard}
                    incompleteCount={state.detail.run.incompleteCount}
                    selection={state.selection}
                    onSelect={handleSelect}
                  />
                  {selectedFinding && (
                    <EvidencePanel
                      finding={selectedFinding}
                      run={state.detail.run}
                      specs={state.detail.specs}
                      models={state.detail.models}
                      filters={state.filters}
                      onFiltersChange={(filters) => dispatch({ type: "SET_FILTERS", filters })}
                      page={state.page}
                      onPageChange={(page) => dispatch({ type: "SET_PAGE", page })}
                      members={state.members}
                      membersLoading={state.membersLoading}
                      onMembersLoading={() => dispatch({ type: "MEMBERS_LOADING" })}
                      onMembersReady={(findingId, objects, total) =>
                        dispatch({ type: "MEMBERS_READY", findingId, objects, total })
                      }
                      onMembersFailed={() => dispatch({ type: "MEMBERS_FAILED" })}
                      viewer={viewer}
                      lang={locale}
                    />
                  )}
                  <IncompleteSection
                    findings={state.detail.reviewIncomplete}
                    selection={state.selection}
                    onSelect={(findingId) => handleSelect(null, null, findingId)}
                  />
                  <SpecTable specs={state.detail.specs} />
                  <DecisionPanel run={state.detail} findings={findings} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground" data-no-run-selected>
                  {reviewCopy.selectRun}
                </p>
              )}
            </div>
          )
        }
      />
    </div>
  );
}
