import { CircleDashed } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DEFAULT_LOCALE, UI, type Locale } from "@/lib/i18n";
import { PROVENANCE_COLOR } from "@/lib/palette";
import type { RunInputProvenance } from "@/lib/types";

/**
 * Renders only when run input provenance is incomplete. The UI must say the
 * inputs are unproven rather than imply proof (product principle 1).
 *
 * `complete` is the normal case for runs the service creates today: input
 * pinning landed in ticket 06, so a new run snapshots its exact revisions into
 * `run_models` and reports `complete`. `incomplete` now means what it says —
 * a historical run from before pinning, or one whose inputs could not be
 * proven. `complete` is the silent case: you are told when a claim is weaker
 * than it looks, never congratulated when it is fine.
 */
export function ProvenanceNotice({
  provenance,
  status,
  reason,
  locale = DEFAULT_LOCALE,
}: {
  /** Preferred: pass the run's provenance object straight through. */
  provenance?: RunInputProvenance;
  /** Flat form, kept for existing callers. */
  status?: "complete" | "incomplete";
  reason?: string | null;
  locale?: Locale;
} = {}) {
  const effectiveStatus = provenance?.status ?? status;
  const effectiveReason = provenance?.reason ?? reason ?? null;
  if (effectiveStatus !== "incomplete") return null;
  return (
    <Alert>
      <CircleDashed />
      <AlertTitle>{UI[locale].provenanceTitle}</AlertTitle>
      {effectiveReason && <AlertDescription>{effectiveReason}</AlertDescription>}
    </Alert>
  );
}

/**
 * The compact form for a metadata row that already says "Inputs". Amber, not
 * red: this is a limit on how much the result proves, not a failure. The
 * colour comes from `palette.ts` because it encodes an API-provided status —
 * the split that file defines — and because it has to stay distinguishable
 * from `fail` for a deuteranopic reader.
 */
export function ProvenanceValue({
  provenance,
  locale = DEFAULT_LOCALE,
}: {
  provenance: RunInputProvenance;
  locale?: Locale;
}) {
  if (provenance.status === "complete") {
    return <span className="text-ink-secondary">{UI[locale].provenancePinned}</span>;
  }
  return <span style={{ color: PROVENANCE_COLOR }}>{UI[locale].provenanceShort}</span>;
}
