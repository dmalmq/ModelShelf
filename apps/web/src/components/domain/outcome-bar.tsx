import { OUTCOME_COLOR } from "@/lib/palette";
import { DEFAULT_LOCALE, OUTCOME_LABEL, UI, type Locale } from "@/lib/i18n";
import type { RunSummary, SpecOutcome } from "@/lib/types";

export interface OutcomeCounts {
  pass: number;
  fail: number;
  notApplicable: number;
  incomplete: number;
}

/** Adapter so a real `RunSummary` can drive this without the caller reshaping it. */
export function outcomeCountsFromRun(run: RunSummary): OutcomeCounts {
  return {
    pass: run.passCount,
    fail: run.failCount,
    notApplicable: run.notApplicableCount,
    incomplete: run.incompleteCount,
  };
}

/**
 * One stacked bar, four outcomes. not_applicable is a deliberate neutral —
 * an absence, not a result — and review-incomplete is always visible, never
 * folded into pass. Legend labels always accompany the colour.
 *
 * There is deliberately no percentage. `RunSummary.score` exists, but one
 * number cannot separate "nothing failed" from "almost nothing was checked",
 * and on the demo delivery 19 of 36 results did not apply — folding those into
 * pass would roughly double the apparent success rate.
 */
export function OutcomeBar({
  counts,
  locale = DEFAULT_LOCALE,
}: {
  counts: OutcomeCounts;
  locale?: Locale;
}) {
  const t = UI[locale];
  const total = counts.pass + counts.fail + counts.notApplicable + counts.incomplete;

  if (total === 0) {
    return <p className="text-xs text-muted-foreground">{t.nothingEvaluated}</p>;
  }

  const segments: { outcome: SpecOutcome; count: number }[] = [
    { outcome: "pass", count: counts.pass },
    { outcome: "fail", count: counts.fail },
    { outcome: "review_incomplete", count: counts.incomplete },
    { outcome: "not_applicable", count: counts.notApplicable },
  ];
  const shown = segments.filter((s) => s.count > 0);
  const evaluated = counts.pass + counts.fail;

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm"
        role="img"
        aria-label={shown
          .map((s) => `${OUTCOME_LABEL[locale][s.outcome]} ${s.count}`)
          .join(", ")}
      >
        {shown.map((s) => (
          <div
            key={s.outcome}
            style={{
              width: `${(s.count / total) * 100}%`,
              backgroundColor: OUTCOME_COLOR[s.outcome],
            }}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {shown.map((s) => (
          <span key={s.outcome} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: OUTCOME_COLOR[s.outcome] }}
            />
            {OUTCOME_LABEL[locale][s.outcome]} <span className="tnum">{s.count}</span>
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {counts.notApplicable > 0 && `${t.didNotApply(counts.notApplicable)} `}
        {t.evaluated(evaluated)}
      </p>
    </div>
  );
}
