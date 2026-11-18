import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nextPointName } from '../model/scene';
import { useAppStore } from '../store/useAppStore';
import { applyKey, type KeypadAction } from './keypadEdit';
import { NumericKeypad } from './NumericKeypad';

const EXAMPLES = ['A(1, 2, 3)', 'B(0, √3, 1/2)', 'u = (1, -1, 2)', 'AB', '線段 BC', '直線 AC', '平面 ABC'];
const MODE_KEY = 'quickInput.keypadMode';

/** The on-screen keyboard starts collapsed (Desmos-style); only an explicit 'keypad' choice reopens it. */
function loadKeypadMode(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === 'keypad';
  } catch {
    return false;
  }
}

/** Small keyboard glyph for the toggle button. */
const KeyboardIcon = () => (
  <svg width="26" height="18" viewBox="0 0 26 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="1" y="1" width="24" height="16" rx="2.5" />
    <path d="M5 5.5h1.5M9.5 5.5H11M14.5 5.5H16M19.5 5.5H21M5 9h1.5M9.5 9H11M14.5 9H16M19.5 9H21M7.5 13h11" strokeLinecap="round" />
  </svg>
);

const TriangleIcon = ({ up }: { up: boolean }) => (
  <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor" aria-hidden="true">
    <path d={up ? 'M6 0 12 8H0z' : 'M6 8 0 0h12z'} />
  </svg>
);

export function QuickInput() {
  const runCommand = useAppStore((s) => s.runCommand);
  const scene = useAppStore((s) => s.scene);
  const [text, setText] = useState('');
  const [keypad, setKeypad] = useState(loadKeypadMode);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The toggle and the keyboard live in a dock mounted at the bottom of <App>, so they span the whole window.
  const [dock, setDock] = useState<HTMLElement | null>(null);
  useEffect(() => setDock(document.getElementById('kbd-dock')), []);

  const submit = () => {
    const r = runCommand(text);
    if (r.ok) {
      setFeedback({ ok: true, text: r.message ?? '完成' });
      setText('');
    } else {
      setFeedback({ ok: false, text: r.error });
    }
    inputRef.current?.focus();
  };

  const edit = (action: KeypadAction) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const r = applyKey(text, start, end, action);
    setText(r.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  };

  const toggleMode = () => {
    const next = !keypad;
    setKeypad(next);
    try {
      localStorage.setItem(MODE_KEY, next ? 'keypad' : 'system');
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
    // Re-focus so the system keyboard opens right away when switching to it.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <section className="quick" aria-label="快速輸入">
      <form
        className="quick-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className="field quick-field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如 A(1, 2, 3) 或 AB"
          aria-label="輸入點、向量或線段"
          aria-invalid={feedback?.ok === false}
          aria-describedby="quick-feedback"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          inputMode={keypad ? 'none' : 'text'}
        />
        <button type="submit" className="btn btn-primary">
          新增
        </button>
      </form>

      {dock &&
        createPortal(
          <>
            <button
              type="button"
              className="kbd-toggle"
              onPointerDown={(e) => e.preventDefault()}
              onClick={toggleMode}
              aria-expanded={keypad}
              aria-controls="kbd-panel"
              aria-label={keypad ? '收起螢幕鍵盤（改用系統鍵盤）' : '展開螢幕鍵盤'}
              title={keypad ? '收起螢幕鍵盤' : '展開螢幕鍵盤'}
            >
              <KeyboardIcon />
              <TriangleIcon up={!keypad} />
            </button>
            {keypad && (
              <div className="kbd-panel" id="kbd-panel">
                <NumericKeypad nextName={nextPointName(scene)} onKey={edit} onEnter={submit} />
              </div>
            )}
          </>,
          dock,
        )}

      <p id="quick-feedback" className={`feedback ${feedback ? (feedback.ok ? 'is-ok' : 'is-error') : ''}`} aria-live="polite">
        {feedback?.text ?? ''}
      </p>

      <details className="examples">
        <summary>輸入格式說明</summary>
        <ul>
          <li>
            <b>點</b>：A(1, 2, 3)，可用 1/2、√3、sqrt(3)、π；再輸入一次同名點即可修改
          </li>
          <li>
            <b>向量</b>：AB（由 A 指向 B），或 u = (1, -1, 2)（從原點出發）
          </li>
          <li>
            <b>線段／直線</b>：線段 AB、直線 AB
          </li>
          <li>
            <b>平面</b>：平面 ABC、平面 ABCD（點需共平面）
          </li>
        </ul>
        <div className="chip-row">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
