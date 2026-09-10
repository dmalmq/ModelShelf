// Run header: rule totals, distinct affected objects, not-applicable and
// incomplete. No overall success percentage is ever rendered.
"use client";

import { OutcomeBar, outcomeCountsFromRun } from "../domain/outcome-bar";
import { UI } from "@/lib/i18n";
import type { RunSummary } from "@/lib/types";
import { useLocale } from "../locale-provider";

export function TotalsHeader({
  run,
  presentation = "desk",
}: {
  readonly run: RunSummary;
  readonly presentation?: "desk" | "meeting";
}): React.JSX.Element {
  const { locale } = useLocale();
  const copy = UI[locale];
  return (
    <section aria-label={copy.totalsHeading} data-totals-header>
      <dl
        className={`grid gap-x-4 gap-y-1.5 text-xs ${
          presentation === "meeting" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"
        }`}
      >
        <div>
          <dt className="text-muted-foreground">{copy.ruleTotals}</dt>
          <dd
            className={`tnum flex flex-wrap gap-x-3 font-semibold ${
              presentation === "meeting" ? "text-xl" : "text-sm"
            }`}
            data-totals-rules
          >
            <span data-totals-pass>{copy.pass} {run.passCount}</span>
            <span data-totals-fail>{copy.fail} {run.failCount}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.distinctObjects}</dt>
          <dd
            className={`tnum font-semibold ${presentation === "meeting" ? "text-2xl" : "text-sm"}`}
            data-totals-distinct-objects
          >
            {run.failingObjectCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.notApplicable}</dt>
          <dd
            className={`tnum font-semibold ${presentation === "meeting" ? "text-2xl" : "text-sm"}`}
            data-totals-not-applicable
          >
            {run.notApplicableCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{copy.incomplete}</dt>
          <dd
            className={`tnum font-semibold ${presentation === "meeting" ? "text-2xl" : "text-sm"}`}
            data-totals-incomplete
          >
            {run.incompleteCount}
          </dd>
        </div>
      </dl>
      <div className="mt-2">
        <OutcomeBar counts={outcomeCountsFromRun(run)} locale={locale} />
      </div>
    </section>
  );
}
