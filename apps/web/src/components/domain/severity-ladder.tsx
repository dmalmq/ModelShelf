import { LEVEL_COLOR } from "@/components/domain/severity-badge";
import {
  DEFAULT_LOCALE,
  SEVERITY_LABEL,
  UI,
  joinTerms,
  type FindingLevel,
  type Locale,
} from "@/lib/i18n";
import { SEVERITY_ORDER, type Severity } from "@/lib/types";

export interface LadderBand {
  severity: Severity;
  findingCount: number;
  objectCount: number;
}

interface Rung {
  level: FindingLevel;
  findingCount: number;
  /** Secondary. Shown as text, never encoded in bar length. */
  objectCount: number | null;
}

/**
 * Bar length encodes FINDING count so volume can never outrank severity;
 * object counts stay as text. Zero-count bands collapse into a single line —
 * the longest bar on screen must never mean "none".
 *
 * `incompleteCount` adds an Undecided rung. It is not a severity and is not
 * ranked against the four bands, but it has to stay visible even when every
 * evaluated check passed: a delivery where nothing failed and two regulatory
 * checks could not be evaluated is not a clean delivery, and a ladder that
 * omitted it would report one.
 *
 * The prop is deliberately tri-state, and it does not default to zero.
 * `undefined` means the caller did not measure undecided results, so the rung
 * is omitted entirely; `0` means the caller measured none, so the rung joins
 * the absent line and the ladder states it. Defaulting to zero would make an
 * uninformed caller publish "no undecided findings" — the exact claim this
 * component exists to prevent.
 */
export function SeverityLadder({
  bands,
  incompleteCount,
  locale = DEFAULT_LOCALE,
}: {
  bands: LadderBand[];
  incompleteCount?: number;
  locale?: Locale;
}) {
  const t = UI[locale];

  const rungs: Rung[] = [
    ...SEVERITY_ORDER.map((s) => {
      const band = bands.find((b) => b.severity === s);
      return {
        level: s as FindingLevel,
        findingCount: band?.findingCount ?? 0,
        objectCount: band?.objectCount ?? 0,
      };
    }),
    ...(incompleteCount === undefined
      ? []
      : [{ level: "review_incomplete" as FindingLevel, findingCount: incompleteCount, objectCount: null }]),
  ];

  const present = rungs.filter((r) => r.findingCount > 0);
  const absent = rungs.filter((r) => r.findingCount === 0);
  const max = Math.max(1, ...present.map((r) => r.findingCount));

  if (present.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.noFindingsAtAll}</p>;
  }

  return (
    <div className="space-y-2">
      {absent.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t.noFindingsOfLevel(
            joinTerms(
              absent.map((r) => SEVERITY_LABEL[locale][r.level]),
              locale,
            ),
          )}
        </p>
      )}

      {present.map((r) => (
        <div
          key={r.level}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
        >
          <span className="text-sm font-medium whitespace-nowrap">
            {SEVERITY_LABEL[locale][r.level]}
          </span>
          <div
            className="h-5"
            role="img"
            aria-label={t.findingCount(r.findingCount)}
          >
            <div
              className="h-full rounded-sm"
              style={{
                width: `${(r.findingCount / max) * 100}%`,
                backgroundColor: LEVEL_COLOR[r.level],
              }}
            />
          </div>
          <span className="tnum text-right text-sm whitespace-nowrap text-muted-foreground">
            {r.level === "review_incomplete"
              ? `${t.checkCount(r.findingCount)} · ${t.notAPass}`
              : `${t.findingCount(r.findingCount)} / ${t.objectCount(r.objectCount ?? 0)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
