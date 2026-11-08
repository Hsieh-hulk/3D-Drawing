import type { KeypadAction } from './keypadEdit';

interface Key {
  label: string;
  aria: string;
  action: KeypadAction;
  className?: string;
}

const ins = (text: string, aria = `輸入 ${text}`): Key => ({ label: text, aria, action: { type: 'insert', text } });

/** 5 columns × 4 rows; the last row is built in the component because it needs the next point name. */
const GRID: Key[] = [
  ins('7'), ins('8'), ins('9'), ins('(', '輸入左括號'), ins(')', '輸入右括號'),
  ins('4'), ins('5'), ins('6'), ins(',', '輸入逗號'), { label: '⌫', aria: '刪除前一個字', action: { type: 'backspace' }, className: 'key-fn' },
  ins('1'), ins('2'), ins('3'), ins('/', '輸入分數線'), ins('√', '輸入根號'),
  ins('0'), ins('.', '輸入小數點'), ins('-', '輸入負號'), ins('π', '輸入 π'), { label: '清除', aria: '清除全部', action: { type: 'clear' }, className: 'key-fn' },
];

interface Props {
  nextName: string;
  onKey: (action: KeypadAction) => void;
}

/** On-screen keypad so coordinates can be entered without the system keyboard. */
export function NumericKeypad({ nextName, onKey }: Props) {
  const keys: Key[] = [
    ...GRID,
    { label: '◀', aria: '游標左移', action: { type: 'left' }, className: 'key-fn' },
    { label: '▶', aria: '游標右移', action: { type: 'right' }, className: 'key-fn' },
    ins('=', '輸入等號'),
    { label: `${nextName}(`, aria: `插入下一個點名 ${nextName}`, action: { type: 'insert', text: `${nextName}(` }, className: 'key-wide key-fn' },
  ];

  return (
    <div className="keypad" role="group" aria-label="數字鍵盤">
      {keys.map((k) => (
        <button
          key={k.aria}
          type="button"
          className={`btn btn-symbol keypad-key ${k.className ?? ''}`}
          onPointerDown={(e) => e.preventDefault()} // keep focus and caret on the input
          onClick={() => onKey(k.action)}
          aria-label={k.aria}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
