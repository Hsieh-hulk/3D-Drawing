import type { CommandResult } from './commands';
import { toExactText } from './expr';
import {
  POINT_COLOR,
  SOLID_COLOR,
  newId,
  nextPointName,
  pointByName,
  type Coords,
  type PointObj,
  type Scene,
  type SolidObj,
  type SolidTemplate,
} from './scene';
import type { Vec3 } from './types';

export interface TemplateParam {
  key: 'a' | 'b' | 'c' | 'h';
  label: string;
  default: number;
}

export interface TemplateSpec {
  template: SolidTemplate;
  label: string;
  params: TemplateParam[];
  /** Fixed vertex names (only the axis tetrahedron uses O for its first vertex). */
  build: (p: Record<string, number>) => { vertices: Vec3[]; faces: number[][]; fixedNames?: (string | null)[] };
}

const S3 = Math.sqrt(3);
const S6 = Math.sqrt(6);

export const TEMPLATES: TemplateSpec[] = [
  {
    template: 'cube',
    label: '正立方體',
    params: [{ key: 'a', label: '邊長', default: 2 }],
    build: ({ a }) => box(a, a, a),
  },
  {
    template: 'cuboid',
    label: '長方體',
    params: [
      { key: 'a', label: '長 (x)', default: 3 },
      { key: 'b', label: '寬 (y)', default: 2 },
      { key: 'c', label: '高 (z)', default: 2 },
    ],
    build: ({ a, b, c }) => box(a, b, c),
  },
  {
    template: 'axisTetra',
    label: '四面體 O-ABC（頂點在座標軸上）',
    params: [
      { key: 'a', label: 'A 在 x 軸', default: 2 },
      { key: 'b', label: 'B 在 y 軸', default: 3 },
      { key: 'c', label: 'C 在 z 軸', default: 2 },
    ],
    build: ({ a, b, c }) => ({
      vertices: [
        [0, 0, 0],
        [a, 0, 0],
        [0, b, 0],
        [0, 0, c],
      ],
      faces: [
        [0, 1, 2],
        [0, 1, 3],
        [0, 2, 3],
        [1, 2, 3],
      ],
      fixedNames: ['O', null, null, null],
    }),
  },
  {
    template: 'tetrahedron',
    label: '正四面體',
    params: [{ key: 'a', label: '邊長', default: 2 }],
    build: ({ a }) => ({
      vertices: [
        [0, 0, 0],
        [a, 0, 0],
        [a / 2, (a * S3) / 2, 0],
        [a / 2, (a * S3) / 6, (a * S6) / 3],
      ],
      faces: [
        [0, 1, 2],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    }),
  },
  {
    template: 'pyramid',
    label: '正四角錐',
    params: [
      { key: 'a', label: '底邊長', default: 2 },
      { key: 'h', label: '高', default: 2 },
    ],
    build: ({ a, h }) => ({
      vertices: [
        [0, 0, 0],
        [a, 0, 0],
        [a, a, 0],
        [0, a, 0],
        [a / 2, a / 2, h],
      ],
      faces: [
        [0, 1, 2, 3],
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    }),
  },
  {
    template: 'prism',
    label: '正三角柱',
    params: [
      { key: 'a', label: '底邊長', default: 2 },
      { key: 'h', label: '高', default: 2 },
    ],
    build: ({ a, h }) => ({
      vertices: [
        [0, 0, 0],
        [a, 0, 0],
        [a / 2, (a * S3) / 2, 0],
        [0, 0, h],
        [a, 0, h],
        [a / 2, (a * S3) / 2, h],
      ],
      faces: [
        [0, 1, 2],
        [3, 4, 5],
        [0, 1, 4, 3],
        [1, 2, 5, 4],
        [2, 0, 3, 5],
      ],
    }),
  },
];

/** Axis-aligned box with one corner at the origin. Vertex order: bottom ABCD, then top EFGH above them. */
function box(a: number, b: number, c: number) {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [a, 0, 0],
    [a, b, 0],
    [0, b, 0],
    [0, 0, c],
    [a, 0, c],
    [a, b, c],
    [0, b, c],
  ];
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return { vertices, faces };
}

export function templateSpec(t: SolidTemplate): TemplateSpec {
  return TEMPLATES.find((s) => s.template === t)!;
}

const toCoords = (p: Vec3): Coords =>
  p.map((value) => ({ src: toExactText(value), value })) as Coords;

/** Adds a solid (and its vertex points, auto-named) to the scene. */
export function createSolid(scene: Scene, template: SolidTemplate, params: Record<string, number>): CommandResult {
  const spec = templateSpec(template);
  for (const p of spec.params) {
    const v = params[p.key];
    if (!(Number.isFinite(v) && v > 0)) return { ok: false, error: `${p.label}必須是正數` };
    if (v > 20) return { ok: false, error: `${p.label}請小於等於 20` };
  }
  const { vertices, faces, fixedNames } = spec.build(params);

  const newPoints: PointObj[] = [];
  const vertexIds: string[] = [];
  const reserved: string[] = [];
  vertices.forEach((pos, i) => {
    const fixed = fixedNames?.[i];
    if (fixed) {
      const existing = pointByName(scene, fixed);
      if (existing && existing.coords.every((c, k) => Math.abs(c.value - pos[k]) < 1e-9)) {
        vertexIds.push(existing.id); // reuse O
        return;
      }
    }
    const name = fixed && !pointByName(scene, fixed) && !reserved.includes(fixed) ? fixed : nextPointName(scene, reserved);
    reserved.push(name);
    const id = newId('p');
    vertexIds.push(id);
    newPoints.push({ id, kind: 'point', name, color: POINT_COLOR, visible: true, coords: toCoords(pos) });
  });

  const solid: SolidObj = {
    id: newId('solid'),
    kind: 'solid',
    template,
    vertexIds,
    faces,
    color: SOLID_COLOR,
    visible: true,
  };
  return {
    ok: true,
    message: `已新增${spec.label.split('（')[0]}`,
    scene: { objects: [...scene.objects, ...newPoints, solid] },
  };
}
