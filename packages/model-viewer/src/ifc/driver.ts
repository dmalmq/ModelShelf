import { GEOMETRY_DRIVER, GeometryLoadError, type InternalGeometryDriver } from "../geometry-driver.internal";
import { parseWorkerResponse, type WorkerRequest } from "./protocol";
import type { FailureStage, GeometryDriver, ViewerSource } from "../types";

interface WorkerLike {
  postMessage(message: WorkerRequest, options?: StructuredSerializeOptions): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface IfcGeometryDriverOptions {
  readonly wasmBaseUrl: string;
  readonly workerUrl?: string | URL;
  readonly loadBytes: (
    source: ViewerSource,
    signal: AbortSignal,
    report?: (loaded: number, total: number | null) => void,
  ) => Promise<ArrayBuffer>;
}

let jobCounter = 0;

export function createIfcGeometryDriver(options: IfcGeometryDriverOptions): GeometryDriver {
  const wasmBaseUrl = resolveWasmBaseUrl(options.wasmBaseUrl);
  let worker: WorkerLike | null = null;
  let live = 0;

  const driver: InternalGeometryDriver = {
    [GEOMETRY_DRIVER]: true,
    workerCount: () => live,
    dispose: () => {
      worker?.terminate();
      worker = null;
      live = 0;
    },
    load: (source, sink, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new GeometryLoadError("worker", "load aborted", false));
          return;
        }

        let settled = false;
        const terminateIfActive = () => {
          if (!worker) return;
          worker.terminate();
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

        const startJob = (bytes: ArrayBuffer) => {
          if (!worker) {
            worker = installWorker(options.workerUrl);
            live = 1;
          }
          sink.workerCount(live);

          const active = worker;
          const jobId = `${source.revisionId}\u0000${++jobCounter}`;
          let lastSequence = 0;
          let headerReceived = false;

          signal.addEventListener(
            "abort",
            () => {
              if (settled) return;
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
            if (response.revisionId !== source.revisionId || response.jobId !== jobId || response.sequence <= lastSequence) {
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
                settled = true;
                reject(new GeometryLoadError(response.stage, response.message, response.retryable));
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

          active.postMessage(
            {
              type: "load",
              jobId,
              revisionId: source.revisionId,
              attributes: source.attributes,
              wasmBaseUrl,
              bytes,
            },
            { transfer: [bytes] },
          );
        };

        sink.progress("download", 0, null);
        void options.loadBytes(source, signal, (loaded, total) => {
          if (!settled) sink.progress("download", loaded, total);
        }).then(
          (bytes) => {
            if (settled || signal.aborted) {
              if (signal.aborted && !settled) {
                settled = true;
                reject(new GeometryLoadError("worker", "load aborted", false));
              }
              return;
            }
            sink.progress("download", bytes.byteLength, bytes.byteLength);
            startJob(bytes);
          },
          (error: unknown) => {
            if (settled || signal.aborted) {
              if (signal.aborted && !settled) {
                settled = true;
                reject(new GeometryLoadError("worker", "load aborted", false));
              }
              return;
            }
            if (error instanceof GeometryLoadError) {
              fail(error.stage, error.message, error.retryable);
              return;
            }
            fail("download", errorMessage(error), true);
          },
        );
      }),
  };

  return driver as unknown as GeometryDriver;
}

function installWorker(workerUrl: string | URL | undefined): WorkerLike {
  if (workerUrl !== undefined) {
    return new Worker(workerUrl, { type: "module" });
  }
  // Bundlers only emit the worker file when this constructor is written
  // as `new Worker(new URL(..., import.meta.url))` in one expression.
  return new Worker(new URL("./loader.worker.ts", import.meta.url), { type: "module" });
}

function resolveWasmBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "/wasm/";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown viewer error";
}
