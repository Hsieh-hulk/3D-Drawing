import { prettyExpr } from '../model/expr';
import { clipLineToCube } from '../model/geometry';
import {
  coordsValue,
  planes,
  pointPositions,
  points,
  segmentEndpoints,
  segments,
  solidEdges,
  solids,
  vectorEndpoints,
  vectorLabel,
  vectors,
  type Scene,
} from '../model/scene';
import type { Vec3, ViewSettings } from '../model/types';
import { dot, scale } from '../model/vec3';
import type { Bounds, Drawing, LabelPrim, LineRole, Prim, Pt2, ViewCamera } from './types';
import { classifySegment, isOccluded, prepareOccluders, triangulate, type Triangle } from './visibility';

export const AXIS_COLORS = { x: '#d1453b', y: '#2e9d5b', z: '#2f6fd6' } as const;
const GRID_COLOR = '#dfe3e8';
const GUIDE_COLOR = '#8a939d';
const AXIS_OVERHANG = 0.6;

export interface ProjectOptions {
  view: ViewSettings;
  selectedId: string | null;
}

export function projectPoint(p: Vec3, cam: ViewCamera): Pt2 {
  return [dot(p, cam.right), dot(p, cam.up)];
}

const len2 = (v: Pt2) => Math.hypot(v[0], v[1]);
const norm2 = (v: Pt2): Pt2 => {
  const l = len2(v);
  return l < 1e-12 ? [0, 0] : [v[0] / l, v[1] / l];
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Collects every face that can hide other geometry: visible solids and planes. */
export function collectOccluders(scene: Scene): Triangle[] {
  const tris: Triangle[] = [];
  for (const s of solids(scene)) {
    if (!s.visible) continue;
    const pos = pointPositions(scene, s.vertexIds);
    if (!pos) continue;
    for (const f of s.faces) tris.push(...triangulate(f.map((i) => pos[i])));
  }
  for (const pl of planes(scene)) {
    if (!pl.visible) continue;
    const pos = pointPositions(scene, pl.pointIds);
    if (pos) tris.push(...triangulate(pos));
  }
  return tris;
}

/**
 * Projects the scene to a list of 2D primitives with visible/hidden flags.
 * This is the single drawing model shared by the on-screen canvas and every export format.
 */
export function projectToDrawing(scene: Scene, cam: ViewCamera, opts: ProjectOptions): Drawing {
  const { view, selectedId } = opts;
  const prims: Prim[] = [];
  const occluders = prepareOccluders(collectOccluders(scene), cam);
  const P = (p: Vec3) => projectPoint(p, cam);

  /** Adds a 3D segment as visible/hidden runs. Returns the runs' last piece for arrow trimming. */
  const addSegment3 = (
    a: Vec3,
    b: Vec3,
    color: string,
    role: LineRole,
    extra: { objectId?: string; selected?: boolean; trimEndPx?: number; occlusion?: boolean } = {},
  ) => {
    const runs = extra.occlusion === false ? [{ t0: 0, t1: 1, hidden: false }] : classifySegment(a, b, occluders);
    runs.forEach((r, i) => {
      prims.push({
        type: 'line',
        a: P(lerp3(a, b, r.t0)),
        b: P(lerp3(a, b, r.t1)),
        hidden: r.hidden,
        color,
        role,
        objectId: extra.objectId,
        selected: extra.selected,
        trimEndPx: i === runs.length - 1 ? extra.trimEndPx : undefined,
      });
    });
  };

  // ---- grid (never occluded, drawn underneath everything) ----
  const R = view.axisRange;
  if (view.showGrid) {
    for (let i = -R; i <= R; i++) {
      addSegment3([i, -R, 0], [i, R, 0], GRID_COLOR, 'grid', { occlusion: false });
      addSegment3([-R, i, 0], [R, i, 0], GRID_COLOR, 'grid', { occlusion: false });
    }
  }

  // ---- translucent plane fills ----
  for (const pl of planes(scene)) {
    if (!pl.visible) continue;
    const pos = pointPositions(scene, pl.pointIds);
    if (!pos) continue;
    const depth = pos.reduce((s, p) => s + dot(p, cam.forward), 0) / pos.length;
    const selected = pl.id === selectedId;
    prims.push({ type: 'polygon', pts: pos.map(P), color: pl.color, opacity: selected ? 0.32 : 0.2, depth, objectId: pl.id, selected });
    pos.forEach((p, i) => addSegment3(p, pos[(i + 1) % pos.length], pl.color, 'plane-edge', { objectId: pl.id, selected }));
  }

  // ---- axes ----
  if (view.showAxes) {
    const axes: [keyof typeof AXIS_COLORS, Vec3][] = [
      ['x', [1, 0, 0]],
      ['y', [0, 1, 0]],
      ['z', [0, 0, 1]],
    ];
    for (const [name, dir] of axes) {
      const color = AXIS_COLORS[name];
      const tip = scale(dir, R + AXIS_OVERHANG);
      addSegment3(scale(dir, -R), tip, color, 'axis', { trimEndPx: 8 });
      const d2 = norm2(P(dir));
      if (len2(P(dir)) > 0.05) {
        prims.push({ type: 'arrow', tip: P(tip), dir: d2, color, role: 'axis', hidden: isOccluded(tip, occluders) });
      }
      prims.push({
        type: 'label',
        p: P(tip),
        text: name,
        style: 'axis',
        color,
        offsetPx: len2(P(dir)) > 0.05 ? [d2[0] * 14, d2[1] * 14] : [12, 12],
      });

      // Ticks + tick labels, placed on the side of the axis that faces down (or left for vertical axes).
      let across: Pt2 = [-d2[1], d2[0]];
      if (across[1] > 1e-6 || (Math.abs(across[1]) <= 1e-6 && across[0] > 0)) across = [-across[0], -across[1]];
      if (len2(P(dir)) > 0.05) {
        for (let i = -R; i <= R; i++) {
          if (i === 0) continue;
          const p = P(scale(dir, i));
          prims.push({ type: 'tick', p, across, color });
          if (view.showTickLabels) {
            prims.push({ type: 'label', p, text: String(i), style: 'tick', color: '#7a838d', offsetPx: [across[0] * 11, across[1] * 11] });
          }
        }
      }
    }
    prims.push({ type: 'label', p: [0, 0], text: 'O', style: 'origin', color: '#1d232b', offsetPx: [-9, -11] });
  }

  // ---- solids ----
  const vertexCentroid = new Map<string, Pt2>();
  for (const s of solids(scene)) {
    const pos = pointPositions(scene, s.vertexIds);
    if (!pos) continue;
    const c2 = P(scale(pos.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]] as Vec3, [0, 0, 0] as Vec3), 1 / pos.length));
    s.vertexIds.forEach((id) => vertexCentroid.has(id) || vertexCentroid.set(id, c2));
    if (!s.visible) continue;
    const selected = s.id === selectedId;
    for (const [i, j] of solidEdges(s)) addSegment3(pos[i], pos[j], s.color, 'edge', { objectId: s.id, selected });
  }

  // ---- segments / lines ----
  for (const sg of segments(scene)) {
    if (!sg.visible) continue;
    const e = segmentEndpoints(scene, sg);
    if (!e) continue;
    const ends = sg.infinite ? clipLineToCube(e.start, e.end, R * 1.6) : [e.start, e.end];
    if (!ends) continue;
    addSegment3(ends[0], ends[1], sg.color, 'segment', { objectId: sg.id, selected: sg.id === selectedId });
  }

  // ---- vectors ----
  for (const v of vectors(scene)) {
    if (!v.visible) continue;
    const e = vectorEndpoints(scene, v);
    if (!e) continue;
    const selected = v.id === selectedId;
    const d2 = [P(e.end)[0] - P(e.start)[0], P(e.end)[1] - P(e.start)[1]] as Pt2;
    const pointsAtViewer = len2(d2) < 1e-6;
    if (!pointsAtViewer) {
      addSegment3(e.start, e.end, v.color, 'vector', { objectId: v.id, selected, trimEndPx: 9 });
      const nearTip = lerp3(e.start, e.end, 0.999);
      prims.push({ type: 'arrow', tip: P(e.end), dir: norm2(d2), color: v.color, role: 'vector', hidden: isOccluded(nearTip, occluders), objectId: v.id, selected });
    }
    const u = norm2(d2);
    // Label beside the shaft on its upper/left side.
    let side: Pt2 = [-u[1], u[0]];
    if (side[1] < 0 || (side[1] === 0 && side[0] > 0)) side = [-side[0], -side[1]];
    prims.push({
      type: 'label',
      p: P(lerp3(e.start, e.end, 0.55)),
      text: vectorLabel(scene, v),
      style: 'vector',
      color: v.color,
      offsetPx: pointsAtViewer ? [12, 12] : [side[0] * 14, side[1] * 14],
      selected,
    });
  }

  // ---- point guide lines ----
  for (const p of points(scene)) {
    if (!p.visible || !p.guides) continue;
    const [x, y, z] = coordsValue(p.coords);
    const foot: Vec3 = [x, y, 0];
    const guide = (a: Vec3, b: Vec3) => {
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-9) {
        prims.push({ type: 'line', a: P(a), b: P(b), hidden: true, color: GUIDE_COLOR, role: 'guide', objectId: p.id });
      }
    };
    guide([x, y, z], foot);
    guide(foot, [x, 0, 0]);
    guide(foot, [0, y, 0]);
    if (Math.abs(z) > 1e-9) guide([x, y, z], [0, 0, z]);
  }

  // ---- points + labels ----
  for (const p of points(scene)) {
    if (!p.visible) continue;
    const pos = coordsValue(p.coords);
    const p2 = P(pos);
    const selected = p.id === selectedId;
    prims.push({ type: 'point', p: p2, color: p.color, hidden: isOccluded(pos, occluders), objectId: p.id, selected });
    if (p.name === 'O' && view.showAxes) continue; // the axes already print O
    const c = vertexCentroid.get(p.id);
    let dir: Pt2 = [0.6, 0.8];
    if (c) {
      const away = norm2([p2[0] - c[0], p2[1] - c[1]]);
      if (len2(away) > 0) dir = away;
    }
    const label: LabelPrim = {
      type: 'label',
      p: p2,
      text: p.name,
      sub: view.showPointCoords ? `(${p.coords.map((k) => prettyExpr(k.src)).join(', ')})` : undefined,
      style: 'point',
      color: p.color,
      offsetPx: [dir[0] * 13, dir[1] * 13],
      selected,
    };
    prims.push(label);
  }

  return { prims, bounds: computeBounds(prims) };
}

export function computeBounds(prims: Prim[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: Pt2) => {
    b.minX = Math.min(b.minX, p[0]);
    b.maxX = Math.max(b.maxX, p[0]);
    b.minY = Math.min(b.minY, p[1]);
    b.maxY = Math.max(b.maxY, p[1]);
  };
  for (const pr of prims) {
    switch (pr.type) {
      case 'line':
        add(pr.a);
        add(pr.b);
        break;
      case 'polygon':
        pr.pts.forEach(add);
        break;
      case 'arrow':
        add(pr.tip);
        break;
      default:
        add(pr.p);
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return b;
}
