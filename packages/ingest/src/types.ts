import type { ElementInfo, ModelIndex } from '@clashflight/core';

export interface MergedMeshGroup {
  color: [number, number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Parallel to indices.length / 3: stores numeric IFC expressID per triangle. */
  triangleElementIds: Uint32Array;
}

export interface IfcLoadStats {
  elementCount: number;
  triangleCount: number;
  meshGroupCount: number;
  parseTimeMs: number;
}

export interface IfcLoadResult {
  modelIndex: ModelIndex;
  meshGroups: MergedMeshGroup[];
  stats: IfcLoadStats;
}

export interface SerializableModelIndex extends Omit<ModelIndex, 'elements'> {
  elements: Array<[string, ElementInfo]>;
}
