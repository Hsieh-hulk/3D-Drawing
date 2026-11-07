import { evaluate, normalizeInput, splitTopLevel } from './expr';
import type { Vec3 } from './types';
import { cross, dot, length, scale, sub } from './vec3';
import {
  PLANE_PALETTE,
  POINT_COLOR,
  SEGMENT_COLOR,
  coordsValue,
  newId,
  planes,
  nextPointName,
  nextVectorColor,
  pointByName,
  segments,
  vectorByName,
  vectors,
  type Coords,
  type PointObj,
  type Scene,
} from './scene';

/**
 * Quick-input commands understood by the text box:
 *   A(1, 2, 3)  /  A = (1, 2, 3)  /  (1, 2, 3)   → add or update a point (auto-named when no name)
 *   u = (1, -1, 2)                                → add or update a component vector from O
 *   AB  /  向量 AB  /  vec AB                      → vector from point A to point B
 *   線段 AB  /  seg AB                             → segment AB
 *   直線 AB  /  line AB                            → infinite line through A and B
 *   平面 ABC  /  平面 ABCD                         → translucent plane polygon through ≥3 coplanar points
 */
export type CommandResult = { ok: true; scene: Scene; message: string } | { ok: false; error: string };

const NAME = "[A-Z][0-9']*";
const POINT_RE = new RegExp(`^(${NAME})?\\s*=?\\s*\\((.*)\\)$`);
const COMP_VECTOR_RE = /^([a-z][0-9]*)\s*=\s*\((.*)\)$/;
// Keywords are matched case-sensitively on purpose: point names must stay upper-case.
const SEGMENT_RE = new RegExp(`^(線段|直線|segment|seg|line)\\s*(${NAME})\\s*(${NAME})$`);
const VECTOR_RE = new RegExp(`^(?:向量|vector|vec)?\\s*(${NAME})\\s*(${NAME})$`);
const PLANE_RE = new RegExp(`^(平面|plane)\\s*((?:${NAME}\\s*){3,})$`);
const NAME_G = new RegExp(NAME, 'g');

const AXIS_NAMES = ['x', 'y', 'z'];

export function parseCoords(body: string): { ok: true; coords: Coords } | { ok: false; error: string } {
  const parts = splitTopLevel(body);
  if (parts.length !== 3) return { ok: false, error: `需要 3 個座標 (x, y, z)，目前有 ${parts.length} 個` };
  const coords: { src: string; value: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const r = evaluate(parts[i]);
    if (!r.ok) return { ok: false, error: `${AXIS_NAMES[i]} 座標：${r.error}` };
    coords.push({ src: parts[i], value: r.value });
  }
  return { ok: true, coords: coords as Coords };
}

function missingPoint(name: string): string {
  return `找不到點 ${name}，請先輸入 ${name}(x, y, z)`;
}

export function runCommand(input: string, scene: Scene): CommandResult {
  // Normalize full-width characters, but keep case for point names (vector names are lower-case).
  const text = normalizeInput(input).trim();
  if (!text) return { ok: false, error: '請輸入內容，例如 A(1, 2, 3)' };

  let m = COMP_VECTOR_RE.exec(text);
  if (m) {
    const [, name, body] = m;
    const parsed = parseCoords(body);
    if (!parsed.ok) return parsed;
    const existing = vectorByName(scene, name);
    if (existing) {
      return {
        ok: true,
        message: `已更新向量 ${name}`,
        scene: {
          objects: scene.objects.map((o) =>
            o.id === existing.id && o.kind === 'vector'
              ? { ...o, def: { type: 'components', origin: o.def.type === 'components' ? o.def.origin : null, comps: parsed.coords } }
              : o,
          ),
        },
      };
    }
    return {
      ok: true,
      message: `已新增向量 ${name}`,
      scene: {
        objects: [
          ...scene.objects,
          {
            id: newId('v'),
            kind: 'vector',
            name,
            color: nextVectorColor(scene),
            visible: true,
            def: { type: 'components', origin: null, comps: parsed.coords },
          },
        ],
      },
    };
  }

  m = POINT_RE.exec(text);
  if (m) {
    const name = m[1] ?? nextPointName(scene);
    const parsed = parseCoords(m[2]);
    if (name === 'O') {
      if (parsed.ok && parsed.coords.every((c) => c.value === 0)) {
        return { ok: true, scene: withOrigin(scene, 'O'), message: '已加入原點 O' };
      }
      return { ok: false, error: 'O 保留給原點 (0, 0, 0)，請換一個名稱' };
    }
    if (!parsed.ok) return parsed;
    const existing = pointByName(scene, name);
    if (existing) {
      return {
        ok: true,
        message: `已更新點 ${name}`,
        scene: {
          objects: scene.objects.map((o) =>
            o.id === existing.id ? { ...existing, coords: parsed.coords } : o,
          ),
        },
      };
    }
    return {
      ok: true,
      message: `已新增點 ${name}`,
      scene: {
        objects: [
          ...scene.objects,
          { id: newId('p'), kind: 'point', name, color: POINT_COLOR, visible: true, coords: parsed.coords },
        ],
      },
    };
  }

  m = PLANE_RE.exec(text);
  if (m) return addPlane(scene, m[2].match(NAME_G) ?? []);

  m = SEGMENT_RE.exec(text);
  if (m) {
    const [, kindWord, an, bn] = m;
    return addSegment(scene, an, bn, kindWord === '直線' || kindWord === 'line');
  }

  m = VECTOR_RE.exec(text);
  if (m) return addPointVector(scene, m[1], m[2]);

  return {
    ok: false,
    error: '看不懂這個輸入。可以試試：A(1, 2, 3)、u = (1, -1, 2)、AB、線段 BC',
  };
}

/** Problems constantly use the origin O (向量 OA, 線段 OB), so referencing O creates O(0, 0, 0) on demand. */
function withOrigin(scene: Scene, ...names: string[]): Scene {
  if (!names.includes('O') || pointByName(scene, 'O')) return scene;
  const zero = { src: '0', value: 0 };
  return {
    objects: [
      { id: newId('p'), kind: 'point', name: 'O', color: POINT_COLOR, visible: true, coords: [zero, zero, zero] },
      ...scene.objects,
    ],
  };
}

export function addPointVector(scene: Scene, fromName: string, toName: string): CommandResult {
  scene = withOrigin(scene, fromName, toName);
  const a = pointByName(scene, fromName);
  const b = pointByName(scene, toName);
  if (!a) return { ok: false, error: missingPoint(fromName) };
  if (!b) return { ok: false, error: missingPoint(toName) };
  if (a.id === b.id) return { ok: false, error: '向量的起點與終點不能相同' };
  const dup = vectors(scene).some((v) => v.def.type === 'points' && v.def.from === a.id && v.def.to === b.id);
  if (dup) return { ok: false, error: `向量 ${a.name}${b.name} 已存在` };
  return {
    ok: true,
    message: `已新增向量 ${a.name}${b.name}`,
    scene: {
      objects: [
        ...scene.objects,
        {
          id: newId('v'),
          kind: 'vector',
          name: '',
          color: nextVectorColor(scene),
          visible: true,
          def: { type: 'points', from: a.id, to: b.id },
        },
      ],
    },
  };
}

export function addPlane(scene: Scene, names: string[]): CommandResult {
  scene = withOrigin(scene, ...names);
  if (names.length < 3) return { ok: false, error: '平面至少需要 3 個點' };
  if (new Set(names).size !== names.length) return { ok: false, error: '平面的點不能重複' };
  const pts: PointObj[] = [];
  for (const n of names) {
    const p = pointByName(scene, n);
    if (!p) return { ok: false, error: missingPoint(n) };
    pts.push(p);
  }
  const pos = pts.map((p) => coordsValue(p.coords));
  // Normal from the first non-collinear triple; every other point must lie on that plane.
  let normal: Vec3 | null = null;
  for (let i = 2; i < pos.length && !normal; i++) {
    const n = cross(sub(pos[1], pos[0]), sub(pos[i], pos[0]));
    if (length(n) > 1e-9) normal = n;
  }
  if (!normal) return { ok: false, error: '這些點在同一直線上，無法決定平面' };
  const unit = scale(normal, 1 / length(normal));
  if (pos.some((p) => Math.abs(dot(sub(p, pos[0]), unit)) > 1e-6)) {
    return { ok: false, error: '這些點不在同一個平面上' };
  }
  // Order the vertices around their centroid so "平面 ACBD" still gives a simple polygon.
  const centroid = scale(pos.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]] as Vec3, [0, 0, 0] as Vec3), 1 / pos.length);
  let u = sub(pos[0], centroid);
  if (length(u) < 1e-9) u = sub(pos[1], centroid);
  u = scale(u, 1 / length(u));
  const w = cross(unit, u);
  const angleOf = (p: Vec3) => Math.atan2(dot(sub(p, centroid), w), dot(sub(p, centroid), u));
  pts.sort((p, q) => angleOf(coordsValue(p.coords)) - angleOf(coordsValue(q.coords)));

  const label = pts.map((p) => p.name).join('');
  const dup = planes(scene).some(
    (pl) => pl.pointIds.length === pts.length && pts.every((p) => pl.pointIds.includes(p.id)),
  );
  if (dup) return { ok: false, error: `平面 ${label} 已存在` };
  return {
    ok: true,
    message: `已新增平面 ${label}`,
    scene: {
      objects: [
        ...scene.objects,
        {
          id: newId('pl'),
          kind: 'plane',
          pointIds: pts.map((p) => p.id),
          color: PLANE_PALETTE[planes(scene).length % PLANE_PALETTE.length],
          visible: true,
        },
      ],
    },
  };
}

export function addSegment(scene: Scene, aName: string, bName: string, infinite: boolean): CommandResult {
  scene = withOrigin(scene, aName, bName);
  const a = pointByName(scene, aName);
  const b = pointByName(scene, bName);
  const word = infinite ? '直線' : '線段';
  if (!a) return { ok: false, error: missingPoint(aName) };
  if (!b) return { ok: false, error: missingPoint(bName) };
  if (a.id === b.id) return { ok: false, error: `${word}需要兩個不同的點` };
  const dup = segments(scene).some(
    (s) => s.infinite === infinite && ((s.a === a.id && s.b === b.id) || (s.a === b.id && s.b === a.id)),
  );
  if (dup) return { ok: false, error: `${word} ${a.name}${b.name} 已存在` };
  return {
    ok: true,
    message: `已新增${word} ${a.name}${b.name}`,
    scene: {
      objects: [
        ...scene.objects,
        { id: newId('s'), kind: 'segment', a: a.id, b: b.id, infinite, color: SEGMENT_COLOR, visible: true },
      ],
    },
  };
}
