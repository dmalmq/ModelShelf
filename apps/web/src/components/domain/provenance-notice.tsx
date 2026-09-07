import { CircleDashed } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PROVENANCE } from "@/lib/mock";

/**
 * Renders only when run input provenance is incomplete. The UI must say the
 * inputs are unproven rather than imply proof (product principle 1).
 */
export function ProvenanceNotice() {
  if (PROVENANCE.status !== "incomplete") return null;
  return (
    <Alert>
      <CircleDashed />
      <AlertTitle>入力モデルの来歴: 未確定</AlertTitle>
      <AlertDescription>{PROVENANCE.reason}</AlertDescription>
    </Alert>
  );
}
