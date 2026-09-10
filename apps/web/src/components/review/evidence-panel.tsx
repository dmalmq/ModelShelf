// Evidence for one finding: requirement, expected (with an honest absence
// marker, never invented), actual per object plus a first-member summary,
// instructions (honest absence), scope/applicability with notes, and pack /
// engine identity. All affected objects stay reachable: the 25-sample renders
// first, fetchAllFindingObjects pages the rest, and past 100 rows the table is
// windowed behind a pager. Malformed member metadata shows a banner while the
// valid prefix still renders; nothing here throws on API data.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { SEVERITY_COLOR } from "@/lib/palette";
import { UI, type Locale } from "@/lib/i18n";
import type { Finding, FindingObject, ModelInfo, ObjectDetail, RunSummary, SpecResultRow } from "@/lib/types";
import { fetchAllFindingObjects, fetchObjectDetail } from "../viewer/findings-api";
import type { DeliveryViewerController } from "../viewer/types";
import { ObjectFilters, type FilterOptions } from "./object-filters";
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

const EVIDENCE_COPY = {
  ja: {
    requirement: "要件",
    expected: "期待値",
    section: "断面 Z (m)",
    sectionLabel: "断面 Z メートル",
    sectionActive: "適用中",
    inspect: "選択オブジェクトの属性を表示",
    resetView: "表示をリセット",
    type: "タイプ",
    noOccurrence: "このメンバーには照会できるモデル出現がありません。",
    propertyFailed: "オブジェクト属性を読み込めませんでした",
    undecided: "未判定: エンジンはこの要件を判定できませんでした。合格ではありません。",
    reasons: (reasons: readonly string[]) =>
      reasons.length > 0 ? `理由: ${reasons.join(" / ")}` : "エンジンからの理由の記載はありません。",
    instructions: "指示",
    firstMember: "代表メンバー",
    actual: "実測値",
    unnamed: "名称なし",
    scopeSummary: (name: string, applicable: number, pass: number) =>
      `${name}: 適用${applicable} · 合格${pass}`,
    scopeCounts: (name: string, applicable: number, pass: number, fail: number, incomplete: number) =>
      `${name}: 適用${applicable} · 合格${pass} · 不合格${fail} · 未判定${incomplete}`,
    seeSpecTable: "適用範囲の詳細は仕様表を参照してください。",
    issueCount: (count: number) => `${count}件`,
    memberCounts: (shown: number, valid: number, unique: number, matched: number | null, undrawable: number) =>
      `${shown}/${valid}件表示${valid !== unique ? ` · 一意${unique}件` : ""}${matched !== null ? ` · ビューア一致${matched}件` : ""} · 描画不可${undrawable}件`,
    loadFailed: (sample: number) => `全件の読み込みに失敗しました。${sample}件のサンプルを表示しています。`,
    refetch: "再取得",
    loadingMembers: (count: number) => `対象オブジェクトを読み込み中… ${count}件`,
    name: "名称",
    storey: "階",
    model: "モデル",
    textEvidenceOnly: "テキスト証拠のみのメンバーです。描画対象から除外し、一覧に保持しています。",
    noGlobalId: "GlobalIdなし",
    selectedHidden: "選択中のオブジェクトは現在の絞り込みで非表示です。選択は保持されます。",
    previousPage: "前のオブジェクトページ",
    nextPage: "次のオブジェクトページ",
  },
  en: {
    requirement: "Requirement",
    expected: "Expected",
    section: "Section Z (m)",
    sectionLabel: "Section Z metres",
    sectionActive: "active",
    inspect: "Inspect selection properties",
    resetView: "Reset view",
    type: "Type",
    noOccurrence: "This finding member has no model occurrence to inspect.",
    propertyFailed: "Object properties could not be loaded",
    instructions: "Instructions",
    undecided: "Review incomplete: the engine could not decide this requirement. This is never a pass.",
    reasons: (reasons: readonly string[]) =>
      reasons.length > 0 ? `Reason: ${reasons.join(" / ")}` : "The engine recorded no reason.",
    firstMember: "First member",
    actual: "Actual",
    unnamed: "Unnamed",
    scopeSummary: (name: string, applicable: number, pass: number) =>
      `${name}: ${applicable} applicable · ${pass} passed`,
    scopeCounts: (name: string, applicable: number, pass: number, fail: number, incomplete: number) =>
      `${name}: ${applicable} applicable · ${pass} passed · ${fail} failed · ${incomplete} incomplete`,
    seeSpecTable: "See the spec table for scope details.",
    issueCount: (count: number) => `${count} issues`,
    memberCounts: (shown: number, valid: number, unique: number, matched: number | null, undrawable: number) =>
      `${shown}/${valid} shown${valid !== unique ? ` · ${unique} unique` : ""}${matched !== null ? ` · ${matched} matched in viewer` : ""} · ${undrawable} undrawable`,
    loadFailed: (sample: number) => `Could not load all members. Showing the ${sample}-object sample.`,
    refetch: "Retry",
    loadingMembers: (count: number) => `Loading affected objects… ${count}`,
    name: "Name",
    storey: "Storey",
    model: "Model",
    textEvidenceOnly: "These members have text evidence but no geometry. They remain listed and are excluded from drawing.",
    noGlobalId: "no GlobalId",
    selectedHidden: "The selected object is hidden by the current filter. Its selection is preserved.",
    previousPage: "Previous objects page",
    nextPage: "Next objects page",
  },
} as const;

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
  readonly lang?: Locale;
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
  const copy = EVIDENCE_COPY[lang];
  const [matched, setMatched] = useState<number | null>(null);
  const [selectedHidden, setSelectedHidden] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Keys (`revisionId\0objectId`) with no drawable geometry in this delivery. */
  const [sectionInput, setSectionInput] = useState("");
  const [sectionActive, setSectionActive] = useState(false);
  const [property, setProperty] = useState<ObjectDetail | null>(null);
  const [propertyError, setPropertyError] = useState<string | null>(null);

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

  function resetView(): void {
    if (!viewer) return;
    viewer.setSectionZ(null);
    setSectionInput("");
    setSectionActive(false);
    onFiltersChange({ source: "all", discipline: "all", storey: "all", ifcType: "all" });
  }

  async function inspectSelection(): Promise<void> {
    if (!viewer) return;
    setProperty(null);
    setPropertyError(null);
    const selected = viewer.diagnostics().snapshot.selected;
    if (!selected) return;
    const match = membersForFinding.find(
      (object) =>
        object.ref.revisionId === selected.ref.revisionId && object.ref.objectId === selected.ref.objectId,
    );
    if (!match) return;
    if (!match.objectId) {
      setPropertyError(copy.noOccurrence);
      return;
    }
    try {
      setProperty(await fetchObjectDetail(match.objectId));
    } catch (reason: unknown) {
      setPropertyError(reason instanceof Error ? reason.message : copy.propertyFailed);
    }
  }

  const [notDrawn, setNotDrawn] = useState<Record<string, true>>({});

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

  /** Distinct engine-supplied reasons behind an undecided requirement. */
  const reasonsGiven = useMemo(
    () => [
      ...new Set(
        membersForFinding
          .map((object) => object.incompleteReason)
          .filter((reason): reason is string => Boolean(reason)),
      ),
    ],
    [membersForFinding],
  );

  const filtered = useMemo(() => filterMembers(valid, filters), [valid, filters]);

  // The viewer owns selection truth; mirror its hidden flag so the notice
  // appears the moment the selection leaves the isolated set.
  useEffect(() => {
    if (!viewer) return;
    return viewer.subscribe(() => setSelectedHidden(viewer.diagnostics().selectedHidden));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const windowed = filtered.length > VIRTUALIZE_AFTER;
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const first = valid[0] ?? null;

  return (
    <div className="space-y-3" data-evidence-panel={finding.id}>
      {finding.incomplete && (
        <p
          className="border border-border bg-muted px-2 py-1.5 text-xs font-medium"
          data-incomplete-evidence
        >
          {copy.undecided} {copy.reasons(reasonsGiven)}
        </p>
      )}
      <div>
        <p className="text-xs text-muted-foreground">{copy.requirement}</p>
        <p className="mt-0.5 break-all font-mono text-xs" data-evidence-requirement>
          {finding.requirement}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-xs text-muted-foreground">{copy.expected}</p>
          {finding.expected ? (
            <p data-evidence-expected>{finding.expected}</p>
          ) : (
            <p className="text-muted-foreground" data-evidence-expected-absent>
              {UI[lang].expectedAbsent}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{copy.instructions}</p>
          {finding.instructions ? (
            <p data-evidence-instructions>{finding.instructions}</p>
          ) : (
            <p className="text-muted-foreground" data-evidence-instructions-absent>
              {UI[lang].instructionsAbsent}
            </p>
          )}
        </div>
      </div>

      {first && (
        <div className="border border-border p-2 text-xs" data-first-member-summary>
          <p className="text-xs text-muted-foreground">{copy.firstMember}</p>
          <p className="mt-0.5 truncate font-medium">
            {first.name ?? copy.unnamed} · {first.ifcType} #{first.expressId}
          </p>
          <p className="tnum mt-0.5 text-xs text-muted-foreground">
            {copy.actual}: {first.actual ?? "—"}
            {first.storey ? ` · ${first.storey}` : ""} · {modelNameOf(first.modelId)}
          </p>
        </div>
      )}

      <div data-evidence-scope>
        <p className="text-xs text-muted-foreground">{UI[lang].scopeHeading}</p>
        {finding.objectCount === 0 ? (
          <p className="mt-0.5 text-xs" data-scope-no-match>
            {UI[lang].noMatchScope}
            {specRow ? (
              <span className="tnum text-muted-foreground">
                {" "}
                · {copy.scopeSummary(specRow.specName, specRow.applicableCount, specRow.passCount)}
              </span>
            ) : (
              ""
            )}
          </p>
        ) : specRow ? (
          <div className="mt-0.5 text-xs">
            <p className="tnum" data-scope-counts>
              {copy.scopeCounts(
                specRow.specName,
                specRow.applicableCount,
                specRow.passCount,
                specRow.failCount,
                specRow.incompleteCount,
              )}
            </p>
            {specRow.notes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground" data-scope-notes>
                {specRow.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.seeSpecTable}</p>
        )}
      </div>

      <p className="tnum text-xs text-muted-foreground" data-pack-identity>
        {run.packName} v{run.packVersion} · engine {run.engineVersion} · parser {run.parserVersion} ·{" "}
        {finding.facet} · {finding.categoryLabel}
      </p>

      {issues.length > 0 && (
        <p className="border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs" data-malformed-banner>
          {UI[lang].malformedMembers} ({copy.issueCount(issues.length)}: {issues[0].reason} @#{issues[0].index})
        </p>
      )}

      <ObjectFilters filters={filters} options={filterOptions} onChange={onFiltersChange} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          data-reset-view
          onClick={resetView}
        >
          {copy.resetView}
        </Button>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{copy.section}</span>
          <input
            data-section-z
            aria-label={copy.sectionLabel}
            className="min-h-11 w-20 border border-border bg-card px-1.5 py-1 font-mono text-xs sm:min-h-8"
            value={sectionInput}
            inputMode="decimal"
            onChange={(event) => setSectionInput(event.target.value)}
            onBlur={applySection}
            onKeyDown={(event) => {
              if (event.key === "Enter") applySection();
            }}
          />
          {sectionActive && <span className="text-muted-foreground">{copy.sectionActive}</span>}
        </label>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          data-inspect-selection
          onClick={() => void inspectSelection()}
        >
          {copy.inspect}
        </Button>
      </div>
      {propertyError && <p className="text-xs text-destructive">{propertyError}</p>}
      {property && (
        <dl className="space-y-1.5 border border-border p-2 text-xs" data-property-panel>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{copy.type}</dt>
            <dd className="font-mono">{property.ifcType}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{copy.name}</dt>
            <dd className="truncate">{property.name ?? copy.unnamed}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{copy.storey}</dt>
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

      <p className="tnum text-xs text-muted-foreground" data-member-counts>
        {copy.memberCounts(filtered.length, valid.length, uniqueKeys, matched, withoutGeometry.length)}
      </p>

      {loadFailed && !membersLoading && (
        <div
          className="border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs"
          data-members-failed
        >
          <p>{copy.loadFailed(membersForFinding.length)}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5 min-h-11 sm:min-h-8"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            {copy.refetch}
          </Button>
        </div>
      )}

      {membersLoading ? (
        <p className="text-xs text-muted-foreground" role="status" data-members-loading>
          {copy.loadingMembers(membersForFinding.length)}
        </p>
      ) : (
        <div>
          <table className="w-full text-xs" data-object-table={windowed ? "windowed" : "full"}>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">{copy.name}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{copy.storey}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{copy.model}</th>
                <th scope="col" className="py-1 font-medium">{copy.actual}</th>
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
                    <span className="block truncate">{object.name ?? copy.unnamed}</span>
                    <span className="tnum block font-mono text-xs text-muted-foreground">
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
                aria-label={copy.previousPage}
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
                aria-label={copy.nextPage}
              >
                →
              </Button>
            </div>
          )}
        </div>
      )}

      {withoutGeometry.length > 0 && (
        <div className="border border-border p-2 text-xs" data-no-geometry-block>
          <p className="font-medium">
            {UI[lang].membersWithoutGeometry} ({withoutGeometry.length})
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {copy.textEvidenceOnly}
          </p>
          <ul className="mt-1 space-y-0.5 font-mono">
            {withoutGeometry.slice(0, 5).map((object, index) => (
              <li key={`${object.modelId}-${index}`}>
                {object.ifcType} · {object.globalId ?? copy.noGlobalId}
                {object.actual ? ` · actual: ${object.actual}` : ""}
                {object.incompleteReason ? ` · ${object.incompleteReason}` : ""}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5 min-h-11 sm:min-h-8"
            onClick={() => setRetryCount((count) => count + 1)}
            data-geometry-retry
          >
            {copy.refetch}
          </Button>
        </div>
      )}

      {selectedHidden && (
        <p className="border border-border bg-muted px-2 py-1.5 text-xs" data-hidden-notice>
          {copy.selectedHidden}
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
