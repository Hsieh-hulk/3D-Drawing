import type { Vec3 } from '../model/types';
import type { Drawing, LinePrim, PointPrim, PolygonPrim, Pt2, ViewCamera } from '../projection/types';
import { toPx, type PxTransform } from '../render2d/paint';

/** Inverse of toPx: canvas pixel → drawing space. */
export function screenToDrawing(t: PxTransform, x: number, y: number): Pt2 {
  return [t.origin[0] + (x - t.cx) / t.scale, t.origin[1] - (y - t.cy) / t.scale];
}

/**
 * Coordinate plane used for free dragging / placing: the xy-plane (z fixed) unless it is seen nearly
 * edge-on, in which case the coordinate plane that faces the camera best.
 * Returns the index of the coordinate that stays fixed.
 */
export function choosePlaneAxis(cam: ViewCamera): 0 | 1 | 2 {
  const f = cam.forward.map(Math.abs);
  if (f[2] >= 0.25) return 2;
  return f[0] >= f[1] ? 0 : 1;
}

/**
 * World point on the plane {coord[fixedAxis] = fixedValue} that projects to drawing point `d`.
 * Solves  dot(W, right) = d.x,  dot(W, up) = d.y  for the two free coordinates.
 */
export function solveOnPlane(d: Pt2, cam: ViewCamera, fixedAxis: 0 | 1 | 2, fixedValue: number): Vec3 | null {
  const [i, j] = ([0, 1, 2] as const).filter((k) => k !== fixedAxis) as [number, number];
  const r = cam.right;
  const u = cam.up;
  const bx = d[0] - r[fixedAxis] * fixedValue;
  const by = d[1] - u[fixedAxis] * fixedValue;
  const det = r[i] * u[j] - r[j] * u[i];
  if (Math.abs(det) < 1e-6) return null;
  const a = (bx * u[j] - by * r[j]) / det;
  const b = (r[i] * by - u[i] * bx) / det;
  const out = [0, 0, 0];
  out[fixedAxis] = fixedValue;
  out[i] = a;
  out[j] = b;
  return out as unknown as Vec3;
}

/** Moves along an axis by the pointer delta projected onto that axis' on-screen direction. */
export function axisDragDelta(deltaPx: Pt2, axisPxPerUnit: Pt2): number {
  const len2 = axisPxPerUnit[0] ** 2 + axisPxPerUnit[1] ** 2;
  if (len2 < 1e-9) return 0;
  return (deltaPx[0] * axisPxPerUnit[0] + deltaPx[1] * axisPxPerUnit[1]) / len2;
}

export function snapValue(v: number, step: number): number {
  if (step <= 0) return Math.round(v * 1e6) / 1e6;
  const s = Math.round(v / step) * step;
  const r = Math.round(s * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}

export interface Hit {
  id: string;
  kind: 'point' | 'line' | 'plane';
}

function distToSegment(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insidePolygon(p: Pt2, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Finds what is under a canvas pixel: points first, then lines/edges, then plane fills. */
export function hitTest(drawing: Drawing, t: PxTransform, x: number, y: number, radiusPx: number): Hit | null {
  const p: Pt2 = [x, y];
  let best: { hit: Hit; d: number } | null = null;
  for (const pr of drawing.prims) {
    if (pr.type !== 'point' || !pr.objectId) continue;
    const d = Math.hypot(...(toPx(t, (pr as PointPrim).p).map((v, i) => v - p[i]) as Pt2));
    if (d <= radiusPx && (!best || d < best.d)) best = { hit: { id: pr.objectId, kind: 'point' }, d };
  }
  if (best) return best.hit;

  const lineRadius = radiusPx * 0.6;
  for (const pr of drawing.prims) {
    if (pr.type !== 'line' || !pr.objectId || (pr as LinePrim).role === 'guide') continue;
    // A plane's outline often coincides with a segment/edge the student drew; the explicit object wins ties.
    const penalty = (pr as LinePrim).role === 'plane-edge' ? 3 : 0;
    const d = distToSegment(p, toPx(t, pr.a), toPx(t, pr.b)) + penalty;
    if (d <= lineRadius && (!best || d < best.d)) best = { hit: { id: pr.objectId, kind: 'line' }, d };
  }
  if (best) return best.hit;

  const polys = drawing.prims.filter((q): q is PolygonPrim => q.type === 'polygon' && !!q.objectId);
  polys.sort((a, b) => a.depth - b.depth); // nearest first
  for (const poly of polys) {
    if (insidePolygon(p, poly.pts.map((q) => toPx(t, q)))) return { id: poly.objectId!, kind: 'plane' };
  }
  return null;
}
