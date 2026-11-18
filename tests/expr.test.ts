import { describe, expect, it } from 'vitest';
import { compileExpr, evaluate, formatNumber, parseEquation, prettyExpr, splitTopLevel, toExactText } from '../src/model/expr';

function value(src: string): number {
  const r = evaluate(src);
  if (!r.ok) throw new Error(`expected ok for "${src}", got: ${r.error}`);
  return r.value;
}

describe('evaluate', () => {
  it.each([
    ['3', 3],
    ['-2', -2],
    ['+4', 4],
    ['2.5', 2.5],
    ['.5', 0.5],
    ['1/2', 0.5],
    ['-1/2', -0.5],
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['2^3', 8],
    ['2^-1', 0.5],
    ['-2^2', -4],
    ['10-4-3', 3],
    ['8/4/2', 1],
  ])('evaluates %s = %d', (src, expected) => {
    expect(value(src)).toBeCloseTo(expected, 12);
  });

  it('supports square roots in several notations', () => {
    expect(value('sqrt(3)')).toBeCloseTo(Math.sqrt(3));
    expect(value('√3')).toBeCloseTo(Math.sqrt(3));
    expect(value('2sqrt(3)')).toBeCloseTo(2 * Math.sqrt(3));
    expect(value('2√3')).toBeCloseTo(2 * Math.sqrt(3));
    expect(value('√3/2')).toBeCloseTo(Math.sqrt(3) / 2);
    expect(value('√(2+2)')).toBeCloseTo(2);
    expect(value('-sqrt(2)/2')).toBeCloseTo(-Math.SQRT2 / 2);
  });

  it('supports pi and implicit multiplication', () => {
    expect(value('pi')).toBeCloseTo(Math.PI);
    expect(value('π')).toBeCloseTo(Math.PI);
    expect(value('2pi')).toBeCloseTo(2 * Math.PI);
    expect(value('2(1+1)')).toBe(4);
    expect(value('(1+1)(2+1)')).toBe(6);
  });

  it('evaluates trig functions in degrees', () => {
    expect(value('sin(30)')).toBeCloseTo(0.5);
    expect(value('cos(60)')).toBeCloseTo(0.5);
    expect(value('tan(45)')).toBeCloseTo(1);
    expect(value('abs(-3)')).toBe(3);
  });

  it('normalizes full-width and typographic characters', () => {
    expect(value('１／２')).toBeCloseTo(0.5);
    expect(value('−3')).toBe(-3);
    expect(value('2×3')).toBe(6);
    expect(value('6÷4')).toBeCloseTo(1.5);
    expect(value('（1＋2）')).toBe(3);
  });

  it.each([
    ['', '請輸入數值'],
    ['   ', '請輸入數值'],
    ['1/0', '不能除以 0'],
    ['(1+2', '括號沒有成對'],
    ['1+', '算式不完整'],
    ['abc', '不認得'],
    ['sqrt(-1)', '根號內不能是負數'],
    ['√-4', '根號內不能是負數'],
    ['1)', '算式格式不正確'],
    ['3$', '無法辨識的符號'],
  ])('rejects %j with a Chinese error message', (src, msg) => {
    const r = evaluate(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it('never executes code', () => {
    expect(evaluate('alert(1)').ok).toBe(false);
    expect(evaluate('constructor').ok).toBe(false);
    expect(evaluate('__proto__').ok).toBe(false);
  });
});

describe('compileExpr', () => {
  const fn = (src: string) => {
    const r = compileExpr(src);
    if (!r.ok) throw new Error(`expected ok for "${src}", got: ${r.error}`);
    return r.fn;
  };

  it('evaluates variables with implicit multiplication', () => {
    expect(fn('x^2')(3, 0)).toBe(9);
    expect(fn('2x+1')(2, 0)).toBe(5);
    expect(fn('xy')(2, 3)).toBe(6);
    expect(fn('-x^2')(3, 0)).toBe(-9);
  });

  it('uses radians and splits glued function names', () => {
    expect(fn('sin(x)')(Math.PI / 2, 0)).toBeCloseTo(1);
    expect(fn('xsin(x)')(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2);
    expect(fn('ln(x)')(Math.E, 0)).toBeCloseTo(1);
    expect(fn('exp(x)')(0, 0)).toBe(1);
  });

  it('returns non-finite values instead of throwing', () => {
    expect(fn('1/x')(0, 0)).toBe(Infinity);
    expect(fn('sqrt(x)')(-1, 0)).toBeNaN();
  });

  it('keeps coordinate input in degrees', () => {
    expect(evaluate('asin(1/2)').ok && evaluate('asin(1/2)')).toMatchObject({ value: expect.closeTo(30) });
  });
});

describe('parseEquation', () => {
  it.each([
    ['y = x^2', 'y', 2, 4, false],
    ['x = y^2', 'x', 2, 4, false],
    ['x^2 = y', 'y', 3, 9, false],
    ['x = 3', 'x', 7, 3, true],
    ['Y = -1', 'y', 5, -1, true],
    ['ｙ＝２ｘ', 'y', 2, 4, false],
  ] as const)('parses %s', (src, solveFor, t, expected, constant) => {
    const r = parseEquation(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solveFor).toBe(solveFor);
    expect(r.fn(t)).toBeCloseTo(expected);
    expect(r.constant).toBe(constant);
  });

  it.each([
    ['', '請輸入方程式'],
    ['x^2', '需要一個'],
    ['y = x = 1', '只能有一個'],
    ['x^2 + y^2 = 4', '目前只支援'],
    ['y = y + 1', '目前只支援'],
    ['y = z', '不認得'],
  ])('rejects %j', (src, msg) => {
    const r = parseEquation(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });
});

describe('helpers', () => {
  it('splits on top-level commas only', () => {
    expect(splitTopLevel('1, sqrt(2), (1+2)')).toEqual(['1', 'sqrt(2)', '(1+2)']);
    expect(splitTopLevel('1,2')).toEqual(['1', '2']);
  });

  it('pretty-prints expressions', () => {
    expect(prettyExpr('sqrt(3)')).toBe('√3');
    expect(prettyExpr('2*pi')).toBe('2·π');
    expect(prettyExpr(' 1 / 2 ')).toBe('1/2');
  });

  it('writes rationals and surds exactly', () => {
    expect(toExactText(2)).toBe('2');
    expect(toExactText(-0.5)).toBe('-1/2');
    expect(toExactText(Math.sqrt(3))).toBe('sqrt(3)');
    expect(toExactText(Math.sqrt(3) / 2)).toBe('sqrt(3)/2');
    expect(toExactText((2 * Math.sqrt(6)) / 3)).toBe('2sqrt(6)/3');
    expect(toExactText(Math.PI)).toBe('3.142');
  });

  it('formats numbers compactly', () => {
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(1.23456)).toBe('1.235');
    expect(formatNumber(-0.0001)).toBe('0');
  });
});
