// One deterministic, revision-scoped mapping from an IFC express ID to an opaque
// ObjectRef.objectId. See ../../../schemas/model/v1/README.md for the full contract
// this must agree with (the Python worker implements the same function).
import { createHash } from "node:crypto";

export function expressIdToObjectId(revisionId: string, expressId: number): string {
  const digest = createHash("sha256").update(`${revisionId}:${expressId}`).digest("hex");
  return `occ_${digest.slice(0, 16)}`;
}
