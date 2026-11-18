import type { Equation2D } from './expr';
import type { Vec3 } from './types';

/** Samples across the visible range; enough for smooth sin / x^2 curves at any zoom. */
export const EQUATION_SAMPLES = 400;

/**
 * Samples a 2D equation on the xy-plane (z = 0) over [-range, range] of its free variable.
 * Returns polylines: the curve is split wherever it is undefined (√ of a negative, 1/0), leaves the
 * plotting window, or jumps across an asymptote (tan x), so no false vertical lines are drawn.
 * `valueLimit` bounds the dependent variable (default 2 × range, so curves leave the screen smoothly);
 * surfaces pass `range` to stay inside the axis box.
 */
export function sampleEquation(
  eq: Equation2D,
  range: number,
  samples = EQUATION_SAMPLES,
  valueLimit = range * 2,
): Vec3[][] {
  const at = (t: number, v: number): Vec3 => (eq.solveFor === 'y' ? [t, v, 0] : [v, t, 0]);
  if (eq.constant) {
    const v = eq.fn(0);
    return Number.isFinite(v) && Math.abs(v) <= range ? [[at(-range, v), at(range, v)]] : [];
  }
  const limit = valueLimit;
  const lines: Vec3[][] = [];
  let cur: Vec3[] = [];
  let prev = NaN;
  const flush = () => {
    if (cur.length >= 2) lines.push(cur);
    cur = [];
  };
  for (let i = 0; i <= samples; i++) {
    const t = -range + (2 * range * i) / samples;
    const v = eq.fn(t);
    const valid = Number.isFinite(v) && Math.abs(v) <= limit;
    if (!valid || (cur.length > 0 && Math.abs(v - prev) > range)) flush();
    if (valid) cur.push(at(t, v));
    prev = v;
  }
  flush();
  return lines;
}

/** Drops interior points that lie on a straight line, so `x = 3` extends to a single quad, not 400. */
export function simplifyPolyline(pts: Vec3[], eps = 1e-9): Vec3[] {
  if (pts.length <= 2) return pts;
  const out: Vec3[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const scale = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross) / scale > eps) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * The surface swept by a z = 0 polyline along the z-axis over [-zRange, zRange], as quads
 * (counter-clockwise: bottom a → bottom b → top b → top a).
 */
export function extrudeAlongZ(pts: Vec3[], zRange: number): Vec3[][] {
  const quads: Vec3[][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    quads.push([
      [ax, ay, -zRange],
      [bx, by, -zRange],
      [bx, by, zRange],
      [ax, ay, zRange],
    ]);
  }
  return quads;
}
