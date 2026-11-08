/** Pure text/caret editing for the on-screen keypad, kept free of React/DOM so it can be unit tested. */

export type KeypadAction =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'left' }
  | { type: 'right' };

export interface EditResult {
  text: string;
  caret: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Applies a keypad action to `text` with the current selection [selStart, selEnd).
 * Returns the new text and a collapsed caret position.
 */
export function applyKey(text: string, selStart: number, selEnd: number, action: KeypadAction): EditResult {
  const start = clamp(Math.min(selStart, selEnd), 0, text.length);
  const end = clamp(Math.max(selStart, selEnd), 0, text.length);
  const hasSelection = end > start;

  switch (action.type) {
    case 'insert':
      return { text: text.slice(0, start) + action.text + text.slice(end), caret: start + action.text.length };
    case 'backspace':
      if (hasSelection) return { text: text.slice(0, start) + text.slice(end), caret: start };
      if (start === 0) return { text, caret: 0 };
      return { text: text.slice(0, start - 1) + text.slice(start), caret: start - 1 };
    case 'clear':
      return { text: '', caret: 0 };
    case 'left':
      return { text, caret: hasSelection ? start : Math.max(0, start - 1) };
    case 'right':
      return { text, caret: hasSelection ? end : Math.min(text.length, end + 1) };
  }
}
