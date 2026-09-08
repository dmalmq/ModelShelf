// Scorecard tree: severity bands, then categories, then requirement rows. The
// backend sort is authoritative and preserved — this component never re-sorts,
// so advisory volume cannot displace a critical band. Incomplete-review
// findings render in their own section below, never inside a band. Spec rows
// include not_applicable outcomes explicitly.
"use client";

import { useState } from "react";
import { SeverityBadge } from "../domain/severity-badge";
import { OUTCOME_COLOR } from "@/lib/palette";
import { OUTCOME_LABEL_JA } from "@/lib/mock";
import type { Finding, Severity, SeverityBand, SpecOutcome, SpecResultRow } from "@/lib/types";
import type { FindingSelection } from "./review-state";

interface ScorecardTreeProps {
  readonly bands: readonly SeverityBand[];
  readonly selection: FindingSelection;
  readonly onSelect: (band: Severity | null, categoryId: string | null, findingId: string | null) => void;
}

export function ScorecardTree({ bands, selection, onSelect }: ScorecardTreeProps): React.JSX.Element {
  if (bands.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-scorecard-empty>
        指摘はありません / No findings — all evaluated checks pass.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-scorecard>
      {bands.map((band) => (
        <BandSection key={band.severity} band={band} selection={selection} onSelect={onSelect} />
      ))}
    </div>
  );
}

function BandSection({
  band,
  selection,
  onSelect,
}: {
  band: SeverityBand;
  selection: FindingSelection;
  onSelect: ScorecardTreeProps["onSelect"];
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={`${band.severity} band`} data-severity-band={band.severity}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <SeverityBadge severity={band.severity as Severity} />
          <span className="tnum truncate text-xs text-muted-foreground" data-band-counts>
            {band.findingCount}件 · {band.objectCount}オブジェクト
          </span>
        </button>
      </div>
      {open && (
        <div className="mt-1.5 space-y-2">
          {band.categories.map((category) => (
            <div key={category.categoryId} className="border-l-2 border-border pl-2">
              <p className="truncate text-xs font-medium" data-category-label={category.categoryId}>
                {category.categoryLabel}{" "}
                <span className="tnum font-normal text-muted-foreground">
                  {category.findingCount}件 · {category.objectCount}オブジェクト
                </span>
              </p>
              <ul className="mt-1 space-y-1">
                {category.findings.map((finding) => (
                  <li key={finding.id}>
                    <button
                      type="button"
                      data-finding-id={finding.id}
                      data-finding-key={finding.findingKey}
                      aria-pressed={selection.findingId === finding.id}
                      onClick={() =>
                        selection.findingId === finding.id
                          ? onSelect(null, null, null)
                          : onSelect(band.severity as Severity, category.categoryId, finding.id)
                      }
                      className="flex w-full items-center gap-2 border border-border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{finding.title}</span>
                        <span className="tnum block text-[11px] text-muted-foreground">
                          {finding.objectCount}オブジェクト
                          {finding.specIdentifier ? ` · ${finding.specIdentifier}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function IncompleteSection({ findings }: { findings: readonly Finding[] }): React.JSX.Element {
  return (
    <section aria-label="Incomplete review / 未判定" data-incomplete-section>
      <h2 className="text-sm font-semibold">未判定のレビュー / Incomplete review</h2>
      {findings.length === 0 ? (
        <p className="tnum mt-1 text-xs text-muted-foreground" data-incomplete-empty>
          未判定はありません / Nothing awaiting review.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {findings.map((finding) => (
            <li
              key={finding.id}
              data-incomplete-finding={finding.id}
              className="border border-dashed border-border px-2 py-1.5 text-xs"
            >
              <p className="truncate font-medium">{finding.title}</p>
              <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                {finding.objectCount}オブジェクト · エンジンが判定できませんでした
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const OUTCOME_ORDER: SpecOutcome[] = ["fail", "review_incomplete", "not_applicable", "pass"];

export function SpecTable({ specs }: { specs: readonly SpecResultRow[] }): React.JSX.Element {
  if (specs.length === 0) return <p className="text-xs text-muted-foreground">仕様結果なし / No spec rows.</p>;
  // Backend order is stable (spec_name); group display by severity of outcome
  // without hiding any row — not_applicable stays visible as its own outcome.
  const ordered = [...specs].sort(
    (a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome),
  );
  return (
    <section aria-label="Spec results / 仕様結果" data-spec-table>
      <h2 className="text-sm font-semibold">仕様結果 / Spec results</h2>
      <div className="mt-1.5 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-2 font-medium">仕様 / Spec</th>
            <th scope="col" className="py-1 pr-2 font-medium">結果 / Outcome</th>
            <th scope="col" className="tnum py-1 text-right font-medium">適用</th>
            <th scope="col" className="tnum py-1 text-right font-medium">合格</th>
            <th scope="col" className="tnum py-1 text-right font-medium">不合格</th>
            <th scope="col" className="tnum py-1 text-right font-medium">未判定</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((spec) => (
            <tr key={spec.id} data-spec-row={spec.id} className="border-t border-border">
              <td className="max-w-44 truncate py-1 pr-2" title={spec.specName}>
                {spec.specIdentifier ? `${spec.specIdentifier} · ` : ""}
                {spec.specName}
              </td>
              <td className="py-1 pr-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: OUTCOME_COLOR[spec.outcome] }}
                  />
                  {OUTCOME_LABEL_JA[spec.outcome]}
                </span>
              </td>
              <td className="tnum py-1 text-right">{spec.applicableCount}</td>
              <td className="tnum py-1 text-right">{spec.passCount}</td>
              <td className="tnum py-1 text-right">{spec.failCount}</td>
              <td className="tnum py-1 text-right">{spec.incompleteCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
