import type { Vec3 } from './types';
import { add, scale, sub } from './vec3';

/**
 * Clips the infinite line through `a` and `b` to the axis-aligned cube [-half, half]^3 (slab method).
 * Returns null when the line misses the cube or a == b.
 */
export function clipLineToCube(a: Vec3, b: Vec3, half: number): [Vec3, Vec3] | null {
  const d = sub(b, a);
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (a[i] < -half || a[i] > half) return null;
      continue;
    }
    let t1 = (-half - a[i]) / d[i];
    let t2 = (half - a[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin > tMax) return null;
  return [add(a, scale(d, tMin)), add(a, scale(d, tMax))];
}
