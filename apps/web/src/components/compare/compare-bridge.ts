// One-way bridge from compare data to the generic viewer core. This module never
// imports diff response types beyond plain refs, colors, and labels: it receives
// change entries, paints the active side only, and drives the viewer port.
// Members whose ref cannot be parsed yield null and are counted as undrawable,
// listed in the panel, never highlighted, never crashing the viewer.
// (Copied from review/viewer-bridge.ts applyFindingToViewer, not generalized.)
import { CHANGE_COLOR, VIEWER_MAX_HIGHLIGHT_GROUPS } from "@/lib/palette";
import type { ChangeKind, ObjectChange } from "@/lib/types";
import { parseObjectRef } from "../viewer/object-ref";
import type { DeliveryViewerController, ObjectRef, ViewerHighlight } from "../viewer/types";
import { compareRefKey, type CompareChangeEntry, type CompareSide } from "./compare-state";

export interface PlainChangeRef {
  revisionId: string;
  objectId: string;
}

export function toViewerRefPlain(ref: PlainChangeRef): ObjectRef | null {
  try {
    return parseObjectRef(ref);
  } catch {
    return null;
  }
}

/** The active side's ref for a change, or null when it lives only on the other side. */
export function activeRefOf(change: ObjectChange, side: CompareSide): PlainChangeRef | null {
  const ref = side === "base" ? change.base : change.head;
  if (!ref) return null;
  return { revisionId: ref.revisionId, objectId: ref.objectId };
}

/** Ref key of the active side's ref, or null for a one-sided change seen from the void. */
export function activeKeyOf(change: ObjectChange, side: CompareSide): string | null {
  const ref = activeRefOf(change, side);
  return ref ? compareRefKey(ref.revisionId, ref.objectId) : null;
}

/**
 * Display order for kind groups as data, not branches: additions first,
 * removals second, then geometry edits, then attribute edits, then mixed.
 */
export const KIND_GROUP_ORDER: readonly ChangeKind[] = [
  "added",
  "removed",
  "moved",
  "shape_changed",
  "properties_changed",
  "mixed",
];

export interface CompareHighlightGroups {
  groups: ViewerHighlight[];
  /** Kinds painted, in group order. */
  paintedKinds: ChangeKind[];
  /** Kinds beyond the cap: counted with text labels, never painted. */
  overflow: ReadonlyArray<{ kind: ChangeKind; count: number }>;
  /** Convertible-but-undrawable refs, counted by the caller into text rows. */
  undrawable: number;
}

/**
 * Group active-side refs by change kind. Unchanged is never painted (grey
 * counts only). At most VIEWER_MAX_HIGHLIGHT_GROUPS groups are painted; the
 * rest collapse into the overflow list keeping their text labels.
 */
export function changeToHighlights(
  entries: readonly CompareChangeEntry[],
  side: CompareSide,
): CompareHighlightGroups {
  const byKind = new Map<ChangeKind, ObjectRef[]>();
  let undrawable = 0;
  for (const entry of entries) {
    if (entry.change.kind === "unchanged") continue;
    const ref = activeRefOf(entry.change, side);
    if (!ref) continue;
    const parsed = toViewerRefPlain(ref);
    if (!parsed) {
      undrawable += 1;
      continue;
    }
    const bucket = byKind.get(entry.change.kind);
    if (bucket) bucket.push(parsed);
    else byKind.set(entry.change.kind, [parsed]);
  }
  const ordered = KIND_GROUP_ORDER.filter((kind) => byKind.has(kind));
  const paintedKinds = ordered.slice(0, VIEWER_MAX_HIGHLIGHT_GROUPS);
  const overflow = ordered.slice(VIEWER_MAX_HIGHLIGHT_GROUPS).map((kind) => ({
    kind,
    count: byKind.get(kind)?.length ?? 0,
  }));
  return {
    groups: paintedKinds.map((kind) => ({
      refs: byKind.get(kind) ?? [],
      color: CHANGE_COLOR[kind],
      label: kind,
    })),
    paintedKinds,
    overflow,
    undrawable,
  };
}

export interface CompareOverlayReadback {
  matched: number;
  selectedHidden: boolean;
  drawnKeys: string[];
}

/**
 * One-way push: highlight, isolate, soften the rest, frame. Returns the
 * diagnostics read-back (matched / selectedHidden / drawnKeys) for the panel
 * to display. `drawnKeys` are revision-qualified strings for geometry the
 * viewer actually holds.
 */
export function pushCompareOverlay(
  controller: DeliveryViewerController,
  highlight: CompareHighlightGroups,
  options?: { isolate?: boolean; dimOpacity?: number; frame?: boolean },
): CompareOverlayReadback {
  const { isolate = true, dimOpacity = 0.25, frame = true } = options ?? {};
  controller.setHighlights(highlight.groups);
  const refs = highlight.groups.flatMap((group) => [...group.refs]);
  controller.isolate(isolate ? refs : null);
  controller.setDimOpacity(dimOpacity);
  if (frame) controller.frame(refs);
  const diagnostics = controller.diagnostics();
  return {
    matched: diagnostics.renderer.highlightGroups.reduce((sum, group) => sum + group.matched, 0),
    selectedHidden: diagnostics.selectedHidden,
    drawnKeys: diagnostics.objects.map((entry) => compareRefKey(entry.ref.revisionId, entry.ref.objectId)),
  };
}

export function clearCompareOverlay(controller: DeliveryViewerController): void {
  controller.setHighlights([]);
  controller.isolate(null);
  controller.setDimOpacity(1);
}

export type SideBannerNeed =
  | { missingSide: Extract<CompareSide, "head">; reason: "added" }
  | { missingSide: Extract<CompareSide, "base">; reason: "removed" };

/**
 * Added (head-only) viewed from base, and removed (base-only) viewed from
 * head, have no geometry on the active side: the panel shows a persistent
 * banner with a jump-to-other-side action instead of framing the void.
 */
export function sideBannerFor(change: ObjectChange, side: CompareSide): SideBannerNeed | null {
  if (change.kind === "added" && side === "base" && !change.base && change.head) {
    return { missingSide: "head", reason: "added" };
  }
  if (change.kind === "removed" && side === "head" && !change.head && change.base) {
    return { missingSide: "base", reason: "removed" };
  }
  return null;
}
