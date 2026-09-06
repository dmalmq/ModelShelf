// Boundary validators for the shared model contract. Types are generated
// (src/generated/*.ts); validation is compiled at runtime from the same canonical
// schema files via a pinned Ajv version, so there is exactly one source of truth for
// the wire shape and no hand-maintained duplicate of its rules.
import { Ajv2020 } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ObjectRef } from "./generated/object-ref.js";
import type { ModelDescriptor } from "./generated/model-descriptor.js";
import type { SemanticModel } from "./generated/semantic-model.js";
import type { RenderManifest } from "./generated/render-manifest.js";
import type { GeometryChunk } from "./generated/geometry-chunk.js";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schemas", "model", "v1");

const SCHEMA_FILES = [
  "object-ref.schema.json",
  "transform.schema.json",
  "semantic-capability.schema.json",
  "render-capability.schema.json",
  "model-descriptor.schema.json",
  "semantic-model.schema.json",
  "render-manifest.schema.json",
  "geometry-chunk.schema.json",
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const file of SCHEMA_FILES) {
  ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8")));
}

function compiled(id: string) {
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`no schema registered for ${id}`);
  return validate;
}

const validateObjectRef = compiled("object-ref.schema.json");
const validateModelDescriptorSchema = compiled("model-descriptor.schema.json");
const validateSemanticModelSchema = compiled("semantic-model.schema.json");
const validateRenderManifestSchema = compiled("render-manifest.schema.json");
const validateGeometryChunkSchema = compiled("geometry-chunk.schema.json");

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function errorsOf(validate: { errors?: unknown }): string[] {
  const errors = (validate.errors ?? []) as Array<{ instancePath: string; message?: string }>;
  return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

export function parseObjectRef(payload: unknown): ValidationResult<ObjectRef> {
  if (validateObjectRef(payload)) return { ok: true, value: payload as ObjectRef };
  return { ok: false, errors: errorsOf(validateObjectRef) };
}

export function parseModelDescriptor(payload: unknown): ValidationResult<ModelDescriptor> {
  if (validateModelDescriptorSchema(payload)) return { ok: true, value: payload as ModelDescriptor };
  return { ok: false, errors: errorsOf(validateModelDescriptorSchema) };
}

export function parseRenderManifest(payload: unknown): ValidationResult<RenderManifest> {
  if (validateRenderManifestSchema(payload)) return { ok: true, value: payload as RenderManifest };
  return { ok: false, errors: errorsOf(validateRenderManifestSchema) };
}

export function parseGeometryChunk(payload: unknown): ValidationResult<GeometryChunk> {
  if (validateGeometryChunkSchema(payload)) return { ok: true, value: payload as GeometryChunk };
  return { ok: false, errors: errorsOf(validateGeometryChunkSchema) };
}

/**
 * Schema validation alone cannot see that two occurrences share an objectId (JSON
 * Schema has no "unique by sub-key" keyword); a duplicate here means two different
 * source objects were mapped to the same reference, which is an integrity bug a
 * producer must not ship. Duplicate globalIds are unrelated and always allowed.
 */
export function parseSemanticModel(payload: unknown): ValidationResult<SemanticModel> {
  if (!validateSemanticModelSchema(payload)) {
    return { ok: false, errors: errorsOf(validateSemanticModelSchema) };
  }
  const model = payload as SemanticModel;
  const seen = new Map<string, number>();
  for (let index = 0; index < model.objects.length; index += 1) {
    const id = model.objects[index].ref.objectId;
    const firstIndex = seen.get(id);
    if (firstIndex !== undefined) {
      return {
        ok: false,
        errors: [`/objects/${index}/ref/objectId "${id}" duplicates /objects/${firstIndex}/ref/objectId`],
      };
    }
    seen.set(id, index);
  }
  for (let index = 0; index < model.objects.length; index += 1) {
    const revisionId = model.objects[index].ref.revisionId;
    if (revisionId !== model.revisionId) {
      return {
        ok: false,
        errors: [
          `/objects/${index}/ref/revisionId "${revisionId}" does not match /revisionId "${model.revisionId}"`,
        ],
      };
    }
  }
  return { ok: true, value: model };
}
