import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { ElementInfo, Issue, ModelIndex } from '@clashflight/core';
import type { MergedMeshGroup } from '@clashflight/ingest';

export type QualityPreset = 'low' | 'medium' | 'high';

export interface CollisionMeshData {
  bvh: MeshBVH;
  triangleElementIds: Uint32Array;
}

/**
 * Manages the Three.js WebGLRenderer, scene lighting, IFC mesh groups,
 * lazy BVH collision index, issue element highlights, and quality presets.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly modelGroup = new THREE.Group();
  readonly highlightGroup = new THREE.Group();
  readonly markersGroup = new THREE.Group();

  private readonly container: HTMLElement;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly modelMaterials: THREE.MeshStandardMaterial[] = [];

  private modelIndex: ModelIndex | null = null;
  private collisionData: CollisionMeshData | null = null;
  private collisionGeometry: THREE.BufferGeometry | null = null;
  private xrayMode = false;
  private quality: QualityPreset = 'medium';

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setSize(container.clientWidth || 1280, container.clientHeight || 720);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1220);
    this.scene.fog = new THREE.FogExp2(0x0b1220, 0.0045);

    const aspect =
      (container.clientWidth || 1280) / (container.clientHeight || 720);
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.12, 1200);

    this.hemiLight = new THREE.HemisphereLight(0xdcebff, 0x263248, 0.95);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff7ea, 1.35);
    this.dirLight.position.set(28, 42, 24);
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight(0x74a9ff, 0.45);
    this.fillLight.position.set(-24, 18, -22);
    this.scene.add(this.fillLight);

    const grid = new THREE.GridHelper(120, 60, 0x2b4162, 0x162238);
    grid.position.y = -0.02;
    this.scene.add(grid);

    this.scene.add(this.modelGroup);
    this.scene.add(this.highlightGroup);
    this.scene.add(this.markersGroup);

    this.setQuality('medium');
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  getModelIndex(): ModelIndex | null {
    return this.modelIndex;
  }

  getCollisionData(): CollisionMeshData | null {
    return this.collisionData;
  }

  getElementByExpressId(expressId: number): ElementInfo | undefined {
    return this.modelIndex?.elements.get(String(expressId));
  }

  /**
   * Loads normalized IFC mesh groups into the scene and builds the BVH lazily
   * after the first frame paints.
   */
  loadModel(modelIndex: ModelIndex, meshGroups: MergedMeshGroup[]): void {
    this.clearModel();
    this.modelIndex = modelIndex;

    let totalVerts = 0;
    let totalIndices = 0;
    let totalTris = 0;

    for (const group of meshGroups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.BufferAttribute(group.positions, 3)
      );
      geo.setAttribute('normal', new THREE.BufferAttribute(group.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(group.indices, 1));
      geo.computeBoundingSphere();

      const [r, g, b, a] = group.color;
      const isTransparent = a < 0.99;

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        roughness: 0.72,
        metalness: 0.08,
        transparent: isTransparent || this.xrayMode,
        opacity: this.xrayMode ? Math.min(a, 0.24) : a,
        depthWrite: !isTransparent && !this.xrayMode,
        side: THREE.DoubleSide,
      });
      mat.userData.baseOpacity = a;
      mat.userData.baseTransparent = isTransparent;
      this.modelMaterials.push(mat);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.quality === 'high';
      mesh.receiveShadow = this.quality !== 'low';
      this.modelGroup.add(mesh);

      totalVerts += group.positions.length / 3;
      totalIndices += group.indices.length;
      totalTris += group.triangleElementIds.length;
    }

    // Prepare combined collision geometry + element-id lookup, build BVH lazily
    const combinedPositions = new Float32Array(totalVerts * 3);
    const combinedIndices = new Uint32Array(totalIndices);
    const combinedElementIds = new Uint32Array(totalTris);

    let vOffset = 0;
    let iOffset = 0;
    let tOffset = 0;

    for (const group of meshGroups) {
      combinedPositions.set(group.positions, vOffset * 3);
      for (let k = 0; k < group.indices.length; k++) {
        combinedIndices[iOffset + k] = group.indices[k] + vOffset;
      }
      combinedElementIds.set(group.triangleElementIds, tOffset);

      vOffset += group.positions.length / 3;
      iOffset += group.indices.length;
      tOffset += group.triangleElementIds.length;
    }

    const collisionGeo = new THREE.BufferGeometry();
    collisionGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(combinedPositions, 3)
    );
    collisionGeo.setIndex(new THREE.BufferAttribute(combinedIndices, 1));
    this.collisionGeometry = collisionGeo;

    // Defer BVH construction slightly so first frame renders immediately
    setTimeout(() => {
      if (this.collisionGeometry !== collisionGeo) return;
      const bvh = new MeshBVH(collisionGeo);
      this.collisionData = {
        bvh,
        triangleElementIds: combinedElementIds,
      };
    }, 16);
  }

  clearModel(): void {
    this.highlightIssue(null);

    for (const child of this.modelGroup.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
    this.modelGroup.clear();
    this.modelMaterials.length = 0;

    this.collisionGeometry?.dispose();
    this.collisionGeometry = null;
    this.collisionData = null;
    this.modelIndex = null;
  }

  /**
   * Draws glowing bounding boxes around the BIM elements linked to the active issue.
   */
  highlightIssue(issue: Issue | null): void {
    while (this.highlightGroup.children.length > 0) {
      const obj = this.highlightGroup.children.pop()!;
      if (obj instanceof THREE.Box3Helper || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    }

    if (!issue || !this.modelIndex) return;

    const colors = [0xff5252, 0x00e5ff, 0xffd740];
    let idx = 0;

    for (const key of issue.elementKeys) {
      const el = this.modelIndex.elements.get(key);
      if (!el) continue;

      const box = new THREE.Box3(
        new THREE.Vector3(el.bounds.min[0], el.bounds.min[1], el.bounds.min[2]),
        new THREE.Vector3(el.bounds.max[0], el.bounds.max[1], el.bounds.max[2])
      );
      box.expandByScalar(0.06);

      const helper = new THREE.Box3Helper(
        box,
        new THREE.Color(colors[idx % colors.length])
      );
      this.highlightGroup.add(helper);
      idx += 1;
    }
  }

  /**
   * Computes a comfortable exterior-to-entrance spawn point facing the model center.
   */
  getSafeSpawnPoint(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    if (!this.modelIndex) {
      return {
        position: new THREE.Vector3(0, 3, 14),
        lookAt: new THREE.Vector3(0, 2, 0),
      };
    }

    const { min, max } = this.modelIndex.bounds;
    const spanX = max[0] - min[0];
    const spanY = max[1] - min[1];
    const spanZ = max[2] - min[2];
    const center = new THREE.Vector3(
      (min[0] + max[0]) * 0.5,
      min[1] + Math.min(2.4, Math.max(1.6, spanY * 0.35)),
      (min[2] + max[2]) * 0.5
    );

    const standoff = Math.max(5.5, Math.min(18, Math.max(spanX, spanZ) * 0.35));
    const position = new THREE.Vector3(
      center.x,
      center.y + 0.4,
      max[2] + standoff
    );

    return { position, lookAt: center };
  }

  setXrayMode(enabled: boolean): void {
    this.xrayMode = enabled;
    for (const mat of this.modelMaterials) {
      const baseOpacity = (mat.userData.baseOpacity as number) ?? 1;
      const baseTransparent = Boolean(mat.userData.baseTransparent);
      mat.transparent = enabled || baseTransparent;
      mat.opacity = enabled ? Math.min(baseOpacity, 0.22) : baseOpacity;
      mat.depthWrite = !enabled && !baseTransparent;
      mat.needsUpdate = true;
    }
  }

  setQuality(preset: QualityPreset): void {
    this.quality = preset;
    const dpr = window.devicePixelRatio || 1;
    if (preset === 'low') {
      this.renderer.setPixelRatio(Math.min(dpr, 1));
      this.renderer.shadowMap.enabled = false;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.renderer.shadowMap.enabled = false;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = true;
    }
  }

  setFov(fovDegrees: number): void {
    this.camera.fov = Math.max(50, Math.min(105, fovDegrees));
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearModel();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
