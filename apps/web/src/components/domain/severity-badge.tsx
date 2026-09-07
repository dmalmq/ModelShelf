import { Badge } from "@/components/ui/badge";
import { SEVERITY_COLOR } from "@/lib/palette";
import { SEVERITY_LABEL_JA } from "@/lib/mock";
import type { Severity } from "@/lib/types";

/**
 * Severity always ships as colour + label, never colour alone (product
 * accessibility commitment). Colour comes from palette.ts as an inline style —
 * never a Tailwind class — per the chrome/data token split.
 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: SEVERITY_COLOR[severity] }}
      />
      {SEVERITY_LABEL_JA[severity]}
    </Badge>
  );
}
