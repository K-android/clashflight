import { describe, expect, it } from 'vitest';
import { resolveIssues } from '../issueResolver';
import type { IssueDraft, ModelIndex } from '../types';

function createTestModel(): ModelIndex {
  const elements = new Map();
  elements.set('10', {
    key: '10',
    ifcGuid: '1abcDEF234567890123456',
    ifcClass: 'IfcBeam',
    name: 'Beam B1',
    discipline: 'Structure',
    bounds: { min: [-2, 3, -1], max: [2, 4, 1] },
    meshRanges: [],
  });
  elements.set('11', {
    key: '11',
    ifcGuid: '2abcDEF234567890123456',
    ifcClass: 'IfcFlowSegment',
    name: 'Duct D1',
    discipline: 'MEP',
    bounds: { min: [0, 3.2, -0.5], max: [4, 3.8, 0.5] },
    meshRanges: [],
  });

  return {
    schemaVersion: 1,
    id: 'test-model',
    source: 'ifc',
    units: 'm',
    originShift: [-100, 0, 50],
    bounds: { min: [-12, 0, -8], max: [12, 7, 8] },
    elements,
  };
}

describe('resolveIssues', () => {
  it('places GUID-matched issues at combined bounding box center, camera fallback 2.5m along view dir, and marks unmatched without camera as unplaced', () => {
    const model = createTestModel();
    const drafts: IssueDraft[] = [
      {
        id: 'issue-guid',
        source: 'bcf',
        title: 'Duct vs Beam Clash',
        priority: 'High',
        ifcGuids: ['1abcDEF234567890123456', '2abcDEF234567890123456'],
      },
      {
        id: 'issue-cam',
        source: 'bcf',
        title: 'Camera Only Issue',
        priority: 'Medium',
        ifcGuids: ['NON_EXISTENT_GUID'],
        cameraIfcZUp: {
          position: [100, 50, 2],
          direction: [0, 1, 0],
          up: [0, 0, 1],
        },
      },
      {
        id: 'issue-unplaced',
        source: 'bcf',
        title: 'Ghost Issue',
        ifcGuids: ['MISSING_GUID_NO_CAMERA'],
      },
    ];

    const result = resolveIssues(drafts, model);
    expect(result.stats).toEqual({
      total: 3,
      matchedByGuid: 1,
      fallbackByCamera: 1,
      unplaced: 1,
    });

    // Combined bounds of elements 10 and 11: min [-2, 3, -1], max [4, 4, 1] -> center [1, 3.5, 0]
    expect(result.issues[0].position).toEqual([1, 3.5, 0]);
    expect(result.issues[0].elementKeys).toEqual(['10', '11']);
    expect(result.issues[0].discipline).toBe('Structure');

    // Camera position in Z-up [100, 50, 2] -> Y-up [100, 2, -50] -> + originShift [-100, 0, 50] => [0, 2, 0]
    // Camera direction in Z-up [0, 1, 0] -> Y-up [0, 0, -1], * 2.5m => [0, 2, -2.5]
    expect(result.issues[1].position?.[0]).toBeCloseTo(0);
    expect(result.issues[1].position?.[1]).toBeCloseTo(2);
    expect(result.issues[1].position?.[2]).toBeCloseTo(-2.5);

    expect(result.issues[2].position).toBeNull();
  });
});
