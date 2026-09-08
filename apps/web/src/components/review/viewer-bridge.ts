// One-way bridge from review data to the generic viewer core. This module never
// imports Finding, Severity, or Pack types: it receives plain refs, colors, and
// filter strings, and drives the viewer port. Members whose ref cannot be
// parsed yield null and are counted as undrawable — listed in the panel, never
// highlighted, never crashing the viewer.
import { parseObjectRef } from "../viewer/object-ref";
import type { DeliveryViewerController, ObjectRef } from "../viewer/types";

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

export interface PlainFilters {
  source: string;
  discipline: string;
  storey: string;
  ifcType: string;
}

export function toViewerRefPlain(ref: PlainMemberRef): ObjectRef | null {
  try {
    return parseObjectRef(ref);
  } catch {
    return null;
  }
}

export interface HighlightSplit {
  refs: ObjectRef[];
  /** Convertible-but-undrawable accounting is done by the caller via diagnostics. */
  undrawable: number;
}

/** Partition members into drawable viewer refs; nulls are counted, not thrown. */
export function findingToHighlights<T extends { ref: PlainMemberRef }>(members: readonly T[]): HighlightSplit {
  const refs: ObjectRef[] = [];
  let undrawable = 0;
  for (const member of members) {
    const ref = toViewerRefPlain(member.ref);
    if (ref) refs.push(ref);
    else undrawable += 1;
  }
  return { refs, undrawable };
}

export function filterMembers<T extends FilterableMember>(
  members: readonly T[],
  filters: PlainFilters,
): T[] {
  return members.filter(
    (member) =>
      (filters.source === "all" || member.modelId === filters.source) &&
      (filters.discipline === "all" || member.discipline === filters.discipline) &&
      (filters.storey === "all" || member.storey === filters.storey) &&
      (filters.ifcType === "all" || member.ifcType === filters.ifcType),
  );
}

export interface FindingHighlight {
  refs: ObjectRef[];
  color: string;
  label: string;
}
/**
 * One-way push: highlight, isolate, soften the rest, frame. Returns the
 * diagnostics read-back (matched / selectedHidden / drawnKeys) for the panel
 * to display. `drawnKeys` are `revisionId\0objectId` strings for geometry the
 * viewer actually holds — members outside that set are listed as without
 * geometry, never highlighted into the void.
 */
export function applyFindingToViewer(
  controller: DeliveryViewerController,
  highlight: FindingHighlight,
  options?: { isolate?: boolean; dimOpacity?: number; frame?: boolean },
): { matched: number; selectedHidden: boolean; drawnKeys: string[] } {
  const { isolate = true, dimOpacity = 0.25, frame = true } = options ?? {};
  controller.setHighlights([{ refs: highlight.refs, color: highlight.color, label: highlight.label }]);
  controller.isolate(isolate ? highlight.refs : null);
  controller.setDimOpacity(dimOpacity);
  if (frame) controller.frame(highlight.refs);
  const diagnostics = controller.diagnostics();
  return {
    matched: diagnostics.renderer.highlightGroups[0]?.matched ?? 0,
    selectedHidden: diagnostics.selectedHidden,
    drawnKeys: diagnostics.objects.map((entry) => `${entry.ref.revisionId}\0${entry.ref.objectId}`),
  };
}

export function clearFindingFromViewer(controller: DeliveryViewerController): void {
  controller.setHighlights([]);
  controller.isolate(null);
  controller.setDimOpacity(1);
}
