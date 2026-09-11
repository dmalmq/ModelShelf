// Standalone example. Imports ONLY the public core bundle. Geometry is
// self-authored (two detached buildings) and arrives through a fixture
// geometry loader, so no IFC, worker, or backend is involved.
//
// Build the bundle first: npm --prefix packages/model-viewer run build:example
// Then serve this directory; the page has no other dependencies.
import {
  createDeliveryViewer,
  objectIdFrom,
  GeometryLoadError,
} from "../dist/model-viewer.core.mjs";

const canvas = document.getElementById("viewer");
const state = document.getElementById("state");
let viewer = null;

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function boxGeometry(size, offset) {
  const h = size / 2;
  const positions = [];
  const normals = [];
  const indices = [];
  const faces = [
    { n: [0, 0, 1], corners: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], corners: [[-h, -h, -h], [-h, h, -h], [h, h, -h], [h, -h, -h]] },
    { n: [1, 0, 0], corners: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] },
    { n: [-1, 0, 0], corners: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
    { n: [0, 1, 0], corners: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], corners: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
  ];
  for (const face of faces) {
    const base = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(corner[0] + offset[0], corner[1] + offset[1], corner[2] + offset[2]);
      normals.push(...face.n);
    }
    indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
  }
  const xs = positions.filter((_, i) => i % 3 === 0);
  const ys = positions.filter((_, i) => i % 3 === 1);
  const zs = positions.filter((_, i) => i % 3 === 2);
  return {
    positions,
    normals,
    indices,
    bounds: {
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    },
  };
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(16, "0");
}

function objectId(revision, expressId) {
  return objectIdFrom(`occ_${hash(`${revision}:${expressId}`)}`);
}

function modelRecord(id, discipline) {
  return {
    id,
    deliveryId: "fixture-delivery",
    discipline,
    sourceModelId: id,
    sourceModelName: discipline === "ARCH" ? "Detached House A" : "Detached House B",
    filename: `${id}.fixture`,
    contentSha256: hash(id),
    byteSize: 0,
    schemaLabel: "fixture",
    entityCount: 0,
    productCount: 0,
    lengthToMetre: 1,
    parseMs: null,
    uploadedAt: "2026-09-09T00:00:00Z",
    originatingSystem: "standalone example",
  };
}

const delivery = {
  delivery: {
    id: "fixture-delivery",
    projectId: "example-project",
    label: "Fixture delivery",
    deliveryDate: null,
    createdAt: "2026-09-09T00:00:00Z",
    finalizedAt: "2026-09-09T00:00:00Z",
    modelCount: 2,
    productCount: 0,
  },
  models: [modelRecord("rev-a", "ARCH"), modelRecord("rev-b", "STRUCT")],
  runs: [],
  locked: true,
};

const geometries = {
  "rev-a": boxGeometry(2, [0.5, 0, 0.5]),
  "rev-b": boxGeometry(2, [-0.5, 0, -0.5]),
};

function objectsFor(model) {
  const count = model.discipline === "ARCH" ? 3 : 2;
  const names = model.discipline === "ARCH" ? ["Wall A", "Slab A", "Roof A"] : ["Column B", "Beam B"];
  return Array.from({ length: count }, (_, i) => ({
    expressId: i + 1,
    name: names[i],
    color: model.discipline === "ARCH" ? [0.36, 0.57, 0.9, 1] : [0.56, 0.78, 0.42, 1],
  }));
}

async function fixtureLoader(model, sink, signal) {
  if (signal.aborted) throw new GeometryLoadError("worker", "load aborted", false);
  const geometry = geometries[model.revisionId];
  const objects = objectsFor(model);
  const instances = objects.map((object) => ({
    expressId: object.expressId,
    objectId: objectId(model.revisionId, object.expressId),
    globalId: null,
    ifcType: "IfcBuildingElementProxy",
    name: object.name,
    discipline: model.discipline,
    geometryExpressId: 1000,
    matrix: IDENTITY,
    color: object.color,
  }));
  sink.progress("download", 0, 0);
  sink.progress("parse", 100, 100);
  sink.header({
    bounds: geometry.bounds,
    objectCount: instances.length,
    uniqueGeometryCount: 1,
    instanceCount: instances.length,
    vertexCount: geometry.positions.length / 3,
    indexCount: geometry.indices.length,
    batchCount: 1,
  });
  sink.batch(
    [
      {
        geometryExpressId: 1000,
        positions: new Float32Array(geometry.positions),
        normals: new Float32Array(geometry.normals),
        indices: new Uint32Array(geometry.indices),
        bounds: geometry.bounds,
      },
    ],
    instances,
  );
}

function startViewer() {
  viewer = createDeliveryViewer({
    delivery,
    canvas,
    geometryLoader: fixtureLoader,
    modelFileUrl: (model) => `fixture://${model.id}`,
  });
  viewer.start();
  viewer.subscribe(render);
}

function render() {
  const diagnostics = viewer.diagnostics();
  state.textContent = JSON.stringify(
    {
      models: diagnostics.snapshot.models.map((m) => ({
        id: m.model.id,
        status: m.status,
        objects: m.status === "ready" ? m.objectCount : null,
      })),
      selected: diagnostics.snapshot.selected?.ref ?? null,
      highlightGroups: diagnostics.renderer.highlightGroups.map((g) => g.matched),
      isolatedMatched: diagnostics.renderer.isolatedMatched,
      clipping: diagnostics.renderer.clipping,
      resources: { workers: diagnostics.resources.workers, renderers: diagnostics.resources.renderers },
    },
    null,
    2,
  );
}

document.getElementById("pick").addEventListener("click", () => {
  render();
});
document.getElementById("highlight").addEventListener("click", () => {
  const refs = viewer.diagnostics().objects.map((object) => object.ref);
  viewer.setHighlights([{ refs, color: "#e02424", label: "Everything" }]);
});
document.getElementById("isolate").addEventListener("click", () => {
  const arch = viewer.diagnostics().objects
    .filter((object) => object.ref.revisionId === "rev-a")
    .map((object) => object.ref);
  viewer.isolate(arch.length > 0 ? arch : null);
});
document.getElementById("section").addEventListener("click", () => {
  viewer.setSectionZ(viewer.diagnostics().sectionZ === null ? 0.5 : null);
});
document.getElementById("unload").addEventListener("click", () => {
  viewer.dispose();
  viewer = null;
  state.textContent = JSON.stringify({ unloaded: true }, null, 2);
});

startViewer();