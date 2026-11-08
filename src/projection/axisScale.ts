import type { Vec3 } from '../model/types';
import type { Bounds, Pt2, ViewCamera } from './types';

/**
 * Desmos-style automatic axis scaling: picks a "nice" tick step (1, 2, 5 × 10^n) for the current zoom,
 * formats tick labels without floating-point noise, and finds which part of each axis is on screen.
 * Pure functions, shared by the interactive viewport and the tests.
 */

/**
 * Smallest on-screen gap between neighbouring ticks; the 1-2-5 sequence keeps it below 2.5× this
 * (40–100 px). 40 keeps the familiar step of 1 at the default zoom of the textbook view.
 */
export const MIN_TICK_GAP_PX = 40;
/** Hard cap on ticks drawn per axis, whatever the zoom. */
export const MAX_TICKS_PER_AXIS = 200;
/** Hard cap on grid lines per direction. */
export const MAX_GRID_LINES = 200;

const NICE = [1, 2, 5, 10] as const;
/** Multipliers used to thin out ticks / labels / grid lines (keeps them on round values). */
const THIN = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const;

/** Removes binary floating-point noise, e.g. 0.30000000000000004 → 0.3. */
export function clean(v: number): number {
  const r = parseFloat(v.toPrecision(12));
  return Object.is(r, -0) ? 0 : r;
}

/** Smallest nice step (1, 2, 5 × 10^n) whose on-screen length is at least `minGapPx`. */
export function niceStep(pxPerUnit: number, minGapPx = MIN_TICK_GAP_PX): number {
  if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return 1;
  const raw = minGapPx / pxPerUnit;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  for (const m of NICE) {
    const s = clean(m * base);
    if (s >= raw * (1 - 1e-9)) return s;
  }
  return clean(10 * base);
}

/** Tick label text: as many decimals as the step needs, no float noise, exponent form for extreme values. */
export function formatTick(v: number, step: number): string {
  const c = clean(v);
  if (c === 0) return '0';
  const abs = Math.abs(c);
  if (abs >= 1e6 || abs < 1e-4) {
    return c
      .toExponential()
      .replace(/\.?0+e/, 'e')
      .replace('e+', 'e');
  }
  const decimals = step >= 1 ? 0 : Math.min(10, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  // Round to the step's precision, then drop trailing zeros like Desmos ("0.010" → "0.01", "1.0" → "1").
  const s = decimals > 0 ? c.toFixed(decimals).replace(/\.?0+$/, '') : c.toFixed(0);
  return s === '-0' ? '0' : s;
}

/** On-screen length (per world unit, in drawing units) of a coordinate axis. */
export function axisScreenLength(dir: Vec3, cam: ViewCamera): number {
  return Math.hypot(dir[0] * cam.right[0] + dir[1] * cam.right[1] + dir[2] * cam.right[2], dir[0] * cam.up[0] + dir[1] * cam.up[1] + dir[2] * cam.up[2]);
}

export const AXIS_DIRS: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * One tick step shared by all three axes (so x, y and z read on the same scale), chosen so the least
 * foreshortened axis gets ticks about MIN_TICK_GAP_PX apart.
 */
export function axisStep(cam: ViewCamera, pxPerUnit: number): number {
  const lref = Math.max(...AXIS_DIRS.map((d) => axisScreenLength(d, cam)), 0.2);
  return niceStep(pxPerUnit * lref);
}

/** Smallest thinning factor k so that k × gapPx ≥ minPx (k from 1, 2, 5, 10, …). */
export function thinFactor(gapPx: number, minPx: number): number {
  for (const k of THIN) if (gapPx * k >= minPx) return k;
  return THIN[THIN.length - 1];
}

/**
 * Parameter range [t0, t1] of the line t·d (through the origin, drawing space) inside `rect`,
 * or null when the line misses the rectangle. Slab method.
 */
export function lineRangeInRect(d: Pt2, rect: Bounds): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const slabs: [number, number, number][] = [
    [d[0], rect.minX, rect.maxX],
    [d[1], rect.minY, rect.maxY],
  ];
  for (const [dv, lo, hi] of slabs) {
    if (Math.abs(dv) < 1e-12) {
      if (lo > 0 || hi < 0) return null;
      continue;
    }
    let a = lo / dv;
    let b = hi / dv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

export function shrinkRect(r: Bounds, by: number): Bounds {
  return { minX: r.minX + by, minY: r.minY + by, maxX: r.maxX - by, maxY: r.maxY - by };
}

/**
 * Bounding box, in xy-plane coordinates, of the part of the plane z = 0 that projects into `rect`.
 * Null when the plane is seen (nearly) edge-on.
 */
export function xyPlaneRange(cam: ViewCamera, rect: Bounds): { x: [number, number]; y: [number, number] } | null {
  const px: Pt2 = [cam.right[0], cam.up[0]];
  const py: Pt2 = [cam.right[1], cam.up[1]];
  const det = px[0] * py[1] - px[1] * py[0];
  if (Math.abs(det) < 0.05) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [u, v] of [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.minX, rect.maxY],
    [rect.maxX, rect.maxY],
  ]) {
    xs.push((u * py[1] - v * py[0]) / det);
    ys.push((px[0] * v - px[1] * u) / det);
  }
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
}

/** Rough width in px of a tick label in the 11px sans tick font. */
export function tickLabelWidthPx(text: string): number {
  return text.length * 6.4 + 4;
}
