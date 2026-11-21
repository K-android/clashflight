import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseIfcBuffer } from '../ifc/ifcParserCore';
import { parseBcfBuffer } from '../bcf/bcfParser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');
const samplesDir = path.join(rootDir, 'samples');
const webIfcWasmDir =
  path.dirname(fileURLToPath(import.meta.resolve('web-ifc'))) + path.sep;

describe('@clashflight/ingest integration with sample IFC & BCFZIP', () => {
  it('parses clashflight-sample.ifc and resolves clashflight-sample.bcfzip markers accurately', async () => {
    const ifcBytes = new Uint8Array(
      fs.readFileSync(path.join(samplesDir, 'clashflight-sample.ifc'))
    );
    const ifcResult = await parseIfcBuffer(ifcBytes, {
      fileName: 'clashflight-sample.ifc',
      wasmPath: webIfcWasmDir,
      absoluteWasmPath: true,
    });

    expect(ifcResult.stats.elementCount).toBeGreaterThan(20);
    expect(ifcResult.stats.triangleCount).toBeGreaterThan(200);
    expect(ifcResult.stats.meshGroupCount).toBeGreaterThanOrEqual(4);

    // Normalized Y-up bounds should sit at Y=0 and span ~7.5m high, ~24m wide, ~16m deep
    const { min, max } = ifcResult.modelIndex.bounds;
    expect(min[1]).toBeCloseTo(0, 2);
    expect(max[1]).toBeCloseTo(7.5, 1);
    expect(max[0] - min[0]).toBeCloseTo(24, 1);
    expect(max[2] - min[2]).toBeCloseTo(16, 1);

    // Every element should have an ifcGuid and valid bounds
    for (const el of ifcResult.modelIndex.elements.values()) {
      expect(el.ifcGuid).toBeTruthy();
      expect(el.ifcClass).toBeTruthy();
    }

    const bcfBytes = new Uint8Array(
      fs.readFileSync(path.join(samplesDir, 'clashflight-sample.bcfzip'))
    );
    const resolved = parseBcfBuffer(bcfBytes, ifcResult.modelIndex);

    expect(resolved.stats.total).toBe(6);
    expect(resolved.stats.matchedByGuid).toBe(5);
    expect(resolved.stats.fallbackByCamera).toBe(1);
    expect(resolved.stats.unplaced).toBe(0);

    // All 6 issues should land cleanly inside the normalized 24x7.5x16m building bounds
    for (const issue of resolved.issues) {
      expect(issue.position).not.toBeNull();
      const [x, y, z] = issue.position!;
      expect(x).toBeGreaterThanOrEqual(min[0] - 0.5);
      expect(x).toBeLessThanOrEqual(max[0] + 0.5);
      expect(y).toBeGreaterThanOrEqual(min[1] - 0.5);
      expect(y).toBeLessThanOrEqual(max[1] + 0.5);
      expect(z).toBeGreaterThanOrEqual(min[2] - 0.5);
      expect(z).toBeLessThanOrEqual(max[2] + 0.5);
    }
  });
});
