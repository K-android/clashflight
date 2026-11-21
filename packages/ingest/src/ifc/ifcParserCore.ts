import { IfcAPI, LogLevel } from 'web-ifc';
import {
  computeOriginShift,
  createEmptyBounds,
  expandBoundsByPoint,
  inferDiscipline,
  shiftBounds,
  type Bounds3,
  type ElementInfo,
  type ElementKey,
  type MeshRange,
  type ModelIndex,
  type Vec3,
} from '@clashflight/core';
import type { IfcLoadResult, MergedMeshGroup } from '../types';

interface MutableGroupBucket {
  color: [number, number, number, number];
  positions: number[];
  normals: number[];
  indices: number[];
  triangleElementIds: number[];
}

export interface ParseIfcOptions {
  fileName?: string;
  wasmPath?: string;
  absoluteWasmPath?: boolean;
  onProgress?: (message: string) => void;
}

function quantizeColor(
  r: number,
  g: number,
  b: number,
  a: number
): { key: string; rgba: [number, number, number, number] } {
  const cr = Math.max(0, Math.min(255, Math.round(r * 255)));
  const cg = Math.max(0, Math.min(255, Math.round(g * 255)));
  const cb = Math.max(0, Math.min(255, Math.round(b * 255)));
  const ca = Math.max(12, Math.min(255, Math.round(a * 255)));
  return {
    key: `${cr}-${cg}-${cb}-${ca}`,
    rgba: [cr / 255, cg / 255, cb / 255, ca / 255],
  };
}

/**
 * Computes the 3x3 cofactor-transposed normal matrix from a column-major 4x4 matrix
 * and returns [n0..n8, determinant].
 */
function computeNormalMatrix3x3(m: number[]): {
  nm: [number, number, number, number, number, number, number, number, number];
  det3: number;
} {
  const a00 = m[0],
    a10 = m[1],
    a20 = m[2];
  const a01 = m[4],
    a11 = m[5],
    a21 = m[6];
  const a02 = m[8],
    a12 = m[9],
    a22 = m[10];

  const b00 = a11 * a22 - a12 * a21;
  const b01 = a12 * a20 - a10 * a22;
  const b02 = a10 * a21 - a11 * a20;

  const b10 = a02 * a21 - a01 * a22;
  const b11 = a00 * a22 - a02 * a20;
  const b12 = a01 * a20 - a00 * a21;

  const b20 = a01 * a12 - a02 * a11;
  const b21 = a02 * a10 - a00 * a12;
  const b22 = a00 * a11 - a01 * a10;

  const det3 = a00 * b00 + a01 * b01 + a02 * b02;
  const invDet = Math.abs(det3) > 1e-12 ? 1 / det3 : 1;

  return {
    nm: [
      b00 * invDet,
      b01 * invDet,
      b02 * invDet,
      b10 * invDet,
      b11 * invDet,
      b12 * invDet,
      b20 * invDet,
      b21 * invDet,
      b22 * invDet,
    ],
    det3,
  };
}

/**
 * Parses an IFC buffer using web-ifc, merges geometry by quantized material color,
 * extracts element metadata & GUIDs, and normalizes model coordinates to Y-up metres
 * shifted cleanly near the origin.
 */
export async function parseIfcBuffer(
  data: Uint8Array,
  options: ParseIfcOptions = {}
): Promise<IfcLoadResult> {
  const startedAt = performance.now();
  const {
    fileName = 'model.ifc',
    wasmPath = '/wasm/',
    absoluteWasmPath = false,
    onProgress,
  } = options;

  const ifcApi = new IfcAPI();
  ifcApi.SetWasmPath(wasmPath, absoluteWasmPath);
  await ifcApi.Init(undefined, true);
  ifcApi.SetLogLevel(LogLevel.LOG_LEVEL_OFF);

  onProgress?.('Opening IFC model...');
  const modelID = ifcApi.OpenModel(data, {
    COORDINATE_TO_ORIGIN: false,
  });

  if (modelID < 0) {
    throw new Error(`web-ifc failed to open IFC model "${fileName}".`);
  }

  try {
    const bucketMap = new Map<string, number>();
    const buckets: MutableGroupBucket[] = [];
    const elements = new Map<ElementKey, ElementInfo>();
    const globalBounds = createEmptyBounds();
    let totalTriangles = 0;

    onProgress?.('Extracting IFC geometry & metadata...');

    ifcApi.StreamAllMeshes(modelID, (flatMesh, index, total) => {
      if (index % 150 === 0 && total > 0) {
        const pct = Math.round(((index + 1) / total) * 100);
        onProgress?.(`Streaming IFC meshes (${pct}%)...`);
      }

      const expressID = flatMesh.expressID;
      const key = String(expressID);
      const elementBounds = createEmptyBounds();
      const meshRanges: MeshRange[] = [];
      let hasTriangles = false;

      const geomCount = flatMesh.geometries.size();
      for (let i = 0; i < geomCount; i++) {
        const placed = flatMesh.geometries.get(i);
        // Only process triangle meshes (geomType 0)
        if (placed.geomType !== 0) {
          continue;
        }

        const geom = ifcApi.GetGeometry(modelID, placed.geometryExpressID);
        const verts = ifcApi.GetVertexArray(
          geom.GetVertexData(),
          geom.GetVertexDataSize()
        );
        const indices = ifcApi.GetIndexArray(
          geom.GetIndexData(),
          geom.GetIndexDataSize()
        );

        if (verts.length === 0 || indices.length === 0) {
          geom.delete();
          continue;
        }

        hasTriangles = true;

        const colorInfo = placed.hasColor
          ? quantizeColor(
              placed.color.x,
              placed.color.y,
              placed.color.z,
              placed.color.w
            )
          : quantizeColor(0.78, 0.8, 0.84, 1);

        let groupIndex = bucketMap.get(colorInfo.key);
        if (groupIndex === undefined) {
          groupIndex = buckets.length;
          bucketMap.set(colorInfo.key, groupIndex);
          buckets.push({
            color: colorInfo.rgba,
            positions: [],
            normals: [],
            indices: [],
            triangleElementIds: [],
          });
        }

        const bucket = buckets[groupIndex];
        const baseVertex = bucket.positions.length / 3;
        const indexStart = bucket.indices.length;

        const m = placed.flatTransformation;
        const { nm, det3 } = computeNormalMatrix3x3(m);
        const flipWinding = det3 < 0;

        // Vertex stride in web-ifc is 6 floats: px, py, pz, nx, ny, nz
        for (let v = 0; v < verts.length; v += 6) {
          const x = verts[v];
          const y = verts[v + 1];
          const z = verts[v + 2];

          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];

          bucket.positions.push(wx, wy, wz);
          const pt: Vec3 = [wx, wy, wz];
          expandBoundsByPoint(elementBounds, pt);
          expandBoundsByPoint(globalBounds, pt);

          const nx = verts[v + 3];
          const ny = verts[v + 4];
          const nz = verts[v + 5];

          let wnx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
          let wny = nm[1] * nx + nm[4] * ny + nm[7] * nz;
          let wnz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
          const nLen = Math.hypot(wnx, wny, wnz) || 1;
          wnx /= nLen;
          wny /= nLen;
          wnz /= nLen;

          bucket.normals.push(wnx, wny, wnz);
        }

        for (let k = 0; k < indices.length; k += 3) {
          const i0 = baseVertex + indices[k];
          const i1 = baseVertex + indices[k + 1];
          const i2 = baseVertex + indices[k + 2];
          if (flipWinding) {
            bucket.indices.push(i0, i2, i1);
          } else {
            bucket.indices.push(i0, i1, i2);
          }
          bucket.triangleElementIds.push(expressID);
          totalTriangles += 1;
        }

        meshRanges.push({
          groupIndex,
          indexStart,
          indexCount: indices.length,
        });

        geom.delete();
      }

      if (!hasTriangles) {
        return;
      }

      let ifcGuid: string | undefined;
      let ifcClass = 'IfcBuildingElement';
      let name: string | undefined;

      try {
        const line = ifcApi.GetLine(modelID, expressID, false);
        if (line) {
          ifcClass = ifcApi.GetNameFromTypeCode(line.type) || ifcClass;
          if (typeof line.GlobalId?.value === 'string') {
            ifcGuid = line.GlobalId.value;
          }
          if (typeof line.Name?.value === 'string' && line.Name.value.trim()) {
            name = line.Name.value.trim();
          }
        }
      } catch {
        // Fallback to GUID lookup if GetLine fails
      }

      if (!ifcGuid) {
        const rawGuid = ifcApi.GetGuidFromExpressId(modelID, expressID);
        if (typeof rawGuid === 'string' && rawGuid.length > 0) {
          ifcGuid = rawGuid;
        }
      }

      elements.set(key, {
        key,
        ifcGuid,
        ifcClass,
        name,
        discipline: inferDiscipline(ifcClass),
        bounds: elementBounds,
        meshRanges,
      });
    });

    if (buckets.length === 0 || totalTriangles === 0) {
      throw new Error(`No 3D triangle geometry found in "${fileName}".`);
    }

    onProgress?.('Normalizing origin & building mesh buffers...');
    const originShift = computeOriginShift(globalBounds);
    const shiftedGlobalBounds: Bounds3 = shiftBounds(globalBounds, originShift);

    for (const el of elements.values()) {
      el.bounds = shiftBounds(el.bounds, originShift);
    }

    const meshGroups: MergedMeshGroup[] = buckets.map((bucket) => {
      const posArr = new Float32Array(bucket.positions.length);
      for (let i = 0; i < bucket.positions.length; i += 3) {
        posArr[i] = bucket.positions[i] + originShift[0];
        posArr[i + 1] = bucket.positions[i + 1] + originShift[1];
        posArr[i + 2] = bucket.positions[i + 2] + originShift[2];
      }
      return {
        color: bucket.color,
        positions: posArr,
        normals: new Float32Array(bucket.normals),
        indices: new Uint32Array(bucket.indices),
        triangleElementIds: new Uint32Array(bucket.triangleElementIds),
      };
    });

    const modelIndex: ModelIndex = {
      schemaVersion: 1,
      id: fileName,
      source: 'ifc',
      units: 'm',
      originShift,
      bounds: shiftedGlobalBounds,
      elements,
    };

    const parseTimeMs = Math.round(performance.now() - startedAt);
    onProgress?.(
      `Loaded ${elements.size} elements (${totalTriangles.toLocaleString()} triangles) in ${parseTimeMs} ms`
    );

    return {
      modelIndex,
      meshGroups,
      stats: {
        elementCount: elements.size,
        triangleCount: totalTriangles,
        meshGroupCount: meshGroups.length,
        parseTimeMs,
      },
    };
  } finally {
    ifcApi.CloseModel(modelID);
  }
}
