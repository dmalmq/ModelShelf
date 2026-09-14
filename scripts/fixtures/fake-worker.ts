#!/usr/bin/env node
// A stand-in for the real `ifc-worker` CLI (docs/contracts/worker-v1.md), used
// only by scripts/verify-api.ts's `worker-failure` scenario to exercise
// validation paths a well-behaved real worker never triggers: malformed NDJSON,
// duplicate/misidentified terminal results, a nonzero exit, tampered artifact
// hashes, a manifest that tries to point outside its own job directory, and a
// future protocol version this build does not understand. `slow-success` and
// `hang` produce a real, protocol-valid (or deliberately never-finishing) run
// for the concurrency and restart-recovery scenarios, which don't need a real
// IFC file — just a real subprocess exercising the real Rust validation code.
//
// Usage: node fake-worker.ts <mode> --request <path-to-request.json>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expressIdToObjectId } from "../../packages/model-contracts-ts/src/express-id-mapping.ts";

const mode = process.argv[2];
const requestIndex = process.argv.indexOf("--request");
const requestPath = requestIndex >= 0 ? process.argv[requestIndex + 1] : undefined;
if (!mode || !requestPath) {
  console.error("usage: fake-worker.ts <mode> --request <path>");
  process.exit(2);
}
const request = JSON.parse(readFileSync(requestPath, "utf8"));
const { jobId, outputDir, model } = request;
const revisionId = model.revisionId;

function sha256Hex(bufferOrString) {
  return createHash("sha256").update(bufferOrString).digest("hex");
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function progressEvent(stage) {
  return { protocolVersion: 2, jobId, event: "progress", stage };
}

function writeArtifact(path, text) {
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(path, bytes);
  return { path, sha256: sha256Hex(bytes), size: bytes.length };
}

const wallObjectId = await expressIdToObjectId(revisionId, 1);

function fakeSemanticJson() {
  const ref = { revisionId, objectId: wallObjectId };
  return `${JSON.stringify({
    schemaVersion: "model-v1",
    revisionId,
    objects: [
      {
        ref,
        nativeIds: { expressId: 1 },
        classification: "IfcWall",
        properties: [],
      },
    ],
  })}\n`;
}

function fakeDescriptorJson(semanticHash) {
  return `${JSON.stringify({
    schemaVersion: "model-v1",
    revisionId,
    lengthToMetre: 1,
    upAxis: "Z_UP",
    transform: {
      translation: [0, 0, 0],
      rotationQuaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    sourceProvenance: {
      format: "IFC4",
      originalFilename: "fake.ifc",
      contentHash: model.sha256,
    },
    artifacts: {
      semantic: {
        status: "available",
        artifactVersion: "1",
        contentHash: semanticHash,
        objectCount: 1,
      },
      render: { status: "unsupported", reason: "fake-worker does not emit geometry" },
    },
  })}\n`;
}

function writeValidManifestAndResult({ tamperObjectsHash = false, escapeArtifactPath = false } = {}) {
  mkdirSync(outputDir, { recursive: true });
  const semanticPath = join(outputDir, "semantic.json");
  const descriptorPath = join(outputDir, "descriptor.json");
  const outcomesPath = join(outputDir, "outcomes.jsonl");
  const semanticInfo = writeArtifact(semanticPath, fakeSemanticJson());
  const descriptorInfo = writeArtifact(descriptorPath, fakeDescriptorJson(semanticInfo.sha256));
  const outcomesInfo = writeArtifact(outcomesPath, "");

  const artifacts = {
    descriptor: { ...descriptorInfo, recordCount: 1 },
    semantic: {
      path: escapeArtifactPath ? "/tmp/fake-worker-escaped-semantic.json" : semanticInfo.path,
      sha256: tamperObjectsHash ? "0".repeat(64) : semanticInfo.sha256,
      size: semanticInfo.size,
      recordCount: 1,
    },
    renderManifest: null,
    geometry: null,
    outcomes: { ...outcomesInfo, recordCount: 0 },
  };
  if (escapeArtifactPath) {
    writeArtifact(artifacts.semantic.path, fakeSemanticJson());
  }

  const manifest = {
    protocolVersion: 2,
    jobId,
    operation: "inspect",
    revisionId,
    modelSha256: model.sha256,
    idsSha256: null,
    versions: {
      worker: "fake", ifcOpenShell: "fake", ifcTester: "fake",
      extraction: "fake", scopeSemantics: "fake",
    },
    artifacts,
    diagnostics: [],
  };
  const manifestPath = join(outputDir, "manifest.json");
  const manifestInfo = writeArtifact(manifestPath, JSON.stringify(manifest));
  return manifestInfo;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const delayMs = Number(process.env.FAKE_WORKER_DELAY_MS ?? "0");

  switch (mode) {
    case "malformed-stdout": {
      emit(progressEvent("loading"));
      process.stdout.write('{"protocolVersion":2,"jobId":"truncated"\n');
      process.exit(0);
      return;
    }
    case "duplicate-result": {
      const manifestInfo = writeValidManifestAndResult();
      const result = { protocolVersion: 2, jobId, event: "result", manifest: manifestInfo };
      emit(result);
      emit(result);
      process.exit(0);
      return;
    }
    case "wrong-job-id": {
      const manifestInfo = writeValidManifestAndResult();
      emit({ protocolVersion: 2, jobId: `not-${jobId}`, event: "result", manifest: manifestInfo });
      process.exit(0);
      return;
    }
    case "nonzero-exit": {
      emit(progressEvent("loading"));
      console.error("simulated engine failure");
      process.exit(1);
      return;
    }
    case "bad-artifact-hash": {
      const manifestInfo = writeValidManifestAndResult({ tamperObjectsHash: true });
      emit({ protocolVersion: 2, jobId, event: "result", manifest: manifestInfo });
      process.exit(0);
      return;
    }
    case "path-escape": {
      const manifestInfo = writeValidManifestAndResult({ escapeArtifactPath: true });
      emit({ protocolVersion: 2, jobId, event: "result", manifest: manifestInfo });
      process.exit(0);
      return;
    }
    case "schema-version-mismatch": {
      emit({ protocolVersion: 3, jobId, event: "progress", stage: "loading" });
      process.exit(0);
      return;
    }
    case "slow-success": {
      emit(progressEvent("loading"));
      if (delayMs > 0) await sleep(delayMs);
      const manifestInfo = writeValidManifestAndResult();
      emit({ protocolVersion: 2, jobId, event: "result", manifest: manifestInfo });
      process.exit(0);
      return;
    }
    case "hang": {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, "worker.pid"), String(process.pid));
      emit(progressEvent("loading"));
      // Bounded, not infinite: if orphaned by a killed parent it still exits on
      // its own rather than lingering forever.
      await sleep(delayMs > 0 ? delayMs : 5000);
      process.exit(1);
      return;
    }
    case "hang-child": {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, "worker.pid"), String(process.pid));
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(join(outputDir, "worker.child.pid"), String(child.pid));
      emit(progressEvent("loading"));
      await sleep(delayMs > 0 ? delayMs : 8000);
      process.exit(1);
      return;
    }
    case "symlink-escape": {
      mkdirSync(outputDir, { recursive: true });
      const outsidePath = join("/tmp", `fake-worker-symlink-${jobId}.json`);
      writeArtifact(outsidePath, fakeSemanticJson());
      const linkPath = join(outputDir, "semantic.json");
      const { symlinkSync } = await import("node:fs");
      try {
        symlinkSync(outsidePath, linkPath);
      } catch {
        process.exit(2);
        return;
      }
      const semanticInfo = { path: linkPath, sha256: sha256Hex(fakeSemanticJson()), size: Buffer.byteLength(fakeSemanticJson()) };
      const descriptorInfo = writeArtifact(join(outputDir, "descriptor.json"), fakeDescriptorJson(semanticInfo.sha256));
      const outcomesInfo = writeArtifact(join(outputDir, "outcomes.jsonl"), "");
      const artifacts = {
        descriptor: { ...descriptorInfo, recordCount: 1 },
        semantic: { ...semanticInfo, recordCount: 1 },
        renderManifest: null,
        geometry: null,
        outcomes: { ...outcomesInfo, recordCount: 0 },
      };
      const manifest = {
        protocolVersion: 2,
        jobId,
        operation: "inspect",
        revisionId,
        modelSha256: model.sha256,
        idsSha256: null,
        versions: {
          worker: "fake", ifcOpenShell: "fake", ifcTester: "fake",
          extraction: "fake", scopeSemantics: "fake",
        },
        artifacts,
        diagnostics: [],
      };
      const manifestInfo = writeArtifact(join(outputDir, "manifest.json"), JSON.stringify(manifest));
      emit({ protocolVersion: 2, jobId, event: "result", manifest: manifestInfo });
      process.exit(0);
      return;
    }
    case "bad-render-schema": {
      mkdirSync(outputDir, { recursive: true });
      const semanticInfo = writeArtifact(join(outputDir, "semantic.json"), fakeSemanticJson());
      const renderInfo = writeArtifact(
        join(outputDir, "render-manifest.json"),
        JSON.stringify({ schemaVersion: "model-v1", revisionId: "not-this-revision", format: "prepared-scene-v1", instances: [] }),
      );
      const geometryInfo = writeArtifact(join(outputDir, "geometry.jsonl"), "");
      const descriptor = JSON.parse(fakeDescriptorJson(semanticInfo.sha256));
      descriptor.artifacts.render = {
        status: "available",
        artifactVersion: "1",
        contentHash: geometryInfo.sha256,
        format: "prepared-scene-v1",
        primitiveCount: 0,
      };
      const descriptorInfo = writeArtifact(join(outputDir, "descriptor.json"), `${JSON.stringify(descriptor)}\n`);
      const outcomesInfo = writeArtifact(join(outputDir, "outcomes.jsonl"), "");
      const artifacts = {
        descriptor: { ...descriptorInfo, recordCount: 1 },
        semantic: { ...semanticInfo, recordCount: 1 },
        renderManifest: { ...renderInfo, recordCount: 0 },
        geometry: { ...geometryInfo, recordCount: 0 },
        outcomes: { ...outcomesInfo, recordCount: 0 },
      };
      const manifest = {
        protocolVersion: 2,
        jobId,
        operation: "inspect",
        revisionId,
        modelSha256: model.sha256,
        idsSha256: null,
        versions: {
          worker: "fake", ifcOpenShell: "fake", ifcTester: "fake",
          extraction: "fake", scopeSemantics: "fake",
        },
        artifacts,
        diagnostics: [],
      };
      const manifestInfo = writeArtifact(join(outputDir, "manifest.json"), JSON.stringify(manifest));
      emit({ protocolVersion: 2, jobId, event: "result", manifest: manifestInfo });
      process.exit(0);
      return;
    }
    default: {
      console.error(`unknown fake-worker mode: ${mode}`);
      process.exit(2);
    }
  }
}

main();
