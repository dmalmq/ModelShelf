import { GEOMETRY_DRIVER, GeometryLoadError, type InternalGeometryDriver } from "./geometry-driver.internal";
import type {
  GeometryDriver,
  PreparedGeometryDriverOptions,
  PreparedModel,
  ViewerSource,
} from "./types";

export { GeometryLoadError };

export function createPreparedGeometryDriver(
  options: PreparedGeometryDriverOptions,
): GeometryDriver {
  const driver: InternalGeometryDriver = {
    [GEOMETRY_DRIVER]: true,
    workerCount: () => 0,
    dispose: () => {},
    async load(source: ViewerSource, sink, signal) {
      if (signal.aborted) throw new GeometryLoadError("worker", "load aborted", false);
      let model: PreparedModel;
      try {
        model = await options.load(source, signal);
      } catch (error) {
        if (error instanceof GeometryLoadError) throw error;
        throw new GeometryLoadError("geometry", errorMessage(error), false);
      }
      if (signal.aborted) throw new GeometryLoadError("worker", "load aborted", false);

      const objectIds = new Set(model.instances.map((instance) => instance.objectId));
      let vertexCount = 0;
      let indexCount = 0;
      for (const geometry of model.geometries) {
        vertexCount += geometry.positions.length / 3;
        indexCount += geometry.indices.length;
      }
      const hasBatch = model.geometries.length > 0;
      sink.workerCount(0);
      sink.header({
        bounds: model.bounds,
        objectCount: objectIds.size,
        uniqueGeometryCount: model.geometries.length,
        instanceCount: model.instances.length,
        vertexCount,
        indexCount,
        batchCount: hasBatch ? 1 : 0,
      });
      if (!hasBatch) return;
      sink.batch(
        model.geometries.map((geometry) => ({
          geometryId: geometry.id,
          positions: geometry.positions,
          normals: geometry.normals,
          indices: geometry.indices,
          bounds: geometry.bounds,
        })),
        model.instances.map((instance) => ({
          objectId: instance.objectId,
          geometryId: instance.geometryId,
          matrix: instance.matrix,
          color: instance.color,
          name: instance.name ?? null,
          attributes: instance.attributes ?? {},
        })),
      );
    },
  };
  return driver as unknown as GeometryDriver;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown geometry error";
}
