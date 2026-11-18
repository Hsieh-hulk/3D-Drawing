import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nextPointName } from '../model/scene';
import { readStorage, writeStorage } from '../store/persistence';
import { useAppStore } from '../store/useAppStore';
import { applyKey, type KeypadAction } from './keypadEdit';
import { NumericKeypad } from './NumericKeypad';

const EXAMPLES = ['A(1, 2, 3)', 'B(0, √3, 1/2)', 'u = (1, -1, 2)', 'AB', '線段 BC', '直線 AC', '平面 ABC', 'y = x^2', 'x = sin(y)'];
const MODE_KEY = 'quickInput.keypadMode';

/** The on-screen keyboard starts collapsed (Desmos-style); only an explicit 'keypad' choice reopens it. */
function loadKeypadMode(): boolean {
  return readStorage(MODE_KEY) === 'keypad';
}

/** Another text field the on-screen keyboard can type into (object list coordinates, names, solid sizes…). */
function isKeypadField(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'text' && !el.readOnly && !el.disabled;
}

/** Sets an input's value so React's onChange sees it, as if the student typed it. */
function setNativeValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
  /** Field (other than the quick input) the student is editing; the on-screen keyboard types into it. */
  const otherRef = useRef<HTMLInputElement | null>(null);
  const keypadRef = useRef(keypad);
  keypadRef.current = keypad;
  // The keyboard lives in a dock mounted at the bottom of <App>, so it spans the whole window.
  const [dock, setDock] = useState<HTMLElement | null>(null);
  useEffect(() => setDock(document.getElementById('kbd-dock')), []);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t === inputRef.current || !isKeypadField(t)) return;
      otherRef.current = t;
      // With the on-screen keyboard open, keep the system keyboard from covering it (fields that set their own
      // inputMode are left alone).
      if (keypadRef.current && !t.hasAttribute('inputmode')) {
        t.setAttribute('inputmode', 'none');
        t.dataset.kbdInputmode = '1';
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const t = e.target;
      if (t !== otherRef.current) return;
      otherRef.current = null;
      if (t instanceof HTMLInputElement && t.dataset.kbdInputmode) {
        t.removeAttribute('inputmode');
        delete t.dataset.kbdInputmode;
      }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

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
    const other = otherRef.current;
    if (other?.isConnected) {
      const r = applyKey(other.value, other.selectionStart ?? other.value.length, other.selectionEnd ?? other.value.length, action);
      setNativeValue(other, r.text);
      requestAnimationFrame(() => {
        other.focus();
        other.setSelectionRange(r.caret, r.caret);
      });
      return;
    }
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
    writeStorage(MODE_KEY, next ? 'keypad' : 'system'); // storage unavailable: the choice just isn't remembered
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
          placeholder="例如 A(1, 2, 3)、AB 或 y = x^2"
          aria-label="輸入點、向量或線段"
          aria-invalid={feedback?.ok === false}
          aria-describedby="quick-feedback"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          inputMode={keypad ? 'none' : 'text'}
          onPaste={(e) => {
            // A single-line field would glue pasted lines together ("A(1,2,3)B(4,5,6)"): run them one by one.
            const lines = e.clipboardData.getData('text').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (lines.length < 2) return;
            e.preventDefault();
            let done = 0;
            for (const [i, line] of lines.entries()) {
              const r = runCommand(line);
              if (!r.ok) {
                setText(line);
                setFeedback({ ok: false, text: `已加入 ${done} 筆；第 ${i + 1} 行「${line}」：${r.error}` });
                return;
              }
              done++;
            }
            setText('');
            setFeedback({ ok: true, text: `已逐行加入 ${done} 筆` });
          }}
        />
        {/* Inline next to the field (not floating), so it never covers the object list. */}
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
        <button type="submit" className="btn btn-primary">
          新增
        </button>
      </form>

      {dock &&
        createPortal(
          <>
            {keypad && (
              <div className="kbd-panel" id="kbd-panel">
                <NumericKeypad
                  nextName={nextPointName(scene)}
                  onKey={edit}
                  // Enter commits a field being edited (fields commit on blur), otherwise adds the quick input.
                  onEnter={() => (otherRef.current?.isConnected ? otherRef.current.blur() : submit())}
                />
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
            <b>點的名稱</b>：大寫英文字母開頭，可加數字或 '，例如 A1、A'（不支援 A_1）；O 保留給原點
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
          <li>
            <b>方程式</b>：y = f(x) 或 x = f(y)，例如 y = x^2、x = sin(y)、x = 3（可勾選延伸到 3D）
          </li>
          <li>
            <b>函式與常數</b>：sin、cos、tan、asin、acos、atan、sqrt、cbrt、abs、ln、log、exp；π（pi）、e；次方用 ^
          </li>
          <li>
            <b>快捷鍵</b>：Ctrl+Z 復原、Ctrl+Y 或 Ctrl+Shift+Z 重做、Delete 刪除選取的物件、Esc 取消選取
          </li>
          <li>
            <b>三角函數單位</b>：點座標用「度」，sin(30) = 0.5；方程式用「弧度」，y = sin(x)。可寫 30°、deg(30) 或 rad(π/6) 指定單位
          </li>
        </ul>
        <p className="chip-hint">點範例會填入輸入框，再按「新增」。</p>
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
