import { parseIfcBuffer } from './ifcParserCore';
import type { IfcLoadStats, MergedMeshGroup, SerializableModelIndex } from '../types';

export interface IfcWorkerRequest {
  type: 'parse';
  buffer: ArrayBuffer;
  fileName: string;
  wasmPath: string;
}

export type IfcWorkerResponse =
  | { type: 'progress'; message: string }
  | {
      type: 'result';
      modelIndex: SerializableModelIndex;
      meshGroups: MergedMeshGroup[];
      stats: IfcLoadStats;
    }
  | { type: 'error'; error: string };

interface WorkerGlobalLike {
  onmessage: ((event: MessageEvent<IfcWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as WorkerGlobalLike;

workerScope.onmessage = async (event: MessageEvent<IfcWorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== 'parse') return;

  try {
    const result = await parseIfcBuffer(new Uint8Array(msg.buffer), {
      fileName: msg.fileName,
      wasmPath: msg.wasmPath,
      absoluteWasmPath: true,
      onProgress: (message) => {
        const progressMsg: IfcWorkerResponse = { type: 'progress', message };
        workerScope.postMessage(progressMsg);
      },
    });

    const serializableModel: SerializableModelIndex = {
      ...result.modelIndex,
      elements: Array.from(result.modelIndex.elements.entries()),
    };

    const transferables: Transferable[] = [];
    for (const group of result.meshGroups) {
      transferables.push(
        group.positions.buffer,
        group.normals.buffer,
        group.indices.buffer,
        group.triangleElementIds.buffer
      );
    }

    const response: IfcWorkerResponse = {
      type: 'result',
      modelIndex: serializableModel,
      meshGroups: result.meshGroups,
      stats: result.stats,
    };

    workerScope.postMessage(response, transferables);
  } catch (err) {
    const errorMsg: IfcWorkerResponse = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    workerScope.postMessage(errorMsg);
  }
};
