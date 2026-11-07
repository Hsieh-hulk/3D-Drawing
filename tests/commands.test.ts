import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/model/commands';
import {
  EMPTY_SCENE,
  nextPointName,
  pointByName,
  removeObject,
  segments,
  vectorComponents,
  vectorLabel,
  vectors,
  type Scene,
} from '../src/model/scene';

function run(scene: Scene, ...inputs: string[]): Scene {
  return inputs.reduce((s, input) => {
    const r = runCommand(input, s);
    if (!r.ok) throw new Error(`"${input}" failed: ${r.error}`);
    return r.scene;
  }, scene);
}

function fail(scene: Scene, input: string): string {
  const r = runCommand(input, scene);
  if (r.ok) throw new Error(`"${input}" should have failed`);
  return r.error;
}

describe('point commands', () => {
  it('adds a point with expressions, keeping the original text', () => {
    const s = run(EMPTY_SCENE, 'A(1, sqrt(3), 1/2)');
    const a = pointByName(s, 'A')!;
    expect(a.coords.map((c) => c.value)).toEqual([1, Math.sqrt(3), 0.5]);
    expect(a.coords[1].src).toBe('sqrt(3)');
  });

  it('accepts "A = (…)", full-width input and auto-naming', () => {
    const s = run(EMPTY_SCENE, 'A = (0,0,0)', 'B（１，２，３）', '(4,5,6)');
    expect(pointByName(s, 'B')!.coords.map((c) => c.value)).toEqual([1, 2, 3]);
    expect(pointByName(s, 'C')!.coords.map((c) => c.value)).toEqual([4, 5, 6]);
  });

  it('updates an existing point instead of duplicating it', () => {
    const s = run(EMPTY_SCENE, 'A(1,2,3)', 'A(3,2,1)');
    expect(s.objects).toHaveLength(1);
    expect(pointByName(s, 'A')!.coords.map((c) => c.value)).toEqual([3, 2, 1]);
  });

  it('rejects bad coordinates with a helpful message', () => {
    expect(fail(EMPTY_SCENE, 'A(1,2)')).toContain('需要 3 個座標');
    expect(fail(EMPTY_SCENE, 'A(1,2,1/0)')).toContain('z 座標：不能除以 0');
    expect(fail(EMPTY_SCENE, 'O(1,2,3)')).toContain('原點');
  });

  it('skips O when auto-naming', () => {
    const names = 'ABCDEFGHIJKLMN'.split('').map((n) => `${n}(0,0,0)`);
    const s = run(EMPTY_SCENE, ...names);
    expect(nextPointName(s)).toBe('P');
  });
});

describe('vector commands', () => {
  const base = run(EMPTY_SCENE, 'A(1,2,3)', 'B(4,6,3)');

  it('creates vector AB from two points', () => {
    for (const input of ['AB', '向量AB', 'vec AB']) {
      const s = run(base, input);
      const v = vectors(s)[0];
      expect(vectorLabel(s, v)).toBe('AB');
      expect(vectorComponents(s, v)).toEqual([3, 4, 0]);
    }
  });

  it('creates and updates component vectors', () => {
    let s = run(base, 'u = (1, -1, 2)');
    expect(vectorComponents(s, vectors(s)[0])).toEqual([1, -1, 2]);
    s = run(s, 'u=(0,0,1)');
    expect(vectors(s)).toHaveLength(1);
    expect(vectorComponents(s, vectors(s)[0])).toEqual([0, 0, 1]);
  });

  it('reports missing points, duplicates and degenerate vectors', () => {
    expect(fail(base, 'AC')).toContain('找不到點 C');
    expect(fail(base, 'AA')).toContain('不能相同');
    expect(fail(run(base, 'AB'), 'AB')).toContain('已存在');
  });

  it('creates the origin O on demand for OA / 線段 OB', () => {
    const s = run(base, 'OA', '線段 OB');
    const o = pointByName(s, 'O')!;
    expect(o.coords.map((c) => c.value)).toEqual([0, 0, 0]);
    expect(vectorComponents(s, vectors(s)[0])).toEqual([1, 2, 3]);
    expect(s.objects.filter((x) => x.kind === 'point')).toHaveLength(3); // O created once
    expect(run(EMPTY_SCENE, 'O(0,0,0)').objects).toHaveLength(1);
  });

  it('keeps vector AB in sync when a point moves', () => {
    const s = run(base, 'AB', 'B(1,2,5)');
    expect(vectorComponents(s, vectors(s)[0])).toEqual([0, 0, 2]);
  });
});

describe('segments and removal', () => {
  const base = run(EMPTY_SCENE, 'A(0,0,0)', 'B(1,0,0)', 'C(0,1,0)');

  it('adds segments and lines', () => {
    const s = run(base, '線段 AB', '直線 BC', 'seg CA');
    const segs = segments(s);
    expect(segs.map((x) => x.infinite)).toEqual([false, true, false]);
    expect(fail(s, '線段 BA')).toContain('已存在');
  });

  it('removing a point removes the vectors and segments built on it', () => {
    let s = run(base, 'AB', '線段 BC', 'u=(1,1,1)');
    s = removeObject(s, pointByName(s, 'B')!.id);
    expect(s.objects.map((o) => o.kind)).toEqual(['point', 'point', 'vector']);
  });

  it('adds planes, ordering the vertices into a simple polygon', () => {
    let s = run(base, 'D(1,1,0)', '平面 ABDC');
    const plane = s.objects.find((o) => o.kind === 'plane');
    expect(plane?.kind === 'plane' && plane.pointIds.length).toBe(4);
    expect(fail(s, '平面 ABCD')).toContain('已存在');
    s = run(s, 'E(2,0,0)', 'F(0,0,1)');
    expect(fail(s, '平面 ABE')).toContain('同一直線');
    expect(fail(s, '平面 ABCF')).toContain('不在同一個平面');
  });

  it('gives a hint for unknown input', () => {
    expect(fail(base, 'hello world')).toContain('看不懂');
    expect(fail(base, '   ')).toContain('請輸入內容');
  });
});
