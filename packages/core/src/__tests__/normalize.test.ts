import { describe, expect, it } from 'vitest';
import {
  applyOriginShift,
  computeOriginShift,
  ifcZUpToThreeYUp,
  inferDiscipline,
  unitScaleToMeters,
} from '../normalize';

describe('normalize helpers', () => {
  it('converts standard BIM length units to metres', () => {
    expect(unitScaleToMeters('m')).toBe(1);
    expect(unitScaleToMeters('mm')).toBeCloseTo(0.001);
    expect(unitScaleToMeters('cm')).toBeCloseTo(0.01);
    expect(unitScaleToMeters('ft')).toBeCloseTo(0.3048);
    expect(unitScaleToMeters('in')).toBeCloseTo(0.0254);
  });

  it('converts IFC Z-up coordinates to Three.js Y-up coordinates', () => {
    expect(ifcZUpToThreeYUp([10, 20, 3])).toEqual([10, 3, -20]);
    expect(ifcZUpToThreeYUp([0, 1, 0])).toEqual([0, 0, -1]);
    expect(ifcZUpToThreeYUp([0, 0, 1])).toEqual([0, 1, -0]);
  });

  it('computes origin shift that centers XZ and sits min Y on 0', () => {
    const bounds = {
      min: [998, 12, -210] as [number, number, number],
      max: [1022, 22, -190] as [number, number, number],
    };
    const shift = computeOriginShift(bounds);
    expect(shift).toEqual([-1010, -12, 200]);

    const shiftedMin = applyOriginShift(bounds.min, shift);
    const shiftedMax = applyOriginShift(bounds.max, shift);
    expect(shiftedMin).toEqual([-12, 0, -10]);
    expect(shiftedMax).toEqual([12, 10, 10]);
  });

  it('infers disciplines from IFC class names', () => {
    expect(inferDiscipline('IfcWallStandardCase')).toBe('Architecture');
    expect(inferDiscipline('IfcSlab')).toBe('Architecture');
    expect(inferDiscipline('IfcColumn')).toBe('Structure');
    expect(inferDiscipline('IfcBeam')).toBe('Structure');
    expect(inferDiscipline('IfcFlowSegment')).toBe('MEP');
    expect(inferDiscipline('IfcDuctSegment')).toBe('MEP');
    expect(inferDiscipline('IfcBuildingElementProxy')).toBe('General');
  });
});
