/**
 * Small, safe arithmetic expression evaluator for coordinate input (no eval / new Function).
 *
 * Grammar (implicit multiplication is allowed between adjacent factors, e.g. `2sqrt(3)`, `3pi`, `2(1+1)`):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary | <implicit> power)*
 *   unary   := ('-' | '+') unary | power
 *   power   := primary ('^' unary)?
 *   primary := number | 'pi' | 'π' | 'e' | func '(' expr ')' | '√' primary | '(' expr ')'
 *   func    := sqrt | sin | cos | tan | abs   (trig functions take degrees, as in high-school problems)
 */

export type ExprResult = { ok: true; value: number } | { ok: false; error: string };

/** Converts full-width and typographic characters students commonly type on iPad/Chinese IMEs. */
export function normalizeInput(src: string): string {
  return src
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/、/g, ',')
    .replace(/。/g, '.');
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' | '(' | ')' | '√' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new Error(`無法辨識的數字「${ch}」`);
      tokens.push({ t: 'num', v: parseFloat(m[1]) });
      i += m[1].length;
    } else if (/[a-zA-Zπ]/.test(ch)) {
      const m = /^(π|[a-zA-Z]+)/.exec(src.slice(i))!;
      tokens.push({ t: 'id', v: m[1].toLowerCase() });
      i += m[1].length;
    } else if ('+-*/^()√'.includes(ch)) {
      tokens.push({ t: 'op', v: ch as '+' });
      i++;
    } else {
      throw new Error(`無法辨識的符號「${ch}」`);
    }
  }
  return tokens;
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };
const DEG = Math.PI / 180;
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: (x) => Math.sin(x * DEG),
  cos: (x) => Math.cos(x * DEG),
  tan: (x) => Math.tan(x * DEG),
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    if (this.tokens.length === 0) throw new Error('請輸入數值');
    const v = this.expr();
    if (this.pos < this.tokens.length) throw new Error('算式格式不正確');
    return v;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(v: string): boolean {
    const tk = this.peek();
    return tk?.t === 'op' && tk.v === v;
  }

  private expect(v: string): void {
    if (!this.isOp(v)) throw new Error(v === ')' ? '括號沒有成對' : `缺少「${v}」`);
    this.pos++;
  }

  private expr(): number {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.pos++] as { v: string }).v;
      const r = this.term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  /** True when the next token can start an implicitly multiplied factor. */
  private startsFactor(): boolean {
    const tk = this.peek();
    if (!tk) return false;
    return tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && (tk.v === '(' || tk.v === '√'));
  }

  private term(): number {
    let v = this.unary();
    for (;;) {
      if (this.isOp('*')) {
        this.pos++;
        v *= this.unary();
      } else if (this.isOp('/')) {
        this.pos++;
        const d = this.unary();
        if (d === 0) throw new Error('不能除以 0');
        v /= d;
      } else if (this.startsFactor()) {
        v *= this.power();
      } else {
        return v;
      }
    }
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.pos++;
      return -this.unary();
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.primary();
    if (this.isOp('^')) {
      this.pos++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  private primary(): number {
    const tk = this.peek();
    if (!tk) throw new Error('算式不完整');
    if (tk.t === 'num') {
      this.pos++;
      return tk.v;
    }
    if (tk.t === 'op' && tk.v === '(') {
      this.pos++;
      const v = this.expr();
      this.expect(')');
      return v;
    }
    if (tk.t === 'op' && tk.v === '√') {
      this.pos++;
      const v = this.unary();
      if (v < 0) throw new Error('根號內不能是負數');
      return Math.sqrt(v);
    }
    if (tk.t === 'id') {
      this.pos++;
      // Object.hasOwn guards against inherited keys such as "constructor" or "__proto__".
      if (Object.hasOwn(CONSTANTS, tk.v)) return CONSTANTS[tk.v];
      if (Object.hasOwn(FUNCS, tk.v)) {
        const fn = FUNCS[tk.v];
        this.expect('(');
        const arg = this.expr();
        this.expect(')');
        if (tk.v === 'sqrt' && arg < 0) throw new Error('根號內不能是負數');
        return fn(arg);
      }
      throw new Error(`不認得「${tk.v}」`);
    }
    throw new Error('算式格式不正確');
  }
}

export function evaluate(src: string): ExprResult {
  try {
    const value = new Parser(tokenize(normalizeInput(src).trim())).parse();
    if (!Number.isFinite(value)) return { ok: false, error: '結果不是有限的數' };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Splits on top-level commas (ignoring commas inside parentheses). */
export function splitTopLevel(src: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts.map((p) => p.trim());
}

/** Pretty form of a user expression for labels: `sqrt(3)` → `√3`, `*` → `·`. */
export function prettyExpr(src: string): string {
  return normalizeInput(src)
    .trim()
    .replace(/sqrt\(\s*([0-9.]+)\s*\)/gi, '√$1')
    .replace(/sqrt/gi, '√')
    .replace(/pi/gi, 'π')
    .replace(/\*/g, '·')
    .replace(/\s+/g, '');
}

/**
 * Writes a number exactly when it is a small rational or rational multiple of √k
 * (e.g. 0.8660254 → "sqrt(3)/2"), otherwise as a compact decimal. Output is valid parser input.
 */
export function toExactText(v: number): string {
  if (Math.abs(v) < 1e-12) return '0';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  for (const k of [1, 2, 3, 5, 6, 7]) {
    const r = abs / Math.sqrt(k);
    for (let q = 1; q <= 12; q++) {
      const p = Math.round(r * q);
      if (p === 0 || Math.abs(r * q - p) > 1e-9 * Math.max(1, p)) continue;
      const g = gcd(p, q);
      const [pp, qq] = [p / g, q / g];
      const num = k === 1 ? `${pp}` : pp === 1 ? `sqrt(${k})` : `${pp}sqrt(${k})`;
      return `${sign}${qq === 1 ? num : `${num}/${qq}`}`;
    }
  }
  return formatNumber(v);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Formats a number compactly (up to 3 decimals, trailing zeros removed). */
export function formatNumber(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}
