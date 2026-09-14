import { expressIdToObjectId } from "@modelshelf/model-contracts";
import { objectIdFrom, revisionIdFrom, type ObjectId, type RevisionId } from "../object-ref";

const ifcObjectIdPattern = /^occ_[0-9a-f]{16}$/;

export async function ifcObjectId(revisionId: RevisionId, expressId: number): Promise<ObjectId> {
  if (!Number.isSafeInteger(expressId) || expressId < 0) throw new Error("expressId must be a non-negative integer");
  return objectIdFrom(await expressIdToObjectId(revisionId, expressId));
}

export function parseIfcObjectId(value: unknown): ObjectId {
  if (typeof value !== "string" || !ifcObjectIdPattern.test(value)) {
    throw new Error("objectId must match occ_ plus 16 lowercase hex characters");
  }
  return objectIdFrom(value);
}

export function parseRevisionId(value: unknown): RevisionId {
  if (typeof value !== "string") throw new Error("revisionId must be a non-empty string");
  return revisionIdFrom(value);
}
