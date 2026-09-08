import { Badge } from "@/components/ui/badge";
import { REVIEW_INCOMPLETE_COLOR, SEVERITY_COLOR } from "@/lib/palette";
import { DEFAULT_LOCALE, SEVERITY_LABEL, type FindingLevel, type Locale } from "@/lib/i18n";

const LEVEL_COLOR: Record<FindingLevel, string> = {
  ...SEVERITY_COLOR,
  review_incomplete: REVIEW_INCOMPLETE_COLOR,
};

/**
 * Severity always ships as colour + label, never colour alone (product
 * accessibility commitment). Colour comes from palette.ts as an inline style —
 * never a Tailwind class — per the chrome/data token split.
 *
 * `severity` widens to `FindingLevel` so this can also label review-incomplete.
 * That is NOT a fifth severity: the API models it as a separate outcome and it
 * is never ranked against the four bands. But a reviewer still needs to see the
 * word, and it is the one state the product cannot afford to leave unlabelled.
 */
export function SeverityBadge({
  severity,
  locale = DEFAULT_LOCALE,
}: {
  severity: FindingLevel;
  locale?: Locale;
}) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: LEVEL_COLOR[severity] }}
      />
      {SEVERITY_LABEL[locale][severity]}
    </Badge>
  );
}

export { LEVEL_COLOR };
