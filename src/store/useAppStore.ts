import { create } from 'zustand';
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from '../export/frame';
import { runCommand } from '../model/commands';
import { evaluate, formatNumber, toExactText } from '../model/expr';
import { parseProject } from '../model/project';
import {
  EMPTY_SCENE,
  POINT_COLOR,
  POINT_NAME_RE,
  findPoint,
  newId,
  nextPointName,
  pointByName,
  removeObject,
  type Coords,
  type Scene,
  type SceneObject,
  type SolidTemplate,
} from '../model/scene';
import { createSolid } from '../model/solids';
import type { Vec3, ViewPreset, ViewSettings } from '../model/types';
import { loadAutosave, startAutosave } from './persistence';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const HISTORY_LIMIT = 100;

export const DEFAULT_VIEW: ViewSettings = {
  preset: 'textbook',
  showGrid: true,
  showAxes: true,
  showTickLabels: true,
  showPointCoords: false,
  showHiddenLines: true,
  snap: 1,
  axisRange: 5,
};

interface AppState {
  view: ViewSettings;
  /** Increments on every preset click so the viewport re-applies a preset even when it is unchanged. */
  viewRequestId: number;
  scene: Scene;
  selectedId: string | null;
  /** Tap on empty space in the 3D view adds a point. */
  placeMode: boolean;

  /** Undo stack (older scenes) and redo stack. Scenes are immutable, so snapshots are cheap. */
  past: Scene[];
  future: Scene[];
  undo: () => void;
  redo: () => void;

  setPreset: (preset: ViewPreset) => void;
  toggleGrid: () => void;
  toggleTickLabels: () => void;
  togglePointCoords: () => void;
  toggleHiddenLines: () => void;
  setSnap: (snap: ViewSettings['snap']) => void;
  togglePlaceMode: () => void;

  runCommand: (input: string) => ActionResult;
  updatePointCoord: (id: string, axis: 0 | 1 | 2, src: string) => ActionResult;
  renamePoint: (id: string, name: string) => ActionResult;
  updateObject: (id: string, patch: Partial<Pick<SceneObject, 'color' | 'visible'>>) => void;
  togglePointGuides: (id: string) => void;
  addSolid: (template: SolidTemplate, params: Record<string, number>) => ActionResult;
  setSegmentInfinite: (id: string, infinite: boolean) => void;
  removeObject: (id: string) => void;
  clearScene: () => void;
  select: (id: string | null) => void;

  /** Adds a point at a 3D position (tap in place mode) and selects it. */
  addPointAt: (pos: Vec3) => void;
  /** Drag lifecycle: one undo entry per drag, live moves in between. */
  beginDrag: () => void;
  movePointLive: (id: string, pos: Vec3) => void;

  loadProjectText: (text: string) => ActionResult;

  exportOptions: ExportOptions;
  setExportOptions: (patch: Partial<ExportOptions>) => void;
}

/** Coordinate text written after a drag: exact form for snapped values, 2 decimals otherwise. */
function coordText(v: number, snap: number): string {
  return snap > 0 ? toExactText(v) : formatNumber(Math.round(v * 100) / 100);
}

const saved = loadAutosave();

export const useAppStore = create<AppState>((set, get) => {
  /** Applies a new scene and records the previous one for undo. */
  const commit = (scene: Scene, extra: Partial<AppState> = {}) => {
    const { scene: prev, past } = get();
    if (scene === prev) return;
    set({ scene, past: [...past, prev].slice(-HISTORY_LIMIT), future: [], ...extra });
  };
  const mapObjects = (fn: (o: SceneObject) => SceneObject) => commit({ objects: get().scene.objects.map(fn) });
  /** Drops the selection when the selected object no longer exists. */
  const validSelection = (scene: Scene, id: string | null) => (id && scene.objects.some((o) => o.id === id) ? id : null);

  return {
    view: { ...DEFAULT_VIEW, ...saved?.view },
    viewRequestId: 0,
    scene: saved?.scene ?? EMPTY_SCENE,
    selectedId: null,
    placeMode: false,
    past: [],
    future: [],

    undo: () => {
      const { past, future, scene, selectedId } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set({ scene: prev, past: past.slice(0, -1), future: [scene, ...future], selectedId: validSelection(prev, selectedId) });
    },
    redo: () => {
      const { past, future, scene, selectedId } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({ scene: next, past: [...past, scene], future: future.slice(1), selectedId: validSelection(next, selectedId) });
    },

    setPreset: (preset) => set((s) => ({ view: { ...s.view, preset }, viewRequestId: s.viewRequestId + 1 })),
    toggleGrid: () => set((s) => ({ view: { ...s.view, showGrid: !s.view.showGrid } })),
    toggleTickLabels: () => set((s) => ({ view: { ...s.view, showTickLabels: !s.view.showTickLabels } })),
    togglePointCoords: () => set((s) => ({ view: { ...s.view, showPointCoords: !s.view.showPointCoords } })),
    toggleHiddenLines: () => set((s) => ({ view: { ...s.view, showHiddenLines: !s.view.showHiddenLines } })),
    setSnap: (snap) => set((s) => ({ view: { ...s.view, snap } })),
    togglePlaceMode: () => set((s) => ({ placeMode: !s.placeMode })),

    runCommand: (input) => {
      const r = runCommand(input, get().scene);
      if (!r.ok) return r;
      commit(r.scene);
      return { ok: true, message: r.message };
    },

    updatePointCoord: (id, axis, src) => {
      const target = findPoint(get().scene, id);
      if (target?.name === 'O') return { ok: false, error: '原點 O 固定在 (0, 0, 0)' };
      const r = evaluate(src);
      if (!r.ok) return r;
      mapObjects((o) => {
        if (o.id !== id || o.kind !== 'point') return o;
        const coords = [...o.coords] as Coords;
        coords[axis] = { src: src.trim(), value: r.value };
        return { ...o, coords };
      });
      return { ok: true };
    },

    renamePoint: (id, rawName) => {
      const name = rawName.trim();
      if (!POINT_NAME_RE.test(name)) return { ok: false, error: "點的名稱需以大寫英文字母開頭，例如 A、B1、A'" };
      if (name === 'O') return { ok: false, error: 'O 保留給原點' };
      const clash = pointByName(get().scene, name);
      if (clash && clash.id !== id) return { ok: false, error: `已經有點 ${name}` };
      mapObjects((o) => (o.id === id && o.kind === 'point' ? { ...o, name } : o));
      return { ok: true };
    },

    updateObject: (id, patch) => mapObjects((o) => (o.id === id ? { ...o, ...patch } : o)),

    togglePointGuides: (id) => mapObjects((o) => (o.id === id && o.kind === 'point' ? { ...o, guides: !o.guides } : o)),

    addSolid: (template, params) => {
      const r = createSolid(get().scene, template, params);
      if (!r.ok) return r;
      commit(r.scene);
      return { ok: true, message: r.message };
    },

    setSegmentInfinite: (id, infinite) =>
      mapObjects((o) => (o.id === id && o.kind === 'segment' ? { ...o, infinite } : o)),

    removeObject: (id) => {
      const next = removeObject(get().scene, id);
      commit(next, { selectedId: validSelection(next, get().selectedId) });
    },

    clearScene: () => commit(EMPTY_SCENE, { selectedId: null }),

    select: (id) => set({ selectedId: id }),

    addPointAt: (pos) => {
      const { scene, view } = get();
      const id = newId('p');
      const coords = pos.map((v) => ({ src: coordText(v, view.snap), value: v })) as Coords;
      commit(
        { objects: [...scene.objects, { id, kind: 'point', name: nextPointName(scene), color: POINT_COLOR, visible: true, coords }] },
        { selectedId: id },
      );
    },

    beginDrag: () => {
      const { scene, past } = get();
      set({ past: [...past, scene].slice(-HISTORY_LIMIT), future: [] });
    },

    movePointLive: (id, pos) => {
      const snap = get().view.snap;
      set((s) => ({
        scene: {
          objects: s.scene.objects.map((o) =>
            o.id === id && o.kind === 'point'
              ? { ...o, coords: pos.map((v) => ({ src: coordText(v, snap), value: v })) as Coords }
              : o,
          ),
        },
      }));
    },

    loadProjectText: (text) => {
      const r = parseProject(text);
      if (!r.ok) return r;
      commit(r.scene, { selectedId: null, view: { ...get().view, ...r.view } });
      const n = r.scene.objects.length;
      return { ok: true, message: r.dropped > 0 ? `已開啟 ${n} 個物件（略過 ${r.dropped} 個無效物件）` : `已開啟 ${n} 個物件` };
    },

    exportOptions: { ...DEFAULT_EXPORT_OPTIONS, ...saved?.exportOptions },
    setExportOptions: (patch) => set((s) => ({ exportOptions: { ...s.exportOptions, ...patch } })),
  };
});

startAutosave(useAppStore);
