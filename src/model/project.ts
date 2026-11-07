import { evaluate, formatNumber } from './expr';
import {
  POINT_NAME_RE,
  VECTOR_NAME_RE,
  type Coord,
  type Coords,
  type PlaneObj,
  type PointObj,
  type Scene,
  type SceneObject,
  type SegmentObj,
  type SolidObj,
  type SolidTemplate,
  type VectorObj,
} from './scene';
import type { ViewPreset, ViewSettings } from './types';

/** File / localStorage format. Bump `version` and add a migration when the shape changes. */
export const PROJECT_APP = 'space-vector-3d';
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  app: typeof PROJECT_APP;
  version: number;
  savedAt: string;
  scene: Scene;
  view: Partial<ViewSettings>;
}

export function serializeProject(scene: Scene, view: ViewSettings, now = new Date()): string {
  const file: ProjectFile = { app: PROJECT_APP, version: PROJECT_VERSION, savedAt: now.toISOString(), scene, view };
  return JSON.stringify(file, null, 2);
}

export type ParseResult =
  | { ok: true; scene: Scene; view: Partial<ViewSettings>; dropped: number }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const COLOR_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const color = (v: unknown, fallback: string) => (isStr(v) && COLOR_RE.test(v) ? v : fallback);
const TEMPLATES: SolidTemplate[] = ['cube', 'cuboid', 'tetrahedron', 'axisTetra', 'pyramid', 'prism'];
const PRESETS: ViewPreset[] = ['textbook', 'front', 'top', 'right'];

function coord(v: unknown): Coord | null {
  if (!isObj(v)) return null;
  const src = isStr(v.src) ? v.src.slice(0, 64) : null;
  // Prefer re-evaluating the student's expression; fall back to the stored number.
  if (src !== null) {
    const r = evaluate(src);
    if (r.ok) return { src, value: r.value };
  }
  if (typeof v.value === 'number' && Number.isFinite(v.value)) return { src: formatNumber(v.value), value: v.value };
  return null;
}

function coords(v: unknown): Coords | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const c = v.map(coord);
  return c.every(Boolean) ? (c as Coords) : null;
}

/**
 * Validates untrusted JSON (a file the student picked, or old localStorage) and rebuilds a clean scene.
 * Invalid objects, and objects referring to missing points, are dropped rather than failing the whole load.
 */
export function parseProject(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '檔案不是有效的 JSON' };
  }
  if (!isObj(data) || data.app !== PROJECT_APP) return { ok: false, error: '這不是空間向量繪圖的專案檔' };
  if (typeof data.version !== 'number' || data.version > PROJECT_VERSION) {
    return { ok: false, error: '專案檔版本較新，請更新網頁後再開啟' };
  }
  if (!isObj(data.scene) || !Array.isArray(data.scene.objects)) return { ok: false, error: '專案檔缺少場景資料' };

  const raw = data.scene.objects as unknown[];
  if (raw.length > 2000) return { ok: false, error: '專案檔物件數量過多' };
  let dropped = 0;
  const ids = new Set<string>();
  const pointIds = new Set<string>();
  const names = new Set<string>();
  const out: SceneObject[] = [];
  const validPoints = new Map<unknown, PointObj>();

  // Pass 1: validate points (everything else refers to them).
  for (const o of raw) {
    if (!isObj(o) || o.kind !== 'point') continue;
    const c = coords(o.coords);
    if (!isStr(o.id) || ids.has(o.id) || !isStr(o.name) || !POINT_NAME_RE.test(o.name) || names.has(o.name) || !c) {
      dropped++;
      continue;
    }
    const p: PointObj = { id: o.id, kind: 'point', name: o.name, coords: c, color: color(o.color, '#1d232b'), visible: o.visible !== false };
    if (o.guides === true) p.guides = true;
    ids.add(o.id);
    pointIds.add(o.id);
    names.add(o.name);
    validPoints.set(o, p);
  }

  const ref = (v: unknown): v is string => isStr(v) && pointIds.has(v);

  // Pass 2: emit everything in the original order, validating objects built on points.
  for (const o of raw) {
    const point = validPoints.get(o);
    if (point) {
      out.push(point);
      continue;
    }
    if (isObj(o) && o.kind === 'point') continue; // invalid point, already counted
    if (!isObj(o)) {
      dropped++;
      continue;
    }
    if (!isStr(o.id) || ids.has(o.id)) {
      dropped++;
      continue;
    }
    const base = { id: o.id, color: color(o.color, '#1d232b'), visible: o.visible !== false };
    let obj: SceneObject | null = null;
    if (o.kind === 'vector' && isObj(o.def)) {
      const d = o.def;
      if (d.type === 'points' && ref(d.from) && ref(d.to) && d.from !== d.to) {
        obj = { ...base, kind: 'vector', name: '', def: { type: 'points', from: d.from, to: d.to } } satisfies VectorObj;
      } else if (d.type === 'components' && isStr(o.name) && VECTOR_NAME_RE.test(o.name)) {
        const comps = coords(d.comps);
        const origin = d.origin === null || d.origin === undefined ? null : ref(d.origin) ? d.origin : undefined;
        if (comps && origin !== undefined) {
          obj = { ...base, kind: 'vector', name: o.name, def: { type: 'components', origin, comps } } satisfies VectorObj;
        }
      }
    } else if (o.kind === 'segment' && ref(o.a) && ref(o.b) && o.a !== o.b) {
      obj = { ...base, kind: 'segment', a: o.a, b: o.b, infinite: isBool(o.infinite) && o.infinite } satisfies SegmentObj;
    } else if (o.kind === 'plane' && Array.isArray(o.pointIds) && o.pointIds.length >= 3 && o.pointIds.every(ref)) {
      obj = { ...base, kind: 'plane', pointIds: [...(o.pointIds as string[])] } satisfies PlaneObj;
    } else if (
      o.kind === 'solid' &&
      isStr(o.template) &&
      TEMPLATES.includes(o.template as SolidTemplate) &&
      Array.isArray(o.vertexIds) &&
      o.vertexIds.every(ref) &&
      Array.isArray(o.faces)
    ) {
      const n = o.vertexIds.length;
      const faces = o.faces as unknown[];
      const valid = faces.every(
        (f) => Array.isArray(f) && f.length >= 3 && f.every((i) => Number.isInteger(i) && i >= 0 && i < n),
      );
      if (valid && faces.length >= 4) {
        obj = {
          ...base,
          kind: 'solid',
          template: o.template as SolidTemplate,
          vertexIds: [...(o.vertexIds as string[])],
          faces: (faces as number[][]).map((f) => [...f]),
        } satisfies SolidObj;
      }
    }
    if (obj) {
      ids.add(obj.id);
      out.push(obj);
    } else dropped++;
  }

  // View: copy only known keys with the right types.
  const view: Partial<ViewSettings> = {};
  if (isObj(data.view)) {
    const v = data.view;
    if (isStr(v.preset) && PRESETS.includes(v.preset as ViewPreset)) view.preset = v.preset as ViewPreset;
    for (const k of ['showGrid', 'showAxes', 'showTickLabels', 'showPointCoords', 'showHiddenLines'] as const) {
      if (isBool(v[k])) view[k] = v[k];
    }
    if (v.snap === 0 || v.snap === 0.5 || v.snap === 1) view.snap = v.snap;
  }

  return { ok: true, scene: { objects: out }, view, dropped };
}
