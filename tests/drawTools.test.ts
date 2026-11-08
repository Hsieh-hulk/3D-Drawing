import { beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/model/commands';
import { parseProject, serializeProject } from '../src/model/project';
import { EMPTY_SCENE, planes, pointByName, segments, solids, type Scene } from '../src/model/scene';
import { createSolid } from '../src/model/solids';
import { normalize, scale } from '../src/model/vec3';
import { presetCameraPosition, screenBasis } from '../src/model/viewPresets';
import { projectToDrawing } from '../src/projection/project';
import type { PolygonPrim, ViewCamera } from '../src/projection/types';
import { DEFAULT_VIEW, useAppStore } from '../src/store/useAppStore';

function cam(): ViewCamera {
  const pos = presetCameraPosition('textbook', 30);
  const { right, up } = screenBasis(pos);
  return { right, up, forward: normalize(scale(pos, -1)) };
}

function withPoints(): Scene {
  let s: Scene = EMPTY_SCENE;
  for (const c of ['A(0,0,0)', 'B(2,0,0)', 'C(2,2,0)', 'D(0,2,0)', 'E(0,0,3)']) {
    const r = runCommand(c, s);
    if (!r.ok) throw new Error(r.error);
    s = r.scene;
  }
  return s;
}

const id = (s: Scene, n: string) => pointByName(s, n)!.id;

beforeEach(() => {
  useAppStore.setState({ scene: withPoints(), past: [], future: [], drawTool: null, faceDraft: [], toolMessage: null });
});

describe('line tool', () => {
  it('connects two points with one undoable segment', () => {
    const st = useAppStore.getState();
    const s = st.scene;
    expect(st.connectPoints(id(s, 'A'), id(s, 'B')).ok).toBe(true);
    expect(segments(useAppStore.getState().scene)).toHaveLength(1);
    expect(st.connectPoints(id(s, 'B'), id(s, 'A')).ok).toBe(false); // duplicate
    useAppStore.getState().undo();
    expect(segments(useAppStore.getState().scene)).toHaveLength(0);
  });
});

describe('face tool', () => {
  it('builds a plane by picking points and closing on the first one', () => {
    const st = useAppStore.getState();
    const s = st.scene;
    st.setDrawTool('face');
    for (const n of ['A', 'B', 'C', 'D']) useAppStore.getState().toggleFaceVertex(id(s, n));
    expect(useAppStore.getState().faceDraft).toHaveLength(4);
    useAppStore.getState().toggleFaceVertex(id(s, 'A'));
    const state = useAppStore.getState();
    expect(planes(state.scene)).toHaveLength(1);
    expect(state.faceDraft).toEqual([]);
    expect(state.toolMessage?.ok).toBe(true);
  });

  it('tapping the last vertex again removes it; non-coplanar points are rejected', () => {
    const s = useAppStore.getState().scene;
    const t = () => useAppStore.getState();
    for (const n of ['A', 'B', 'C', 'E']) t().toggleFaceVertex(id(s, n));
    expect(t().finishFace().ok).toBe(false);
    expect(planes(t().scene)).toHaveLength(0);
    t().toggleFaceVertex(id(s, 'E'));
    expect(t().faceDraft).toHaveLength(3);
    expect(t().finishFace().ok).toBe(true);
  });
});

describe('solid face colours', () => {
  function cube(): Scene {
    const r = createSolid(EMPTY_SCENE, 'cube', { a: 2 });
    if (!r.ok) throw new Error(r.error);
    return r.scene;
  }

  it('only coloured faces are projected as fills', () => {
    useAppStore.setState({ scene: cube() });
    const solidId = solids(useAppStore.getState().scene)[0].id;
    const polys = () =>
      projectToDrawing(useAppStore.getState().scene, cam(), { view: DEFAULT_VIEW, selectedId: null }).prims.filter(
        (p): p is PolygonPrim => p.type === 'polygon',
      );
    expect(polys()).toHaveLength(0);
    useAppStore.getState().setSolidFaceColor(solidId, 2, '#e5534b');
    expect(polys().map((p) => p.color)).toEqual(['#e5534b']);
    useAppStore.getState().setSolidFaceColor(solidId, 'all', '#4fb37a');
    expect(polys()).toHaveLength(6);
    useAppStore.getState().setSolidFaceColor(solidId, 'all', null);
    expect(solids(useAppStore.getState().scene)[0].faceColors).toBeUndefined();
  });

  it('face colours survive save / load, and old files without them still load', () => {
    useAppStore.setState({ scene: cube() });
    const solidId = solids(useAppStore.getState().scene)[0].id;
    useAppStore.getState().setSolidFaceColor(solidId, 0, '#2bb3c0');
    const r = parseProject(serializeProject(useAppStore.getState().scene, DEFAULT_VIEW));
    if (!r.ok) throw new Error(r.error);
    expect(solids(r.scene)[0].faceColors?.[0]).toBe('#2bb3c0');
    expect(solids(r.scene)[0].faceColors?.[1]).toBeNull();

    const old = parseProject(serializeProject(cube(), DEFAULT_VIEW));
    if (!old.ok) throw new Error(old.error);
    expect(solids(old.scene)[0].faceColors).toBeUndefined();
  });
});
