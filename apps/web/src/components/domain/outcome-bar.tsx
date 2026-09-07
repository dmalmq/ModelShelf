import { OUTCOME_COLOR } from "@/lib/palette";
import { OUTCOME_LABEL_JA } from "@/lib/mock";
import type { SpecOutcome } from "@/lib/types";

export interface OutcomeCounts {
  pass: number;
  fail: number;
  notApplicable: number;
  incomplete: number;
}

/**
 * One stacked bar, four outcomes. not_applicable is a deliberate neutral —
 * an absence, not a result — and review-incomplete is always visible, never
 * folded into pass. Legend labels always accompany the colour.
 */
export function OutcomeBar({ counts }: { counts: OutcomeCounts }) {
  const total = counts.pass + counts.fail + counts.notApplicable + counts.incomplete;
  if (total === 0) return null;
  const segments: { outcome: SpecOutcome; count: number }[] = [
    { outcome: "pass", count: counts.pass },
    { outcome: "fail", count: counts.fail },
    { outcome: "review_incomplete", count: counts.incomplete },
    { outcome: "not_applicable", count: counts.notApplicable },
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
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
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span key={s.outcome} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: OUTCOME_COLOR[s.outcome] }}
              />
              {OUTCOME_LABEL_JA[s.outcome]} <span className="tnum">{s.count}</span>
            </span>
          ))}
      </div>
    </div>
  );
}
