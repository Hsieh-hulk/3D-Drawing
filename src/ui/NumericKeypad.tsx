import type { KeypadAction } from './keypadEdit';

interface Key {
  label: string;
  aria: string;
  action?: KeypadAction;
  /** Enter key: submits the form instead of editing the text. */
  enter?: boolean;
  className?: string;
}

const ins = (text: string, aria = `輸入 ${text}`, className?: string): Key => ({
  label: text,
  aria,
  action: { type: 'insert', text },
  className,
});

/** Right block: cursor / delete / enter keys. */
const FN_KEYS: Key[] = [
  { label: '◀', aria: '游標左移', action: { type: 'left' }, className: 'key-fn' },
  { label: '▶', aria: '游標右移', action: { type: 'right' }, className: 'key-fn' },
  { label: '⌫', aria: '刪除前一個字', action: { type: 'backspace' }, className: 'key-fn key-span2' },
  { label: '↵', aria: '新增（Enter）', enter: true, className: 'key-enter key-span2 key-tall' },
];

/** Middle block: digits. */
const DIGIT_KEYS: Key[] = [
  ins('7'), ins('8'), ins('9'),
  ins('4'), ins('5'), ins('6'),
  ins('1'), ins('2'), ins('3'),
  ins('0', '輸入 0', 'key-span3'),
];

interface Props {
  nextName: string;
  onKey: (action: KeypadAction) => void;
  onEnter: () => void;
}

/** Bottom keyboard so coordinates can be entered without the system keyboard. Layout: symbols | digits | functions. */
export function NumericKeypad({ nextName, onKey, onEnter }: Props) {
  const symbolKeys: Key[] = [
    ins('(', '輸入左括號'), ins(')', '輸入右括號'), ins(',', '輸入逗號'), ins('=', '輸入等號'),
    ins('-', '輸入負號'), ins('/', '輸入分數線'), ins('√', '輸入根號'), ins('π', '輸入 π'),
    ins('.', '輸入小數點'),
    { label: `${nextName}(`, aria: `插入下一個點名 ${nextName}`, action: { type: 'insert', text: `${nextName}(` }, className: 'key-fn key-span3' },
    { label: '清除', aria: '清除全部', action: { type: 'clear' }, className: 'key-fn key-span4' },
  ];

  const renderKey = (k: Key) => (
    <button
      key={k.aria}
      type="button"
      className={`kbd-key ${k.className ?? ''}`}
      onPointerDown={(e) => e.preventDefault()} // keep focus and caret on the input
      onClick={() => (k.enter ? onEnter() : k.action && onKey(k.action))}
      aria-label={k.aria}
    >
      {k.label}
    </button>
  );

  return (
    <div className="keypad" role="group" aria-label="螢幕鍵盤">
      <div className="kbd-block kbd-block--symbols">{symbolKeys.map(renderKey)}</div>
      <div className="kbd-block kbd-block--digits">{DIGIT_KEYS.map(renderKey)}</div>
      <div className="kbd-block kbd-block--fn">{FN_KEYS.map(renderKey)}</div>
    </div>
  );
}
