// Compare inspector: object-change rows plus finding-delta list. Hosted inside
// the viewer's Findings tab via the generic `inspector` seam, so the compare
// screen never renders two competing lists. Finding deltas stay their own
// list (scorecard grouping), never merged into geometry entries.
"use client";

import { useState } from "react";
import { CHANGE_LABEL, SEVERITY_LABEL } from "@/lib/i18n";
import { CHANGE_COLOR, SEVERITY_COLOR } from "@/lib/palette";
import type {
  ChangeKind,
  DiffSummary,
  FindingChange,
  FindingDelta,
  FindingDiffResponse,
  RunDetail,
  RunSummary,
} from "@/lib/types";
import { copy } from "../review/review-i18n";
import { runLabel } from "../review/pack-selection";
import type { FindingIncomparableDimension } from "./compare-api";
import { activeKeyOf, sideBannerFor } from "./compare-bridge";
import {
  compareRefKey,
  isUncertain,
  type CompareChangeEntry,
  type CompareSelection,
  type CompareSide,
  type FindingStatus,
  type ModelDiffStatus,
} from "./compare-state";

const COPY = {
  changesHeading: { ja: "モデル差分", en: "Model changes" },
  findingsHeading: { ja: "指摘差分", en: "Finding changes" },
  baseRunLabel: { ja: "基準ラン", en: "Base run" },
  headRunLabel: { ja: "先端ラン", en: "Head run" },
  selectRun: { ja: "ランを選択", en: "Select a run" },
  uncertainBadge: { ja: "不確実", en: "Uncertain" },
  movedDistance: { ja: "移動距離", en: "Moved" },
  beforeValue: { ja: "変更前", en: "Before" },
  afterValue: { ja: "変更後", en: "After" },
  rerun: { ja: "再実行", en: "Rerun" },
  rerunning: { ja: "実行中…", en: "Running…" },
} as const;

const KIND_ORDER: readonly ChangeKind[] = [
  "added",
  "removed",
  "moved",
  "shape_changed",
  "properties_changed",
  "mixed",
  "unchanged",
];

const DELTA_ORDER: readonly FindingDelta[] = ["resolved", "introduced", "persisting"];

const DELTA_COPY: Record<FindingDelta, { ja: string; en: string }> = {
  resolved: { ja: "解消", en: "Resolved" },
  introduced: { ja: "新規", en: "Introduced" },
  persisting: { ja: "継続", en: "Persisting" },
};

const DIMENSION_COPY: Record<FindingIncomparableDimension, { ja: string; en: string }> = {
  provenance_incomplete: { ja: "入力の来歴が未確定", en: "Input provenance incomplete" },
  run_not_completed: { ja: "ランが完了していない", en: "Run not completed" },
  run_incomplete: { ja: "未判定の要件がある", en: "Run has review-incomplete outcomes" },
  pack_version_mismatch: { ja: "チェックパックの版が不一致", en: "Pack versions differ" },
  pack_digest_mismatch: { ja: "チェックパックの内容が不一致", en: "Pack digests differ" },
  scope_mismatch: { ja: "判定範囲が不一致", en: "Check scope differs" },
  engine_profile_mismatch: { ja: "エンジンの版が不一致", en: "Engine profiles differ" },
};

export interface CompareInspectorProps {
  readonly side: CompareSide;
  readonly entries: readonly CompareChangeEntry[];
  readonly unfilteredCount: number;
  readonly summary: DiffSummary | null;
  readonly selection: CompareSelection;
  readonly onSelect: (key: CompareSelection) => void;
  readonly onJumpSide: (side: CompareSide) => void;
  readonly drawnKeys: readonly string[];
  readonly undrawable: number;
  readonly overflow: ReadonlyArray<{ kind: ChangeKind; count: number }>;
  readonly modelStatus: ModelDiffStatus;
  readonly modelError: string | null;
  readonly profileExpected: string | null;
  readonly profileActual: string | null;
  readonly baseDeliveryId: string | null;
  readonly headDeliveryId: string | null;
  readonly baseRuns: readonly RunSummary[];
  readonly headRuns: readonly RunSummary[];
  readonly baseRunId: string | null;
  readonly headRunId: string | null;
  readonly onRunsChange: (baseRunId: string | null, headRunId: string | null) => void;
  readonly findingStatus: FindingStatus;
  readonly findingDiff: FindingDiffResponse | null;
  readonly findingError: string | null;
  readonly findingDimension: FindingIncomparableDimension | null;
  readonly onRunCreated: (detail: RunDetail) => void;
}

export function CompareInspector(props: CompareInspectorProps): React.JSX.Element {
  const selectedIndex = props.selection == null ? null : findSelectedIndex(props.entries, props.selection);
  const selected = selectedIndex == null ? null : (props.entries[selectedIndex] ?? null);
  return (
    <div className="space-y-6" data-compare-inspector>
      <section aria-label={copy(COPY.changesHeading, "ja")}>
        <h2 className="text-sm font-semibold">
          {copy(COPY.changesHeading, "ja")} / {copy(COPY.changesHeading, "en")}
        </h2>
        <ModelStateBlock
          status={props.modelStatus}
          error={props.modelError}
          profileExpected={props.profileExpected}
          profileActual={props.profileActual}
        />
        {props.modelStatus === "ready" && (
          <>
            <SummaryCounts summary={props.summary} filtered={props.entries.length} total={props.unfilteredCount} />
            {props.undrawable > 0 && (
              <p className="mt-2 text-xs text-muted-foreground" data-undrawable-count={props.undrawable}>
                ジオメトリなしの変更 {props.undrawable}件 / {props.undrawable} changes without geometry
              </p>
            )}
            {props.overflow.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {props.overflow.map(({ kind, count }) => `${CHANGE_LABEL.ja[kind]} ${count}件`).join("・")}
                は一覧のみ表示 / collapsed to the list
              </p>
            )}
            <ol className="mt-2 space-y-1.5">
              {props.entries.map((entry) => {
                const activeKey = activeKeyOf(entry.change, props.side);
                const key = activeKey ?? fallbackKey(entry);
                const isSelected = props.selection !== null && entryKeyMatches(entry, props.selection);
                const drawn = activeKey !== null && props.drawnKeys.includes(activeKey);
                return (
                  <li key={`${entry.sourceModelId}:${entry.index}`}>
                    <ChangeRow
                      entry={entry}
                      selected={isSelected}
                      drawn={drawn}
                      onSelect={() => props.onSelect(isSelected ? null : key)}
                    />
                  </li>
                );
              })}
            </ol>
            {selected && (
              <SelectedDetail
                entry={selected}
                side={props.side}
                drawnKeys={props.drawnKeys}
                onJumpSide={props.onJumpSide}
              />
            )}
          </>
        )}
      </section>

      <section aria-label={copy(COPY.findingsHeading, "ja")}>
        <h2 className="text-sm font-semibold">
          {copy(COPY.findingsHeading, "ja")} / {copy(COPY.findingsHeading, "en")}
        </h2>
        <div className="mt-2 grid gap-2">
          <RunPicker
            id="compare-base-run"
            label={copy(COPY.baseRunLabel, "ja")}
            runs={props.baseRuns}
            value={props.baseRunId}
            onChange={(runId) => props.onRunsChange(runId, props.headRunId)}
          />
          <RunPicker
            id="compare-head-run"
            label={copy(COPY.headRunLabel, "ja")}
            runs={props.headRuns}
            value={props.headRunId}
            onChange={(runId) => props.onRunsChange(props.baseRunId, runId)}
          />
        </div>
        <FindingStateBlock
          status={props.findingStatus}
          error={props.findingError}
          dimension={props.findingDimension}
          baseDeliveryId={props.baseDeliveryId}
          headDeliveryId={props.headDeliveryId}
          baseRunId={props.baseRunId}
          headRunId={props.headRunId}
          baseRuns={props.baseRuns}
          headRuns={props.headRuns}
          onRunCreated={props.onRunCreated}
        />
        {props.findingStatus === "ready" && props.findingDiff && (
          <FindingDeltaList diff={props.findingDiff} />
        )}
      </section>
    </div>
  );
}

/** A change with no active-side ref still needs a stable selection key. */
function fallbackKey(entry: CompareChangeEntry): string {
  const ref = entry.change.head ?? entry.change.base;
  if (ref) return compareRefKey(ref.revisionId, ref.objectId);
  return `change:${entry.sourceModelId}:${entry.index}`;
}

function entryKeyMatches(entry: CompareChangeEntry, key: string): boolean {
  const { base, head } = entry.change;
  if (base && compareRefKey(base.revisionId, base.objectId) === key) return true;
  if (head && compareRefKey(head.revisionId, head.objectId) === key) return true;
  return fallbackKey(entry) === key;
}

function findSelectedIndex(entries: readonly CompareChangeEntry[], key: string): number | null {
  const index = entries.findIndex((entry) => entryKeyMatches(entry, key));
  return index >= 0 ? index : null;
}

function ModelStateBlock({
  status,
  error,
  profileExpected,
  profileActual,
}: {
  status: ModelDiffStatus;
  error: string | null;
  profileExpected: string | null;
  profileActual: string | null;
}): React.JSX.Element | null {
  if (status === "loading" || status === "idle") {
    return (
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        モデル差分を読み込み中 / Loading model diff…
      </p>
    );
  }
  if (status === "profile_mismatch_409") {
    return (
      <div className="mt-2 border border-destructive/40 p-3 text-xs" data-profile-mismatch role="alert">
        <p className="font-medium">指紋プロファイルが不一致 / Fingerprint profile mismatch</p>
        {profileExpected && profileActual && (
          <p className="mt-1">
            期待 {profileExpected} / 検出 {profileActual} / expected {profileExpected}, found {profileActual}
          </p>
        )}
        <p className="mt-1 text-muted-foreground">
          両版を同一プロファイルで再計算してください。履歴は追記専用のため、リビジョンの再アップロードで再計算されます。/
          Recompute both revisions under one profile by re-uploading (history is append-only).
        </p>
        {error && <p className="mt-1 text-destructive">{error}</p>}
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="mt-2 border border-destructive/40 p-3 text-xs" data-model-diff-failed role="alert">
        <p className="font-medium">モデル差分を読み込めません / Model diff could not be loaded</p>
        {error && <p className="mt-1 text-destructive">{error}</p>}
      </div>
    );
  }
  return null;
}

function SummaryCounts({
  summary,
  filtered,
  total,
}: {
  summary: DiffSummary | null;
  filtered: number;
  total: number;
}): React.JSX.Element | null {
  if (!summary) return null;
  const counts: Array<{ kind: ChangeKind; count: number }> = KIND_ORDER.map((kind) => ({
    kind,
    count:
      kind === "added"
        ? summary.added
        : kind === "removed"
          ? summary.removed
          : kind === "moved"
            ? summary.moved
            : kind === "shape_changed"
              ? summary.shapeChanged
              : kind === "properties_changed"
                ? summary.propertiesChanged
                : kind === "mixed"
                  ? summary.mixed
                  : summary.unchanged,
  })).filter(({ kind, count }) => kind === "unchanged" || count > 0 || filtered < total);
  return (
    <div className="mt-2" data-change-summary>
      <ul className="flex flex-wrap gap-1.5">
        {counts.map(({ kind, count }) => (
          <li
            key={kind}
            className="flex items-center gap-1.5 border border-border px-2 py-1 text-xs"
            data-summary-kind={kind}
          >
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: CHANGE_COLOR[kind] }} />
            {CHANGE_LABEL.ja[kind]} {count}件
          </li>
        ))}
      </ul>
      {summary.uncertainMatches > 0 && (
        <p className="mt-1 text-xs text-muted-foreground" data-uncertain-count={summary.uncertainMatches}>
          うち不確実な照合 {summary.uncertainMatches}件 / {summary.uncertainMatches} uncertain matches
        </p>
      )}
    </div>
  );
}

function ChangeRow({
  entry,
  selected,
  drawn,
  onSelect,
}: {
  entry: CompareChangeEntry;
  selected: boolean;
  drawn: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { change } = entry;
  const ref = change.head ?? change.base;
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-change-row
      data-change-kind={change.kind}
      data-change-index={entry.index}
      data-selected={selected ? "true" : "false"}
      onClick={onSelect}
      className={`flex w-full items-start gap-2 border px-2 py-1.5 text-left text-xs ${
        selected ? "border-primary bg-accent" : "border-border"
      }`}
    >
      <span aria-hidden className="mt-1 inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: CHANGE_COLOR[change.kind] }} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{CHANGE_LABEL.ja[change.kind]}</span>
          <span className="truncate">{ref?.name ?? "(名称なし / unnamed)"}</span>
          {isUncertain(change) && (
            <span className="border border-border px-1 py-px" data-uncertain-badge>
              {copy(COPY.uncertainBadge, "ja")}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-muted-foreground">
          {ref?.ifcType ?? "—"} · express #{ref?.expressId ?? "—"}
          {ref?.globalId ? ` · ${ref.globalId}` : " · GlobalIdなし"}
          {!drawn && change.kind !== "unchanged" ? " · 一覧のみ" : ""}
        </span>
      </span>
    </button>
  );
}

function SelectedDetail({
  entry,
  side,
  drawnKeys,
  onJumpSide,
}: {
  entry: CompareChangeEntry;
  side: CompareSide;
  drawnKeys: readonly string[];
  onJumpSide: (side: CompareSide) => void;
}): React.JSX.Element {
  const { change } = entry;
  const banner = sideBannerFor(change, side);
  const activeKey = activeKeyOf(change, side);
  const framed = activeKey !== null && drawnKeys.includes(activeKey);
  return (
    <div className="mt-2 border border-border p-3 text-xs" data-change-detail data-change-kind={change.kind}>
      <p className="font-medium">
        <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full" style={{ backgroundColor: CHANGE_COLOR[change.kind] }} />
        {CHANGE_LABEL.ja[change.kind]} / {change.kind}
      </p>
      <p className="mt-1 text-muted-foreground">
        {entry.sourceModelName} · {(change.head ?? change.base)?.ifcType ?? "—"}
        {isUncertain(change) && (
          <>
            {" · "}
            <UncertainText change={entry.change} />
          </>
        )}
      </p>
      {banner && (
        <div className="mt-2 border border-amber-500/50 p-2" data-side-banner={banner.missingSide} role="status">
          <p>
            {banner.reason === "added"
              ? "この追加は先端版にのみ存在します / This addition exists only on the head side"
              : "この削除は基準版にのみ存在します / This removal exists only on the base side"}
          </p>
          <button
            type="button"
            className="mt-1.5 border border-border px-2 py-1"
            data-jump-side={banner.missingSide}
            onClick={() => onJumpSide(banner.missingSide)}
          >
            {banner.missingSide === "head" ? "先端で表示 / Show in head" : "基準で表示 / Show in base"}
          </button>
        </div>
      )}
      {activeKey && !banner && (
        <p className="mt-1 text-muted-foreground" data-frame-state={framed ? "framed" : "listed"}>
          {framed ? "形状を選択中 / Geometry framed" : "一覧のみ / Listed without geometry"}
        </p>
      )}
      {change.movedDistanceM != null && (
        <p className="mt-1">
          {copy(COPY.movedDistance, "ja")} {(change.movedDistanceM).toFixed(3)} m / {copy(COPY.movedDistance, "en")}{" "}
          {(change.movedDistanceM).toFixed(3)} m
        </p>
      )}
      {change.propertyChanges.length > 0 && (
        <table className="mt-2 w-full border-collapse text-xs" data-property-changes>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="border border-border px-1.5 py-1 font-normal">属性 / Property</th>
              <th className="border border-border px-1.5 py-1 font-normal">{copy(COPY.beforeValue, "ja")}</th>
              <th className="border border-border px-1.5 py-1 font-normal">{copy(COPY.afterValue, "ja")}</th>
            </tr>
          </thead>
          <tbody>
            {change.propertyChanges.map((property) => (
              <tr key={`${property.pset}.${property.name}`}>
                <td className="border border-border px-1.5 py-1">
                  {property.pset}.{property.name}
                </td>
                <td className="border border-border px-1.5 py-1">{property.base ?? "—"}</td>
                <td className="border border-border px-1.5 py-1">{property.head ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {change.notes.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {change.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UncertainText({ change }: { change: CompareChangeEntry["change"] }): React.JSX.Element {
  if (change.confidence.kind === "heuristic") {
    return (
      <span data-confidence="heuristic">
        推定照合 (score {change.confidence.score.toFixed(2)} · {change.confidence.basis})
      </span>
    );
  }
  return <span data-confidence="none">照合なし / unmatched</span>;
}

function RunPicker({
  id,
  label,
  runs,
  value,
  onChange,
}: {
  id: string;
  label: string;
  runs: readonly RunSummary[];
  value: string | null;
  onChange: (runId: string | null) => void;
}): React.JSX.Element {
  return (
    <label className="grid gap-1 text-xs" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <select
        id={id}
        className="border border-border bg-background px-2 py-1.5 text-xs"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">{`${copy(COPY.selectRun, "ja")} / ${copy(COPY.selectRun, "en")}`}</option>
        {runs.map((run) => (
          <option key={run.id} value={run.id}>
            {runLabel(run)}
          </option>
        ))}
      </select>
    </label>
  );
}

function FindingStateBlock(props: {
  status: FindingStatus;
  error: string | null;
  dimension: FindingIncomparableDimension | null;
  baseDeliveryId: string | null;
  headDeliveryId: string | null;
  baseRunId: string | null;
  headRunId: string | null;
  baseRuns: readonly RunSummary[];
  headRuns: readonly RunSummary[];
  onRunCreated: (detail: RunDetail) => void;
}): React.JSX.Element | null {
  if (props.status === "loading") {
    return (
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        指摘差分を読み込み中 / Loading finding diff…
      </p>
    );
  }
  if (props.status === "incomparable_409") {
    return (
      <div className="mt-2 border border-destructive/40 p-3 text-xs" data-finding-incomparable role="alert">
        <p className="font-medium">比較できない設定差 / Incomparable checking settings</p>
        {props.dimension && (
          <p className="mt-1" data-incomparable-dimension={props.dimension}>
            {DIMENSION_COPY[props.dimension].ja} / {DIMENSION_COPY[props.dimension].en} ({props.dimension})
          </p>
        )}
        {props.error && <p className="mt-1 text-destructive">{props.error}</p>}
        <RerunButtons
          baseDeliveryId={props.baseDeliveryId}
          headDeliveryId={props.headDeliveryId}
          baseRunId={props.baseRunId}
          headRunId={props.headRunId}
          baseRuns={props.baseRuns}
          headRuns={props.headRuns}
          onRunCreated={props.onRunCreated}
        />
      </div>
    );
  }
  if (props.status === "failed") {
    return (
      <div className="mt-2 border border-destructive/40 p-3 text-xs" data-finding-diff-failed role="alert">
        <p className="font-medium">指摘差分を読み込めません / Finding diff could not be loaded</p>
        {props.error && <p className="mt-1 text-destructive">{props.error}</p>}
      </div>
    );
  }
  if (props.status === "idle") {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-no-runs-selected>
        両方のランを選択してください / Select both runs to compare their findings.
      </p>
    );
  }
  return null;
}

function FindingDeltaList({ diff }: { diff: FindingDiffResponse }): React.JSX.Element {
  const byDelta = new Map<FindingDelta, FindingChange[]>();
  for (const change of diff.changes) {
    const bucket = byDelta.get(change.delta);
    if (bucket) bucket.push(change);
    else byDelta.set(change.delta, [change]);
  }
  return (
    <div className="mt-2 space-y-3" data-finding-delta-list>
      <p className="text-xs text-muted-foreground">
        解消 {diff.resolved}件 · 新規 {diff.introduced}件 · 継続 {diff.persisting}件 / resolved {diff.resolved},
        introduced {diff.introduced}, persisting {diff.persisting}
      </p>
      {DELTA_ORDER.map((delta) => (
        <section key={delta} aria-label={`${DELTA_COPY[delta].ja} / ${DELTA_COPY[delta].en}`} data-finding-delta={delta}>
          <h3 className="text-xs font-semibold">
            {DELTA_COPY[delta].ja} ({byDelta.get(delta)?.length ?? 0}) / {DELTA_COPY[delta].en}
          </h3>
          <ul className="mt-1 space-y-1">
            {(byDelta.get(delta) ?? []).map((change) => (
              <li key={change.findingKey} className="flex items-start gap-2 border border-border px-2 py-1.5 text-xs">
                <span
                  aria-hidden
                  className="mt-1 inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: SEVERITY_COLOR[change.severity] }}
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {SEVERITY_LABEL.ja[change.severity]} · {change.title}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    {change.categoryLabel} · 基準 {change.baseObjectCount}件 / 先端 {change.headObjectCount}件
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Rerun CTA for incomparable runs. PackSelection's createRunWith is local to
 * that module, so this copies its POST-plus-poll shape: mint a new run on the
 * same delivery under the same pack version, never mutating the old one.
 */
function RerunButtons(props: {
  baseDeliveryId: string | null;
  headDeliveryId: string | null;
  baseRunId: string | null;
  headRunId: string | null;
  baseRuns: readonly RunSummary[];
  headRuns: readonly RunSummary[];
  onRunCreated: (detail: RunDetail) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState<"base" | "head" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rerun(which: "base" | "head"): Promise<void> {
    const deliveryId = which === "base" ? props.baseDeliveryId : props.headDeliveryId;
    const runId = which === "base" ? props.baseRunId : props.headRunId;
    const runs = which === "base" ? props.baseRuns : props.headRuns;
    const packVersionId = runs.find((run) => run.id === runId)?.packVersionId;
    if (!deliveryId || !packVersionId || busy) return;
    setBusy(which);
    setError(null);
    try {
      props.onRunCreated(await postAndPollRun(deliveryId, packVersionId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Run could not be created");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          className="border border-border px-2 py-1"
          disabled={busy !== null}
          onClick={() => void rerun("base")}
        >
          {busy === "base" ? copy(COPY.rerunning, "ja") : `${copy(COPY.rerun, "ja")} (基準)`} /{" "}
          {busy === "base" ? copy(COPY.rerunning, "en") : `${copy(COPY.rerun, "en")} base`}
        </button>
        <button
          type="button"
          className="border border-border px-2 py-1"
          disabled={busy !== null}
          onClick={() => void rerun("head")}
        >
          {busy === "head" ? copy(COPY.rerunning, "ja") : `${copy(COPY.rerun, "ja")} (先端)`} /{" "}
          {busy === "head" ? copy(COPY.rerunning, "en") : `${copy(COPY.rerun, "en")} head`}
        </button>
      </div>
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  );
}

async function postAndPollRun(deliveryId: string, packVersionId: string): Promise<RunDetail> {
  const created = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryId, packVersionId }),
  });
  if (!created.ok) {
    const text = await created.text().catch(() => "");
    throw new Error(`Run creation failed with HTTP ${created.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const createdDetail = (await created.json()) as RunDetail;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const response = await fetch(`/api/runs/${encodeURIComponent(createdDetail.run.id)}`);
    if (!response.ok) throw new Error(`Run request failed with HTTP ${response.status}`);
    const detail = (await response.json()) as RunDetail;
    if (detail.run.status === "completed" || detail.run.status === "failed") return detail;
    if (Date.now() > deadline) throw new Error("Run did not settle within 120 s");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
