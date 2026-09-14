// ReviewScreenState: the review screen's typed domain model. One useReducer owns
// the run lifecycle, the finding selection, the object filters, and the loaded
// members, so SELECT_FINDING and RUN_LOADING clear their dependents atomically
// instead of scattering resets across effects.
import type { FindingObject, RunDetail, Severity } from "@/lib/types";

/** Idle before any run loads; loading while fetching/creating; ready on data. */
export type RunLifecycle = "idle" | "loading" | "ready" | "failed";

export interface FindingSelection {
  band: Severity | null;
  categoryId: string | null;
  findingId: string | null;
}

export interface ObjectFilterSet {
  source: string;
  discipline: string;
  storey: string;
  ifcType: string;
}

export interface LoadedMembers {
  findingId: string;
  objects: FindingObject[];
  total: number;
}

export interface ReviewScreenState {
  lifecycle: RunLifecycle;
  runId: string | null;
  detail: RunDetail | null;
  error: string | null;
  selection: FindingSelection;
  filters: ObjectFilterSet;
  members: LoadedMembers | null;
  membersLoading: boolean;
  page: number;
}

export const EMPTY_FILTERS: ObjectFilterSet = {
  source: "all",
  discipline: "all",
  storey: "all",
  ifcType: "all",
};

export const EMPTY_SELECTION: FindingSelection = {
  band: null,
  categoryId: null,
  findingId: null,
};

export const initialReviewState: ReviewScreenState = {
  lifecycle: "idle",
  runId: null,
  detail: null,
  error: null,
  selection: EMPTY_SELECTION,
  filters: EMPTY_FILTERS,
  members: null,
  membersLoading: false,
  page: 0,
};

export type ReviewAction =
  | { type: "RUN_LOADING"; runId: string }
  | { type: "RUN_READY"; runId: string; detail: RunDetail }
  | { type: "RUN_FAILED"; error: string }
  | { type: "SELECT_FINDING"; band: Severity | null; categoryId: string | null; findingId: string | null }
  | { type: "SET_FILTERS"; filters: ObjectFilterSet }
  | { type: "MEMBERS_LOADING" }
  | { type: "MEMBERS_READY"; findingId: string; objects: FindingObject[]; total: number }
  | { type: "MEMBERS_FAILED" }
  | { type: "SET_PAGE"; page: number }
  | { type: "RESET_RUN" };

export function reviewReducer(state: ReviewScreenState, action: ReviewAction): ReviewScreenState {
  switch (action.type) {
    case "RUN_LOADING":
      // Atomic clear: a new run invalidates selection, filters, members, page.
      return {
        ...state,
        lifecycle: "loading",
        runId: action.runId,
        detail: null,
        error: null,
        selection: EMPTY_SELECTION,
        filters: EMPTY_FILTERS,
        members: null,
        membersLoading: false,
        page: 0,
      };
    case "RUN_READY":
      return { ...state, lifecycle: "ready", runId: action.runId, detail: action.detail, error: null };
    case "RUN_FAILED":
      return { ...state, lifecycle: "failed", detail: null, error: action.error };
    case "SELECT_FINDING":
      // Atomic clear: a new finding invalidates filters, members, page.
      return {
        ...state,
        selection: { band: action.band, categoryId: action.categoryId, findingId: action.findingId },
        filters: EMPTY_FILTERS,
        members: null,
        membersLoading: action.findingId !== null,
        page: 0,
      };
    case "SET_FILTERS":
      return { ...state, filters: action.filters, page: 0 };
    case "MEMBERS_LOADING":
      return { ...state, members: null, membersLoading: true, page: 0 };
    case "MEMBERS_READY":
      return {
        ...state,
        members: { findingId: action.findingId, objects: action.objects, total: action.total },
        membersLoading: false,
      };
    case "MEMBERS_FAILED":
      return { ...state, members: null, membersLoading: false };
    case "SET_PAGE":
      return { ...state, page: action.page };
    case "RESET_RUN":
      return { ...initialReviewState };
  }
}
