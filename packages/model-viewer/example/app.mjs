import {
  createModelViewer,
  parseViewerScene,
  objectRef,
  NO_OVERLAY,
  createPreparedGeometryDriver,
} from "../dist/model-viewer.mjs";

const canvas = document.getElementById("viewer");
const state = document.getElementById("state");

const WALL = objectRef("east-wing", "wall-01");
const SLAB = objectRef("east-wing", "slab-01");

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
    id: `box-${offset.join("x")}`,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    bounds: {
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    },
  };
}

function prepared(objects, origin) {
  const geometries = objects.map((object, index) => boxGeometry(object.size, object.offset));
  return {
    bounds: unionBounds(geometries.map((geometry) => geometry.bounds)),
    geometries,
    instances: objects.map((object, index) => ({
      objectId: object.id,
      geometryId: geometries[index].id,
      matrix: translate(origin),
      color: object.color,
      name: object.name,
      attributes: { storey: "L01", kind: object.kind },
    })),
  };
}

function translate(origin) {
  const matrix = IDENTITY.slice();
  matrix[12] = origin[0];
  matrix[13] = origin[1];
  matrix[14] = origin[2];
  return matrix;
}

function unionBounds(list) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const bounds of list) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return { min, max };
}

const FIXTURES = {
  "east-wing": prepared(
    [
      { id: "wall-01", name: "Wall", kind: "wall", size: 2, offset: [0, 0, 1], color: [0.39, 0.4, 0.95, 1] },
      { id: "slab-01", name: "Slab", kind: "slab", size: 2.4, offset: [0, 0, 0], color: [0.55, 0.63, 0.75, 1] },
    ],
    [8, 0, 0],
  ),
  "west-wing": prepared(
    [
      { id: "column-01", name: "Column", kind: "column", size: 1.2, offset: [0, 0, 1], color: [0.34, 0.7, 0.45, 1] },
    ],
    [-8, 0, 0],
  ),
};

const scene = parseViewerScene({
  sources: [
    { revisionId: "east-wing", attributes: { storey: "L01" } },
    { revisionId: "west-wing", attributes: { storey: "L01" } },
  ],
});

const geometry = createPreparedGeometryDriver({
  load: (source) => FIXTURES[source.revisionId],
});

let viewer = createModelViewer({
  canvas,
  scene,
  geometry,
  selectionColor: "#334155",
});
viewer.subscribe(paintStatePanel);
viewer.start();

function paintStatePanel() {
  if (!viewer) return;
  const diagnostics = viewer.diagnostics();
  state.textContent = JSON.stringify(
    {
      sources: diagnostics.snapshot.sources.map((source) => ({
        revisionId: source.revisionId,
        status: source.status,
        objects: source.status === "ready" ? source.objectCount : null,
      })),
      selected: diagnostics.snapshot.selected?.ref ?? null,
      highlightGroups: diagnostics.renderer.highlightGroups.map((group) => group.matched),
      isolatedMatched: diagnostics.renderer.isolatedMatched,
      clipping: diagnostics.renderer.clipping,
      resources: {
        workers: diagnostics.resources.workers,
        renderers: diagnostics.resources.renderers,
      },
    },
    null,
    2,
  );
}

function report(stats) {
  state.textContent = JSON.stringify({ unloaded: true, resources: stats }, null, 2);
}

document.getElementById("pick").onclick = () => {
  viewer.select(WALL, { frame: true });
};

document.getElementById("highlight").onclick = () =>
  viewer.applyOverlay({
    highlights: [{ refs: [WALL, SLAB], color: "#7c3aed", label: "Sample" }],
    isolate: null,
    dimOpacity: 0.35,
    frame: null,
  });

document.getElementById("isolate").onclick = () =>
  viewer.applyOverlay({
    highlights: [],
    isolate: [WALL],
    dimOpacity: 1,
    frame: [WALL],
  });

document.getElementById("section").onclick = () => viewer.setSectionZ(1.5);

document.getElementById("unload").onclick = () => {
  viewer.dispose();
  report(viewer.resourceStats());
  viewer = null;
};
