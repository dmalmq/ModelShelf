// Evidence for one finding: requirement, expected (with an honest absence
// marker, never invented), actual per object plus a first-member summary,
// instructions (honest absence), scope/applicability with notes, and pack /
// engine identity. All affected objects stay reachable: the 25-sample renders
// first, fetchAllFindingObjects pages the rest, and past 100 rows the table is
// windowed behind a pager. Malformed member metadata shows a banner while the
// valid prefix still renders; nothing here throws on API data.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { SEVERITY_COLOR } from "@/lib/palette";
import type { Finding, FindingObject, ModelInfo, ObjectDetail, RunSummary, SpecResultRow } from "@/lib/types";
import { fetchAllFindingObjects, fetchObjectDetail } from "./findings-api";

import type { DeliveryViewerController } from "model-viewer/core";
import { ObjectFilters, type FilterOptions } from "./object-filters";
import { copy, REVIEW_COPY, type ReviewLang } from "./review-i18n";
import type { LoadedMembers, ObjectFilterSet } from "./review-state";
import {
  applyFindingToViewer,
  clearFindingFromViewer,
  filterMembers,
  findingToHighlights,
  MISSING_STOREY,
  toViewerRefPlain,
} from "./viewer-bridge";

const PAGE_SIZE = 25;
const VIRTUALIZE_AFTER = 100;

interface EvidencePanelProps {
  readonly finding: Finding;
  readonly run: RunSummary;
  readonly specs: readonly SpecResultRow[];
  readonly models: readonly ModelInfo[];
  readonly filters: ObjectFilterSet;
  readonly onFiltersChange: (filters: ObjectFilterSet) => void;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
  readonly members: LoadedMembers | null;
  readonly membersLoading: boolean;
  readonly onMembersLoading: () => void;
  readonly onMembersReady: (findingId: string, objects: FindingObject[], total: number) => void;
  readonly onMembersFailed: () => void;
  readonly viewer: DeliveryViewerController | null;
  readonly lang?: ReviewLang;
}

interface MemberIssue {
  index: number;
  reason: string;
}

function validateMember(object: FindingObject, knownModels: Set<string>): string | null {
  if (!object.modelId || !knownModels.has(object.modelId)) return `unknown modelId ${String(object.modelId)}`;
  if (!["ARCH", "STRUCT", "MEP", "OTHER"].includes(object.discipline)) {
    return `invalid discipline ${String(object.discipline)}`;
  }
  if (!Number.isSafeInteger(object.expressId) || object.expressId < 0) {
    return `invalid expressId ${String(object.expressId)}`;
  }
  if (!object.ifcType) return "missing ifcType";
  if (!object.ref || typeof object.ref.revisionId !== "string" || typeof object.ref.objectId !== "string") {
    return "missing ref";
  }
  return null;
}

function refKey(ref: { readonly revisionId: string; readonly objectId: string } | null): string | null {
  return ref ? `${ref.revisionId}\0${ref.objectId}` : null;
}

export function EvidencePanel({
  finding,
  run,
  specs,
  models,
  filters,
  onFiltersChange,
  page,
  onPageChange,
  members,
  membersLoading,
  onMembersLoading,
  onMembersReady,
  onMembersFailed,
  viewer,
  lang = "ja",
}: EvidencePanelProps): React.JSX.Element {
  const [matched, setMatched] = useState<number | null>(null);
  const [selectedHidden, setSelectedHidden] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Keys (`revisionId\0objectId`) with no drawable geometry in this delivery. */
  const [notDrawn, setNotDrawn] = useState<Record<string, true>>({});
  const [sectionInput, setSectionInput] = useState("");
  const [sectionActive, setSectionActive] = useState(false);
  const [property, setProperty] = useState<ObjectDetail | null>(null);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const propertyRequest = useRef<{ controller: AbortController; version: number } | null>(null);
  const propertyRequestVersion = useRef(0);
  const lastSelectionKey = useRef<string | null>(null);

  const knownModels = useMemo(() => new Set(models.map((model) => model.id)), [models]);
  const modelNameOf = useMemo(() => {
    const table = new Map(models.map((model) => [model.id, model.sourceModelName] as const));
    return (modelId: string): string => table.get(modelId) ?? modelId.slice(0, 8);
  }, [models]);

  const specRow = useMemo(
    () =>
      specs.find((spec) =>
        finding.specIdentifier !== null
          ? spec.specIdentifier === finding.specIdentifier
          : spec.specName === finding.specName,
      ) ?? null,
    [specs, finding],
  );

  // Full affected-object access: the embedded 25-sample shows first; every
  // object pages in behind it. Members state lives in the reducer so selection
  useEffect(() => {
    if (members && members.findingId === finding.id) return;
    const abort = new AbortController();
    onMembersLoading();
    setLoadFailed(false);
    void fetchAllFindingObjects(
      finding.id,
      undefined,
      abort.signal,
    )
      .then((objects) => {
        if (abort.signal.aborted) return;
        onMembersReady(finding.id, objects, objects.length);
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setLoadFailed(true);
        onMembersFailed();
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding.id, retryCount]);

  const membersForFinding = members && members.findingId === finding.id ? members.objects : finding.sampleObjects;

  const { valid, issues } = useMemo(() => {
    const validMembers: FindingObject[] = [];
    const memberIssues: MemberIssue[] = [];
    membersForFinding.forEach((object, index) => {
      const reason = validateMember(object, knownModels);
      if (reason) memberIssues.push({ index, reason });
      else validMembers.push(object);
    });
    return { valid: validMembers, issues: memberIssues };
  }, [membersForFinding, knownModels]);

  const filtered = useMemo(() => filterMembers(valid, filters), [valid, filters]);

  const { refs, undrawable: nullRefs } = useMemo(() => findingToHighlights(filtered), [filtered]);

  const nullRefMembers = useMemo(
    () => valid.filter((object) => toViewerRefPlain(object.ref) === null),
    [valid],
  );
  const uniqueKeys = useMemo(() => {
    const keys = new Set(valid.map((object) => `${object.ref.revisionId}\0${object.ref.objectId}`));
    return keys.size;
  }, [valid]);

  /** Null-ref members plus members the viewer holds no geometry for. */
  const withoutGeometry = useMemo(() => {
    const listed = [...nullRefMembers];
    for (const object of valid) {
      const key = `${object.ref.revisionId}\0${object.ref.objectId}`;
      if (toViewerRefPlain(object.ref) !== null && notDrawn[key] && !listed.includes(object)) {
        listed.push(object);
      }
    }
    return listed;
  }, [valid, nullRefMembers, notDrawn]);

  const filterOptions: FilterOptions = useMemo(
    () => ({
      sources: uniqueBy(
        valid.map((object) => object.modelId),
        modelNameOf,
      ),
      disciplines: [...new Set(valid.map((object) => object.discipline))],
      storeys: [...new Set(valid.map((object) => object.storey ?? MISSING_STOREY))],
      types: [...new Set(valid.map((object) => object.ifcType))],
    }),
    [valid, modelNameOf],
  );

  // Push the filtered selection one way into the viewer; read back matched /
  // selectedHidden plus the drawable set for the panel. Zero-object findings
  // clear stale highlights.
  useEffect(() => {
    if (!viewer) {
      setNotDrawn({});
      return;
    }
    if (finding.objectCount === 0 || filtered.length === 0) {
      clearFindingFromViewer(viewer);
      setMatched(0);
      setSelectedHidden(viewer.diagnostics().selectedHidden);
      setNotDrawn({});
      return;
    }
    try {
      const readback = applyFindingToViewer(
        viewer,
        { refs, color: SEVERITY_COLOR[finding.severity], label: finding.title },
      );
      setMatched(readback.matched);
      setSelectedHidden(readback.selectedHidden);
      const drawn: Record<string, true> = {};
      for (const key of readback.drawnKeys) drawn[key] = true;
      const missing: Record<string, true> = {};
      for (const object of filtered) {
        const ref = toViewerRefPlain(object.ref);
        if (ref && !drawn[`${ref.revisionId}\0${ref.objectId}`]) {
          missing[`${object.ref.revisionId}\0${object.ref.objectId}`] = true;
        }
      }
      setNotDrawn(missing);
    } catch {
      setMatched(null);
    }
    return () => {
      // Unmount (run switch, deselect) must not leave stale highlights behind.
      try {
        clearFindingFromViewer(viewer);
      } catch {
        // Viewer already disposed; nothing to clear.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, finding.id, finding.objectCount, refs.length === 0 ? "empty" : refs.map((r) => `${r.revisionId}${r.objectId}`).join(",")]);
  useEffect(() => {
    if (!viewer) {
      lastSelectionKey.current = null;
      setSelectedHidden(false);
      return;
    }
    const refreshSelection = () => {
      const selectedKey = refKey(viewer.snapshot().selected?.ref ?? null);
      if (selectedKey !== lastSelectionKey.current) {
        lastSelectionKey.current = selectedKey;
        propertyRequest.current?.controller.abort();
        propertyRequest.current = null;
        propertyRequestVersion.current += 1;
        setProperty(null);
        setPropertyError(null);
      }
      setSelectedHidden(viewer.diagnostics().selectedHidden);
    };
    refreshSelection();
    return viewer.subscribe(refreshSelection);
  }, [viewer]);
  useEffect(() => {
    propertyRequest.current?.controller.abort();
    propertyRequest.current = null;
    propertyRequestVersion.current += 1;
    setSectionInput("");
    setSectionActive(false);
    setProperty(null);
    setPropertyError(null);
    return () => {
      propertyRequest.current?.controller.abort();
      propertyRequest.current = null;
      propertyRequestVersion.current += 1;
    };
  }, [finding.id, viewer]);

  function applySection(): void {
    if (!viewer) return;
    const trimmed = sectionInput.trim();
    if (trimmed === "") {
      viewer.setSectionZ(null);
      setSectionActive(false);
      return;
    }
    const z = Number(trimmed);
    if (!Number.isFinite(z)) return;
    viewer.setSectionZ(z);
    setSectionActive(true);
  }

  async function inspectSelection(): Promise<void> {
    propertyRequest.current?.controller.abort();
    propertyRequest.current = null;
    const requestVersion = ++propertyRequestVersion.current;
    setProperty(null);
    setPropertyError(null);
    if (!viewer) return;
    const selected = viewer.snapshot().selected;
    if (!selected) return;
    const member = membersForFinding.find(
      (object) =>
        object.ref.revisionId === selected.ref.revisionId &&
        object.ref.objectId === selected.ref.objectId,
    );
    if (!member) return;
    if (!member.objectId) {
      setPropertyError(copy(REVIEW_COPY.noOccurrence, lang));
      return;
    }
    const selectedKey = refKey(selected.ref);
    const controller = new AbortController();
    propertyRequest.current = { controller, version: requestVersion };
    try {
      const detail = await fetchObjectDetail(member.objectId, controller.signal);
      const current = viewer.snapshot().selected;
      const currentKey = refKey(current?.ref ?? null);
      if (
        controller.signal.aborted ||
        requestVersion !== propertyRequestVersion.current ||
        currentKey !== selectedKey
      ) {
        return;
      }
      setProperty(detail);
    } catch (reason: unknown) {
      const current = viewer.snapshot().selected;
      const currentKey = refKey(current?.ref ?? null);
      if (
        controller.signal.aborted ||
        requestVersion !== propertyRequestVersion.current ||
        currentKey !== selectedKey
      ) {
        return;
      }
      setPropertyError(reason instanceof Error ? reason.message : copy(REVIEW_COPY.propertyError, lang));
    } finally {
      if (propertyRequest.current?.version === requestVersion) {
        propertyRequest.current = null;
      }
    }
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const windowed = filtered.length > VIRTUALIZE_AFTER;
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const first = valid[0] ?? null;

  return (
    <div className="space-y-3" data-evidence-panel={finding.id} data-inspector-active={finding.id}>
      <div>
        <p className="text-[11px] text-muted-foreground">要件 / Requirement</p>
        <p className="mt-0.5 break-all font-mono text-xs" data-evidence-requirement>
          {finding.requirement}
        </p>
      </div>

      {finding.incomplete && (
        <p
          className="border border-dashed border-border bg-muted/40 px-2 py-1.5 text-xs"
          data-evidence-incomplete
        >
          {copy(REVIEW_COPY.incompleteNotice, lang)}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[11px] text-muted-foreground">期待値 / Expected</p>
          {finding.expected ? (
            <p data-evidence-expected>{finding.expected}</p>
          ) : (
            <p className="text-muted-foreground" data-evidence-expected-absent>
              {copy(REVIEW_COPY.expectedAbsent, lang)}
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">指示 / Instructions</p>
          {finding.instructions ? (
            <p data-evidence-instructions>{finding.instructions}</p>
          ) : (
            <p className="text-muted-foreground" data-evidence-instructions-absent>
              {copy(REVIEW_COPY.instructionsAbsent, lang)}
            </p>
          )}
        </div>
      </div>

      {first && (
        <div className="border border-border p-2 text-xs" data-first-member-summary>
          <p className="text-[11px] text-muted-foreground">代表メンバー / First member</p>
          <p className="mt-0.5 truncate font-medium">
            {first.name ?? "Unnamed"} · {first.ifcType} #{first.expressId}
          </p>
          <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
            実測値 / actual: {first.actual ?? "—"}
            {first.storey ? ` · ${first.storey}` : ""} · {modelNameOf(first.modelId)}
          </p>
        </div>
      )}

      <div data-evidence-scope>
        <p className="text-[11px] text-muted-foreground">{copy(REVIEW_COPY.scopeHeading, lang)}</p>
        {finding.objectCount === 0 ? (
          <p className="mt-0.5 text-xs" data-scope-no-match>
            {copy(REVIEW_COPY.noMatchScope, lang)}
            {specRow ? (
              <span className="tnum text-muted-foreground">
                {" "}
                · {specRow.specName}: 適用{specRow.applicableCount} / 合格{specRow.passCount}
              </span>
            ) : (
              ""
            )}
          </p>
        ) : specRow ? (
          <div className="mt-0.5 text-xs">
            <p className="tnum" data-scope-counts>
              {specRow.specName}: 適用{specRow.applicableCount} / 合格{specRow.passCount} / 不合格
              {specRow.failCount} / 未判定{specRow.incompleteCount}
            </p>
            {specRow.notes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground" data-scope-notes>
                {specRow.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">適用範囲の詳細は仕様表を参照 / See the spec table.</p>
        )}
      </div>

      <p className="tnum text-[11px] text-muted-foreground" data-pack-identity>
        {run.packName} v{run.packVersion} · engine {run.engineVersion} · parser {run.parserVersion} ·{" "}
        {finding.facet} · {finding.categoryLabel}
      </p>

      {issues.length > 0 && (
        <p className="border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px]" data-malformed-banner>
          {copy(REVIEW_COPY.malformedMembers, lang)} ({issues.length}件: {issues[0].reason} @#{issues[0].index})
        </p>
      )}

      <ObjectFilters filters={filters} options={filterOptions} onChange={onFiltersChange} />

      <p className="tnum text-[11px] text-muted-foreground" data-member-counts>
        {filtered.length} / {valid.length}件表示
        {valid.length !== uniqueKeys ? ` · 一意 ${uniqueKeys}件 (revisionId+objectIdで重複除去)` : ""}
        {matched !== null ? ` · ビューア一致 ${matched}件` : ""} · 描画不可 {withoutGeometry.length}件
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{copy(REVIEW_COPY.sectionZ, lang)}</span>
          <input
            aria-label={copy(REVIEW_COPY.sectionZInputLabel, lang)}
            className="w-20 border border-border bg-card px-1.5 py-1 font-mono text-xs"
            value={sectionInput}
            inputMode="decimal"
            onChange={(event) => setSectionInput(event.target.value)}
            onBlur={applySection}
            onKeyDown={(event) => {
              if (event.key === "Enter") applySection();
            }}
          />
          {sectionActive && <span className="text-muted-foreground">{copy(REVIEW_COPY.sectionActive, lang)}</span>}
        </label>
        <Button variant="outline" size="sm" onClick={() => void inspectSelection()}>
          {copy(REVIEW_COPY.inspectSelection, lang)}
        </Button>
      </div>
      {propertyError && <p className="text-xs text-destructive">{propertyError}</p>}
      {property && (
        <dl className="space-y-1.5 border border-border p-2 text-xs" data-property-panel>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{copy(REVIEW_COPY.propertyType, lang)}</dt>
            <dd className="font-mono">{property.ifcType}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{copy(REVIEW_COPY.propertyName, lang)}</dt>
            <dd className="truncate">{property.name ?? copy(REVIEW_COPY.unnamed, lang)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{copy(REVIEW_COPY.propertyStorey, lang)}</dt>
            <dd>{property.storey ?? copy(REVIEW_COPY.noValue, lang)}</dd>
          </div>
          {property.properties.slice(0, 12).map((group) => (
            <div key={`${group.pset}.${group.name}`}>
              <dt className="text-muted-foreground">
                {group.pset}.{group.name}
                {group.origin === "type" ? copy(REVIEW_COPY.propertyTypeOrigin, lang) : ""}
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


      {loadFailed && !membersLoading && (
        <div
          className="border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px]"
          data-members-failed
        >
          <p>
            全件の読み込みに失敗しました。{membersForFinding.length}
            件のサンプルを表示中 / Could not load all members — showing the{" "}
            {membersForFinding.length}-object sample.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            再取得 / Retry
          </Button>
        </div>
      )}

      {membersLoading ? (
        <p className="text-xs text-muted-foreground" role="status" data-members-loading>
          Loading affected objects… {membersForFinding.length}
        </p>
      ) : (
        <div>
          <table className="w-full text-xs" data-object-table={windowed ? "windowed" : "full"}>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">名称 / Name</th>
                <th scope="col" className="py-1 pr-2 font-medium">階</th>
                <th scope="col" className="py-1 pr-2 font-medium">モデル</th>
                <th scope="col" className="py-1 font-medium">実測値 / Actual</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((object, index) => (
                <tr
                  key={`${object.modelId}-${object.expressId}-${safePage * PAGE_SIZE + index}`}
                  className="border-t border-border"
                  data-object-row={`${object.ref.revisionId}:${object.ref.objectId}`}
                >
                  <td className="max-w-36 py-1 pr-2">
                    <span className="block truncate">{object.name ?? "Unnamed"}</span>
                    <span className="tnum block font-mono text-[11px] text-muted-foreground">
                      #{object.expressId} · {object.ifcType}
                    </span>
                  </td>
                  <td className="py-1 pr-2">{object.storey ?? "—"}</td>
                  <td className="max-w-24 truncate py-1 pr-2">{modelNameOf(object.modelId)}</td>
                  <td className="py-1 text-muted-foreground">{object.actual ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div className="mt-1.5 flex items-center gap-2 text-xs" data-object-pager>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === 0}
                onClick={() => onPageChange(safePage - 1)}
                aria-label="Previous objects page"
              >
                ←
              </Button>
              <span className="tnum" aria-live="polite">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => onPageChange(safePage + 1)}
                aria-label="Next objects page"
              >
                →
              </Button>
            </div>
          )}
        </div>
      )}

      {withoutGeometry.length > 0 && (
        <div className="border border-border p-2 text-[11px]" data-no-geometry-block>
          <p className="font-medium">
            {copy(REVIEW_COPY.membersWithoutGeometry, lang)} ({withoutGeometry.length})
          </p>
          <p className="mt-0.5 text-muted-foreground">
            テキスト証拠のみのメンバーです。描画対象から除外し、一覧に保持しています。
          </p>
          <ul className="mt-1 space-y-0.5 font-mono">
            {withoutGeometry.slice(0, 5).map((object, index) => (
              <li key={`${object.modelId}-${index}`}>
                {object.ifcType} · {object.globalId ?? "no GlobalId"}
                {object.actual ? ` · actual: ${object.actual}` : ""}
                {object.incompleteReason ? ` · ${object.incompleteReason}` : ""}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5"
            onClick={() => setRetryCount((count) => count + 1)}
            data-geometry-retry
          >
            再取得 / Retry ({copy(REVIEW_COPY.retry, lang)})
          </Button>
        </div>
      )}

      {selectedHidden && (
        <p className="border border-border bg-muted px-2 py-1.5 text-[11px]" data-hidden-notice>
          選択中のオブジェクトは現在の絞り込みで非表示です。選択は保持されます。
        </p>
      )}
    </div>
  );
}

function uniqueBy(values: string[], label: (value: string) => string): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: label(value) });
  }
  return out;
}
