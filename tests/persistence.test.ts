import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_EXPORT_OPTIONS } from '../src/export/frame';
import { runCommand } from '../src/model/commands';
import { EMPTY_SCENE, type Scene } from '../src/model/scene';
import type { ViewSettings } from '../src/model/types';
import {
  AUTOSAVE_BACKUP_KEY,
  AUTOSAVE_KEY,
  loadAutosaveChecked,
  loadAutosave,
  loadRotateSpeed,
  ROTATE_SPEED_DEFAULT,
  startAutosave,
  type StorageStatus,
} from '../src/store/persistence';

const VIEW: ViewSettings = {
  preset: 'textbook',
  showGrid: true,
  showAxes: true,
  showTickLabels: true,
  showPointCoords: false,
  showHiddenLines: true,
  snap: 1,
  axisRange: 5,
};

class MemoryStorage {
  data = new Map<string, string>();
  failWrites: Error | null = null;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw this.failWrites;
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function setStorage(getter: () => unknown) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: getter });
}

function makeStore() {
  return createStore(() => ({ scene: EMPTY_SCENE as Scene, view: VIEW, exportOptions: DEFAULT_EXPORT_OPTIONS, rotateSpeed: 0.5 }));
}

function addPoint(store: ReturnType<typeof makeStore>, input: string) {
  const r = runCommand(input, store.getState().scene);
  if (!r.ok) throw new Error(r.error);
  store.setState({ scene: r.scene });
}

function storageEvent(key: string, newValue: string | null): Event {
  return Object.assign(new Event('storage'), { key, newValue });
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.useRealTimers();
});

describe('blocked storage (QA-01)', () => {
  beforeEach(() =>
    setStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    }),
  );

  it('loads defaults instead of throwing', () => {
    expect(loadAutosave()).toBeNull();
    expect(loadRotateSpeed()).toBe(ROTATE_SPEED_DEFAULT);
  });

  it('starts autosave and reports it as unavailable', () => {
    const onStatus = vi.fn<(s: StorageStatus) => void>();
    const store = makeStore();
    const h = startAutosave(store, { onStatus, target: new EventTarget(), doc: null });
    expect(onStatus).toHaveBeenCalledWith('unavailable');
    expect(() => {
      addPoint(store, 'A(1,2,3)');
      h.flush();
    }).not.toThrow();
    h.dispose();
  });
});

describe('autosave', () => {
  let mem: MemoryStorage;
  beforeEach(() => {
    vi.useFakeTimers();
    mem = new MemoryStorage();
    setStorage(() => mem);
  });

  it('writes immediately on pagehide instead of waiting for the debounce (QA-04)', () => {
    const target = new EventTarget();
    const store = makeStore();
    const h = startAutosave(store, { target, doc: null });
    addPoint(store, 'A(1,2,3)');
    expect(mem.getItem(AUTOSAVE_KEY)).toBeNull();
    target.dispatchEvent(new Event('pagehide'));
    expect(mem.getItem(AUTOSAVE_KEY)).toContain('"A"');
    h.dispose();
  });

  it('writes on visibilitychange to hidden (QA-04)', () => {
    const target = new EventTarget();
    const doc = { visibilityState: 'visible' };
    const store = makeStore();
    const h = startAutosave(store, { target, doc });
    addPoint(store, 'A(1,2,3)');
    target.dispatchEvent(new Event('visibilitychange'));
    expect(mem.getItem(AUTOSAVE_KEY)).toBeNull();
    doc.visibilityState = 'hidden';
    target.dispatchEvent(new Event('visibilitychange'));
    expect(mem.getItem(AUTOSAVE_KEY)).toContain('"A"');
    h.dispose();
  });

  it('reports failed writes, then recovery (QA-16)', () => {
    const onStatus = vi.fn<(s: StorageStatus) => void>();
    const store = makeStore();
    const h = startAutosave(store, { onStatus, target: new EventTarget(), doc: null });
    mem.failWrites = new DOMException('full', 'QuotaExceededError');
    addPoint(store, 'A(1,2,3)');
    vi.advanceTimersByTime(500);
    expect(onStatus).toHaveBeenLastCalledWith('failed');
    mem.failWrites = null;
    addPoint(store, 'B(1,2,3)');
    vi.advanceTimersByTime(500);
    expect(onStatus).toHaveBeenLastCalledWith('ok');
    h.dispose();
  });

  it('pauses on another tab’s save and resumes on request (QA-17)', () => {
    const target = new EventTarget();
    const onExternalChange = vi.fn();
    const store = makeStore();
    const h = startAutosave(store, { target, doc: null, onExternalChange });

    target.dispatchEvent(storageEvent('other.key', 'x'));
    expect(onExternalChange).not.toHaveBeenCalled();

    mem.data.set(AUTOSAVE_KEY, 'from-other-tab');
    target.dispatchEvent(storageEvent(AUTOSAVE_KEY, 'from-other-tab'));
    expect(onExternalChange).toHaveBeenCalledOnce();

    addPoint(store, 'A(1,2,3)');
    vi.advanceTimersByTime(500);
    target.dispatchEvent(new Event('pagehide'));
    expect(mem.getItem(AUTOSAVE_KEY)).toBe('from-other-tab');

    h.resume();
    expect(mem.getItem(AUTOSAVE_KEY)).toContain('"A"');
    h.dispose();
  });

  it('ignores storage events that echo its own write', () => {
    const target = new EventTarget();
    const onExternalChange = vi.fn();
    const store = makeStore();
    const h = startAutosave(store, { target, doc: null, onExternalChange });
    addPoint(store, 'A(1,2,3)');
    h.flush();
    target.dispatchEvent(storageEvent(AUTOSAVE_KEY, mem.getItem(AUTOSAVE_KEY)));
    expect(onExternalChange).not.toHaveBeenCalled();
    h.dispose();
  });
});

describe('unreadable autosave (QA-37)', () => {
  let mem: MemoryStorage;
  beforeEach(() => {
    mem = new MemoryStorage();
    setStorage(() => mem);
  });

  it('backs up a corrupt or newer autosave and explains it', () => {
    mem.data.set(AUTOSAVE_KEY, '{"app":"space-vector-3d","version":999,"scene":{"objects":[]}}');
    const r = loadAutosaveChecked();
    expect(r.saved).toBeNull();
    expect(r.notice).toContain('較新版本');
    expect(mem.getItem(AUTOSAVE_BACKUP_KEY)).toContain('999');

    mem.data.set(AUTOSAVE_KEY, '{not json');
    expect(loadAutosaveChecked().notice).toContain('損壞');
    expect(mem.getItem(AUTOSAVE_BACKUP_KEY)).toBe('{not json');
  });

  it('has nothing to say when there is no autosave', () => {
    expect(loadAutosaveChecked()).toEqual({ saved: null, notice: null });
  });
});
