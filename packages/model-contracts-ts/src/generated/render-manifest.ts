/* eslint-disable */
/**
 * GENERATED FILE. Do not edit by hand.
 * Source: schemas/model/v1/render-manifest.schema.json
 * Regenerate: npm run generate --prefix packages/model-contracts-ts
 */

/**
 * Maps rendered instances in one revision's geometry artifact back to ObjectRef. Loadable independently of the revision's semantic model; a render conversion must not invent or rewrite checking evidence.
 */
export interface RenderManifest {
  schemaVersion: "model-v1";
  revisionId: string;
  format: "prepared-scene-v1";
  instances: Instance[];
}
export interface Instance {
  instanceId: string;
  ref: ObjectRef;
  /**
   * Object-to-project 3x4 row-major transform in metres, same layout as SemanticObject.placement. Present when placement was converted so a renderer can position object-local vertices without loading SemanticModel. Omitted when the source placement cannot be interpreted.
   *
   * @minItems 12
   * @maxItems 12
   */
  placement?: [number, number, number, number, number, number, number, number, number, number, number, number];
  boundingBox?: {
    /**
     * @minItems 3
     * @maxItems 3
     */
    min: [number, number, number];
    /**
     * @minItems 3
     * @maxItems 3
     */
    max: [number, number, number];
  };
}
/**
 * An opaque reference to one object occurrence within one model revision. objectId is unique only within its revisionId; consumers must not decode either field.
 */
export interface ObjectRef {
  revisionId: string;
  objectId: string;
}
