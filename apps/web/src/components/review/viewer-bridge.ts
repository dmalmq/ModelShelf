import { NO_OVERLAY, parseObjectRef, refKey, type ObjectRef, type Overlay } from "model-viewer";
import type { ModelViewer } from "model-viewer";

export interface PlainMemberRef {
  revisionId: string;
  objectId: string;
}

export interface FilterableMember {
  modelId: string;
  discipline: string;
  storey: string | null;
  ifcType: string;
  ref: PlainMemberRef;
}

export const MISSING_STOREY = "—";

export interface PlainFilters {
  source: string;
  discipline: string;
  storey: string;
  ifcType: string;
}

export function toViewerRef(ref: PlainMemberRef): ObjectRef | null {
  try {
    return parseObjectRef(ref);
  } catch {
    return null;
  }
}

export function toViewerRefPlain(ref: PlainMemberRef): ObjectRef | null {
  return toViewerRef(ref);
}

export function filterMembers<T extends FilterableMember>(
  members: readonly T[],
  filters: PlainFilters,
): T[] {
  return members.filter(
    (member) =>
      (filters.source === "all" || member.modelId === filters.source) &&
      (filters.discipline === "all" || member.discipline === filters.discipline) &&
      (filters.storey === "all" || (member.storey ?? MISSING_STOREY) === filters.storey) &&
      (filters.ifcType === "all" || member.ifcType === filters.ifcType),
  );
}

export function overlayForFinding(
  members: readonly { ref: PlainMemberRef }[],
  paint: { color: string; label: string; mode: "isolate" | "colour-only" },
): Overlay {
  const refs = members.flatMap((member) => toViewerRef(member.ref) ?? []);
  return paint.mode === "isolate"
    ? {
        highlights: [{ refs, color: paint.color, label: paint.label }],
        isolate: refs,
        dimOpacity: 0.25,
        frame: refs,
      }
    : {
        highlights: [{ refs, color: paint.color, label: paint.label }],
        isolate: null,
        dimOpacity: 1,
        frame: null,
      };
}

export function clearFindingFromViewer(viewer: ModelViewer): void {
  viewer.applyOverlay(NO_OVERLAY);
}

export { refKey };
