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
  /**
   * Row-major 3x4 project-frame transform. Translations are metres. Omitted when the source placement cannot be interpreted.
   *
   * @minItems 12
   * @maxItems 12
   */
  placement?: [number, number, number, number, number, number, number, number, number, number, number, number];
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
  /**
   * One entry per stored value. List-valued IFC properties keep authoring order; unordered IFC sets set ordered=false.
   */
  values: PropertyValue[];
  ordered: boolean;
  origin: "occurrence" | "type";
}
export interface PropertyValue {
  value: string | number | boolean | null;
  originalUnit?: string;
  siValue?: number | null;
  dimension?: "length" | "area" | "volume";
}
