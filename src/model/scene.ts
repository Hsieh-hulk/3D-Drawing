import type { Vec3 } from './types';
import { sub } from './vec3';

/** A coordinate keeps the student's original text (e.g. "√3/2") next to its numeric value. */
export interface Coord {
  src: string;
  value: number;
}
export type Coords = [Coord, Coord, Coord];

interface BaseObj {
  id: string;
  color: string;
  visible: boolean;
}

export interface PointObj extends BaseObj {
  kind: 'point';
  name: string;
  coords: Coords;
  /** Draw dashed guide lines to the xy-plane and the axes (helps read off coordinates). */
  guides?: boolean;
}

export type VectorDef =
  /** Vector AB defined by two existing points. */
  | { type: 'points'; from: string; to: string }
  /** Vector given by components, drawn from `origin` (a point id) or from O when null. */
  | { type: 'components'; origin: string | null; comps: Coords };

export interface VectorObj extends BaseObj {
  kind: 'vector';
  /** Lower-case name for component vectors (u, v…); empty for point-defined vectors (label derived as AB). */
  name: string;
  def: VectorDef;
}

export interface SegmentObj extends BaseObj {
  kind: 'segment';
  a: string;
  b: string;
  /** true → infinite line through a and b (drawn clipped to the view). */
  infinite: boolean;
}

/** Planar polygon through ≥3 existing points, drawn translucent. It also hides what lies behind it. */
export interface PlaneObj extends BaseObj {
  kind: 'plane';
  pointIds: string[];
}

export type SolidTemplate = 'cube' | 'cuboid' | 'tetrahedron' | 'axisTetra' | 'pyramid' | 'prism';

/** Polyhedron whose vertices are ordinary scene points (so students can reuse them for vectors). */
export interface SolidObj extends BaseObj {
  kind: 'solid';
  template: SolidTemplate;
  vertexIds: string[];
  /** Each face lists indices into `vertexIds`, in boundary order. */
  faces: number[][];
  /** Optional fill colour per face (same order as `faces`); null / missing = no fill. */
  faceColors?: (string | null)[];
}

export type SceneObject = PointObj | VectorObj | SegmentObj | PlaneObj | SolidObj;

export interface Scene {
  objects: SceneObject[];
}

export const EMPTY_SCENE: Scene = { objects: [] };

export const POINT_NAME_RE = /^[A-Z][0-9']*$/;
export const VECTOR_NAME_RE = /^[a-z][0-9]*$/;

export const POINT_COLOR = '#1d232b';
export const SEGMENT_COLOR = '#1d232b';
export const VECTOR_PALETTE = ['#2f6fd6', '#d1453b', '#2e9d5b', '#8e44c9', '#d9821e', '#0f93a6'];

let idCounter = 0;
/** Works on non-secure origins too (iPad opening the dev server over LAN has no crypto.randomUUID). */
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export const coordsValue = (c: Coords): Vec3 => [c[0].value, c[1].value, c[2].value];

export const points = (scene: Scene): PointObj[] =>
  scene.objects.filter((o): o is PointObj => o.kind === 'point');
export const vectors = (scene: Scene): VectorObj[] =>
  scene.objects.filter((o): o is VectorObj => o.kind === 'vector');
export const segments = (scene: Scene): SegmentObj[] =>
  scene.objects.filter((o): o is SegmentObj => o.kind === 'segment');
export const planes = (scene: Scene): PlaneObj[] =>
  scene.objects.filter((o): o is PlaneObj => o.kind === 'plane');
export const solids = (scene: Scene): SolidObj[] =>
  scene.objects.filter((o): o is SolidObj => o.kind === 'solid');

export const PLANE_PALETTE = ['#5b8def', '#e9a23b', '#4fb37a', '#b872d9'];
export const SOLID_COLOR = '#1d232b';
/** Colours offered by the colour pickers for planes and solid faces. */
export const FILL_PALETTE = ['#5b8def', '#e9a23b', '#4fb37a', '#b872d9', '#e5534b', '#2bb3c0', '#f2c94c', '#8a94a3'];

/** Resolves a list of point ids to positions; null if any point is missing. */
export function pointPositions(scene: Scene, ids: string[]): Vec3[] | null {
  const out: Vec3[] = [];
  for (const id of ids) {
    const p = findPoint(scene, id);
    if (!p) return null;
    out.push(coordsValue(p.coords));
  }
  return out;
}

/** Unique undirected edges of a polyhedron, as index pairs into `vertexIds`. */
export function solidEdges(solid: Pick<SolidObj, 'faces'>): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const face of solid.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return edges;
}

const SOLID_NAMES: Record<SolidTemplate, string> = {
  cube: '正立方體',
  cuboid: '長方體',
  tetrahedron: '正四面體',
  axisTetra: '四面體',
  pyramid: '正四角錐',
  prism: '三角柱',
};

export function solidTitle(scene: Scene, s: SolidObj): string {
  const names = s.vertexIds.map((id) => findPoint(scene, id)?.name ?? '?');
  let label: string;
  switch (s.template) {
    case 'cube':
    case 'cuboid':
      label = `${names.slice(0, 4).join('')}-${names.slice(4).join('')}`;
      break;
    case 'prism':
      label = `${names.slice(0, 3).join('')}-${names.slice(3).join('')}`;
      break;
    case 'pyramid':
      label = `${names[4]}-${names.slice(0, 4).join('')}`;
      break;
    default:
      label = names.join('');
  }
  return `${SOLID_NAMES[s.template]} ${label}`;
}

export function planeLabel(scene: Scene, p: PlaneObj): string {
  return p.pointIds.map((id) => findPoint(scene, id)?.name ?? '?').join('');
}

/** Short human-readable name of any object (used in buttons and confirmations). */
export function objectName(scene: Scene, o: SceneObject): string {
  switch (o.kind) {
    case 'point':
      return `點 ${o.name}`;
    case 'vector':
      return `向量 ${vectorLabel(scene, o)}`;
    case 'segment':
      return `${o.infinite ? '直線' : '線段'} ${segmentLabel(scene, o)}`;
    case 'plane':
      return `平面 ${planeLabel(scene, o)}`;
    case 'solid':
      return solidTitle(scene, o);
  }
}

export function findPoint(scene: Scene, id: string): PointObj | undefined {
  const o = scene.objects.find((x) => x.id === id);
  return o?.kind === 'point' ? o : undefined;
}

export function pointByName(scene: Scene, name: string): PointObj | undefined {
  return points(scene).find((p) => p.name === name);
}

export function vectorByName(scene: Scene, name: string): VectorObj | undefined {
  return vectors(scene).find((v) => v.name === name);
}

export interface Endpoints {
  start: Vec3;
  end: Vec3;
}

export function vectorEndpoints(scene: Scene, v: VectorObj): Endpoints | null {
  if (v.def.type === 'points') {
    const a = findPoint(scene, v.def.from);
    const b = findPoint(scene, v.def.to);
    if (!a || !b) return null;
    return { start: coordsValue(a.coords), end: coordsValue(b.coords) };
  }
  let origin: Vec3 = [0, 0, 0];
  if (v.def.origin) {
    const o = findPoint(scene, v.def.origin);
    if (o) origin = coordsValue(o.coords);
  }
  const c = coordsValue(v.def.comps);
  return { start: origin, end: [origin[0] + c[0], origin[1] + c[1], origin[2] + c[2]] };
}

export function vectorComponents(scene: Scene, v: VectorObj): Vec3 | null {
  const e = vectorEndpoints(scene, v);
  return e ? sub(e.end, e.start) : null;
}

/** Display label without the arrow (the arrow is drawn above the text by the renderer/UI). */
export function vectorLabel(scene: Scene, v: VectorObj): string {
  if (v.def.type === 'points') {
    const a = findPoint(scene, v.def.from);
    const b = findPoint(scene, v.def.to);
    return `${a?.name ?? '?'}${b?.name ?? '?'}`;
  }
  return v.name;
}

export function segmentEndpoints(scene: Scene, s: SegmentObj): Endpoints | null {
  const a = findPoint(scene, s.a);
  const b = findPoint(scene, s.b);
  if (!a || !b) return null;
  return { start: coordsValue(a.coords), end: coordsValue(b.coords) };
}

export function segmentLabel(scene: Scene, s: SegmentObj): string {
  return `${findPoint(scene, s.a)?.name ?? '?'}${findPoint(scene, s.b)?.name ?? '?'}`;
}

/** Objects that reference the given point and must be removed with it. */
export function dependentsOf(scene: Scene, pointId: string): SceneObject[] {
  return scene.objects.filter((o) => {
    if (o.kind === 'vector') {
      return o.def.type === 'points'
        ? o.def.from === pointId || o.def.to === pointId
        : o.def.origin === pointId;
    }
    if (o.kind === 'segment') return o.a === pointId || o.b === pointId;
    if (o.kind === 'plane') return o.pointIds.includes(pointId);
    if (o.kind === 'solid') return o.vertexIds.includes(pointId);
    return false;
  });
}

/**
 * Removes an object.
 * - Removing a point also removes everything built on it.
 * - Removing a solid also removes its vertices, except vertices still used by something else.
 */
export function removeObject(scene: Scene, id: string): Scene {
  const target = scene.objects.find((o) => o.id === id);
  if (!target) return scene;
  const doomed = new Set([id]);
  if (target.kind === 'point') dependentsOf(scene, id).forEach((o) => doomed.add(o.id));
  if (target.kind === 'solid') {
    for (const vid of target.vertexIds) {
      const usedElsewhere = dependentsOf(scene, vid).some((o) => o.id !== id);
      if (!usedElsewhere) doomed.add(vid);
    }
  }
  return { objects: scene.objects.filter((o) => !doomed.has(o.id)) };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Next unused point name: A…Z, then A1…Z1, A2… (skips O, which is reserved for the origin). */
export function nextPointName(scene: Scene, reserved: Iterable<string> = []): string {
  const used = new Set([...points(scene).map((p) => p.name), ...reserved]);
  for (let round = 0; ; round++) {
    for (const l of LETTERS) {
      if (l === 'O') continue;
      const name = round === 0 ? l : `${l}${round}`;
      if (!used.has(name)) return name;
    }
  }
}

const VECTOR_LETTERS = 'uvwabcdpqrst';

export function nextVectorName(scene: Scene): string {
  const used = new Set(vectors(scene).map((v) => v.name));
  for (let round = 0; ; round++) {
    for (const l of VECTOR_LETTERS) {
      const name = round === 0 ? l : `${l}${round}`;
      if (!used.has(name)) return name;
    }
  }
}

export function nextVectorColor(scene: Scene): string {
  return VECTOR_PALETTE[vectors(scene).length % VECTOR_PALETTE.length];
}
