// Run header: rule totals vs distinct affected objects vs not-applicable vs
// incomplete. No overall success percentage is ever rendered — RunSummary.score
// stays wire-compatible but invisible (a single percent would mislead).
"use client";

import { OutcomeBar } from "../domain/outcome-bar";
import type { RunSummary } from "@/lib/types";
import { copy, REVIEW_COPY, type ReviewLang } from "./review-i18n";

export function TotalsHeader({
  run,
  lang = "ja",
}: {
  run: RunSummary;
  lang?: ReviewLang;
}): React.JSX.Element {
  return (
    <section aria-label={copy(REVIEW_COPY.totalsHeading, lang)} data-totals-header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <dt className="text-muted-foreground">
            {copy(REVIEW_COPY.ruleTotals, lang)} · {copy(REVIEW_COPY.pass, lang)}/
          </dt>
          <dd className="tnum text-sm font-semibold" data-totals-rules>
            {run.passCount} / {run.failCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy(REVIEW_COPY.distinctObjects, lang)}</dt>
          <dd className="tnum text-sm font-semibold" data-totals-distinct-objects>
            {run.failingObjectCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy(REVIEW_COPY.notApplicable, lang)}</dt>
          <dd className="tnum text-sm font-semibold" data-totals-not-applicable>
            {run.notApplicableCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy(REVIEW_COPY.incomplete, lang)}</dt>
          <dd className="tnum text-sm font-semibold" data-totals-incomplete>
            {run.incompleteCount}
          </dd>
        </div>
      </dl>
      <div className="mt-2">
        <OutcomeBar
          counts={{
            pass: run.passCount,
            fail: run.failCount,
            notApplicable: run.notApplicableCount,
            incomplete: run.incompleteCount,
          }}
        />
      </div>
    </section>
  );
}
