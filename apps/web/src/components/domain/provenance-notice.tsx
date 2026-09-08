import { CircleDashed } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PROVENANCE } from "@/lib/mock";

/**
 * Renders only when run input provenance is incomplete. The UI must say the
 * inputs are unproven rather than imply proof (product principle 1).
 */
export function ProvenanceNotice({
  status,
  reason,
}: {
  status?: "complete" | "incomplete";
  reason?: string | null;
} = {}) {
  // Design routes render bare `<ProvenanceNotice />` against the shared mock;
  // the review screen passes the live run's provenance instead.
  const effectiveStatus = status ?? PROVENANCE.status;
  const effectiveReason = reason === undefined ? PROVENANCE.reason : reason;
  if (effectiveStatus !== "incomplete") return null;
  return (
    <Alert>
      <CircleDashed />
      <AlertTitle>入力モデルの来歴: 未確定</AlertTitle>
      <AlertDescription>{effectiveReason}</AlertDescription>
    </Alert>
  );
}
