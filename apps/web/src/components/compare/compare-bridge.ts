import { CHANGE_COLOR, VIEWER_MAX_HIGHLIGHT_GROUPS } from "@/lib/palette";
import type { ChangeKind, ObjectChange } from "@/lib/types";
import { NO_OVERLAY, parseObjectRef, type ObjectRef, type Overlay } from "model-viewer";
import type { ModelViewer } from "model-viewer";
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

export function activeRefOf(change: ObjectChange, side: CompareSide): PlainChangeRef | null {
  const ref = side === "base" ? change.base : change.head;
  if (!ref) return null;
  return { revisionId: ref.revisionId, objectId: ref.objectId };
}

export function activeKeyOf(change: ObjectChange, side: CompareSide): string | null {
  const ref = activeRefOf(change, side);
  return ref ? compareRefKey(ref.revisionId, ref.objectId) : null;
}

export const KIND_GROUP_ORDER: readonly ChangeKind[] = [
  "added",
  "removed",
  "moved",
  "shape_changed",
  "properties_changed",
  "mixed",
];

export interface OverlayForChanges {
  overlay: Overlay;
  overflow: ReadonlyArray<{ kind: ChangeKind; count: number }>;
  unparseable: number;
}

export function overlayForChanges(
  entries: readonly CompareChangeEntry[],
  side: CompareSide,
): OverlayForChanges {
  const byKind = new Map<ChangeKind, ObjectRef[]>();
  let unparseable = 0;
  for (const entry of entries) {
    if (entry.change.kind === "unchanged") continue;
    const ref = activeRefOf(entry.change, side);
    if (!ref) continue;
    const parsed = toViewerRefPlain(ref);
    if (!parsed) {
      unparseable += 1;
      continue;
    }
    const bucket = byKind.get(entry.change.kind);
    if (bucket) bucket.push(parsed);
    else byKind.set(entry.change.kind, [parsed]);
  }
  const ordered = KIND_GROUP_ORDER.flatMap((kind) => {
    const refs = byKind.get(kind);
    return refs ? [{ kind, refs }] : [];
  });
  const painted = ordered.slice(0, VIEWER_MAX_HIGHLIGHT_GROUPS);
  return {
    overlay: {
      highlights: painted.map(({ kind, refs }) => ({ refs, color: CHANGE_COLOR[kind], label: kind })),
      isolate: null,
      dimOpacity: painted.length > 0 ? 0.25 : 1,
      frame: null,
    },
    overflow: ordered
      .slice(VIEWER_MAX_HIGHLIGHT_GROUPS)
      .map(({ kind, refs }) => ({ kind, count: refs.length })),
    unparseable,
  };
}

export function clearCompareOverlay(viewer: ModelViewer): void {
  viewer.applyOverlay(NO_OVERLAY);
}

export type SideBannerNeed =
  | { missingSide: "head"; reason: "added" }
  | { missingSide: "base"; reason: "removed" };

export function sideBannerFor(change: ObjectChange, side: CompareSide): SideBannerNeed | null {
  if (change.kind === "added" && side === "base" && !change.base && change.head) {
    return { missingSide: "head", reason: "added" };
  }
  if (change.kind === "removed" && side === "head" && !change.head && change.base) {
    return { missingSide: "base", reason: "removed" };
  }
  return null;
}
