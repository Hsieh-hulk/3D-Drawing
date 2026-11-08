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
import {
  AXIS_DIRS,
  MAX_GRID_LINES,
  MAX_TICKS_PER_AXIS,
  axisStep,
  clean,
  formatTick,
  lineRangeInRect,
  shrinkRect,
  thinFactor,
  tickLabelWidthPx,
  xyPlaneRange,
} from './axisScale';
import { classifySegment, isOccluded, prepareOccluders, triangulate, type OccluderSet, type Triangle } from './visibility';

export const AXIS_COLORS = { x: '#d1453b', y: '#2e9d5b', z: '#2f6fd6' } as const;
const GRID_COLOR = '#dfe3e8';
const GUIDE_COLOR = '#8a939d';
const AXIS_OVERHANG = 0.6;

/** Visible part of the drawing (drawing space) and its pixel scale, for zoom-dependent axes. */
export interface AxisWindow {
  rect: Bounds;
  pxPerUnit: number;
}

export interface ProjectOptions {
  view: ViewSettings;
  selectedId: string | null;
  /**
   * Omitted: fixed axes and grid from -axisRange to +axisRange (exports).
   * An AxisWindow: Desmos-style axes that fill the window with a zoom-dependent tick step.
   * 'none': no axes or grid (the caller adds projectAutoAxes() itself, e.g. to cache them separately).
   */
  axes?: AxisWindow | 'none';
  /** Half-size of the cube that clips infinite lines (default axisRange × 1.6). */
  lineExtent?: number;
  /** Pre-built occluders for this scene and camera (see sceneOccluders), to avoid rebuilding them. */
  occluders?: OccluderSet;
}

export function sceneOccluders(scene: Scene, cam: ViewCamera): OccluderSet {
  return prepareOccluders(collectOccluders(scene), cam);
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
  const occluders = opts.occluders ?? sceneOccluders(scene, cam);
  const fixedAxes = opts.axes === undefined;
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
  if (opts.axes && opts.axes !== 'none') prims.push(...projectAutoAxes(cam, view, occluders, opts.axes));
  if (fixedAxes && view.showGrid) {
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
  if (fixedAxes && view.showAxes) {
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
    s.faces.forEach((f, fi) => {
      const fill = s.faceColors?.[fi];
      if (!fill) return;
      const fp = f.map((i) => pos[i]);
      const depth = fp.reduce((acc, p) => acc + dot(p, cam.forward), 0) / fp.length;
      prims.push({ type: 'polygon', pts: fp.map(P), color: fill, opacity: selected ? 0.42 : 0.32, depth, objectId: s.id, selected });
    });
    for (const [i, j] of solidEdges(s)) addSegment3(pos[i], pos[j], s.color, 'edge', { objectId: s.id, selected });
  }

  // ---- segments / lines ----
  for (const sg of segments(scene)) {
    if (!sg.visible) continue;
    const e = segmentEndpoints(scene, sg);
    if (!e) continue;
    const ends = sg.infinite ? clipLineToCube(e.start, e.end, opts.lineExtent ?? R * 1.6) : [e.start, e.end];
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

/** Gap between the screen edge and the arrow tip of an auto axis, so the arrow and axis name stay visible. */
const AUTO_TIP_INSET_PX = 34;
const MIN_TICK_MARK_GAP_PX = 8;
const MIN_GRID_GAP_PX = 10;
const TICK_LABEL_HEIGHT_PX = 14;
const AXIS_NAMES = ['x', 'y', 'z'] as const;

/**
 * Desmos-style axes and grid for the interactive view: axes run across the whole window, ticks use one
 * nice step (1, 2, 5 × 10^n) for the current zoom, and ticks / labels / grid lines are thinned so they
 * never crowd. Uses the same primitives as the fixed axes, so painting is unchanged.
 */
export function projectAutoAxes(cam: ViewCamera, view: ViewSettings, occluders: OccluderSet, win: AxisWindow): Prim[] {
  const prims: Prim[] = [];
  const P = (p: Vec3) => projectPoint(p, cam);
  const ppu = win.pxPerUnit;
  const rect = win.rect;
  const step = axisStep(cam, ppu);

  // ---- grid on the xy-plane, covering the visible part of it ----
  if (view.showGrid) {
    const range = xyPlaneRange(cam, rect);
    if (range) {
      const px = P([1, 0, 0]);
      const py = P([0, 1, 0]);
      const det = Math.abs(px[0] * py[1] - px[1] * py[0]);
      // Perpendicular on-screen gap between neighbouring grid lines of each family.
      const gapX = (det / Math.max(len2(py), 1e-9)) * step * ppu;
      const gapY = (det / Math.max(len2(px), 1e-9)) * step * ppu;
      const family = (gap: number, span: number) => {
        const k = Math.max(thinFactor(gap, MIN_GRID_GAP_PX), thinFactor(1, span / step / MAX_GRID_LINES));
        return clean(step * k);
      };
      const gx = family(gapX, range.x[1] - range.x[0]);
      const gy = family(gapY, range.y[1] - range.y[0]);
      const [y0, y1] = range.y;
      const [x0, x1] = range.x;
      for (let i = Math.ceil(x0 / gx); i <= Math.floor(x1 / gx); i++) {
        const x = clean(i * gx);
        prims.push({ type: 'line', a: P([x, y0, 0]), b: P([x, y1, 0]), hidden: false, color: GRID_COLOR, role: 'grid' });
      }
      for (let i = Math.ceil(y0 / gy); i <= Math.floor(y1 / gy); i++) {
        const y = clean(i * gy);
        prims.push({ type: 'line', a: P([x0, y, 0]), b: P([x1, y, 0]), hidden: false, color: GRID_COLOR, role: 'grid' });
      }
    }
  }

  // ---- axes ----
  if (view.showAxes) {
    const outerRect = shrinkRect(rect, -2 / ppu);
    const innerRect = shrinkRect(rect, AUTO_TIP_INSET_PX / ppu);
    const innerOk = innerRect.maxX > innerRect.minX && innerRect.maxY > innerRect.minY;
    // Label boxes in px (centre, size), used to drop tick labels that would collide with another label.
    type Box = { c: Pt2; w: number; h: number };
    const taken: Box[] = [{ c: [-9, -11], w: 14, h: 18 }]; // "O"
    const tickLabels: { label: LabelPrim; box: Box }[] = [];
    const boxAt = (p: Pt2, off: Pt2, w: number, h: number): Box => ({ c: [p[0] * ppu + off[0], p[1] * ppu + off[1]], w, h });
    const overlaps = (a: Box, b: Box) => Math.abs(a.c[0] - b.c[0]) * 2 < a.w + b.w && Math.abs(a.c[1] - b.c[1]) * 2 < a.h + b.h;
    // Least foreshortened axis first, so its labels win collisions.
    const order = [0, 1, 2].sort((a, b) => len2(P(AXIS_DIRS[b])) - len2(P(AXIS_DIRS[a])));
    order.forEach((idx) => {
      const dir = AXIS_DIRS[idx];
      const name = AXIS_NAMES[idx];
      const color = AXIS_COLORS[name];
      const d = P(dir);
      const L = len2(d);
      if (L <= 0.05) {
        // Axis points (almost) straight at the viewer: only its name, next to the origin.
        prims.push({ type: 'label', p: [0, 0], text: name, style: 'axis', color, offsetPx: [12, 12] });
        return;
      }
      const outer = lineRangeInRect(d, outerRect);
      if (!outer) return; // axis entirely off screen
      const inner = innerOk ? lineRangeInRect(d, innerRect) : null;
      const t0 = outer[0];
      const t1 = inner && inner[1] > t0 ? inner[1] : outer[1];
      if (t1 <= t0) return;

      const u = norm2(d);
      const tip = scale(dir, t1);
      classifySegment(scale(dir, t0), tip, occluders).forEach((r, i, runs) => {
        prims.push({
          type: 'line',
          a: P(scale(dir, t0 + (t1 - t0) * r.t0)),
          b: P(scale(dir, t0 + (t1 - t0) * r.t1)),
          hidden: r.hidden,
          color,
          role: 'axis',
          trimEndPx: i === runs.length - 1 ? 8 : undefined,
        });
      });
      prims.push({ type: 'arrow', tip: P(tip), dir: u, color, role: 'axis', hidden: isOccluded(tip, occluders) });
      prims.push({ type: 'label', p: P(tip), text: name, style: 'axis', color, offsetPx: [u[0] * 14, u[1] * 14] });
      taken.push(boxAt(P(tip), [u[0] * 14, u[1] * 14], 16, 22));

      // Ticks + labels on the side of the axis that faces down (or left for vertical axes).
      let across: Pt2 = [-u[1], u[0]];
      if (across[1] > 1e-6 || (Math.abs(across[1]) <= 1e-6 && across[0] > 0)) across = [-across[0], -across[1]];
      const unitPx = L * ppu;
      const gapPx = step * unitPx;
      const i0 = Math.ceil(t0 / step);
      const i1 = Math.floor((t1 - 16 / unitPx) / step); // keep ticks clear of the arrowhead
      if (i1 < i0) return;
      const kTick = Math.max(thinFactor(gapPx, MIN_TICK_MARK_GAP_PX), thinFactor(1, (i1 - i0 + 1) / MAX_TICKS_PER_AXIS));
      const widest = Math.max(tickLabelWidthPx(formatTick(i0 * step, step)), tickLabelWidthPx(formatTick(i1 * step, step)));
      const needPx = Math.abs(u[0]) * widest + Math.abs(u[1]) * TICK_LABEL_HEIGHT_PX + 8;
      const kLabel = Math.max(thinFactor(gapPx, needPx), kTick);
      for (let i = i0; i <= i1; i++) {
        if (i === 0 || i % kTick !== 0) continue;
        const v = clean(i * step);
        const p = P(scale(dir, v));
        prims.push({ type: 'tick', p, across, color });
        if (view.showTickLabels && i % kLabel === 0) {
          const text = formatTick(v, step);
          const offsetPx: Pt2 = [across[0] * 11, across[1] * 11];
          tickLabels.push({
            label: { type: 'label', p, text, style: 'tick', color: '#7a838d', offsetPx },
            box: boxAt(p, offsetPx, tickLabelWidthPx(text), TICK_LABEL_HEIGHT_PX),
          });
        }
      }
    });
    for (const { label, box } of tickLabels) {
      if (taken.some((b) => overlaps(b, box))) continue;
      taken.push(box);
      prims.push(label);
    }
    prims.push({ type: 'label', p: [0, 0], text: 'O', style: 'origin', color: '#1d232b', offsetPx: [-9, -11] });
  }
  return prims;
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
