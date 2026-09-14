import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { expressIdToObjectId } from "../index.js";
import {
  parseGeometryChunk,
  parseModelDescriptor,
  parseObjectRef,
  parseRenderManifest,
  parseSemanticModel,
} from "../validate.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "schemas",
  "model",
  "v1",
  "fixtures",
);

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, ...segments), "utf8"));
}

test("valid object-ref parses", () => {
  const result = parseObjectRef(readJson("valid", "object-ref.json"));
  assert.equal(result.ok, true);
});

test("valid model-descriptor, semantic-model, render-manifest all parse", () => {
  assert.equal(parseModelDescriptor(readJson("valid", "model-descriptor.json")).ok, true);
  assert.equal(parseSemanticModel(readJson("valid", "semantic-model.json")).ok, true);
  assert.equal(parseRenderManifest(readJson("valid", "render-manifest.json")).ok, true);
});

test("format-neutral prepared-scene fixture (no IFC metadata) parses", () => {
  const descriptor = parseModelDescriptor(readJson("valid", "prepared-scene-non-ifc", "model-descriptor.json"));
  assert.equal(descriptor.ok, true);
  if (descriptor.ok) assert.deepEqual(descriptor.value.artifacts.semantic, { status: "absent" });
  assert.equal(parseRenderManifest(readJson("valid", "prepared-scene-non-ifc", "render-manifest.json")).ok, true);
});

test("duplicated GlobalIds remain distinct occurrences (accepted)", () => {
  const result = parseSemanticModel(readJson("valid", "semantic-model.json"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const globalIds = result.value.objects.map((o) => o.nativeIds?.globalId);
  const objectIds = result.value.objects.map((o) => o.ref.objectId);
  assert.equal(new Set(globalIds).size < globalIds.length, true, "fixture should contain a duplicate globalId");
  assert.equal(new Set(objectIds).size, objectIds.length, "objectIds must stay distinct despite the duplicate globalId");
});

test("every fixtures/invalid/schema/*.json is rejected by schema validation", () => {
  const dir = join(FIXTURES_DIR, "invalid", "schema");
  for (const file of readdirSync(dir)) {
    const payload = readJson("invalid", "schema", file);
    const result = file.startsWith("object-ref")
      ? parseObjectRef(payload)
      : file.startsWith("model-descriptor")
        ? parseModelDescriptor(payload)
        : file.startsWith("render-manifest")
          ? parseRenderManifest(payload)
          : file.startsWith("geometry-chunk")
            ? parseGeometryChunk(payload)
            : parseSemanticModel(payload);
    assert.equal(result.ok, false, `expected ${file} to be rejected`);
  }
});

test("fixtures/invalid/boundary/semantic-model-duplicate-objectid.json passes schema but fails the boundary check", () => {
  const result = parseSemanticModel(readJson("invalid", "boundary", "semantic-model-duplicate-objectid.json"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors[0], /duplicates/);
});

test("fixtures/invalid/boundary/semantic-model-mismatched-revision.json passes schema but fails the boundary check", () => {
  const result = parseSemanticModel(readJson("invalid", "boundary", "semantic-model-mismatched-revision.json"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors[0], /does not match/);
});

test("express-id mapping matches the golden fixture shared with the Python worker", async () => {
  const golden = readJson("express-id-mapping.json") as {
    cases: Array<{ revisionId: string; expressId: number; objectId: string }>;
  };
  assert.ok(golden.cases.length > 0);
  for (const { revisionId, expressId, objectId } of golden.cases) {
    assert.equal(await expressIdToObjectId(revisionId, expressId), objectId);
  }
});

test("the same express ID in two different revisions maps to different objectIds", async () => {
  assert.notEqual(await expressIdToObjectId("rev-arch-01", 1), await expressIdToObjectId("rev-struct-07", 1));
});
