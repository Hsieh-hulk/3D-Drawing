import { describe, expect, it } from 'vitest';
import { EMPTY_SCENE, nextPointName } from '../src/model/scene';
import { applyKey } from '../src/ui/keypadEdit';

describe('applyKey', () => {
  it('inserts at the caret in the middle of the text', () => {
    expect(applyKey('A(1,3)', 4, 4, { type: 'insert', text: '2,' })).toEqual({ text: 'A(1,2,3)', caret: 6 });
  });

  it('replaces a selection when inserting', () => {
    expect(applyKey('A(1,9,3)', 4, 5, { type: 'insert', text: '2' })).toEqual({ text: 'A(1,2,3)', caret: 5 });
  });

  it('backspaces one character, or the whole selection', () => {
    expect(applyKey('A(12', 4, 4, { type: 'backspace' })).toEqual({ text: 'A(1', caret: 3 });
    expect(applyKey('A(123', 2, 5, { type: 'backspace' })).toEqual({ text: 'A(', caret: 2 });
    expect(applyKey('A', 0, 0, { type: 'backspace' })).toEqual({ text: 'A', caret: 0 });
  });

  it('clears everything', () => {
    expect(applyKey('A(1,2,3)', 3, 3, { type: 'clear' })).toEqual({ text: '', caret: 0 });
  });

  it('moves the caret left/right and stops at the edges', () => {
    expect(applyKey('abc', 2, 2, { type: 'left' }).caret).toBe(1);
    expect(applyKey('abc', 0, 0, { type: 'left' }).caret).toBe(0);
    expect(applyKey('abc', 1, 1, { type: 'right' }).caret).toBe(2);
    expect(applyKey('abc', 3, 3, { type: 'right' }).caret).toBe(3);
    // with a selection, arrows collapse to the selection edge
    expect(applyKey('abc', 1, 3, { type: 'left' }).caret).toBe(1);
    expect(applyKey('abc', 1, 3, { type: 'right' }).caret).toBe(3);
  });

  it('clamps out-of-range selections', () => {
    expect(applyKey('ab', 9, 9, { type: 'insert', text: 'c' })).toEqual({ text: 'abc', caret: 3 });
  });

  it('inserts the next point name with an opening parenthesis', () => {
    const name = nextPointName(EMPTY_SCENE);
    expect(applyKey('', 0, 0, { type: 'insert', text: `${name}(` })).toEqual({ text: `${name}(`, caret: name.length + 1 });
  });
});
