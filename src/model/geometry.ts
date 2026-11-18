import type { Vec3 } from './types';
import { add, cross, dot, length, scale, sub } from './vec3';

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

/**
 * Orders coplanar points around their centroid so they form a simple polygon (for drawing and occlusion).
 * Plane objects keep the student's point order for their name (平面 ABC stays ABC); only drawing reorders.
 */
export function orderPolygon(pos: Vec3[]): Vec3[] {
  if (pos.length < 4) return pos; // a triangle is simple in any order
  let normal: Vec3 | null = null;
  for (let i = 2; i < pos.length && !normal; i++) {
    const n = cross(sub(pos[1], pos[0]), sub(pos[i], pos[0]));
    if (length(n) > 1e-9) normal = n;
  }
  if (!normal) return pos;
  const centroid = scale(pos.reduce((acc, p) => add(acc, p), [0, 0, 0] as Vec3), 1 / pos.length);
  let u = sub(pos[0], centroid);
  if (length(u) < 1e-9) u = sub(pos[1], centroid);
  const w = cross(normal, u);
  const angle = (p: Vec3) => Math.atan2(dot(sub(p, centroid), w), dot(sub(p, centroid), u));
  return [...pos].sort((p, q) => angle(p) - angle(q));
}
