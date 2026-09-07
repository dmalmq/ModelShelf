/* eslint-disable */
/**
 * GENERATED FILE. Do not edit by hand.
 * Source: schemas/model/v1/geometry-chunk.schema.json
 * Regenerate: npm run generate --prefix packages/model-contracts-ts
 */

/**
 * Object-local triangulated geometry for one rendered instance, joined to a SemanticModel object by ObjectRef. Loadable independently of semantic records.
 */
export interface GeometryChunk {
  ref: ObjectRef;
  instanceId: string;
  status: "available" | "absent" | "unsupported";
  reason?: string;
  /**
   * Flat xyz SI object-local coordinates.
   */
  vertices?: number[];
  /**
   * Flat zero-based vertex indices.
   */
  triangles?: number[];
}
/**
 * An opaque reference to one object occurrence within one model revision. objectId is unique only within its revisionId; consumers must not decode either field.
 */
export interface ObjectRef {
  revisionId: string;
  objectId: string;
}
