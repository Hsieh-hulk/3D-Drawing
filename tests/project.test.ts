import { beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/model/commands';
import { parseProject, serializeProject } from '../src/model/project';
import { EMPTY_SCENE, pointByName, type Scene } from '../src/model/scene';
import { createSolid } from '../src/model/solids';
import { DEFAULT_VIEW, useAppStore } from '../src/store/useAppStore';

function build(...cmds: string[]): Scene {
  const solid = createSolid(EMPTY_SCENE, 'pyramid', { a: 2, h: 3 });
  if (!solid.ok) throw new Error(solid.error);
  let s = solid.scene;
  for (const c of cmds) {
    const r = runCommand(c, s);
    if (!r.ok) throw new Error(r.error);
    s = r.scene;
  }
  return s;
}

describe('project files', () => {
  it('round-trips a scene and view settings', () => {
    const scene = build('P(1, sqrt(2), 1/2)', 'AP', 'u = (1, -1, 2)', '線段 BP', '平面 ABE');
    const text = serializeProject(scene, { ...DEFAULT_VIEW, showGrid: false, snap: 0.5 });
    const r = parseProject(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.scene).toEqual(scene);
    expect(r.dropped).toBe(0);
    expect(r.view.showGrid).toBe(false);
    expect(r.view.snap).toBe(0.5);
  });

  it('rejects files that are not projects', () => {
    expect(parseProject('not json').ok).toBe(false);
    expect(parseProject('{"hello": 1}').ok).toBe(false);
    expect(parseProject(JSON.stringify({ app: 'space-vector-3d', version: 99, scene: { objects: [] } }))).toEqual({
      ok: false,
      error: '專案檔版本較新，請更新網頁後再開啟',
    });
  });

  it('drops invalid objects and objects pointing at missing points', () => {
    const scene = build('AB');
    const data = JSON.parse(serializeProject(scene, DEFAULT_VIEW));
    data.scene.objects.push(
      { id: 'bad1', kind: 'segment', a: 'nope', b: 'nope2', color: '#000', visible: true },
      { id: 'bad2', kind: 'point', name: 'lowercase', coords: [], color: '#000', visible: true },
      { id: 'bad3', kind: 'mystery' },
    );
    const r = parseProject(JSON.stringify(data));
    if (!r.ok) throw new Error(r.error);
    expect(r.dropped).toBe(3);
    expect(r.scene.objects).toHaveLength(scene.objects.length);
  });

  it('re-evaluates coordinate expressions and sanitizes colours', () => {
    const data = {
      app: 'space-vector-3d',
      version: 1,
      scene: {
        objects: [
          { id: 'p1', kind: 'point', name: 'A', coords: [{ src: 'sqrt(4)', value: 999 }, { src: '1/2', value: 0 }, { value: 3 }], color: 'javascript:alert(1)', visible: true },
        ],
      },
    };
    const r = parseProject(JSON.stringify(data));
    if (!r.ok) throw new Error(r.error);
    const a = pointByName(r.scene, 'A')!;
    expect(a.coords.map((c) => c.value)).toEqual([2, 0.5, 3]);
    expect(a.color).toBe('#1d232b');
  });
});

describe('undo / redo', () => {
  beforeEach(() => {
    useAppStore.setState({ scene: EMPTY_SCENE, past: [], future: [], selectedId: null });
  });

  it('undoes and redoes commands step by step', () => {
    const s = useAppStore.getState();
    s.runCommand('A(1,2,3)');
    s.runCommand('B(0,0,1)');
    s.runCommand('AB');
    expect(useAppStore.getState().scene.objects).toHaveLength(3);
    useAppStore.getState().undo();
    expect(useAppStore.getState().scene.objects).toHaveLength(2);
    useAppStore.getState().undo();
    useAppStore.getState().undo();
    expect(useAppStore.getState().scene.objects).toHaveLength(0);
    useAppStore.getState().undo(); // nothing left: no-op
    useAppStore.getState().redo();
    useAppStore.getState().redo();
    expect(useAppStore.getState().scene.objects).toHaveLength(2);
  });

  it('a new action clears the redo stack', () => {
    const s = useAppStore.getState();
    s.runCommand('A(1,2,3)');
    s.undo();
    expect(useAppStore.getState().future).toHaveLength(1);
    useAppStore.getState().runCommand('B(1,1,1)');
    expect(useAppStore.getState().future).toHaveLength(0);
  });

  it('a whole drag is a single undo step', () => {
    const s = useAppStore.getState();
    s.runCommand('A(0,0,0)');
    const id = pointByName(useAppStore.getState().scene, 'A')!.id;
    s.beginDrag();
    s.movePointLive(id, [1, 0, 0]);
    s.movePointLive(id, [2, 0, 0]);
    s.movePointLive(id, [2, 1.5, 0]);
    const moved = pointByName(useAppStore.getState().scene, 'A')!;
    expect(moved.coords.map((c) => c.src)).toEqual(['2', '3/2', '0']);
    useAppStore.getState().undo();
    expect(pointByName(useAppStore.getState().scene, 'A')!.coords.map((c) => c.value)).toEqual([0, 0, 0]);
  });

  it('removing the selected object clears the selection, and undo brings the object back', () => {
    const s = useAppStore.getState();
    s.runCommand('A(1,1,1)');
    const id = pointByName(useAppStore.getState().scene, 'A')!.id;
    s.select(id);
    useAppStore.getState().removeObject(id);
    expect(useAppStore.getState().selectedId).toBeNull();
    useAppStore.getState().undo();
    expect(pointByName(useAppStore.getState().scene, 'A')).toBeDefined();
  });

  it('places points with auto names and selects them', () => {
    useAppStore.getState().addPointAt([1, 2, 0]);
    const st = useAppStore.getState();
    const a = pointByName(st.scene, 'A')!;
    expect(a.coords.map((c) => c.value)).toEqual([1, 2, 0]);
    expect(st.selectedId).toBe(a.id);
  });

  it('opening a project is undoable', () => {
    useAppStore.getState().runCommand('A(1,1,1)');
    const text = serializeProject(build(), DEFAULT_VIEW);
    const r = useAppStore.getState().loadProjectText(text);
    expect(r.ok).toBe(true);
    expect(useAppStore.getState().scene.objects.length).toBeGreaterThan(1);
    useAppStore.getState().undo();
    expect(useAppStore.getState().scene.objects).toHaveLength(1);
  });
});
