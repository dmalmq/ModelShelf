import { GeometryLoadError, parseViewerScene, type GeometryDriver, type ViewerScene } from "model-viewer";
import { createIfcGeometryDriver } from "model-viewer/ifc";
import type { DeliveryDetail } from "@/lib/types";
import { readResponseBytes } from "./read-response-bytes";

export function viewerSceneFor(delivery: DeliveryDetail): ViewerScene {
  return parseViewerScene({
    sources: delivery.models.map((model) => ({
      revisionId: model.id,
      attributes: { discipline: model.discipline },
    })),
  });
}

export function ifcGeometryFor(_delivery: DeliveryDetail): GeometryDriver {
  return createIfcGeometryDriver({
    wasmBaseUrl: "/wasm/",
    loadBytes: async (source, signal, report) => {
      const response = await fetch(`/api/models/${encodeURIComponent(source.revisionId)}/file`, { signal });
      if (!response.ok) {
        throw new GeometryLoadError("download", `IFC download failed with HTTP ${response.status}`, true);
      }
      return readResponseBytes(response, signal, report);
    },
  });
}
