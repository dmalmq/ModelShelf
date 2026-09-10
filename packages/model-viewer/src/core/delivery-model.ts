import { parseRevisionId } from "./object-ref";
import type { DeliveryModel, ViewerModel } from "./viewer-types";

/** Adds the host-resolved resource URL and revision identity to model metadata. */
export function modelForDelivery(model: ViewerModel, fileUrl: string): DeliveryModel {
  const normalizedFileUrl = fileUrl.trim();
  if (normalizedFileUrl.length === 0) {
    throw new Error(`Model ${model.id} must resolve to a non-empty file URL`);
  }
  const revisionId = parseRevisionId(model.id);
  return {
    ...model,
    revisionId,
    fileUrl: normalizedFileUrl,
  };
}