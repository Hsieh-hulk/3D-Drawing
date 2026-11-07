import { useEffect } from 'react';
import { Viewport } from '../render3d/Viewport';
import { useAppStore } from '../store/useAppStore';
import { ObjectPanel } from './ObjectPanel';
import { Toolbar } from './Toolbar';

/** True when the keyboard is busy with a text field (shortcuts must not steal its keys). */
function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typingInField(e.target)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typingInField(e.target)) {
        e.preventDefault();
        s.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId && !typingInField(e.target)) {
        e.preventDefault();
        s.removeObject(s.selectedId); // undoable, so no confirmation
      } else if (e.key === 'Escape' && !typingInField(e.target) && !document.querySelector('dialog[open]')) {
        if (s.placeMode) s.togglePlaceMode();
        else s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <main className="stage">
          <Viewport />
        </main>
        <ObjectPanel />
      </div>
    </div>
  );
}
