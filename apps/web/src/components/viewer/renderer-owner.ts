import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Discipline } from "@/lib/types";
import {
  objectRefKey,
  type DeliveryModel,
  type DrawTarget,
  type ObjectRef,
  type ObjectRefKey,
  type RendererDiagnostics,
  type RevisionId,
  type SelectionRecord,
  type TransferGeometry,
  type TransferInstance,
  type ViewerRenderer,
  type ViewerResourceStats,
  type WorkerHeader,
} from "./types";

interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly onPick: (ref: ObjectRef) => void;
}

interface RevisionResource {
  readonly root: THREE.Group;
  readonly mesh: THREE.BatchedMesh;
  readonly model: DeliveryModel;
  readonly geometryIds: Map<number, number>;
}

const SELECTED_COLOR = new THREE.Color(0x1d4ed8);

export class RendererOwner implements ViewerRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100_000);
  private readonly controls: OrbitControls;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resources = new Map<RevisionId, RevisionResource>();
  private readonly revisionByMesh = new Map<THREE.BatchedMesh, RevisionId>();
  private readonly records = new Map<ObjectRefKey, SelectionRecord>();
  private readonly targetRecords = new Map<string, SelectionRecord>();
  private readonly visibleByDiscipline: Record<Discipline, boolean> = {
    ARCH: true,
    STRUCT: true,
    MEP: true,
    OTHER: true,
  };
  private readonly canvas: HTMLCanvasElement;
  private readonly onPick: (ref: ObjectRef) => void;
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private pointerStart: readonly [number, number] | null = null;
  private selected: SelectionRecord | null = null;
  private disposed = false;

  constructor(options: RendererOptions) {
    this.canvas = options.canvas;
    this.onPick = options.onPick;
    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0xffffff);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(20, 30, 15);
    this.scene.add(light);

    this.camera.position.set(8, 6, 10);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.canvas);
    this.resize();
    this.animationFrame = requestAnimationFrame(this.render);
  }

  uploadHeader(revisionId: RevisionId, header: WorkerHeader, model: DeliveryModel): void {
    if (this.disposed) return;
    this.removeRevision(revisionId);

    const maxItems = Math.max(1, header.instanceCount, header.uniqueGeometryCount);
    const mesh = new THREE.BatchedMesh(
      maxItems,
      Math.max(3, header.vertexCount),
      Math.max(3, header.indexCount),
      this.material,
    );
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;

    const root = new THREE.Group();
    root.name = `revision:${revisionId}`;
    root.visible = false;
    root.add(mesh);
    this.scene.add(root);

    this.resources.set(revisionId, {
      root,
      mesh,
      model,
      geometryIds: new Map(),
    });
    this.revisionByMesh.set(mesh, revisionId);
  }

  uploadBatch(
    revisionId: RevisionId,
    geometries: readonly TransferGeometry[],
    instances: readonly TransferInstance[],
  ): void {
    const resource = this.resources.get(revisionId);
    if (!resource || this.disposed) return;

    for (const transfer of geometries) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(transfer.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(transfer.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(transfer.indices, 1));
      const geometryId = resource.mesh.addGeometry(geometry);
      resource.geometryIds.set(transfer.geometryExpressId, geometryId);
      geometry.dispose();
    }

    for (const transfer of instances) {
      const geometryId = resource.geometryIds.get(transfer.geometryExpressId);
      if (geometryId === undefined) {
        throw new Error(`Geometry ${transfer.geometryExpressId} was not uploaded before its instance`);
      }

      const instanceId = resource.mesh.addInstance(geometryId);
      resource.mesh.setMatrixAt(instanceId, new THREE.Matrix4().fromArray(transfer.matrix));
      const baseColor = new THREE.Color(transfer.color[0], transfer.color[1], transfer.color[2]);
      resource.mesh.setColorAt(instanceId, baseColor);

      const ref: ObjectRef = { revisionId, objectId: transfer.objectId };
      const target: DrawTarget = {
        revisionId,
        instanceId,
        baseColor: [baseColor.r, baseColor.g, baseColor.b],
      };
      const addition: SelectionRecord = {
        ref,
        expressId: transfer.expressId,
        globalId: transfer.globalId,
        ifcType: transfer.ifcType,
        name: transfer.name,
        discipline: transfer.discipline,
        targets: [target],
      };
      this.addRecord(addition);
    }

    this.applyVisibility();
  }

  removeRevision(revisionId: RevisionId): void {
    const resource = this.resources.get(revisionId);
    if (resource) {
      resource.mesh.removeFromParent();
      resource.mesh.dispose();
      resource.root.removeFromParent();
      this.resources.delete(revisionId);
      this.revisionByMesh.delete(resource.mesh);
    }

    for (const [key, record] of this.records) {
      if (record.ref.revisionId === revisionId) this.records.delete(key);
    }
    const prefix = `${revisionId}\0`;
    for (const key of this.targetRecords.keys()) {
      if (key.startsWith(prefix)) this.targetRecords.delete(key);
    }
    if (this.selected?.ref.revisionId === revisionId) this.selected = null;
  }

  setOrigin(origin: readonly [number, number, number]): void {
    for (const resource of this.resources.values()) {
      resource.root.position.set(-origin[0], -origin[1], -origin[2]);
      resource.root.updateMatrixWorld(true);
    }
  }

  reveal(fitCamera: boolean): void {
    for (const resource of this.resources.values()) {
      resource.root.visible = true;
      resource.root.updateMatrixWorld(true);
    }
    if (fitCamera) this.fitAll();
  }

  select(record: SelectionRecord | null): void {
    if (this.selected) this.paintBaseColors(this.selected);
    this.selected = record;
    if (record) this.paint(record, SELECTED_COLOR);
  }

  selection(ref: ObjectRef): SelectionRecord | null {
    return this.records.get(objectRefKey(ref)) ?? null;
  }

  selectionRecords(): readonly SelectionRecord[] {
    return [...this.records.values()];
  }

  frame(refs: readonly ObjectRef[]): void {
    const box = new THREE.Box3();
    for (const ref of refs) {
      const record = this.records.get(objectRefKey(ref));
      if (!record) continue;
      for (const target of record.targets) this.expandTargetBox(box, target);
    }
    if (!box.isEmpty()) this.positionCamera(box);
  }

  setDisciplineVisibility(discipline: Discipline, visible: boolean): void {
    this.visibleByDiscipline[discipline] = visible;
    this.applyVisibility();
  }

  fitAll(): void {
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    for (const resource of this.resources.values()) {
      if (!resource.root.visible) continue;
      resource.mesh.computeBoundingBox();
      if (resource.mesh.boundingBox) {
        box.union(resource.mesh.boundingBox.clone().applyMatrix4(resource.root.matrixWorld));
      }
    }
    if (!box.isEmpty()) this.positionCamera(box);
  }

  diagnostics(): RendererDiagnostics {
    return {
      cameraPosition: this.camera.position.toArray(),
      cameraTarget: this.controls.target.toArray(),
      roots: [...this.resources].map(([revisionId, resource]) => ({
        revisionId,
        offset: resource.root.position.toArray(),
        visible: resource.root.visible,
      })),
    };
  }

  resourceStats(): ViewerResourceStats {
    let geometries = 0;
    for (const resource of this.resources.values()) geometries += resource.geometryIds.size;
    return {
      workers: 0,
      renderLoops: this.disposed ? 0 : 1,
      renderers: this.disposed ? 0 : 1,
      batches: this.disposed ? 0 : this.resources.size,
      geometries: this.disposed ? 0 : geometries,
      materials: this.disposed ? 0 : 1,
      gpuGeometries: this.renderer.info.memory.geometries,
      gpuTextures: this.renderer.info.memory.textures,
      shaderPrograms: this.renderer.info.programs?.length ?? 0,
      renderFrame: this.renderer.info.render.frame,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.dispose();
    for (const revisionId of [...this.resources.keys()]) this.removeRevision(revisionId);
    this.material.dispose();
    this.records.clear();
    this.targetRecords.clear();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }

  private addRecord(addition: SelectionRecord): void {
    const key = objectRefKey(addition.ref);
    const previous = this.records.get(key);
    const combined = previous
      ? { ...previous, targets: [...previous.targets, ...addition.targets] }
      : addition;
    this.records.set(key, combined);
    for (const target of combined.targets) {
      this.targetRecords.set(targetKey(target.revisionId, target.instanceId), combined);
    }
  }

  private applyVisibility(): void {
    for (const record of this.records.values()) {
      const visible = this.visibleByDiscipline[record.discipline];
      for (const target of record.targets) this.setTargetVisible(target, visible);
    }
  }

  private paint(record: SelectionRecord, color: THREE.Color): void {
    for (const target of record.targets) {
      this.resources.get(target.revisionId)?.mesh.setColorAt(target.instanceId, color);
    }
  }

  private paintBaseColors(record: SelectionRecord): void {
    for (const target of record.targets) {
      const color = new THREE.Color(target.baseColor[0], target.baseColor[1], target.baseColor[2]);
      this.resources.get(target.revisionId)?.mesh.setColorAt(target.instanceId, color);
    }
  }

  private setTargetVisible(target: DrawTarget, visible: boolean): void {
    this.resources.get(target.revisionId)?.mesh.setVisibleAt(target.instanceId, visible);
  }

  private expandTargetBox(box: THREE.Box3, target: DrawTarget): void {
    const resource = this.resources.get(target.revisionId);
    if (!resource) return;
    const geometryId = resource.mesh.getGeometryIdAt(target.instanceId);
    const local = resource.mesh.getBoundingBoxAt(geometryId, new THREE.Box3());
    if (!local) return;
    const instanceMatrix = resource.mesh.getMatrixAt(target.instanceId, new THREE.Matrix4());
    resource.root.updateMatrixWorld(true);
    box.union(local.clone().applyMatrix4(instanceMatrix).applyMatrix4(resource.root.matrixWorld));
  }

  private positionCamera(box: THREE.Box3): void {
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.55, 1);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.75, radius));
    this.camera.near = Math.max(radius / 1_000, 0.01);
    this.camera.far = Math.max(radius * 100, 1_000);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private readonly render = (): void => {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.render);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.pointerStart = [event.clientX, event.clientY];
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.disposed || event.button !== 0 || !this.pointerStart) return;
    const movement = Math.hypot(
      event.clientX - this.pointerStart[0],
      event.clientY - this.pointerStart[1],
    );
    this.pointerStart = null;
    if (movement > 4) return;

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pickable: THREE.BatchedMesh[] = [];
    for (const { root, mesh } of this.resources.values()) {
      if (root.visible) pickable.push(mesh);
    }
    const hit = this.raycaster.intersectObjects(pickable, false)[0];
    if (!hit || hit.batchId === undefined || !(hit.object instanceof THREE.BatchedMesh)) return;
    const revisionId = this.revisionByMesh.get(hit.object);
    if (!revisionId) return;
    const record = this.targetRecords.get(targetKey(revisionId, hit.batchId));
    if (record) this.onPick(record.ref);
  };

  private readonly resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
}

function targetKey(revisionId: RevisionId, instanceId: number): string {
  return `${revisionId}\0${instanceId}`;
}
