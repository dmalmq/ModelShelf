import type { Discipline, Finding, FindingObject, ObjectDetail, RunDetail } from "@/lib/types";
import { parseObjectRef } from "./object-ref";
import type { ObjectRef } from "./types";

/**
 * Finding payloads carry plain-string refs; the viewer core brands them.
 * Members without a renderable identity (non-geometric evidence) yield null.
 */
export function toViewerRef(ref: { revisionId: string; objectId: string }): ObjectRef | null {
  try {
    return parseObjectRef(ref);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string") throw new Error(`Run payload field ${field} must be a string`);
  return value[field] as string;
}

function nullableStringField(value: Record<string, unknown>, field: string): string | null {
  const fieldValue = value[field];
  if (fieldValue === null || fieldValue === undefined) return null;
  if (typeof fieldValue !== "string") throw new Error(`Run payload field ${field} must be a string or null`);
  return fieldValue;
}

export function parseFindingObject(value: unknown): FindingObject {
  if (!isRecord(value)) throw new Error("FindingObject must be an object");
  const ref = value["ref"];
  if (!isRecord(ref)) throw new Error("FindingObject.ref must be an object");
  return {
    objectId: nullableStringField(value, "objectId"),
    modelId: stringField(value, "modelId"),
    ref: { revisionId: stringField(ref, "revisionId"), objectId: stringField(ref, "objectId") },
    discipline: value["discipline"] as Discipline,
    expressId: value["expressId"] as number,
    globalId: nullableStringField(value, "globalId"),
    ifcType: stringField(value, "ifcType"),
    name: nullableStringField(value, "name"),
    storey: nullableStringField(value, "storey"),
    actual: nullableStringField(value, "actual"),
    incompleteReason: nullableStringField(value, "incompleteReason"),
  };
}

export function parseFinding(value: unknown): Finding {
  if (!isRecord(value)) throw new Error("Finding must be an object");
  const sample = value["sampleObjects"];
  if (!Array.isArray(sample)) throw new Error("Finding.sampleObjects must be an array");
  if (typeof value["objectCount"] !== "number") throw new Error("Finding.objectCount must be a number");
  return {
    id: stringField(value, "id"),
    findingKey: stringField(value, "findingKey"),
    specIdentifier: nullableStringField(value, "specIdentifier"),
    specName: stringField(value, "specName"),
    title: stringField(value, "title"),
    requirement: stringField(value, "requirement"),
    expected: nullableStringField(value, "expected"),
    instructions: nullableStringField(value, "instructions"),
    facet: value["facet"] as Finding["facet"],
    severity: value["severity"] as Finding["severity"],
    categoryId: stringField(value, "categoryId"),
    categoryLabel: stringField(value, "categoryLabel"),
    objectCount: value["objectCount"] as number,
    incomplete: value["incomplete"] === true,
    sampleObjects: sample.map(parseFindingObject),
  };
}

export async function fetchRunDetail(runId: string, signal?: AbortSignal): Promise<RunDetail> {
  if (runId.trim().length === 0) throw new Error("runId must not be empty");
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { signal });
  if (!response.ok) throw new Error(`Run request failed with HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("Run detail must be an object");
  const scorecard = value["scorecard"];
  const reviewIncomplete = value["reviewIncomplete"];
  if (!Array.isArray(scorecard) || !Array.isArray(reviewIncomplete)) {
    throw new Error("Run detail must contain scorecard and reviewIncomplete arrays");
  }
  return value as unknown as RunDetail;
}

interface FindingObjectsPage {
  total: number;
  objects: FindingObject[];
}

/** Pages through every affected object; the scorecard embeds only the first 25. */
export async function fetchAllFindingObjects(
  findingId: string,
  onProgress?: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<FindingObject[]> {
  const objects: FindingObject[] = [];
  const limit = 100;
  let offset = 0;
  let total: number | null = null;
  for (;;) {
    const response = await fetch(
      `/api/findings/${encodeURIComponent(findingId)}/objects?limit=${limit}&offset=${offset}`,
      { signal },
    );
    if (!response.ok) throw new Error(`Finding objects request failed with HTTP ${response.status}`);
    const page = (await response.json()) as FindingObjectsPage;
    if (typeof page.total !== "number" || !Array.isArray(page.objects)) {
      throw new Error("Finding objects page must contain total and objects");
    }
    total = page.total;
    const parsed = page.objects.map(parseFindingObject);
    objects.push(...parsed);
    onProgress?.(objects.length, total);
    offset += parsed.length;
    if (parsed.length === 0 || objects.length >= total) break;
  }
  return objects;
}

export async function fetchObjectDetail(objectId: string, signal?: AbortSignal): Promise<ObjectDetail> {
  if (objectId.trim().length === 0) throw new Error("objectId must not be empty");
  const response = await fetch(`/api/objects/${encodeURIComponent(objectId)}`, { signal });
  if (!response.ok) throw new Error(`Object request failed with HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("Object detail must be an object");
  return value as unknown as ObjectDetail;
}
