// Compare fetchers: typed clients for GET /api/diff/models and GET /api/diff/runs.
// Same fetch plus parse shape as the viewer fetchers (delivery-api.ts,
// findings-api.ts): non-empty ids, HTTP status in the error, unknown JSON
// validated at this boundary so the screen never learns the wire shape.
import type {
  ChangeKind,
  Delivery,
  Discipline,
  FindingChange,
  FindingDelta,
  FindingDiffResponse,
  MatchConfidence,
  ModelDiffResponse,
  ModelPairDiff,
  ObjectChange,
  ObjectChangeRef,
  PropertyChange,
  RunSummary,
  Severity,
} from "@/lib/types";

/** First-mismatch dimension codes from GET /api/diff/runs 409s (rule 14). */
export type FindingIncomparableDimension =
  | "provenance_incomplete"
  | "run_not_completed"
  | "run_incomplete"
  | "pack_version_mismatch"
  | "pack_digest_mismatch"
  | "scope_mismatch"
  | "engine_profile_mismatch";

const INCOMPARABLE_DIMENSIONS: readonly string[] = [
  "provenance_incomplete",
  "run_not_completed",
  "run_incomplete",
  "pack_version_mismatch",
  "pack_digest_mismatch",
  "scope_mismatch",
  "engine_profile_mismatch",
];

/**
 * 409 from GET /api/diff/models: the two sides were fingerprinted under
 * different profiles (or one side predates normalized fingerprints). The
 * backend message names both profiles and the recompute-by-re-upload
 * guidance, so it is surfaced verbatim rather than picked apart.
 */
export class ModelDiffProfileMismatchError extends Error {
  readonly code = "fingerprint_profile_mismatch" as const;

  constructor(message: string) {
    super(message);
    this.name = "ModelDiffProfileMismatchError";
  }
}

/**
 * 409 from GET /api/diff/runs: the runs do not share one checking setup.
 * Carries the first-mismatch dimension when the backend names a known one;
 * an unrecognised code stays null and the panel shows the raw code instead of
 * claiming a dimension the backend never reported.
 */
export class FindingIncomparableError extends Error {
  readonly dimension: FindingIncomparableDimension | null;
  readonly rawCode: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FindingIncomparableError";
    this.rawCode = code;
    this.dimension = isIncomparableDimension(code) ? code : null;
  }
}

function isIncomparableDimension(code: string): code is FindingIncomparableDimension {
  return INCOMPARABLE_DIMENSIONS.includes(code);
}

interface ErrorEnvelope {
  code: string;
  message: string;
}

function errorEnvelope(value: unknown): ErrorEnvelope | null {
  if (!isRecord(value)) return null;
  const error = value["error"];
  if (!isRecord(error) || typeof error["code"] !== "string") return null;
  return {
    code: error["code"] as string,
    message: typeof error["message"] === "string" ? (error["message"] as string) : "",
  };
}

export interface ModelDiffQuery {
  baseDeliveryId: string;
  headDeliveryId: string;
  limit?: number;
  offset?: number;
}

export async function fetchModelDiff(query: ModelDiffQuery, signal?: AbortSignal): Promise<ModelDiffResponse> {
  const baseDeliveryId = query.baseDeliveryId.trim();
  const headDeliveryId = query.headDeliveryId.trim();
  if (baseDeliveryId.length === 0 || headDeliveryId.length === 0) {
    throw new Error("baseDeliveryId and headDeliveryId must not be empty");
  }
  const params = new URLSearchParams({
    baseDeliveryId,
    headDeliveryId,
    limit: String(query.limit ?? 500),
    offset: String(query.offset ?? 0),
  });
  const response = await fetch(`/api/diff/models?${params.toString()}`, { signal });
  if (response.status === 409) {
    const envelope = errorEnvelope(await response.json().catch(() => null));
    if (envelope?.code === "fingerprint_profile_mismatch") {
      throw new ModelDiffProfileMismatchError(
        envelope.message || "Fingerprint profile mismatch between the two deliveries",
      );
    }
    throw new Error(`Model diff request failed with HTTP 409${envelope?.message ? `: ${envelope.message}` : ""}`);
  }
  if (!response.ok) throw new Error(`Model diff request failed with HTTP ${response.status}`);
  return parseModelDiffResponse(await response.json());
}

/**
 * Fetch once (limit 500), then page further while any pair reports more.
 * `limit`/`offset` page each pair's changes, so every page carries all pairs
 * and this merges by sourceModelId. Filtering stays client-side.
 */
export async function fetchCompleteModelDiff(
  query: Omit<ModelDiffQuery, "limit" | "offset">,
  signal?: AbortSignal,
): Promise<ModelDiffResponse> {
  const limit = 500;
  const first = await fetchModelDiff({ ...query, limit, offset: 0 }, signal);
  const outstanding = first.pairs.some((pair) => pair.changes.length < pair.total);
  if (!outstanding) return first;
  const merged = new Map(first.pairs.map((pair) => [pair.sourceModelId, { ...pair, changes: [...pair.changes] }]));
  let offset = first.pairs.reduce((max, pair) => Math.max(max, pair.changes.length), 0);
  for (;;) {
    const page = await fetchModelDiff({ ...query, limit, offset }, signal);
    let advanced = false;
    for (const pair of page.pairs) {
      const target = merged.get(pair.sourceModelId);
      if (!target || pair.changes.length === 0) continue;
      target.changes.push(...pair.changes);
      advanced = true;
    }
    const done = [...merged.values()].every((pair) => pair.changes.length >= pair.total);
    if (done || !advanced) break;
    offset += limit;
  }
  return { ...first, pairs: [...merged.values()] };
}

export interface FindingDiffQuery {
  baseRunId: string;
  headRunId: string;
}

export async function fetchFindingDiff(query: FindingDiffQuery, signal?: AbortSignal): Promise<FindingDiffResponse> {
  const baseRunId = query.baseRunId.trim();
  const headRunId = query.headRunId.trim();
  if (baseRunId.length === 0 || headRunId.length === 0) {
    throw new Error("baseRunId and headRunId must not be empty");
  }
  const params = new URLSearchParams({ baseRunId, headRunId });
  const response = await fetch(`/api/diff/runs?${params.toString()}`, { signal });
  if (response.status === 409) {
    const envelope = errorEnvelope(await response.json().catch(() => null));
    throw new FindingIncomparableError(
      envelope?.code ?? "provenance_incomplete",
      envelope?.message || "These runs cannot be compared under one set of checking settings",
    );
  }
  if (!response.ok) throw new Error(`Finding diff request failed with HTTP ${response.status}`);
  return parseFindingDiffResponse(await response.json());
}

// ---------------------------------------------------------------------------
// Parsers: the TS mirrors in lib/types.ts are the contract; anything else is
// a malformed payload, never a silent default.
// ---------------------------------------------------------------------------

export function parseModelDiffResponse(value: unknown): ModelDiffResponse {
  const record = requireRecord(value, "Model diff response");
  return {
    base: parseDeliveryShallow(record["base"], "base"),
    head: parseDeliveryShallow(record["head"], "head"),
    pairs: parsePairs(record["pairs"]),
  };
}

export function parseFindingDiffResponse(value: unknown): FindingDiffResponse {
  const record = requireRecord(value, "Finding diff response");
  const changes = record["changes"];
  if (!Array.isArray(changes)) throw new Error("Finding diff response changes must be an array");
  return {
    baseRun: parseRunShallow(record["baseRun"], "baseRun"),
    headRun: parseRunShallow(record["headRun"], "headRun"),
    resolved: integerValue(record["resolved"], "resolved"),
    introduced: integerValue(record["introduced"], "introduced"),
    persisting: integerValue(record["persisting"], "persisting"),
    changes: changes.map((entry) => parseFindingChange(entry)),
  };
}

function parsePairs(value: unknown): ModelPairDiff[] {
  if (!Array.isArray(value)) throw new Error("Model diff response pairs must be an array");
  return value.map((entry) => {
    const record = requireRecord(entry, "Model pair");
    const changes = record["changes"];
    if (!Array.isArray(changes)) throw new Error("Model pair changes must be an array");
    return {
      discipline: disciplineValue(record["discipline"]),
      sourceModelId: stringValue(record["sourceModelId"], "sourceModelId"),
      sourceModelName: stringValue(record["sourceModelName"], "sourceModelName"),
      reusedRevision: booleanValue(record["reusedRevision"], "reusedRevision"),
      baseModelId: nullableString(record["baseModelId"], "baseModelId"),
      headModelId: nullableString(record["headModelId"], "headModelId"),
      baseFilename: nullableString(record["baseFilename"], "baseFilename"),
      headFilename: nullableString(record["headFilename"], "headFilename"),
      summary: parseSummary(record["summary"]),
      total: integerValue(record["total"], "total"),
      changes: changes.map((change) => parseObjectChange(change)),
    } satisfies ModelPairDiff;
  });
}

function parseSummary(value: unknown): ModelPairDiff["summary"] {
  const record = requireRecord(value, "Diff summary");
  return {
    added: integerValue(record["added"], "added"),
    removed: integerValue(record["removed"], "removed"),
    unchanged: integerValue(record["unchanged"], "unchanged"),
    moved: integerValue(record["moved"], "moved"),
    shapeChanged: integerValue(record["shapeChanged"], "shapeChanged"),
    propertiesChanged: integerValue(record["propertiesChanged"], "propertiesChanged"),
    mixed: integerValue(record["mixed"], "mixed"),
    uncertainMatches: integerValue(record["uncertainMatches"], "uncertainMatches"),
  };
}

function parseObjectChange(value: unknown): ObjectChange {
  const record = requireRecord(value, "Object change");
  const propertyChanges = record["propertyChanges"];
  if (!Array.isArray(propertyChanges)) throw new Error("Object change propertyChanges must be an array");
  const notes = record["notes"];
  if (!Array.isArray(notes) || notes.some((note) => typeof note !== "string")) {
    throw new Error("Object change notes must be an array of strings");
  }
  return {
    kind: changeKindValue(record["kind"]),
    confidence: parseConfidence(record["confidence"]),
    base: parseChangeRef(record["base"], "base"),
    head: parseChangeRef(record["head"], "head"),
    propertyChanges: propertyChanges.map((entry) => parsePropertyChange(entry)),
    movedDistanceM: nullableNumber(record["movedDistanceM"], "movedDistanceM"),
    notes: notes as string[],
  };
}

function parseChangeRef(value: unknown, field: string): ObjectChangeRef | null {
  if (value === null) return null;
  const record = requireRecord(value, `Object change ${field}`);
  return {
    revisionId: stringValue(record["revisionId"], "revisionId"),
    objectId: stringValue(record["objectId"], "objectId"),
    expressId: integerValue(record["expressId"], "expressId"),
    globalId: nullableString(record["globalId"], "globalId"),
    ifcType: stringValue(record["ifcType"], "ifcType"),
    name: nullableString(record["name"], "name"),
    storey: nullableString(record["storey"], "storey"),
  };
}

function parsePropertyChange(value: unknown): PropertyChange {
  const record = requireRecord(value, "Property change");
  return {
    pset: stringValue(record["pset"], "pset"),
    name: stringValue(record["name"], "name"),
    base: nullableString(record["base"], "base"),
    head: nullableString(record["head"], "head"),
  };
}

function parseConfidence(value: unknown): MatchConfidence {
  const record = requireRecord(value, "Match confidence");
  const kind = record["kind"];
  if (kind === "exact") return { kind: "exact" };
  if (kind === "none") return { kind: "none" };
  if (kind === "heuristic") {
    return {
      kind: "heuristic",
      score: numberValue(record["score"], "score"),
      basis: stringValue(record["basis"], "basis"),
    };
  }
  throw new Error(`Match confidence kind must be exact, heuristic, or none (got ${String(kind)})`);
}

function parseFindingChange(value: unknown): FindingChange {
  const record = requireRecord(value, "Finding change");
  return {
    findingKey: stringValue(record["findingKey"], "findingKey"),
    delta: findingDeltaValue(record["delta"]),
    title: stringValue(record["title"], "title"),
    severity: severityValue(record["severity"]),
    categoryId: stringValue(record["categoryId"], "categoryId"),
    categoryLabel: stringValue(record["categoryLabel"], "categoryLabel"),
    baseObjectCount: integerValue(record["baseObjectCount"], "baseObjectCount"),
    headObjectCount: integerValue(record["headObjectCount"], "headObjectCount"),
    introducedObjects: stringArray(record["introducedObjects"], "introducedObjects"),
    resolvedObjects: stringArray(record["resolvedObjects"], "resolvedObjects"),
  };
}

function parseDeliveryShallow(value: unknown, field: string): Delivery {
  const record = requireRecord(value, `Model diff ${field}`);
  return {
    id: stringValue(record["id"], "id"),
    projectId: stringValue(record["projectId"], "projectId"),
    label: stringValue(record["label"], "label"),
    deliveryDate: nullableString(record["deliveryDate"], "deliveryDate"),
    createdAt: stringValue(record["createdAt"], "createdAt"),
    finalizedAt: nullableString(record["finalizedAt"], "finalizedAt"),
    modelCount: integerValue(record["modelCount"], "modelCount"),
    productCount: integerValue(record["productCount"], "productCount"),
  };
}

function parseRunShallow(value: unknown, field: string): RunSummary {
  // RunSummary is wide; the diff endpoints return full rows, so a shallow
  // record check plus the fields the panel reads keeps this honest without
  // re-declaring the whole contract.
  const record = requireRecord(value, `Finding diff ${field}`);
  for (const required of ["id", "deliveryId", "packVersionId", "status"]) {
    if (typeof record[required] !== "string") throw new Error(`Finding diff ${field}.${required} must be a string`);
  }
  return value as unknown as RunSummary;
}

// --- scalar guards (same vocabulary as delivery-api.ts) ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string or null`);
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${field} must be an integer`);
  return value;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number`);
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number or null`);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value as string[];
}

function changeKindValue(value: unknown): ChangeKind {
  if (
    value === "added" ||
    value === "removed" ||
    value === "unchanged" ||
    value === "moved" ||
    value === "shape_changed" ||
    value === "properties_changed" ||
    value === "mixed"
  ) {
    return value;
  }
  throw new Error(`Change kind must be a known kind (got ${String(value)})`);
}

function findingDeltaValue(value: unknown): FindingDelta {
  if (value === "resolved" || value === "introduced" || value === "persisting") return value;
  throw new Error(`Finding delta must be resolved, introduced, or persisting (got ${String(value)})`);
}

function severityValue(value: unknown): Severity {
  if (value === "critical" || value === "high" || value === "medium" || value === "advisory") return value;
  throw new Error(`Severity must be a known band (got ${String(value)})`);
}

function disciplineValue(value: unknown): Discipline {
  if (value === "ARCH" || value === "STRUCT" || value === "MEP" || value === "OTHER") return value;
  throw new Error(`Discipline must be a known discipline (got ${String(value)})`);
}
