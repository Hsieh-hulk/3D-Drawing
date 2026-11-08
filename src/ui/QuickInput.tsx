import { useRef, useState } from 'react';
import { nextPointName } from '../model/scene';
import { useAppStore } from '../store/useAppStore';
import { applyKey, type KeypadAction } from './keypadEdit';
import { NumericKeypad } from './NumericKeypad';

const EXAMPLES = ['A(1, 2, 3)', 'B(0, √3, 1/2)', 'u = (1, -1, 2)', 'AB', '線段 BC', '直線 AC', '平面 ABC'];
/** Symbols that are awkward to reach on the iPad on-screen keyboard (shown in system-keyboard mode). */
const SYMBOLS = ['(', ')', ',', '=', '-', '/', '√', 'π'];
const MODE_KEY = 'quickInput.keypadMode';

function loadKeypadMode(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) !== 'system';
  } catch {
    return true;
  }
}

export function QuickInput() {
  const runCommand = useAppStore((s) => s.runCommand);
  const scene = useAppStore((s) => s.scene);
  const [text, setText] = useState('');
  const [keypad, setKeypad] = useState(loadKeypadMode);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const insert = (sym: string) => edit({ type: 'insert', text: sym });

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

      <button
        type="button"
        className="btn btn-small btn-ghost keypad-toggle"
        onPointerDown={(e) => e.preventDefault()}
        onClick={toggleMode}
        aria-pressed={keypad}
      >
        {keypad ? '改用系統鍵盤（可打中文指令）' : '改用螢幕數字鍵盤'}
      </button>

      {keypad ? (
        <NumericKeypad nextName={nextPointName(scene)} onKey={edit} />
      ) : (
        <div className="symbol-row" role="group" aria-label="插入符號">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-symbol"
              onPointerDown={(e) => e.preventDefault()} // keep focus (and the iPad keyboard) on the input
              onClick={() => insert(s)}
              aria-label={`插入 ${s}`}
            >
              {s}
            </button>
          ))}
        </div>
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
