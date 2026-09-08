import { CircleDashed } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DEFAULT_LOCALE, UI, type Locale } from "@/lib/i18n";
import { PROVENANCE } from "@/lib/mock";
import type { RunInputProvenance } from "@/lib/types";

/**
 * Renders only when run input provenance is incomplete. The UI must say the
 * inputs are unproven rather than imply proof (product principle 1).
 *
 * `incomplete` is the NORMAL case, not an alarm. Every run the service creates
 * today reports it, and `complete` is unreachable until input pinning lands in
 * ticket 06. When pinning arrives, `complete` becomes the silent case — you are
 * told when a claim is weaker than it looks, never congratulated when it is fine.
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
  // Design routes render bare `<ProvenanceNotice />` against the shared mock;
  // the review screen passes the live run's provenance instead.
  const effectiveStatus = provenance?.status ?? status ?? PROVENANCE.status;
  const effectiveReason =
    provenance !== undefined
      ? provenance.reason
      : reason === undefined
        ? PROVENANCE.reason
        : reason;
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
 * red: this is a limit on how much the result proves, not a failure.
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
  return <span style={{ color: "#9a3412" }}>{UI[locale].provenanceShort}</span>;
}
