import { useEffect, useState } from 'react';
import { Viewport } from '../render3d/Viewport';
import { viewportRegistry } from '../render3d/viewportRegistry';
import { readStorage, writeStorage } from '../store/persistence';
import { useAppStore } from '../store/useAppStore';
import { confirmRemove } from './confirmRemove';
import { DoubleChevronIcon } from './icons';
import { ObjectPanel } from './ObjectPanel';
import { Toolbar } from './Toolbar';
import { ViewTools } from './ViewTools';

/** True when the keyboard is busy with a text field (shortcuts must not steal its keys). */
function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog (export) owns the keyboard: shortcuts must not edit the scene behind it.
      if (document.querySelector('dialog[open]')) return;
      const s = useAppStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      // Escape / Ctrl+Z while still holding a dragged point: cancel the drag and put the point back.
      if ((e.key === 'Escape' || (mod && e.key.toLowerCase() === 'z')) && viewportRegistry.current?.cancelDrag()) {
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !typingInField(e.target)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typingInField(e.target)) {
        e.preventDefault();
        s.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId && !typingInField(e.target)) {
        e.preventDefault();
        const obj = s.scene.objects.find((o) => o.id === s.selectedId);
        // Same confirmation as the trash button when dependents would be removed too.
        if (obj && confirmRemove(s.scene, obj)) s.removeObject(obj.id);
      } else if (e.key === 'Escape' && !typingInField(e.target)) {
        if (s.placeMode) s.togglePlaceMode();
        else s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [panelOpen, setPanelOpen] = useState(() => readStorage('panel.open') !== '0');
  const togglePanel = () =>
    setPanelOpen((o) => {
      writeStorage('panel.open', o ? '0' : '1');
      return !o;
    });

  return (
    <div className="app">
      <Toolbar />
      <div className={`workspace${panelOpen ? '' : ' is-panel-closed'}`}>
        <main className="stage">
          <Viewport />
          <button
            type="button"
            className="vt-btn panel-toggle"
            aria-expanded={panelOpen}
            aria-label={panelOpen ? '收合輸入區' : '展開輸入區'}
            title={panelOpen ? '收合輸入區' : '展開輸入區'}
            onClick={togglePanel}
          >
            <DoubleChevronIcon left={panelOpen} />
          </button>
          <ViewTools />
        </main>
        <ObjectPanel />
      </div>
      {/* Bottom dock: QuickInput portals its keyboard toggle and keyboard here. */}
      <div className="kbd-dock" id="kbd-dock" />
    </div>
  );
}
