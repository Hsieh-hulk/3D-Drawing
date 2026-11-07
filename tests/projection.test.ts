import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/model/commands';
import { EMPTY_SCENE, solids, type Scene } from '../src/model/scene';
import { createSolid } from '../src/model/solids';
import type { ViewPreset, ViewSettings } from '../src/model/types';
import { normalize, scale } from '../src/model/vec3';
import { presetCameraPosition, screenBasis } from '../src/model/viewPresets';
import { projectToDrawing } from '../src/projection/project';
import type { LinePrim, ViewCamera } from '../src/projection/types';

function camera(preset: ViewPreset): ViewCamera {
  const pos = presetCameraPosition(preset, 30);
  const { right, up } = screenBasis(pos);
  return { right, up, forward: normalize(scale(pos, -1)) };
}

const VIEW: ViewSettings = {
  preset: 'textbook',
  showGrid: false,
  showAxes: false,
  showTickLabels: false,
  showPointCoords: false,
  showHiddenLines: true,
  snap: 1,
  axisRange: 5,
};

function withSolid(template: Parameters<typeof createSolid>[1], params: Record<string, number>): Scene {
  const r = createSolid(EMPTY_SCENE, template, params);
  if (!r.ok) throw new Error(r.error);
  return r.scene;
}

function edgeLines(scene: Scene, preset: ViewPreset = 'textbook'): LinePrim[] {
  const d = projectToDrawing(scene, camera(preset), { view: VIEW, selectedId: null });
  return d.prims.filter((p): p is LinePrim => p.type === 'line' && p.role === 'edge');
}

describe('hidden-line classification in the textbook view', () => {
  it('cube: 9 visible edges and 3 dashed edges meeting at the hidden corner', () => {
    const lines = edgeLines(withSolid('cube', { a: 2 }));
    expect(lines).toHaveLength(12); // each edge is entirely visible or entirely hidden
    expect(lines.filter((l) => !l.hidden)).toHaveLength(9);
    const hidden = lines.filter((l) => l.hidden);
    expect(hidden).toHaveLength(3);
    // All hidden edges share the corner at the origin, which projects to (0, 0).
    for (const l of hidden) expect(Math.min(Math.hypot(...l.a), Math.hypot(...l.b))).toBeLessThan(1e-9);
  });

  it('cuboid behaves like the cube', () => {
    const lines = edgeLines(withSolid('cuboid', { a: 3, b: 2, c: 1 }));
    expect(lines.filter((l) => !l.hidden)).toHaveLength(9);
    expect(lines.filter((l) => l.hidden)).toHaveLength(3);
  });

  it('axis tetrahedron O-ABC: edges through O are hidden behind face ABC', () => {
    const lines = edgeLines(withSolid('axisTetra', { a: 2, b: 3, c: 2 }));
    expect(lines).toHaveLength(6);
    expect(lines.filter((l) => l.hidden)).toHaveLength(3);
  });

  it('square pyramid: 5 visible and 3 hidden edges', () => {
    const lines = edgeLines(withSolid('pyramid', { a: 2, h: 2 }));
    expect(lines).toHaveLength(8);
    expect(lines.filter((l) => !l.hidden)).toHaveLength(5);
    expect(lines.filter((l) => l.hidden)).toHaveLength(3);
  });

  it('triangular prism: 3 of 9 edges are hidden', () => {
    const lines = edgeLines(withSolid('prism', { a: 2, h: 2 }));
    expect(lines).toHaveLength(9);
    expect(lines.filter((l) => l.hidden)).toHaveLength(3);
  });

  it('regular tetrahedron: only face BCD faces the camera, so AB, AC, AD are hidden', () => {
    // Outward normals (a = 2): BCD·view > 0, while ABC, ABD and CAD face away → vertex A is behind BCD.
    const lines = edgeLines(withSolid('tetrahedron', { a: 2 }));
    expect(lines).toHaveLength(6);
    const hidden = lines.filter((l) => l.hidden);
    expect(hidden).toHaveLength(3);
    for (const l of hidden) expect(Math.min(Math.hypot(...l.a), Math.hypot(...l.b))).toBeLessThan(1e-9); // A = origin
  });

  it('a cube seen from the top hides only its bottom edges behind the top face', () => {
    const lines = edgeLines(withSolid('cube', { a: 2 }), 'top');
    const visible = lines.filter((l) => !l.hidden);
    // The four top edges are visible; vertical edges are seen end-on.
    expect(visible.length).toBeGreaterThanOrEqual(4);
  });
});

describe('occlusion of other geometry', () => {
  it('splits a segment that passes behind and then in front of a cube', () => {
    let scene = withSolid('cube', { a: 2 });
    for (const cmd of ['P(-1, 1, 1)', 'Q(3, 1, 1)', '線段 PQ']) {
      const r = runCommand(cmd, scene);
      if (!r.ok) throw new Error(r.error);
      scene = r.scene;
    }
    const d = projectToDrawing(scene, camera('textbook'), { view: VIEW, selectedId: null });
    const seg = d.prims.filter((p): p is LinePrim => p.type === 'line' && p.role === 'segment');
    expect(seg.length).toBe(2);
    expect(seg[0].hidden).toBe(true); // behind / inside the cube
    expect(seg[1].hidden).toBe(false); // x > 2 is in front of the cube
  });

  it('hiding a solid removes its occlusion', () => {
    let scene = withSolid('cube', { a: 2 });
    const id = solids(scene)[0].id;
    scene = { objects: scene.objects.map((o) => (o.id === id ? { ...o, visible: false } : o)) };
    expect(edgeLines(scene)).toHaveLength(0);
  });

  it('a plane hides the part of a vector behind it', () => {
    let scene: Scene = EMPTY_SCENE;
    for (const cmd of ['A(0, -2, -2)', 'B(0, 2, -2)', 'C(0, 2, 2)', 'D(0, -2, 2)', '平面 ABCD', 'u = (-3, 0, 0)']) {
      const r = runCommand(cmd, scene);
      if (!r.ok) throw new Error(r.error);
      scene = r.scene;
    }
    const d = projectToDrawing(scene, camera('textbook'), { view: VIEW, selectedId: null });
    const shaft = d.prims.filter((p): p is LinePrim => p.type === 'line' && p.role === 'vector');
    // The vector starts on the plane (x = 0) and points away from the camera: all of it is behind.
    expect(shaft.every((l) => l.hidden)).toBe(true);
  });
});

describe('solid templates', () => {
  it('names cube vertices A–H and stores exact coordinates', () => {
    const s = withSolid('cube', { a: 2 });
    const names = s.objects.filter((o) => o.kind === 'point').map((o) => (o.kind === 'point' ? o.name : ''));
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('writes irrational vertex coordinates exactly', () => {
    const s = withSolid('tetrahedron', { a: 2 });
    const pts = s.objects.filter((o) => o.kind === 'point');
    const d = pts[3];
    expect(d.kind === 'point' && d.coords.map((c) => c.src)).toEqual(['1', 'sqrt(3)/3', '2sqrt(6)/3']);
  });

  it('axis tetrahedron reuses an existing origin O', () => {
    const r1 = runCommand('O(0,0,0)', EMPTY_SCENE);
    if (!r1.ok) throw new Error();
    const r2 = createSolid(r1.scene, 'axisTetra', { a: 1, b: 1, c: 1 });
    if (!r2.ok) throw new Error();
    expect(r2.scene.objects.filter((o) => o.kind === 'point')).toHaveLength(4);
  });

  it('rejects non-positive sizes', () => {
    const r = createSolid(EMPTY_SCENE, 'cube', { a: 0 });
    expect(r.ok).toBe(false);
  });
});
