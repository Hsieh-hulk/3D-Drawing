import { describe, expect, it } from 'vitest';
import { addEquation, runCommand } from '../src/model/commands';
import { parseEquation, type Equation2D } from '../src/model/expr';
import { extrudeAlongZ, sampleEquation, simplifyPolyline } from '../src/model/equationSampler';
import { parseProject, serializeProject } from '../src/model/project';
import { EMPTY_SCENE, equations } from '../src/model/scene';
import { DEFAULT_VIEW } from '../src/store/useAppStore';

function eq(src: string): Equation2D {
  const r = parseEquation(src);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('sampleEquation', () => {
  it('draws x = 3 as one line along y on z = 0', () => {
    expect(sampleEquation(eq('x = 3'), 5)).toEqual([
      [
        [3, -5, 0],
        [3, 5, 0],
      ],
    ]);
  });

  it('samples y = f(x) over the range', () => {
    const lines = sampleEquation(eq('y = x^2'), 2, 40);
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toEqual([-2, 4, 0]);
    for (const [x, y, z] of lines[0]) {
      expect(y).toBeCloseTo(x * x);
      expect(z).toBe(0);
    }
  });

  it('keeps the dependent variable inside valueLimit', () => {
    const lines = sampleEquation(eq('y = x^2'), 5, 200, 5);
    const ys = lines.flat().map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(5);
    expect(Math.max(...ys)).toBeGreaterThan(4.5);
  });

  it('breaks the curve where it is undefined', () => {
    const lines = sampleEquation(eq('y = sqrt(x)'), 4, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0].every(([x]) => x >= 0)).toBe(true);
  });

  it('breaks at asymptotes instead of joining across them', () => {
    expect(sampleEquation(eq('y = 1/x'), 4, 81).length).toBe(2);
    expect(sampleEquation(eq('y = tan(x)'), 4, 400).length).toBeGreaterThanOrEqual(3);
  });
});

describe('simplifyPolyline / extrudeAlongZ', () => {
  it('collapses a straight line to its endpoints and extrudes it to one quad', () => {
    const line = simplifyPolyline(sampleEquation(eq('y = 2x + 1'), 3)[0]);
    expect(line).toHaveLength(2);
    const quads = extrudeAlongZ(line, 4);
    expect(quads).toHaveLength(1);
    expect(quads[0].map((p) => p[2])).toEqual([-4, -4, 4, 4]);
  });

  it('keeps curved points', () => {
    expect(simplifyPolyline(sampleEquation(eq('y = x^2'), 2, 30)[0]).length).toBe(31);
  });
});

describe('equation objects', () => {
  it('quick input adds equations, even when written like a vector', () => {
    const r = runCommand('y = (x + 1)', EMPTY_SCENE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(equations(r.scene)[0]).toMatchObject({ kind: 'equation', source: 'y = (x + 1)', extend3d: false });
    // A real component vector still wins.
    const v = runCommand('y = (1, 2, 3)', EMPTY_SCENE);
    expect(v.ok && v.scene.objects[0].kind).toBe('vector');
  });

  it('rejects unsupported equations with a specific message', () => {
    const r = runCommand('x^2 + y^2 = 4', EMPTY_SCENE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('目前只支援');
  });

  it('still lets points be named X or Y', () => {
    const r = runCommand('X = (1, 2, 3)', EMPTY_SCENE);
    expect(r.ok && r.scene.objects[0]).toMatchObject({ kind: 'point', name: 'X' });
  });

  it('round-trips through the project file and drops invalid ones', () => {
    const r = addEquation(EMPTY_SCENE, 'x = 3');
    if (!r.ok) throw new Error(r.error);
    const scene = { objects: r.scene.objects.map((o) => (o.kind === 'equation' ? { ...o, extend3d: true } : o)) };
    const text = serializeProject(scene, DEFAULT_VIEW);
    const loaded = parseProject(text);
    expect(loaded.ok && equations(loaded.scene)[0]).toMatchObject({ source: 'x = 3', extend3d: true });

    const bad = JSON.parse(text);
    bad.scene.objects[0].source = 'x^2 + y^2 = 4';
    const r2 = parseProject(JSON.stringify(bad));
    expect(r2.ok && r2.dropped).toBe(1);
  });
});
