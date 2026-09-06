/* eslint-disable */
/**
 * GENERATED FILE. Do not edit by hand.
 * Source: schemas/model/v1/semantic-model.schema.json
 * Regenerate: npm run generate --prefix packages/model-contracts-ts
 */

/**
 * Classification, properties, and native-ID metadata for every occurrence in one revision, keyed by ObjectRef. Loadable independently of the revision's render manifest.
 */
export interface SemanticModel {
  schemaVersion: "model-v1";
  revisionId: string;
  objects: SemanticObject[];
}
export interface SemanticObject {
  ref: ObjectRef;
  nativeIds?: {
    expressId?: number;
    globalId?: string;
  };
  classification: string;
  name?: string;
  storey?: string;
  properties?: Property[];
}
/**
 * An opaque reference to one object occurrence within one model revision. objectId is unique only within its revisionId; consumers must not decode either field.
 */
export interface ObjectRef {
  revisionId: string;
  objectId: string;
}
export interface Property {
  pset: string;
  name: string;
  value: string | number | boolean | null;
}
