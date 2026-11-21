import type { ModelIndex } from '@clashflight/core';
import type { IfcLoadResult } from '../types';
import type { IfcWorkerRequest, IfcWorkerResponse } from './ifcWorker';

/**
 * Loads and parses an IFC file on a dedicated Web Worker with zero-copy buffer transfer.
 */
export async function loadIfcFileInWorker(
  file: { name: string; arrayBuffer(): Promise<ArrayBuffer> },
  options: {
    wasmBaseUrl?: string;
    onProgress?: (message: string) => void;
  } = {}
): Promise<IfcLoadResult> {
  const buffer = await file.arrayBuffer();
  const baseUrl =
    options.wasmBaseUrl ?? `${window.location.origin}/wasm/`;

  return new Promise<IfcLoadResult>((resolve, reject) => {
    const worker = new Worker(new URL('./ifcWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
      const payload = event.data;
      if (payload.type === 'progress') {
        options.onProgress?.(payload.message);
        return;
      }
      if (payload.type === 'error') {
        worker.terminate();
        reject(new Error(payload.error));
        return;
      }
      if (payload.type === 'result') {
        worker.terminate();
        const modelIndex: ModelIndex = {
          ...payload.modelIndex,
          elements: new Map(payload.modelIndex.elements),
        };
        resolve({
          modelIndex,
          meshGroups: payload.meshGroups,
          stats: payload.stats,
        });
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'IFC Web Worker crashed.'));
    };

    const req: IfcWorkerRequest = {
      type: 'parse',
      buffer,
      fileName: file.name,
      wasmPath: baseUrl,
    };

    worker.postMessage(req, [buffer]);
  });
}
