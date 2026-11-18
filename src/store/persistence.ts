import type { StoreApi } from 'zustand';
import type { ExportOptions } from '../export/frame';
import { parseProject, PROJECT_VERSION, serializeProject } from '../model/project';
import type { Scene } from '../model/scene';
import type { ViewSettings } from '../model/types';

export const AUTOSAVE_KEY = 'sv3d.autosave.v1';
const KEY = AUTOSAVE_KEY;
const EXPORT_KEY = 'sv3d.exportOptions.v1';
const ROTATE_SPEED_KEY = 'sv3d.rotateSpeed.v1';
const DEBOUNCE_MS = 400;

/**
 * localStorage, or null when it is missing (node tests) or blocked. Even reading the `localStorage` getter
 * throws a SecurityError when site data is disabled or inside a sandboxed iframe, so it must be guarded.
 */
export function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads a key; null when absent or storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes a key; false when storage is unavailable, full or blocked. */
export function writeStorage(key: string, value: string): boolean {
  const s = getStorage();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

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
  const raw = readStorage(ROTATE_SPEED_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clampRotateSpeed(n) : ROTATE_SPEED_DEFAULT;
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
  return loadAutosaveChecked().saved;
}

export const AUTOSAVE_BACKUP_KEY = 'sv3d.autosave.backup';

/**
 * Like loadAutosave, but an autosave that exists and cannot be read (corrupt, or from a newer version) is
 * copied to AUTOSAVE_BACKUP_KEY before the next edit overwrites it, and `notice` tells the student.
 */
export function loadAutosaveChecked(): { saved: Saved | null; notice: string | null } {
  const text = readStorage(KEY);
  if (!text) return { saved: null, notice: null };
  const saved = parseSaved(text);
  if (saved) return { saved, notice: null };
  const backedUp = readStorage(AUTOSAVE_BACKUP_KEY) === text || writeStorage(AUTOSAVE_BACKUP_KEY, text);
  const newer = /"version"\s*:\s*(\d+)/.exec(text);
  const why = newer && Number(newer[1]) > PROJECT_VERSION ? '來自較新版本的網頁' : '已損壞，無法讀取';
  return {
    saved: null,
    notice: backedUp
      ? `上次的自動存檔${why}，已另存備份（${AUTOSAVE_BACKUP_KEY}），目前從空白畫面開始。`
      : `上次的自動存檔${why}，目前從空白畫面開始。`,
  };
}

function parseSaved(text: string): Saved | null {
  try {
    const r = parseProject(text);
    if (!r.ok) return null;
    let exportOptions: Partial<ExportOptions> | undefined;
    const ex = readStorage(EXPORT_KEY);
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

/** ok: saving works; unavailable: storage is blocked/missing; failed: the last write threw (quota, blocked). */
export type StorageStatus = 'ok' | 'unavailable' | 'failed';

export interface AutosaveOptions {
  onStatus?: (status: StorageStatus) => void;
  /** Another tab wrote the autosave; writes from this tab pause until resume() is called. */
  onExternalChange?: () => void;
  /** Receives pagehide / visibilitychange / storage events (defaults to window; injectable for tests). */
  target?: EventTarget | null;
  /** Read for visibilityState (defaults to document). */
  doc?: { visibilityState?: string } | null;
}

export interface AutosaveHandle {
  /** Writes any pending change now. */
  flush: () => void;
  /** Ends the pause started by an external change and saves this tab's state. */
  resume: () => void;
  dispose: () => void;
}

/**
 * Saves the scene/view/export options shortly after they change, and immediately when the page is hidden
 * or closed (so a quick reload never loses the last edit). Failures are reported through onStatus.
 */
export function startAutosave<T extends PersistedSlice>(store: StoreApi<T>, opts: AutosaveOptions = {}): AutosaveHandle {
  const target = opts.target !== undefined ? opts.target : ((globalThis as { window?: EventTarget }).window ?? null);
  const doc = opts.doc !== undefined ? opts.doc : ((globalThis as { document?: { visibilityState?: string } }).document ?? null);
  let status: StorageStatus | null = null;
  const report = (s: StorageStatus) => {
    if (s === status) return;
    status = s;
    opts.onStatus?.(s);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: PersistedSlice = store.getState();
  let pending: PersistedSlice | null = null;
  let paused = false;
  /** Autosave text this tab last wrote, to tell our own writes from another tab's. */
  let lastWritten: string | null = readStorage(KEY);

  const write = (s: PersistedSlice) => {
    const storage = getStorage();
    if (!storage) return report('unavailable');
    try {
      const text = serializeProject(s.scene, s.view);
      storage.setItem(KEY, text);
      lastWritten = text;
      storage.setItem(EXPORT_KEY, JSON.stringify(s.exportOptions));
      storage.setItem(ROTATE_SPEED_KEY, String(s.rotateSpeed));
      report('ok');
    } catch {
      report('failed');
    }
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending || paused) return;
    const s = pending;
    pending = null;
    write(s);
  };

  if (!getStorage()) report('unavailable');

  const unsubscribe = store.subscribe((s) => {
    if (
      s.scene === last.scene &&
      s.view === last.view &&
      s.exportOptions === last.exportOptions &&
      s.rotateSpeed === last.rotateSpeed
    )
      return;
    last = s;
    pending = s;
    if (paused) return;
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });

  const onPageHide = () => flush();
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') flush();
  };
  const onStorage = (e: Event) => {
    const { key, newValue } = e as StorageEvent;
    if (key !== KEY || newValue === null || newValue === lastWritten) return;
    paused = true;
    clearTimeout(timer);
    opts.onExternalChange?.();
  };
  target?.addEventListener('pagehide', onPageHide);
  target?.addEventListener('visibilitychange', onVisibility);
  target?.addEventListener('storage', onStorage);
  // visibilitychange fires on document, not window.
  const docTarget = doc as unknown as EventTarget | null;
  if (docTarget && docTarget !== target && typeof docTarget.addEventListener === 'function') {
    docTarget.addEventListener('visibilitychange', onVisibility);
  }

  return {
    flush,
    resume: () => {
      paused = false;
      pending = store.getState();
      flush();
    },
    dispose: () => {
      unsubscribe();
      clearTimeout(timer);
      target?.removeEventListener('pagehide', onPageHide);
      target?.removeEventListener('visibilitychange', onVisibility);
      target?.removeEventListener('storage', onStorage);
      if (docTarget && docTarget !== target && typeof docTarget.removeEventListener === 'function') {
        docTarget.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}
