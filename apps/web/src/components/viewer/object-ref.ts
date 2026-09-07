import { objectIdFrom, revisionIdFrom, type ObjectId, type ObjectRef, type RevisionId } from "./types";

const objectIdPattern = /^occ_[0-9a-f]{16}$/;

export function parseObjectRef(value: unknown): ObjectRef {
  if (!isRecord(value) || typeof value.revisionId !== "string" || typeof value.objectId !== "string") {
    throw new Error("ObjectRef must contain revisionId and objectId");
  }
  return { revisionId: revisionIdFrom(value.revisionId), objectId: objectIdFrom(value.objectId) };
}

export function parseRevisionId(value: unknown): RevisionId {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("revisionId must be a non-empty string");
  return revisionIdFrom(value);
}

export function parseObjectId(value: unknown): ObjectId {
  if (typeof value !== "string" || !objectIdPattern.test(value)) throw new Error("objectId has an invalid format");
  return objectIdFrom(value);
}

export async function objectIdForExpressId(revisionId: RevisionId, expressId: number): Promise<ObjectId> {
  if (!Number.isSafeInteger(expressId) || expressId < 0) throw new Error("expressId must be a non-negative integer");
  const bytes = new TextEncoder().encode(`${revisionId}:${expressId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return objectIdFrom(`occ_${hex.slice(0, 16)}`);
}

export async function objectRefForExpressId(revisionId: RevisionId, expressId: number): Promise<ObjectRef> {
  return { revisionId, objectId: await objectIdForExpressId(revisionId, expressId) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
