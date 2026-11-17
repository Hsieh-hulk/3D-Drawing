import type { StoreApi } from 'zustand';
import type { ExportOptions } from '../export/frame';
import { parseProject, serializeProject } from '../model/project';
import type { Scene } from '../model/scene';
import type { ViewSettings } from '../model/types';

const KEY = 'sv3d.autosave.v1';
const EXPORT_KEY = 'sv3d.exportOptions.v1';
const ROTATE_SPEED_KEY = 'sv3d.rotateSpeed.v1';
const DEBOUNCE_MS = 400;

/** Drag-to-rotate sensitivity (OrbitControls.rotateSpeed). 1 is the library default, which felt too fast. */
export const ROTATE_SPEED_MIN = 0.1;
export const ROTATE_SPEED_MAX = 1;
export const ROTATE_SPEED_STEP = 0.1;
export const ROTATE_SPEED_DEFAULT = 0.5;

export function clampRotateSpeed(v: number): number {
  return Math.min(ROTATE_SPEED_MAX, Math.max(ROTATE_SPEED_MIN, Math.round(v * 10) / 10));
}

/** Last chosen rotate sensitivity, or the default when nothing valid is stored. */
export function loadRotateSpeed(): number {
  try {
    const raw = globalThis.localStorage?.getItem(ROTATE_SPEED_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? clampRotateSpeed(n) : ROTATE_SPEED_DEFAULT;
  } catch {
    return ROTATE_SPEED_DEFAULT;
  }
}

interface Saved {
  scene: Scene;
  view: Partial<ViewSettings>;
  exportOptions?: Partial<ExportOptions>;
}

/**
 * Reads the last autosave. Storage can be missing (private mode, node tests) or contain stale/corrupt data,
 * so every access is guarded and the content goes through the same validation as an opened file.
 */
export function loadAutosave(): Saved | null {
  try {
    const text = globalThis.localStorage?.getItem(KEY);
    if (!text) return null;
    const r = parseProject(text);
    if (!r.ok) return null;
    let exportOptions: Partial<ExportOptions> | undefined;
    const ex = globalThis.localStorage.getItem(EXPORT_KEY);
    if (ex) {
      const parsed: unknown = JSON.parse(ex);
      if (parsed && typeof parsed === 'object') exportOptions = sanitizeExportOptions(parsed as Record<string, unknown>);
    }
    return { scene: r.scene, view: r.view, exportOptions };
  } catch {
    return null;
  }
}

function sanitizeExportOptions(o: Record<string, unknown>): Partial<ExportOptions> {
  const out: Partial<ExportOptions> = {};
  if (o.format === 'png' || o.format === 'pdf' || o.format === 'svg') out.format = o.format;
  if (o.pngScale === 1 || o.pngScale === 2 || o.pngScale === 4) out.pngScale = o.pngScale;
  for (const k of ['transparent', 'showAxes', 'showGrid', 'showTickLabels', 'showHiddenLines', 'fitAxes'] as const) {
    if (typeof o[k] === 'boolean') out[k] = o[k];
  }
  if (typeof o.lineScale === 'number' && o.lineScale > 0 && o.lineScale <= 3) out.lineScale = o.lineScale;
  if (typeof o.fontScale === 'number' && o.fontScale > 0 && o.fontScale <= 3) out.fontScale = o.fontScale;
  return out;
}

interface PersistedSlice {
  scene: Scene;
  view: ViewSettings;
  exportOptions: ExportOptions;
  rotateSpeed: number;
}

/** Saves the scene/view/export options shortly after they change. Failures (quota, private mode) are ignored. */
export function startAutosave<T extends PersistedSlice>(store: StoreApi<T>): void {
  if (typeof globalThis.localStorage === 'undefined') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: PersistedSlice = store.getState();
  store.subscribe((s) => {
    if (
      s.scene === last.scene &&
      s.view === last.view &&
      s.exportOptions === last.exportOptions &&
      s.rotateSpeed === last.rotateSpeed
    )
      return;
    last = s;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, serializeProject(s.scene, s.view));
        localStorage.setItem(EXPORT_KEY, JSON.stringify(s.exportOptions));
        localStorage.setItem(ROTATE_SPEED_KEY, String(s.rotateSpeed));
      } catch {
        /* storage full or blocked: autosave is a convenience, never an error */
      }
    }, DEBOUNCE_MS);
  });
}
