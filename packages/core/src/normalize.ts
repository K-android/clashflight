import type { Bounds3, Vec3 } from './types';

export type LengthUnit = 'm' | 'mm' | 'cm' | 'ft' | 'in';

const UNIT_SCALE_TO_METERS: Record<LengthUnit, number> = {
  m: 1,
  mm: 0.001,
  cm: 0.01,
  ft: 0.3048,
  in: 0.0254,
};

/**
 * Returns the multiplier converting coordinates in the given length unit to metres.
 */
export function unitScaleToMeters(unit: LengthUnit): number {
  return UNIT_SCALE_TO_METERS[unit];
}

/**
 * Converts a point or vector from IFC/BCF Z-up right-handed coordinates to Three.js Y-up coordinates.
 * Mapping: (X, Y, Z)_ifc -> (X, Z, -Y)_three.
 */
export function ifcZUpToThreeYUp(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]];
}

/**
 * Normalizes a 3D vector, returning [0, 0, -1] if zero-length.
 */
export function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) {
    return [0, 0, -1];
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Computes the translation shift so a Y-up bounding box is centered in XZ at (0, 0)
 * and rests on ground plane Y = 0 (min.y becomes 0).
 */
export function computeOriginShift(bounds: Bounds3): Vec3 {
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  const minY = bounds.min[1];
  return [-centerX, -minY, -centerZ];
}

/**
 * Applies an origin shift vector to a Y-up coordinate.
 */
export function applyOriginShift(v: Vec3, originShift: Vec3): Vec3 {
  return [v[0] + originShift[0], v[1] + originShift[1], v[2] + originShift[2]];
}

/**
 * Shifts a bounding box by originShift.
 */
export function shiftBounds(bounds: Bounds3, originShift: Vec3): Bounds3 {
  return {
    min: applyOriginShift(bounds.min, originShift),
    max: applyOriginShift(bounds.max, originShift),
  };
}

/**
 * Creates an empty inverse-infinite Bounds3 accumulator.
 */
export function createEmptyBounds(): Bounds3 {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

/**
 * Expands a mutable Bounds3 to include a point.
 */
export function expandBoundsByPoint(bounds: Bounds3, p: Vec3): void {
  if (p[0] < bounds.min[0]) bounds.min[0] = p[0];
  if (p[1] < bounds.min[1]) bounds.min[1] = p[1];
  if (p[2] < bounds.min[2]) bounds.min[2] = p[2];
  if (p[0] > bounds.max[0]) bounds.max[0] = p[0];
  if (p[1] > bounds.max[1]) bounds.max[1] = p[1];
  if (p[2] > bounds.max[2]) bounds.max[2] = p[2];
}

/**
 * Expands a mutable Bounds3 to include another Bounds3.
 */
export function expandBoundsByBounds(target: Bounds3, other: Bounds3): void {
  if (!Number.isFinite(other.min[0]) || !Number.isFinite(other.max[0])) return;
  expandBoundsByPoint(target, other.min);
  expandBoundsByPoint(target, other.max);
}

/**
 * Computes the center of a Bounds3, or null if bounds are empty/non-finite.
 */
export function boundsCenter(bounds: Bounds3): Vec3 | null {
  if (!Number.isFinite(bounds.min[0]) || !Number.isFinite(bounds.max[0])) {
    return null;
  }
  return [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
}

/**
 * Infers a BIM coordination discipline from an IFC class name.
 */
export function inferDiscipline(ifcClass: string): string {
  const upper = ifcClass.toUpperCase();
  if (
    upper.includes('WALL') ||
    upper.includes('DOOR') ||
    upper.includes('WINDOW') ||
    upper.includes('SLAB') ||
    upper.includes('ROOF') ||
    upper.includes('STAIR') ||
    upper.includes('RAILING') ||
    upper.includes('CURTAINWALL') ||
    upper.includes('CEILING') ||
    upper.includes('COVERING') ||
    upper.includes('FURNISHING')
  ) {
    return 'Architecture';
  }
  if (
    upper.includes('COLUMN') ||
    upper.includes('BEAM') ||
    upper.includes('FOOTING') ||
    upper.includes('PILE') ||
    upper.includes('MEMBER') ||
    upper.includes('PLATE') ||
    upper.includes('TRUSS')
  ) {
    return 'Structure';
  }
  if (
    upper.includes('FLOW') ||
    upper.includes('DUCT') ||
    upper.includes('PIPE') ||
    upper.includes('CABLE') ||
    upper.includes('CONDUIT') ||
    upper.includes('DISTRIBUTION') ||
    upper.includes('SANITARY') ||
    upper.includes('AIRTERMINAL') ||
    upper.includes('FAN') ||
    upper.includes('PUMP') ||
    upper.includes('VALVE')
  ) {
    return 'MEP';
  }
  return 'General';
}
