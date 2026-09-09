// CompareScreenState: the comparison screen's typed domain model. One useReducer
// owns the delivery-pair lifecycle, both diff statuses, the viewing side, the
// revision-qualified selection, the filters, and the loaded diffs, so a
// delivery change clears its dependents atomically instead of scattering
// resets across effects (copied from review-state.ts, not generalized: a
// run-centric and a delivery-pair-centric lifecycle in one reducer would couple).
import type {
  ChangeKind,
  DeliveryDetail,
  Discipline,
  FindingDiffResponse,
  ModelDiffResponse,
  ObjectChange,
  RunDetail,
} from "@/lib/types";
import type { FindingIncomparableDimension } from "./compare-api";

export type CompareSide = "base" | "head";

/** Idle before any pair loads; loading while fetching; ready on data. */
export type CompareLifecycle = "idle" | "loading" | "ready" | "failed";

export type ModelDiffStatus = "idle" | "loading" | "ready" | "failed" | "profile_mismatch_409";

export type FindingStatus = "idle" | "loading" | "ready" | "failed" | "incomparable_409";

/** Selection is a revision-qualified ref key. */
export type CompareSelection = string | null;

export interface CompareFilterSet {
  kind: ChangeKind | "all";
  /** "uncertain" keeps heuristic matches only. */
  confidence: "all" | "uncertain";
  sourceModelId: string;
}

export const ALL_SOURCES = "all";

export const EMPTY_COMPARE_FILTERS: CompareFilterSet = {
  kind: "all",
  confidence: "all",
  sourceModelId: ALL_SOURCES,
};

/** NUL separator shared with the viewer diagnostics read-back. */
const REF_KEY_SEPARATOR = String.fromCharCode(0);

/** Revision-qualified ref key. expressId and globalId are display-only. */
export function compareRefKey(revisionId: string, objectId: string): string {
  return `${revisionId}${REF_KEY_SEPARATOR}${objectId}`;
}

/**
 * One flattened change row with its pair context. The lookup table below is
 * keyed by ref key (never pair/change indices: indices break under kind
 * filtering and pagination), with each change registered under both its base
 * and head keys so selection resolves on either side.
 */
export interface CompareChangeEntry {
  index: number;
  sourceModelId: string;
  sourceModelName: string;
  discipline: Discipline;
  change: ObjectChange;
}

export interface CompareChangeIndex {
  entries: CompareChangeEntry[];
  /** ref key to entry index. Base and head keys of one change share the entry. */
  byKey: Record<string, number>;
}

export function buildChangeIndex(response: ModelDiffResponse): CompareChangeIndex {
  const entries: CompareChangeEntry[] = [];
  const byKey: Record<string, number> = {};
  for (const pair of response.pairs) {
    for (const change of pair.changes) {
      const index = entries.length;
      entries.push({
        index,
        sourceModelId: pair.sourceModelId,
        sourceModelName: pair.sourceModelName,
        discipline: pair.discipline,
        change,
      });
      if (change.base) byKey[compareRefKey(change.base.revisionId, change.base.objectId)] = index;
      if (change.head) byKey[compareRefKey(change.head.revisionId, change.head.objectId)] = index;
    }
  }
  return { entries, byKey };
}

/**
 * An uncertain match is a heuristic one. A one-sided addition or removal has
 * `none` confidence because it has no counterpart at all, which is a different
 * claim, and counting it as uncertain would overstate the backend's
 * `uncertainMatches`.
 */
export function isUncertain(change: ObjectChange): boolean {
  return change.confidence.kind === "heuristic";
}

export function filterCompareEntries(
  entries: readonly CompareChangeEntry[],
  filters: CompareFilterSet,
): CompareChangeEntry[] {
  return entries.filter(
    (entry) =>
      (filters.kind === "all" || entry.change.kind === filters.kind) &&
      (filters.confidence === "all" || isUncertain(entry.change)) &&
      (filters.sourceModelId === ALL_SOURCES || entry.sourceModelId === filters.sourceModelId),
  );
}
export interface CompareScreenState {
  lifecycle: CompareLifecycle;
  baseDeliveryId: string | null;
  headDeliveryId: string | null;
  baseDelivery: DeliveryDetail | null;
  headDelivery: DeliveryDetail | null;
  deliveryError: string | null;
  modelDiffStatus: ModelDiffStatus;
  modelDiff: ModelDiffResponse | null;
  /** Failure or 409 message from the model diff, shown verbatim. */
  modelDiffError: string | null;
  findingStatus: FindingStatus;
  findingDiff: FindingDiffResponse | null;
  findingError: string | null;
  findingDimension: FindingIncomparableDimension | null;
  baseRunId: string | null;
  headRunId: string | null;
  side: CompareSide;
  selection: CompareSelection;
  filters: CompareFilterSet;
  changeIndex: CompareChangeIndex;
}

export const initialCompareState: CompareScreenState = {
  lifecycle: "idle",
  baseDeliveryId: null,
  headDeliveryId: null,
  baseDelivery: null,
  headDelivery: null,
  deliveryError: null,
  modelDiffStatus: "idle",
  modelDiff: null,
  modelDiffError: null,
  findingStatus: "idle",
  findingDiff: null,
  findingError: null,
  findingDimension: null,
  baseRunId: null,
  headRunId: null,
  side: "base",
  selection: null,
  filters: EMPTY_COMPARE_FILTERS,
  changeIndex: { entries: [], byKey: {} },
};

export type CompareAction =
  | { type: "SET_DELIVERIES"; baseDeliveryId: string; headDeliveryId: string }
  | { type: "DELIVERIES_READY"; base: DeliveryDetail; head: DeliveryDetail }
  | { type: "DELIVERIES_FAILED"; error: string }
  | { type: "MODEL_DIFF_LOADING" }
  | { type: "MODEL_DIFF_READY"; response: ModelDiffResponse }
  | { type: "MODEL_DIFF_FAILED"; error: string }
  | { type: "MODEL_DIFF_PROFILE_MISMATCH"; error: string }
  | { type: "SET_RUNS"; baseRunId: string | null; headRunId: string | null }
  | { type: "RUN_CREATED"; detail: RunDetail }
  | { type: "FINDING_LOADING" }
  | { type: "FINDING_READY"; response: FindingDiffResponse }
  | { type: "FINDING_FAILED"; error: string }
  | { type: "FINDING_INCOMPARABLE"; error: string; dimension: FindingIncomparableDimension | null }
  | { type: "SET_SIDE"; side: CompareSide }
  | { type: "SELECT_CHANGE"; key: CompareSelection }
  | { type: "SET_FILTERS"; filters: CompareFilterSet };

export function compareReducer(state: CompareScreenState, action: CompareAction): CompareScreenState {
  switch (action.type) {
    case "SET_DELIVERIES":
      // Atomic clear: a new pair invalidates deliveries, both diffs, runs,
      // selection, and filters. Side resets to base; only the toggle mutates it.
      return {
        ...initialCompareState,
        lifecycle: "loading",
        baseDeliveryId: action.baseDeliveryId,
        headDeliveryId: action.headDeliveryId,
      };
    case "DELIVERIES_READY":
      return {
        ...state,
        lifecycle: "ready",
        baseDelivery: action.base,
        headDelivery: action.head,
        deliveryError: null,
      };
    case "DELIVERIES_FAILED":
      return { ...state, lifecycle: "failed", deliveryError: action.error };
    case "MODEL_DIFF_LOADING":
      return {
        ...state,
        modelDiffStatus: "loading",
        modelDiff: null,
        modelDiffError: null,
        selection: null,
        changeIndex: { entries: [], byKey: {} },
      };
    case "MODEL_DIFF_READY":
      return {
        ...state,
        modelDiffStatus: "ready",
        modelDiff: action.response,
        modelDiffError: null,
        changeIndex: buildChangeIndex(action.response),
      };
    case "MODEL_DIFF_FAILED":
      return {
        ...state,
        modelDiffStatus: "failed",
        modelDiff: null,
        modelDiffError: action.error,
        changeIndex: { entries: [], byKey: {} },
      };
    case "MODEL_DIFF_PROFILE_MISMATCH":
      return {
        ...state,
        modelDiffStatus: "profile_mismatch_409",
        modelDiff: null,
        modelDiffError: action.error,
        changeIndex: { entries: [], byKey: {} },
      };
    case "SET_RUNS":
      return {
        ...state,
        baseRunId: action.baseRunId,
        headRunId: action.headRunId,
        findingStatus: "idle",
        findingDiff: null,
        findingError: null,
        findingDimension: null,
      };
    case "RUN_CREATED": {
      // A new run is immutable history from birth: patch the local delivery
      // copy so the run pickers preserve old and new results without refetch.
      const run = action.detail.run;
      if (run.deliveryId === state.baseDeliveryId && state.baseDelivery) {
        return {
          ...state,
          baseDelivery: { ...state.baseDelivery, runs: [...state.baseDelivery.runs, run] },
          baseRunId: run.id,
          findingStatus: "idle",
          findingDiff: null,
          findingError: null,
          findingDimension: null,
        };
      }
      if (run.deliveryId === state.headDeliveryId && state.headDelivery) {
        return {
          ...state,
          headDelivery: { ...state.headDelivery, runs: [...state.headDelivery.runs, run] },
          headRunId: run.id,
          findingStatus: "idle",
          findingDiff: null,
          findingError: null,
          findingDimension: null,
        };
      }
      return state;
    }
    case "FINDING_LOADING":
      return { ...state, findingStatus: "loading", findingDiff: null, findingError: null, findingDimension: null };
    case "FINDING_READY":
      return { ...state, findingStatus: "ready", findingDiff: action.response, findingError: null };
    case "FINDING_FAILED":
      return { ...state, findingStatus: "failed", findingDiff: null, findingError: action.error };
    case "FINDING_INCOMPARABLE":
      return {
        ...state,
        findingStatus: "incomparable_409",
        findingDiff: null,
        findingError: action.error,
        findingDimension: action.dimension,
      };
    case "SET_SIDE":
      // Only the toggle mutates side: camera, filters, and selection survive.
      return { ...state, side: action.side };
    case "SELECT_CHANGE":
      return { ...state, selection: action.key };
    case "SET_FILTERS":
      return { ...state, filters: action.filters };
  }
}
