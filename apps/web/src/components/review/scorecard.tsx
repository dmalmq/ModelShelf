// Scorecard tree: severity bands, then categories, then requirement rows. The
// backend sort is authoritative and preserved — this component never re-sorts,
// so advisory volume cannot displace a critical band. Incomplete-review
// findings render in their own section below, never inside a band. Spec rows
// include not_applicable outcomes explicitly.
"use client";

import { useState } from "react";
import { SeverityBadge } from "../domain/severity-badge";
import { SeverityLadder } from "../domain/severity-ladder";
import { OUTCOME_COLOR } from "@/lib/palette";
import { OUTCOME_LABEL, SEVERITY_LABEL, UI, SPEC_TABLE_COPY } from "@/lib/i18n";
import type { Finding, Severity, SeverityBand, SpecResultRow } from "@/lib/types";
import type { FindingSelection } from "./review-state";
import { useLocale } from "../locale-provider";

interface ScorecardTreeProps {
  readonly bands: readonly SeverityBand[];
  readonly incompleteCount?: number;
  readonly selection: FindingSelection;
  readonly onSelect: (band: Severity | null, categoryId: string | null, findingId: string | null) => void;
}

export function ScorecardTree({ bands, incompleteCount, selection, onSelect }: ScorecardTreeProps): React.JSX.Element {
  const { locale } = useLocale();
  if (bands.length === 0) {
    return (
      <div data-scorecard-empty>
        <SeverityLadder bands={bands} incompleteCount={incompleteCount} locale={locale} />
      </div>
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
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left sm:min-h-8"
        >
          <SeverityBadge severity={band.severity as Severity} />
          <span className="tnum truncate text-xs text-muted-foreground" data-band-counts data-band-object-count={band.objectCount}>
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
                      className="flex min-h-11 w-full items-center gap-2 border border-border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent sm:min-h-8"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{finding.title}</span>
                        <span className="tnum block text-xs text-muted-foreground">
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

export function IncompleteSection({
  findings,
  selection,
  onSelect,
}: {
  readonly findings: readonly Finding[];
  readonly selection?: { findingId: string | null };
  readonly onSelect?: (findingId: string | null) => void;
}): React.JSX.Element | null {
  const { locale } = useLocale();
  if (findings.length === 0) return null;
  return (
    <section aria-label={SEVERITY_LABEL[locale].review_incomplete} data-incomplete-section>
      <h2 className="text-sm font-semibold">{SEVERITY_LABEL[locale].review_incomplete}</h2>
      <ul className="mt-1.5 space-y-1.5">
        {findings.map((finding) => (
          <li key={finding.id} data-incomplete-finding={finding.id}>
            <button
              type="button"
              data-finding-id={finding.id}
              data-finding-key={finding.findingKey}
              aria-pressed={selection?.findingId === finding.id}
              onClick={() =>
                onSelect?.(selection?.findingId === finding.id ? null : finding.id)
              }
              className="flex min-h-11 w-full flex-col items-start border border-dashed border-border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent sm:min-h-8"
            >
              <span className="w-full truncate font-medium">{finding.title}</span>
              <span className="tnum mt-0.5 text-xs text-muted-foreground">
                {finding.objectCount} · {UI[locale].notAPass}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SpecTable({ specs }: { specs: readonly SpecResultRow[] }): React.JSX.Element {
  const { locale } = useLocale();
  const copy = SPEC_TABLE_COPY[locale];
  if (specs.length === 0) return <p className="text-xs text-muted-foreground">{UI[locale].nothingEvaluated}</p>;
  return (
    <section aria-label={copy.heading} data-spec-table>
      <h2 className="text-sm font-semibold">{copy.heading}</h2>
      <div className="mt-1.5 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-2 font-medium">{copy.spec}</th>
            <th scope="col" className="py-1 pr-2 font-medium">{copy.outcome}</th>
            <th scope="col" className="tnum py-1 text-right font-medium">{copy.applicable}</th>
            <th scope="col" className="tnum py-1 text-right font-medium">{copy.pass}</th>
            <th scope="col" className="tnum py-1 text-right font-medium">{copy.fail}</th>
            <th scope="col" className="tnum py-1 text-right font-medium">{copy.incomplete}</th>
          </tr>
        </thead>
        <tbody>
          {specs.map((spec) => (
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
                  {OUTCOME_LABEL[locale][spec.outcome]}
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
