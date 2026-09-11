import type {
  AddDeliveryMemberBody,
  CreateDecisionBody,
  CreateDeliveryBody,
  CreateSourceModelBody,
  DecisionEvidence,
  DecisionFindingEvidence,
  DecisionHistory,
  DecisionOutcome,
  Delivery,
  DeliveryDetail,
  DeliverySummary,
  Discipline,
  IngestionJob,
  IngestionJobStatus,
  ModelInfo,
  ModelRevisionSummary,
  Pack,
  PackVersion,
  Project,
  ProjectDetail,
  ReviewDecision,
  RunStatus,
  RunDetail,
  RunInputProvenance,
  RunSummary,
  Severity,
  SourceModel,
} from "@/lib/types";
import { fetchDelivery, parseDeliveryDetail } from "@/lib/delivery-api";
import { fetchRunDetail as fetchViewerRunDetail } from "@/lib/findings-api";

export { fetchDelivery };

export const DISCIPLINES: readonly Discipline[] = ["ARCH", "STRUCT", "MEP", "OTHER"];

export type ApiErrorCode =
  | "not_found"
  | "bad_request"
  | "delivery_locked"
  | "decision_conflict"
  | "pack_version_mismatch"
  | "duplicate_discipline"
  | "parse_failed"
  | "internal"
  | "transport"
  | "timeout"
  | "invalid_response";

function apiErrorCode(value: unknown): ApiErrorCode | null {
  switch (value) {
    case "not_found":
    case "bad_request":
    case "delivery_locked":
    case "decision_conflict":
    case "pack_version_mismatch":
    case "duplicate_discipline":
    case "parse_failed":
    case "internal":
      return value;
    default:
      return null;
  }
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message;
  if (reason instanceof Error && reason.message.length > 0) return reason.message;
  return "Request failed";
}

export type Remote<T> =
  | { kind: "loading" }
  | { kind: "ready"; value: T }
  | { kind: "failed"; error: unknown };

async function throwForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  let code: ApiErrorCode = "internal";
  let message = `Request failed with HTTP ${response.status}`;
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && isRecord(value.error)) {
      const rawMessage = value.error.message;
      code = apiErrorCode(value.error.code) ?? "invalid_response";
      if (typeof rawMessage === "string" && rawMessage.length > 0) message = rawMessage;
    }
  } catch {
  }
  throw new ApiError(code, message, response.status);
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError("transport", "The server could not be reached");
  }
  await throwForStatus(response);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError("invalid_response", "The server returned an unreadable response", response.status);
  }
  try {
    return parse(value);
  } catch (error: unknown) {
    throw new ApiError(
      "invalid_response",
      error instanceof Error ? error.message : "The server returned an unexpected shape",
      response.status,
    );
  }
}

function get<T>(path: string, signal: AbortSignal | undefined, parse: (value: unknown) => T): Promise<T> {
  return request<T>(path, { signal }, parse);
}

function postJson<T>(
  path: string,
  body: unknown,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    parse,
  );
}

export async function listProjects(signal?: AbortSignal): Promise<readonly Project[]> {
  return get<readonly Project[]>("/api/projects", signal, (value) => {
    if (!Array.isArray(value)) throw new Error("Projects response must be an array");
    return value.map(parseProject);
  });
}

export async function fetchProject(projectId: string, signal?: AbortSignal): Promise<ProjectDetail> {
  return get(`/api/projects/${encodeURIComponent(nonEmpty(projectId, "projectId"))}`, signal, parseProjectDetail);
}

export async function fetchRunDetail(runId: string, signal?: AbortSignal): Promise<RunDetail> {
  const detail = await fetchViewerRunDetail(nonEmpty(runId, "runId"), signal);
  try {
    if (!Array.isArray(detail.models)) throw new Error("Run response models must be an array");
    return {
      ...detail,
      run: parseRunSummary(detail.run),
      models: detail.models.map(parseModelInfo),
      inputProvenance: parseRunInputProvenance(detail.inputProvenance),
    };
  } catch (error: unknown) {
    throw new ApiError(
      "invalid_response",
      error instanceof Error ? error.message : "The server returned an unexpected run",
    );
  }
}

export function fetchDecisionHistory(runId: string, signal?: AbortSignal): Promise<DecisionHistory> {
  return get(`/api/runs/${encodeURIComponent(nonEmpty(runId, "runId"))}/decisions`, signal, parseDecisionHistory);
}

export function createReviewDecision(
  runId: string,
  body: CreateDecisionBody,
  signal?: AbortSignal,
): Promise<ReviewDecision> {
  return postJson(
    `/api/runs/${encodeURIComponent(nonEmpty(runId, "runId"))}/decisions`,
    body,
    parseReviewDecision,
    signal,
  );
}

export async function listSourceModels(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly SourceModel[]> {
  return get(`/api/projects/${encodeURIComponent(nonEmpty(projectId, "projectId"))}/source-models`, signal, (value) => {
    if (!Array.isArray(value)) throw new Error("Source models response must be an array");
    return value.map(parseSourceModel);
  });
}

export async function createDelivery(
  projectId: string,
  body: CreateDeliveryBody,
  signal?: AbortSignal,
): Promise<Delivery> {
  return postJson(
    `/api/projects/${encodeURIComponent(nonEmpty(projectId, "projectId"))}/deliveries`,
    body,
    parseDelivery,
    signal,
  );
}

export async function createSourceModel(
  projectId: string,
  body: CreateSourceModelBody,
  signal?: AbortSignal,
): Promise<SourceModel> {
  return postJson(
    `/api/projects/${encodeURIComponent(nonEmpty(projectId, "projectId"))}/source-models`,
    body,
    parseSourceModel,
    signal,
  );
}

export async function uploadRevision(
  sourceModelId: string,
  file: File,
  signal?: AbortSignal,
): Promise<IngestionJob> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request<IngestionJob>(
    `/api/source-models/${encodeURIComponent(nonEmpty(sourceModelId, "sourceModelId"))}/revisions`,
    { method: "POST", body: form, signal },
    parseIngestionJob,
  );
}

export async function fetchJob(jobId: string, signal?: AbortSignal): Promise<IngestionJob> {
  return get(`/api/jobs/${encodeURIComponent(nonEmpty(jobId, "jobId"))}`, signal, parseIngestionJob);
}

export async function retryJob(jobId: string, signal?: AbortSignal): Promise<IngestionJob> {
  return postJson(`/api/jobs/${encodeURIComponent(nonEmpty(jobId, "jobId"))}/retry`, {}, parseIngestionJob, signal);
}

export async function addDeliveryMember(
  deliveryId: string,
  body: AddDeliveryMemberBody,
  signal?: AbortSignal,
): Promise<DeliveryDetail> {
  return postJson(
    `/api/deliveries/${encodeURIComponent(nonEmpty(deliveryId, "deliveryId"))}/members`,
    body,
    parseDeliveryDetail,
    signal,
  );
}

export async function finalizeDelivery(
  deliveryId: string,
  signal?: AbortSignal,
): Promise<DeliveryDetail> {
  return postJson(
    `/api/deliveries/${encodeURIComponent(nonEmpty(deliveryId, "deliveryId"))}/finalize`,
    {},
    parseDeliveryDetail,
    signal,
  );
}

export interface PollOptions {
  readonly signal?: AbortSignal;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly onJob?: (job: IngestionJob) => void;
}

function waitForPoll(intervalMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Polling stopped"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Polling stopped"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollJob(jobId: string, options: PollOptions = {}): Promise<IngestionJob> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const startedAt = Date.now();
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Polling stopped");
    const job = await fetchJob(jobId, options.signal);
    options.onJob?.(job);
    if (job.status === "completed" || job.status === "failed") return job;
    if (Date.now() - startedAt > timeoutMs) {
      throw new ApiError("timeout", `Upload ${job.filename} did not finish in time`);
    }
    await waitForPoll(intervalMs, options.signal);
  }
}

export type DeliveryLock =
  | { kind: "draft" }
  | { kind: "finalized"; finalizedAt: string }
  | { kind: "runLocked" };

export function deriveDeliveryLock(detail: DeliveryDetail): DeliveryLock {
  if (detail.delivery.finalizedAt && detail.delivery.finalizedAt.length > 0) {
    return { kind: "finalized", finalizedAt: detail.delivery.finalizedAt };
  }
  if (detail.locked) return { kind: "runLocked" };
  return { kind: "draft" };
}

export function memberRevisionBySource(detail: DeliveryDetail): ReadonlyMap<string, string> {
  const members = new Map<string, string>();
  for (const model of detail.models) members.set(model.sourceModelId, model.id);
  return members;
}

export function parseProject(value: unknown): Project {
  const record = requireRecord(value, "Project payload");
  return {
    id: stringValue(record.id, "project.id"),
    tenantId: stringValue(record.tenantId, "project.tenantId"),
    tenantName: stringValue(record.tenantName, "project.tenantName"),
    name: stringValue(record.name, "project.name"),
    createdAt: stringValue(record.createdAt, "project.createdAt"),
    deliveryCount: integerValue(record.deliveryCount, "project.deliveryCount"),
    runCount: integerValue(record.runCount, "project.runCount"),
  };
}

export function parseProjectDetail(value: unknown): ProjectDetail {
  const record = requireRecord(value, "Project response");
  if (!Array.isArray(record.deliveries)) throw new Error("Project response deliveries must be an array");
  if (!Array.isArray(record.packs)) throw new Error("Project response packs must be an array");
  if (!Array.isArray(record.runs)) throw new Error("Project response runs must be an array");
  return {
    project: parseProject(record.project),
    deliveries: record.deliveries.map(parseDeliverySummary),
    packs: record.packs.map(parsePack),
    runs: record.runs.map(parseRunSummary),
  };
}

export function parseDelivery(value: unknown): Delivery {
  const record = requireRecord(value, "Delivery payload");
  return {
    id: stringValue(record.id, "delivery.id"),
    projectId: stringValue(record.projectId, "delivery.projectId"),
    label: stringValue(record.label, "delivery.label"),
    deliveryDate: nullableString(record.deliveryDate, "delivery.deliveryDate"),
    createdAt: stringValue(record.createdAt, "delivery.createdAt"),
    finalizedAt: nullableString(record.finalizedAt, "delivery.finalizedAt"),
    modelCount: integerValue(record.modelCount, "delivery.modelCount"),
    productCount: integerValue(record.productCount, "delivery.productCount"),
  };
}

export function parseDeliverySummary(value: unknown): DeliverySummary {
  const record = requireRecord(value, "Delivery payload");
  if (!Array.isArray(record.models)) throw new Error("Delivery models must be an array");
  return {
    ...parseDelivery(value),
    models: record.models.map(parseModelInfo),
    latestRun: record.latestRun === null ? null : parseRunSummary(record.latestRun),
  };
}

export function parseModelInfo(value: unknown): ModelInfo {
  const record = requireRecord(value, "Model payload");
  const lengthToMetre = numberValue(record.lengthToMetre, "model.lengthToMetre");
  if (lengthToMetre <= 0) throw new Error("model.lengthToMetre must be positive");
  return {
    id: stringValue(record.id, "model.id"),
    deliveryId: stringValue(record.deliveryId, "model.deliveryId"),
    discipline: disciplineValue(record.discipline, "model.discipline"),
    sourceModelId: stringValue(record.sourceModelId, "model.sourceModelId"),
    sourceModelName: stringValue(record.sourceModelName, "model.sourceModelName"),
    filename: stringValue(record.filename, "model.filename"),
    contentSha256: stringValue(record.contentSha256, "model.contentSha256"),
    byteSize: integerValue(record.byteSize, "model.byteSize"),
    schemaLabel: stringValue(record.schemaLabel, "model.schemaLabel"),
    entityCount: integerValue(record.entityCount, "model.entityCount"),
    productCount: integerValue(record.productCount, "model.productCount"),
    lengthToMetre,
    parseMs: nullableNumber(record.parseMs, "model.parseMs"),
    uploadedAt: stringValue(record.uploadedAt, "model.uploadedAt"),
    originatingSystem: nullableString(record.originatingSystem, "model.originatingSystem"),
  };
}

export function parseSourceModel(value: unknown): SourceModel {
  const record = requireRecord(value, "Source model payload");
  if (!Array.isArray(record.revisions)) throw new Error("Source model revisions must be an array");
  return {
    id: stringValue(record.id, "sourceModel.id"),
    projectId: stringValue(record.projectId, "sourceModel.projectId"),
    name: stringValue(record.name, "sourceModel.name"),
    discipline: disciplineValue(record.discipline, "sourceModel.discipline"),
    createdAt: stringValue(record.createdAt, "sourceModel.createdAt"),
    revisions: record.revisions.map(parseRevisionSummary),
  };
}

export function parseRevisionSummary(value: unknown): ModelRevisionSummary {
  const record = requireRecord(value, "Revision payload");
  return {
    id: stringValue(record.id, "revision.id"),
    sourceModelId: stringValue(record.sourceModelId, "revision.sourceModelId"),
    filename: stringValue(record.filename, "revision.filename"),
    contentSha256: stringValue(record.contentSha256, "revision.contentSha256"),
    byteSize: integerValue(record.byteSize, "revision.byteSize"),
    schemaLabel: stringValue(record.schemaLabel, "revision.schemaLabel"),
    entityCount: integerValue(record.entityCount, "revision.entityCount"),
    productCount: integerValue(record.productCount, "revision.productCount"),
    uploadedAt: stringValue(record.uploadedAt, "revision.uploadedAt"),
    provenance: provenanceValue(record.provenance),
  };
}

export function parseIngestionJob(value: unknown): IngestionJob {
  const record = requireRecord(value, "Job payload");
  return {
    id: stringValue(record.id, "job.id"),
    sourceModelId: stringValue(record.sourceModelId, "job.sourceModelId"),
    filename: stringValue(record.filename, "job.filename"),
    contentSha256: stringValue(record.contentSha256, "job.contentSha256"),
    byteSize: integerValue(record.byteSize, "job.byteSize"),
    status: jobStatusValue(record.status),
    modelRevisionId: nullableString(record.modelRevisionId, "job.modelRevisionId"),
    error: nullableString(record.error, "job.error"),
    attemptCount: integerValue(record.attemptCount, "job.attemptCount"),
    createdAt: stringValue(record.createdAt, "job.createdAt"),
    startedAt: nullableString(record.startedAt, "job.startedAt"),
    finishedAt: nullableString(record.finishedAt, "job.finishedAt"),
  };
}

export function parseRunSummary(value: unknown): RunSummary {
  const record = requireRecord(value, "Run payload");
  return {
    id: stringValue(record.id, "run.id"),
    projectId: stringValue(record.projectId, "run.projectId"),
    deliveryId: stringValue(record.deliveryId, "run.deliveryId"),
    deliveryLabel: stringValue(record.deliveryLabel, "run.deliveryLabel"),
    packVersionId: stringValue(record.packVersionId, "run.packVersionId"),
    packName: stringValue(record.packName, "run.packName"),
    packVersion: integerValue(record.packVersion, "run.packVersion"),
    engineVersion: stringValue(record.engineVersion, "run.engineVersion"),
    parserVersion: stringValue(record.parserVersion, "run.parserVersion"),
    status: runStatusValue(record.status),
    error: nullableString(record.error, "run.error"),
    startedAt: stringValue(record.startedAt, "run.startedAt"),
    finishedAt: nullableString(record.finishedAt, "run.finishedAt"),
    durationMs: nullableNumber(record.durationMs, "run.durationMs"),
    passCount: integerValue(record.passCount, "run.passCount"),
    failCount: integerValue(record.failCount, "run.failCount"),
    notApplicableCount: integerValue(record.notApplicableCount, "run.notApplicableCount"),
    incompleteCount: integerValue(record.incompleteCount, "run.incompleteCount"),
    score: nullableNumber(record.score, "run.score"),
    findingCount: integerValue(record.findingCount, "run.findingCount"),
    failingObjectCount: integerValue(record.failingObjectCount, "run.failingObjectCount"),
  };
}

export function parsePack(value: unknown): Pack {
  const record = requireRecord(value, "Pack payload");
  if (!Array.isArray(record.versions)) throw new Error("Pack versions must be an array");
  return {
    id: stringValue(record.id, "pack.id"),
    tenantId: stringValue(record.tenantId, "pack.tenantId"),
    name: stringValue(record.name, "pack.name"),
    description: nullableString(record.description, "pack.description"),
    createdAt: stringValue(record.createdAt, "pack.createdAt"),
    versions: record.versions.map(parsePackVersion),
  };
}

export function parsePackVersion(value: unknown): PackVersion {
  const record = requireRecord(value, "Pack version payload");
  return {
    id: stringValue(record.id, "packVersion.id"),
    packId: stringValue(record.packId, "packVersion.packId"),
    packName: stringValue(record.packName, "packVersion.packName"),
    version: integerValue(record.version, "packVersion.version"),
    idsSha256: stringValue(record.idsSha256, "packVersion.idsSha256"),
    notes: nullableString(record.notes, "packVersion.notes"),
    specCount: integerValue(record.specCount, "packVersion.specCount"),
    createdAt: stringValue(record.createdAt, "packVersion.createdAt"),
  };
}

export function parseDecisionHistory(value: unknown): DecisionHistory {
  const record = requireRecord(value, "Decision history payload");
  if (record.current !== null && !isRecord(record.current)) {
    throw new Error("decisionHistory.current must be an object or null");
  }
  if (!Array.isArray(record.history)) throw new Error("decisionHistory.history must be an array");
  return {
    current: record.current === null ? null : parseReviewDecision(record.current),
    history: record.history.map(parseReviewDecision),
  };
}

export function parseReviewDecision(value: unknown): ReviewDecision {
  const record = requireRecord(value, "Review decision payload");
  return {
    id: stringValue(record.id, "decision.id"),
    runId: stringValue(record.runId, "decision.runId"),
    outcome: decisionOutcomeValue(record.outcome),
    rationale: stringValue(record.rationale, "decision.rationale"),
    citedFindingIds: stringArrayValue(record.citedFindingIds, "decision.citedFindingIds"),
    createdAt: stringValue(record.createdAt, "decision.createdAt"),
    supersedesDecisionId: nullableString(record.supersedesDecisionId, "decision.supersedesDecisionId"),
    supersededBy: nullableString(record.supersededBy, "decision.supersededBy"),
    evidence: parseDecisionEvidence(record.evidence),
  };
}

function parseDecisionEvidence(value: unknown): DecisionEvidence {
  const record = requireRecord(value, "decision.evidence");
  if (!Array.isArray(record.citedFindings)) throw new Error("decision.evidence.citedFindings must be an array");
  return {
    runId: stringValue(record.runId, "decision.evidence.runId"),
    deliveryLabel: stringValue(record.deliveryLabel, "decision.evidence.deliveryLabel"),
    packVersionId: stringValue(record.packVersionId, "decision.evidence.packVersionId"),
    packName: stringValue(record.packName, "decision.evidence.packName"),
    packVersion: integerValue(record.packVersion, "decision.evidence.packVersion"),
    engineVersion: stringValue(record.engineVersion, "decision.evidence.engineVersion"),
    parserVersion: stringValue(record.parserVersion, "decision.evidence.parserVersion"),
    inputProvenance: parseRunInputProvenance(record.inputProvenance),
    incompleteCount: integerValue(record.incompleteCount, "decision.evidence.incompleteCount"),
    citedFindings: record.citedFindings.map(parseDecisionFindingEvidence),
  };
}

function parseDecisionFindingEvidence(value: unknown): DecisionFindingEvidence {
  const record = requireRecord(value, "decision finding evidence");
  return {
    id: stringValue(record.id, "decision.finding.id"),
    title: stringValue(record.title, "decision.finding.title"),
    severity: severityValue(record.severity),
    categoryLabel: stringValue(record.categoryLabel, "decision.finding.categoryLabel"),
    objectCount: integerValue(record.objectCount, "decision.finding.objectCount"),
  };
}

function decisionOutcomeValue(value: unknown): DecisionOutcome {
  if (value === "accept" || value === "reject" || value === "conditional_accept") return value;
  throw new Error("decision.outcome is invalid");
}

function severityValue(value: unknown): Severity {
  if (value === "critical" || value === "high" || value === "medium" || value === "advisory") return value;
  throw new Error("decision.finding.severity is invalid");
}

function stringArrayValue(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function parseRunInputProvenance(value: unknown): RunInputProvenance {
  const record = requireRecord(value, "Run input provenance");
  if (record.status !== "complete" && record.status !== "incomplete") {
    throw new Error("run.inputProvenance.status is invalid");
  }
  return {
    status: record.status,
    reason: nullableString(record.reason, "run.inputProvenance.reason"),
  };
}

function disciplineValue(value: unknown, field: string): Discipline {
  if (value === "ARCH" || value === "STRUCT" || value === "MEP" || value === "OTHER") return value;
  throw new Error(`${field} is invalid`);
}

function provenanceValue(value: unknown): "complete" | "incomplete" {
  if (value === "complete" || value === "incomplete") return value;
  throw new Error("revision.provenance is invalid");
}

function jobStatusValue(value: unknown): IngestionJobStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed") return value;
  throw new Error("job.status is invalid");
}

function runStatusValue(value: unknown): RunStatus {
  if (value === "running" || value === "completed" || value === "failed") return value;
  throw new Error("run.status is invalid");
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new ApiError("bad_request", `${field} must not be empty`);
  return value;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new Error(`${field} must be a string or null`);
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return numberValue(value, field);
}
