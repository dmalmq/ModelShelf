"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DeliveryDetail,
  Finding,
  FindingObject,
  ObjectDetail,
  RunDetail,
  Severity,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import type { DeliveryViewerController, ObjectRef, SelectionRecord } from "./types";
import { fetchAllFindingObjects, fetchObjectDetail, fetchRunDetail, toViewerRef } from "./findings-api";

/** Host-provided finding styles. The rendering core only receives refs and colors. */
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#e02424",
  high: "#f97316",
  medium: "#eab308",
  advisory: "#3b82f6",
};

interface FindingInspectorProps {
  readonly delivery: DeliveryDetail;
  readonly getController: () => DeliveryViewerController | null;
  readonly selected: SelectionRecord | null;
  readonly initialRunId: string | null;
}

interface LoadedFinding {
  readonly finding: Finding;
  readonly objects: FindingObject[];
  readonly matched: number;
  /** Convertible members with no drawable geometry in this delivery. */
  readonly undrawable: FindingObject[];
}

function flattenFindings(detail: RunDetail): Finding[] {
  const fromScorecard = detail.scorecard.flatMap((band) =>
    band.categories.flatMap((category) => category.findings),
  );
  return [...fromScorecard, ...detail.reviewIncomplete];
}

function unique<T>(values: readonly (T | null)[], label: (value: T) => string): { value: T; label: string }[] {
  const seen = new Map<string, { value: T; label: string }>();
  for (const value of values) {
    if (value === null) continue;
    const key = label(value);
    if (!seen.has(key)) seen.set(key, { value, label: key });
  }
  return [...seen.values()];
}

export function FindingInspector({
  delivery,
  getController,
  selected,
  initialRunId,
}: FindingInspectorProps): React.JSX.Element {
  const runs = useMemo(
    () => [...delivery.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [delivery],
  );
  const [runId, setRunId] = useState<string | null>(
    initialRunId ?? runs.find((run) => run.status === "completed")?.id ?? runs[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedFinding | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [disciplineFilter, setDisciplineFilter] = useState<string>("all");
  const [storeyFilter, setStoreyFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [isolated, setIsolated] = useState(false);
  const [sectionInput, setSectionInput] = useState("");
  const [sectionActive, setSectionActive] = useState(false);
  const [selectedHidden, setSelectedHidden] = useState(false);
  const [property, setProperty] = useState<ObjectDetail | null>(null);
  const [propertyError, setPropertyError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const abortController = new AbortController();
    setDetail(null);
    setRunError(null);
    setSelectedFindingId(null);
    setLoaded(null);
    void fetchRunDetail(runId, abortController.signal)
      .then(setDetail)
      .catch((reason: unknown) => {
        if (abortController.signal.aborted) return;
        setRunError(reason instanceof Error ? reason.message : "Run could not be loaded");
      });
    return () => abortController.abort();
  }, [runId]);

  const findings = useMemo(() => (detail ? flattenFindings(detail) : []), [detail]);
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) ?? null;

  const sourceOptions = useMemo(() => {
    if (!loaded) return [];
    return unique(
      loaded.objects.map((object) => object.modelId),
      (modelId) =>
        delivery.models.find((model) => model.id === modelId)?.sourceModelName ?? modelId.slice(0, 8),
    );
  }, [loaded, delivery]);
  const disciplineOptions = useMemo(
    () => (loaded ? unique(loaded.objects.map((object) => object.discipline), String) : []),
    [loaded],
  );
  const storeyOptions = useMemo(
    () => (loaded ? unique(loaded.objects.map((object) => object.storey), String) : []),
    [loaded],
  );
  const typeOptions = useMemo(
    () => (loaded ? unique(loaded.objects.map((object) => object.ifcType), String) : []),
    [loaded],
  );

  const filteredRefs = useMemo((): ObjectRef[] | null => {
    if (!loaded) return null;
    const refs: ObjectRef[] = [];
    for (const object of loaded.objects) {
      if (sourceFilter !== "all" && object.modelId !== sourceFilter) continue;
      if (disciplineFilter !== "all" && object.discipline !== disciplineFilter) continue;
      if (storeyFilter !== "all" && object.storey !== storeyFilter) continue;
      if (typeFilter !== "all" && object.ifcType !== typeFilter) continue;
      const ref = toViewerRef(object.ref);
      if (ref) refs.push(ref);
    }
    return refs;
  }, [loaded, sourceFilter, disciplineFilter, storeyFilter, typeFilter]);

  const missingGeometry = useMemo(() => {
    if (!loaded) return [];
    return loaded.objects.filter((object) => toViewerRef(object.ref) === null);
  }, [loaded]);

  function controller(): DeliveryViewerController {
    const active = getController();
    if (!active) throw new Error("Viewer is not ready yet");
    return active;
  }

  async function selectFinding(finding: Finding): Promise<void> {
    const active = controller();
    setSelectedFindingId(finding.id);
    setLoaded(null);
    setIsolated(false);
    resetFilters();
    setLoadProgress({ loaded: 0, total: finding.objectCount });
    const objects = await fetchAllFindingObjects(finding.id, (loadedCount, total) =>
      setLoadProgress({ loaded: loadedCount, total }),
    );
    const refs = objects.flatMap((object) => {
      const ref = toViewerRef(object.ref);
      return ref ? [ref] : [];
    });
    active.setHighlights([{ refs, color: SEVERITY_COLOR[finding.severity], label: finding.title }]);
    active.isolate(refs);
    active.setDimOpacity(0.25);
    active.frame(refs);
    const diagnostics = active.diagnostics();
    const matched = diagnostics.renderer.highlightGroups[0]?.matched ?? 0;
    const drawableKeys = new Set(
      diagnostics.objects.map((entry) => `${entry.ref.revisionId}\0${entry.ref.objectId}`),
    );
    const undrawable = objects.filter((object) => {
      const ref = toViewerRef(object.ref);
      return ref !== null && !drawableKeys.has(`${ref.revisionId}\0${ref.objectId}`);
    });
    setLoaded({ finding, objects, matched, undrawable });
    setLoadProgress(null);
    setIsolated(true);
  }

  function resetFilters(): void {
    setSourceFilter("all");
    setDisciplineFilter("all");
    setStoreyFilter("all");
    setTypeFilter("all");
  }

  function applyIsolation(next: ObjectRef[] | null): void {
    controller().isolate(next);
    setIsolated(next !== null);
    refreshHiddenFlag();
  }

  function resetView(): void {
    const active = controller();
    resetFilters();
    active.isolate(null);
    active.setSectionZ(null);
    active.setDimOpacity(1);
    setSectionInput("");
    setSectionActive(false);
    setIsolated(false);
    refreshHiddenFlag();
  }

  function clearFinding(): void {
    const active = controller();
    resetFilters();
    active.setHighlights([]);
    active.isolate(null);
    active.setSectionZ(null);
    active.setDimOpacity(1);
    setSectionInput("");
    setSectionActive(false);
    setSelectedFindingId(null);
    setLoaded(null);
    setIsolated(false);
    setProperty(null);
  }

  function refreshHiddenFlag(): void {
    setSelectedHidden(controller().diagnostics().selectedHidden);
  }

  function applySection(): void {
    const active = controller();
    const trimmed = sectionInput.trim();
    if (trimmed === "") {
      active.setSectionZ(null);
      setSectionActive(false);
      return;
    }
    const z = Number(trimmed);
    if (!Number.isFinite(z)) return;
    active.setSectionZ(z);
    setSectionActive(true);
  }

  async function inspectSelection(): Promise<void> {
    setProperty(null);
    setPropertyError(null);
    if (!selected || !loaded) return;
    const match = loaded.objects.find(
      (object) =>
        object.ref.revisionId === selected.ref.revisionId && object.ref.objectId === selected.ref.objectId,
    );
    if (!match) return;
    if (!match.objectId) {
      setPropertyError("This finding member has no model occurrence to inspect.");
      return;
    }
    try {
      // occurrence id shares the finding member objectId for geometric members.
      setProperty(await fetchObjectDetail(match.objectId));
    } catch (reason: unknown) {
      setPropertyError(reason instanceof Error ? reason.message : "Object properties could not be loaded");
    }
  }

  useEffect(() => {
    refreshHiddenFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.ref.revisionId, selected?.ref.objectId]);

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs for this delivery yet.</p>;
  }

  return (
    <div className="space-y-4">
      <label className="block text-xs">
        <span className="mb-1 block font-medium">Run / ラン</span>
        <select
          aria-label="Run"
          className="w-full border border-border bg-card px-2 py-1.5 text-xs"
          value={runId ?? ""}
          onChange={(event) => setRunId(event.target.value || null)}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.packName} v{run.packVersion} · {run.status} · {run.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>

      {runError ? (
        <p className="text-xs text-destructive">{runError}</p>
      ) : !detail ? (
        <p className="text-xs text-muted-foreground" role="status">
          Loading run findings…
        </p>
      ) : (
        <ul className="space-y-1.5">
          {findings.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                data-finding-id={finding.id}
                aria-pressed={finding.id === selectedFindingId}
                onClick={() => void selectFinding(finding)}
                className="flex w-full items-center gap-2 border border-border px-2 py-1.5 text-left text-xs hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0"
                  style={{ backgroundColor: SEVERITY_COLOR[finding.severity] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{finding.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {finding.severity} · {finding.objectCount} objects
                    {finding.incomplete ? " · incomplete" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loadProgress && (
        <p className="text-xs text-muted-foreground" role="status" data-load-progress>
          Loading affected objects… {loadProgress.loaded}
          {loadProgress.total === null ? "" : ` / ${loadProgress.total}`}
        </p>
      )}

      {loaded && (
        <div className="space-y-3 border-t pt-3" data-inspector-active={loaded.finding.id}>
          <p className="text-xs">
            <span className="font-medium">{loaded.matched}</span> of{" "}
            <span className="font-medium">{loaded.objects.length}</span> members have geometry in this
            delivery
            {loaded.undrawable.length + missingGeometry.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {loaded.undrawable.length + missingGeometry.length} without geometry
              </span>
            )}
          </p>

          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-[11px]">
              <span className="mb-0.5 block text-muted-foreground">Source</span>
              <select
                aria-label="Source filter"
                className="w-full border border-border bg-card px-1.5 py-1 text-xs"
                value={sourceFilter}
                onChange={(event) => {
                  setSourceFilter(event.target.value);
                }}
              >
                <option value="all">All sources</option>
                {sourceOptions.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px]">
              <span className="mb-0.5 block text-muted-foreground">Discipline</span>
              <select
                aria-label="Discipline filter"
                className="w-full border border-border bg-card px-1.5 py-1 text-xs"
                value={disciplineFilter}
                onChange={(event) => {
                  setDisciplineFilter(event.target.value);
                }}
              >
                <option value="all">All</option>
                {disciplineOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px]">
              <span className="mb-0.5 block text-muted-foreground">Storey</span>
              <select
                aria-label="Storey filter"
                className="w-full border border-border bg-card px-1.5 py-1 text-xs"
                value={storeyFilter}
                onChange={(event) => {
                  setStoreyFilter(event.target.value);
                }}
              >
                <option value="all">All</option>
                {storeyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px]">
              <span className="mb-0.5 block text-muted-foreground">IFC type</span>
              <select
                aria-label="Type filter"
                className="w-full border border-border bg-card px-1.5 py-1 text-xs"
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value);
                }}
              >
                <option value="all">All</option>
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (filteredRefs) applyIsolation(filteredRefs);
              }}
            >
              Apply filters / 絞り込み
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (filteredRefs) controller().frame(filteredRefs);
              }}
            >
              Frame / 表示
            </Button>
            <Button variant="outline" size="sm" onClick={resetView}>
              Reset view / リセット
            </Button>
            <Button variant="ghost" size="sm" onClick={clearFinding}>
              Clear / クリア
            </Button>
          </div>

          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">Section Z (m)</span>
            <input
              aria-label="Section Z metres"
              className="w-20 border border-border bg-card px-1.5 py-1 font-mono text-xs"
              value={sectionInput}
              inputMode="decimal"
              onChange={(event) => setSectionInput(event.target.value)}
              onBlur={applySection}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySection();
              }}
            />
            {sectionActive && <span className="text-muted-foreground">active</span>}
          </label>

          {selectedHidden && (
            <p className="border border-border bg-muted px-2 py-1.5 text-[11px]" data-hidden-notice>
              The selected object is hidden by the current isolation. It stays selected; reset the view to
              reveal it.
            </p>
          )}

          <div>
            <Button variant="outline" size="sm" onClick={() => void inspectSelection()}>
              Inspect selection properties / 属性表示
            </Button>
            {propertyError && <p className="mt-1 text-[11px] text-destructive">{propertyError}</p>}
            {property && (
              <dl className="mt-2 space-y-1.5 border border-border p-2 text-[11px]" data-property-panel>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-mono">{property.ifcType}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="truncate">{property.name ?? "Unnamed"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Storey</dt>
                  <dd>{property.storey ?? "—"}</dd>
                </div>
                {property.properties.slice(0, 12).map((group) => (
                  <div key={`${group.pset}.${group.name}`}>
                    <dt className="text-muted-foreground">
                      {group.pset}.{group.name}
                      {group.origin === "type" ? " (type)" : ""}
                    </dt>
                    <dd className="font-mono">
                      {group.values
                        .map((entry) =>
                          entry.siValue === null || entry.siValue === undefined
                            ? String(entry.value)
                            : `${String(entry.value)} → ${entry.siValue}`,
                        )
                        .join("; ")}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {(missingGeometry.length > 0 ||
            loaded.undrawable.length > 0 ||
            loaded.finding.incomplete ||
            loaded.objects.length === 0) && (
            <div className="border border-border p-2 text-[11px]" data-evidence-panel>
              <p className="font-medium">
                Members without geometry ({missingGeometry.length + loaded.undrawable.length})
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {loaded.finding.incomplete
                  ? "The engine could not decide these members — review incomplete, never a pass. "
                  : "These members carry textual evidence instead of drawable geometry. "}
                {loaded.finding.expected ? `Expected: ${loaded.finding.expected}. ` : ""}
                {loaded.finding.instructions ? `Instructions: ${loaded.finding.instructions}` : ""}
              </p>
              <ul className="mt-1 space-y-0.5 font-mono">
                {[...missingGeometry, ...loaded.undrawable].slice(0, 5).map((object, index) => (
                  <li key={`${object.modelId}-${index}`}>
                    {object.ifcType} · {object.globalId ?? "no GlobalId"}
                    {object.actual ? ` · actual: ${object.actual}` : ""}
                    {object.incompleteReason ? ` · ${object.incompleteReason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground" data-isolation-state>
            {isolated ? "Isolated to finding members" : "Isolation off"} ·{" "}
            {filteredRefs ? `${filteredRefs.length} in filter` : "no filter"}
          </p>
        </div>
      )}
    </div>
  );
}
