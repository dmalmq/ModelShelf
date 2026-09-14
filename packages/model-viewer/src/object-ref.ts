import type { ObjectRef as WireObjectRef } from "@modelshelf/model-contracts";

export type RevisionId = string & { readonly [revisionIdBrand]: "RevisionId" };
export type ObjectId = string & { readonly [objectIdBrand]: "ObjectId" };
export type ObjectRefKey = string & { readonly [objectRefKeyBrand]: "ObjectRefKey" };

declare const revisionIdBrand: unique symbol;
declare const objectIdBrand: unique symbol;
declare const objectRefKeyBrand: unique symbol;

export type ObjectRef = WireObjectRef & {
  readonly revisionId: RevisionId;
  readonly objectId: ObjectId;
};

export function revisionIdFrom(value: string): RevisionId {
  if (value.trim().length === 0) throw new Error("revisionId must not be empty");
  if (value.includes("\0")) throw new Error("revisionId must not contain NUL");
  return value as RevisionId;
}

export function objectIdFrom(value: string): ObjectId {
  if (value.length === 0) throw new Error("objectId must not be empty");
  if (value.includes("\0")) throw new Error("objectId must not contain NUL");
  return value as ObjectId;
}

export function objectRef(revisionId: string, objectId: string): ObjectRef {
  return { revisionId: revisionIdFrom(revisionId), objectId: objectIdFrom(objectId) };
}

export function parseObjectRef(value: unknown): ObjectRef {
  if (!isRecord(value) || typeof value.revisionId !== "string" || typeof value.objectId !== "string") {
    throw new Error("ObjectRef must contain revisionId and objectId");
  }
  return objectRef(value.revisionId, value.objectId);
}

export function refKey(ref: ObjectRef): ObjectRefKey {
  return `${ref.revisionId}\0${ref.objectId}` as ObjectRefKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
