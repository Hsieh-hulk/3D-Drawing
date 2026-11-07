import type { Vec3 } from '../model/types';
import { cross, dot, length, sub } from '../model/vec3';

export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

/** Fan-triangulates a convex polygon. */
export function triangulate(poly: Vec3[]): Triangle[] {
  const tris: Triangle[] = [];
  for (let i = 1; i + 1 < poly.length; i++) tris.push({ a: poly[0], b: poly[i], c: poly[i + 1] });
  return tris;
}

const EPS_T = 1e-6;
const EPS_DET = 1e-12;

/**
 * Möller–Trumbore: distance t along `dir` at which the ray hits the triangle, or null.
 * Edges count as hits (inclusive barycentric test with a tiny tolerance).
 */
export function rayTriangle(origin: Vec3, dir: Vec3, tri: Triangle): number | null {
  const e1 = sub(tri.b, tri.a);
  const e2 = sub(tri.c, tri.a);
  const p = cross(dir, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < EPS_DET) return null; // ray parallel to the triangle's plane
  const inv = 1 / det;
  const s = sub(origin, tri.a);
  const u = dot(s, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(s, e1);
  const v = dot(dir, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  return dot(e2, q) * inv;
}

interface PreparedTriangle {
  tri: Triangle;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Nearest depth (along the view direction) of the triangle. */
  minDepth: number;
}

/** Occluders with screen-space bounding boxes, so most ray tests are rejected with a few comparisons. */
export interface OccluderSet {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  towardCamera: Vec3;
  items: PreparedTriangle[];
}

export function prepareOccluders(tris: Triangle[], cam: { right: Vec3; up: Vec3; forward: Vec3 }): OccluderSet {
  const pad = 1e-7;
  const items = tris.map((tri) => {
    const xs = [dot(tri.a, cam.right), dot(tri.b, cam.right), dot(tri.c, cam.right)];
    const ys = [dot(tri.a, cam.up), dot(tri.b, cam.up), dot(tri.c, cam.up)];
    const ds = [dot(tri.a, cam.forward), dot(tri.b, cam.forward), dot(tri.c, cam.forward)];
    return {
      tri,
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minY: Math.min(...ys) - pad,
      maxY: Math.max(...ys) + pad,
      minDepth: Math.min(...ds),
    };
  });
  return { ...cam, towardCamera: [-cam.forward[0], -cam.forward[1], -cam.forward[2]], items };
}

/**
 * A point is hidden when something lies strictly between it and the (orthographic) camera.
 * Faces passing through the point itself are ignored via the t > EPS threshold.
 */
export function isOccluded(point: Vec3, occ: OccluderSet): boolean {
  if (occ.items.length === 0) return false;
  const x = dot(point, occ.right);
  const y = dot(point, occ.up);
  const depth = dot(point, occ.forward);
  for (const it of occ.items) {
    if (x < it.minX || x > it.maxX || y < it.minY || y > it.maxY) continue;
    if (it.minDepth >= depth - EPS_T) continue; // the whole triangle is at or behind the point
    const t = rayTriangle(point, occ.towardCamera, it.tri);
    if (t !== null && t > EPS_T) return true;
  }
  return false;
}

export interface Run {
  t0: number;
  t1: number;
  hidden: boolean;
}

/**
 * Splits segment a→b into maximal visible / hidden runs (parameter t in [0, 1]).
 * Samples sub-interval midpoints, then refines every visibility change by bisection.
 */
export function classifySegment(a: Vec3, b: Vec3, occ: OccluderSet): Run[] {
  if (occ.items.length === 0) return [{ t0: 0, t1: 1, hidden: false }];
  const len = length(sub(b, a));
  const n = Math.max(8, Math.min(240, Math.ceil(len / 0.05)));
  const at = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hiddenAt = (t: number) => isOccluded(at(t), occ);

  const flags: boolean[] = [];
  for (let i = 0; i < n; i++) flags.push(hiddenAt((i + 0.5) / n));

  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || flags[i] !== flags[i - 1]) {
      // Refine the boundary between sample i-1 and sample i.
      let t1 = 1;
      if (i < n) {
        let lo = (i - 0.5) / n;
        let hi = (i + 0.5) / n;
        const loFlag = flags[i - 1];
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          if (hiddenAt(mid) === loFlag) lo = mid;
          else hi = mid;
        }
        t1 = (lo + hi) / 2;
      }
      runs.push({ t0: start, t1, hidden: flags[i - 1] });
      start = t1;
    }
  }
  return runs;
}
