import { GeometryLoadError, type GeometryLoader, type GeometryLoadSink } from "./geometry-loader";
import { parseWorkerResponse, type WorkerRequest } from "./ifc-worker-protocol";
import type { DeliveryModel, FailureStage } from "./viewer-types";

interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface IfcGeometryLoaderOptions {
  /** Directory that serves `web-ifc.wasm`. Relative values resolve against the worker origin. */
  readonly wasmBaseUrl?: string;
}

/** Authored IFC driver: one dedicated browser Worker per viewer lifetime, fed
 * the same request/response protocol the app used before this package existed.
 * The worker module is only reachable through this entry, so the framework
 * core bundle never contains web-ifc. */
export function createIfcGeometryLoader(options: IfcGeometryLoaderOptions = {}): GeometryLoader {
  const wasmBaseUrl = resolveWasmBaseUrl(options.wasmBaseUrl);
  let worker: WorkerLike | null = null;
  let live = 0;

  return (model, sink, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new GeometryLoadError("worker", "load aborted", false));
        return;
      }

      if (!worker) {
        worker = new Worker(new URL("./ifc-loader.worker.ts", import.meta.url), { type: "module" });
        live = 1;
        sink.workerCount(live);
      }

      const active = worker;
      const jobId = `${model.revisionId}\u0000${++jobCounter}`;
      let lastSequence = 0;
      let headerReceived = false;
      let settled = false;

      const terminateIfActive = () => {
        if (worker !== active) return;
        active.terminate();
        worker = null;
        live = 0;
        sink.workerCount(0);
      };

      const fail = (stage: FailureStage, message: string, retryable: boolean) => {
        if (settled) return;
        settled = true;
        terminateIfActive();
        reject(new GeometryLoadError(stage, message, retryable));
      };

      signal.addEventListener(
        "abort",
        () => {
          if (settled) {
            terminateIfActive();
            return;
          }
          settled = true;
          active.postMessage({ type: "cancel", jobId });
          terminateIfActive();
          reject(new GeometryLoadError("worker", "load aborted", false));
        },
        { once: true },
      );
      active.onmessage = (event) => {
        if (settled) return;
        const response = parseWorkerResponse(event.data);
        if (!response) {
          fail("worker", "IFC worker returned an invalid message", true);
          return;
        }
        if (response.revisionId !== model.revisionId || response.jobId !== jobId || response.sequence <= lastSequence) {
          return;
        }
        lastSequence = response.sequence;
        try {
          if (response.type === "progress") {
            sink.progress(response.phase, response.loaded, response.total);
          } else if (response.type === "header") {
            headerReceived = true;
            sink.header(response.header);
          } else if (response.type === "batch") {
            sink.batch(response.geometries, response.instances);
            worker?.postMessage({ type: "ack", jobId, batchNumber: response.batchNumber });
          } else if (response.type === "failed") {
            fail(response.stage, response.message, response.retryable);
          } else if (response.type === "complete") {
            if (!headerReceived) {
              fail("worker", "IFC worker completed without a geometry header", true);
              return;
            }
            settled = true;
            resolve();
          }
        } catch (error) {
          fail("upload", errorMessage(error), true);
        }
      };

      active.onerror = (event) => {
        event.preventDefault();
        fail("worker", event.message || "IFC worker stopped unexpectedly", true);
      };

      worker?.postMessage({
        type: "load",
        jobId,
        revisionId: model.revisionId,
        discipline: model.discipline,
        fileUrl: model.fileUrl,
        wasmBaseUrl,
      });
    });
}

let jobCounter = 0;

function resolveWasmBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "/wasm/";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown viewer error";
}