import { revisionIdFrom, type RevisionId } from "./object-ref";
import type { Attributes, ViewerScene, ViewerSource } from "./types";

export function parseViewerScene(value: unknown): ViewerScene {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new Error("ViewerScene must contain a sources array");
  }
  const sources: ViewerSource[] = [];
  const seen = new Set<RevisionId>();
  for (const entry of value.sources) {
    const source = parseSource(entry);
    if (seen.has(source.revisionId)) {
      throw new Error(`ViewerScene contains revision ${source.revisionId} twice`);
    }
    seen.add(source.revisionId);
    sources.push(source);
  }
  return { sources };
}

function parseSource(value: unknown): ViewerSource {
  if (!isRecord(value) || typeof value.revisionId !== "string") {
    throw new Error("ViewerSource must contain revisionId");
  }
  return {
    revisionId: revisionIdFrom(value.revisionId),
    attributes: parseAttributes(value.attributes),
  };
}

function parseAttributes(value: unknown): Attributes {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("ViewerSource attributes must be an object");
  const attributes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new Error(`attributes.${key} must be a string`);
    attributes[key] = entry;
  }
  return attributes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
