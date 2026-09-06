/* eslint-disable */
/**
 * GENERATED FILE. Do not edit by hand.
 * Source: schemas/model/v1/model-descriptor.schema.json
 * Regenerate: npm run generate --prefix packages/model-contracts-ts
 */

/**
 * Whether a revision's semantic (property/classification) artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch.
 */
export type SemanticCapability =
  | {
      status: "available";
      artifactVersion: string;
      contentHash: string;
      objectCount: number;
    }
  | {
      status: "absent";
    }
  | {
      status: "unsupported";
      reason: string;
    }
  | {
      status: "failed";
      error: string;
    };
/**
 * Whether a revision's render artifact is available, deliberately absent, unsupported by the source format, or failed to produce. These four states are mutually exclusive by construction: a payload can satisfy at most one branch. Geometric emptiness (absent), an unsupported conversion, and a processing failure are distinguishable states, not folded into one.
 */
export type RenderCapability =
  | {
      status: "available";
      artifactVersion: string;
      contentHash: string;
      format: "prepared-scene-v1";
      primitiveCount: number;
    }
  | {
      status: "absent";
    }
  | {
      status: "unsupported";
      reason: string;
    }
  | {
      status: "failed";
      error: string;
    };

/**
 * Identity, units, placement, provenance, and artifact availability for one model revision. Carries no ModelShelf project/delivery/pack concepts.
 */
export interface ModelDescriptor {
  schemaVersion: "model-v1";
  revisionId: string;
  /**
   * Multiply a source-file length unit by this factor to get metres.
   */
  lengthToMetre: number;
  upAxis: "Y_UP" | "Z_UP";
  transform: Transform;
  sourceProvenance: {
    format: string;
    originalFilename: string;
    contentHash: string;
    producedBy?: string;
  };
  artifacts: {
    semantic: SemanticCapability;
    render: RenderCapability;
  };
}
/**
 * A rigid transform plus uniform-per-axis scale, applied in translation * rotation * scale order, placing a revision into the shared delivery origin.
 */
export interface Transform {
  /**
   * [x, y, z] in metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  translation: [number, number, number];
  /**
   * [x, y, z, w], not required to be pre-normalized by producers.
   *
   * @minItems 4
   * @maxItems 4
   */
  rotationQuaternion: [number, number, number, number];
  /**
   * [x, y, z], each strictly positive.
   *
   * @minItems 3
   * @maxItems 3
   */
  scale: [number, number, number];
}
