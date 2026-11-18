/**
 * Small, safe arithmetic expression evaluator for coordinate input (no eval / new Function).
 *
 * Grammar (implicit multiplication is allowed between adjacent factors, e.g. `2sqrt(3)`, `3pi`, `2(1+1)`):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary | <implicit> power)*
 *   unary   := ('-' | '+') unary | power
 *   power   := primary '°'* ('^' unary)?
 *   primary := number | 'pi' | 'π' | 'e' | var | func '(' expr ')' | '√' primary | '(' expr ')'
 *   func    := sqrt | cbrt | abs | ln | log | exp | sin | cos | tan | asin | acos | atan | deg | rad
 *   var     := x | y   (only in compileExpr / parseEquation)
 *
 * evaluate() (coordinate input) takes trig in degrees, as in high-school problems;
 * compileExpr() / parseEquation() (graphs) take radians, like Desmos.
 * Either mode accepts explicit units: `30°` / `deg(30)` is 30 degrees, `rad(π/6)` is π/6 radians.
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
    .replace(/。/g, '.')
    .replace(/º/g, '°')
    // Common handwriting / programming forms: x**2 → x^2, |x| → abs(x).
    .replace(/\*\*/g, '^')
    .replace(/\|([^|]+)\|/g, 'abs($1)');
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' | '(' | ')' | '√' | '°' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      // Scientific notation (1e-3, 2E+2) only when digits follow the e; otherwise `2e` stays 2·e.
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`無法辨識的數字「${ch}」`);
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Zπ]/.test(ch)) {
      const m = /^(π|[a-zA-Z]+)/.exec(src.slice(i))!;
      tokens.push({ t: 'id', v: m[1].toLowerCase() });
      i += m[1].length;
    } else if ('+-*/^()√°'.includes(ch)) {
      tokens.push({ t: 'op', v: ch as '+' });
      i++;
    } else {
      // Read a whole code point so emoji and other astral characters are not shown as broken halves.
      const whole = String.fromCodePoint(src.codePointAt(i) ?? 0);
      throw new Error(`無法辨識的符號「${whole}」`);
    }
  }
  return tokens;
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };
const DEG = Math.PI / 180;
/** Functions shared by both angle modes. */
const BASE_FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
};
/** Coordinate input: trig in degrees, as in high-school problems. */
const DEG_FUNCS: Record<string, (x: number) => number> = {
  ...BASE_FUNCS,
  sin: (x) => Math.sin(x * DEG),
  cos: (x) => Math.cos(x * DEG),
  tan: (x) => Math.tan(x * DEG),
  asin: (x) => Math.asin(x) / DEG,
  acos: (x) => Math.acos(x) / DEG,
  atan: (x) => Math.atan(x) / DEG,
  // Unit markers: the argument is in degrees / radians, converted to this mode's angle unit.
  deg: (x) => x,
  rad: (x) => x / DEG,
};
/** Equations such as y = sin(x): x is a length, so trig takes radians (like Desmos). */
const RAD_FUNCS: Record<string, (x: number) => number> = {
  ...BASE_FUNCS,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  deg: (x) => x * DEG,
  rad: (x) => x,
};

/**
 * Real power: a negative base with a fractional exponent p/q (q odd) has a real root, e.g. (-8)^(1/3) = -2,
 * which Math.pow reports as NaN. Even denominators (x^(1/2)) stay NaN.
 */
export function realPow(b: number, e: number): number {
  const r = Math.pow(b, e);
  if (!Number.isNaN(r) || !(b < 0) || !Number.isFinite(e)) return r;
  for (let q = 3; q <= 99; q += 2) {
    const p = Math.round(e * q);
    if (Math.abs(e * q - p) < 1e-9) {
      const mag = Math.pow(-b, e);
      return p % 2 === 0 ? mag : -mag;
    }
  }
  return r;
}

/** Compiled expression; unused variables are simply ignored. */
export type CompiledFn = (x: number, y: number) => number;
type Var = 'x' | 'y';

interface ParseOptions {
  vars: readonly Var[];
  funcs: Record<string, (x: number) => number>;
  /** true: throw on 1/0 and √(negative) (coordinate input); false: return ±Infinity / NaN (graph sampling). */
  strict: boolean;
}

const STRICT_OPTS: ParseOptions = { vars: [], funcs: DEG_FUNCS, strict: true };

/**
 * With variables allowed, students write `2x`, `xsin(x)` or `sinx`; the tokenizer reads letters greedily,
 * so split each unknown identifier into known names (longest match first). Unknown parts stay as-is and
 * produce the usual "不認得" error.
 */
function splitIdentifiers(tokens: Token[], opts: ParseOptions): Token[] {
  if (opts.vars.length === 0) return tokens;
  const known = [...Object.keys(opts.funcs), ...Object.keys(CONSTANTS), ...opts.vars].sort((a, b) => b.length - a.length);
  const isKnown = (s: string) => Object.hasOwn(opts.funcs, s) || Object.hasOwn(CONSTANTS, s) || (opts.vars as readonly string[]).includes(s);
  const out: Token[] = [];
  for (const tk of tokens) {
    if (tk.t !== 'id' || isKnown(tk.v)) {
      out.push(tk);
      continue;
    }
    let rest = tk.v;
    const parts: string[] = [];
    while (rest) {
      const name = known.find((k) => rest.startsWith(k));
      if (!name) {
        parts.length = 0;
        break;
      }
      parts.push(name);
      rest = rest.slice(name.length);
    }
    if (parts.length === 0) out.push(tk);
    else parts.forEach((v) => out.push({ t: 'id', v }));
  }
  return out;
}

class Parser {
  private pos = 0;
  /** Variables actually referenced by the expression. */
  readonly used = new Set<Var>();
  constructor(
    private readonly tokens: Token[],
    private readonly opts: ParseOptions = STRICT_OPTS,
  ) {}

  parse(): CompiledFn {
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

  private expr(): CompiledFn {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.pos++] as { v: string }).v;
      const l = v;
      const r = this.term();
      v = op === '+' ? (x, y) => l(x, y) + r(x, y) : (x, y) => l(x, y) - r(x, y);
    }
    return v;
  }

  /** True when the next token can start an implicitly multiplied factor. */
  private startsFactor(): boolean {
    const tk = this.peek();
    if (!tk) return false;
    return tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && (tk.v === '(' || tk.v === '√'));
  }

  private term(): CompiledFn {
    let v = this.unary();
    for (;;) {
      const l = v;
      if (this.isOp('*')) {
        this.pos++;
        const r = this.unary();
        v = (x, y) => l(x, y) * r(x, y);
      } else if (this.isOp('/')) {
        this.pos++;
        const r = this.unary();
        v = this.opts.strict
          ? (x, y) => {
              const d = r(x, y);
              if (d === 0) throw new Error('不能除以 0');
              return l(x, y) / d;
            }
          : (x, y) => l(x, y) / r(x, y);
      } else if (this.startsFactor()) {
        const r = this.power();
        v = (x, y) => l(x, y) * r(x, y);
      } else {
        return v;
      }
    }
  }

  private unary(): CompiledFn {
    if (this.isOp('-')) {
      this.pos++;
      const f = this.unary();
      return (x, y) => -f(x, y);
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): CompiledFn {
    let base = this.primary();
    // Postfix degree sign: 30° means 30 degrees in either angle mode.
    while (this.isOp('°')) {
      this.pos++;
      const inner = base;
      const toUnit = this.opts.funcs.deg;
      base = (x, y) => toUnit(inner(x, y));
    }
    if (this.isOp('^')) {
      this.pos++;
      const e = this.unary();
      const b = base;
      return (x, y) => realPow(b(x, y), e(x, y));
    }
    return base;
  }

  /** Square root; strict mode rejects negative arguments with a readable message. */
  private sqrtOf(f: CompiledFn): CompiledFn {
    if (!this.opts.strict) return (x, y) => Math.sqrt(f(x, y));
    return (x, y) => {
      const v = f(x, y);
      if (v < 0) throw new Error('根號內不能是負數');
      return Math.sqrt(v);
    };
  }

  private primary(): CompiledFn {
    const tk = this.peek();
    if (!tk) throw new Error('算式不完整');
    if (tk.t === 'num') {
      this.pos++;
      const c = tk.v;
      return () => c;
    }
    if (tk.t === 'op' && tk.v === '(') {
      this.pos++;
      const v = this.expr();
      this.expect(')');
      return v;
    }
    if (tk.t === 'op' && tk.v === '√') {
      this.pos++;
      return this.sqrtOf(this.unary());
    }
    if (tk.t === 'id') {
      this.pos++;
      if (tk.v === 'x' && this.opts.vars.includes('x')) {
        this.used.add('x');
        return (x) => x;
      }
      if (tk.v === 'y' && this.opts.vars.includes('y')) {
        this.used.add('y');
        return (_x, y) => y;
      }
      // Object.hasOwn guards against inherited keys such as "constructor" or "__proto__".
      if (Object.hasOwn(CONSTANTS, tk.v)) {
        const c = CONSTANTS[tk.v];
        return () => c;
      }
      if (Object.hasOwn(this.opts.funcs, tk.v)) {
        const fn = this.opts.funcs[tk.v];
        if (!this.isOp('(')) throw new Error(`${tk.v} 後面要加括號，例如 ${tk.v}(x)`);
        this.expect('(');
        const arg = this.expr();
        this.expect(')');
        if (tk.v === 'sqrt') return this.sqrtOf(arg);
        return (x, y) => fn(arg(x, y));
      }
      throw new Error(`不認得「${tk.v}」`);
    }
    throw new Error('算式格式不正確');
  }
}

export function evaluate(src: string): ExprResult {
  try {
    const value = new Parser(tokenize(normalizeInput(src).trim())).parse()(0, 0);
    if (!Number.isFinite(value)) return { ok: false, error: '結果不是有限的數' };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type CompileResult = { ok: true; fn: CompiledFn; used: Set<Var> } | { ok: false; error: string };

/**
 * Compiles an expression in x and/or y for graphing (radians, non-strict: 1/0 → Infinity, √-1 → NaN,
 * so the sampler can simply skip those points).
 */
export function compileExpr(src: string, vars: readonly Var[] = ['x', 'y']): CompileResult {
  try {
    const opts: ParseOptions = { vars, funcs: RAD_FUNCS, strict: false };
    const parser = new Parser(splitIdentifiers(tokenize(normalizeInput(src).trim()), opts), opts);
    const fn = parser.parse();
    return { ok: true, fn, used: parser.used };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A 2D equation solved for one variable: `y = f(x)` (solveFor 'y', fn takes x) or `x = f(y)`
 * (solveFor 'x', fn takes y). `x = 3` / `y = -1` are the constant cases.
 */
export type Equation2D = { solveFor: 'x' | 'y'; fn: (t: number) => number; constant: boolean };
export type EquationResult = ({ ok: true } & Equation2D) | { ok: false; error: string };

const UNSUPPORTED_EQ = '目前只支援 y = f(x) 或 x = f(y)，例如 y = x^2、x = 3';

export function parseEquation(src: string): EquationResult {
  const text = normalizeInput(src).trim();
  if (!text) return { ok: false, error: '請輸入方程式，例如 y = x^2' };
  const sides = text.split('=');
  if (sides.length !== 2) return { ok: false, error: sides.length < 2 ? '方程式需要一個「=」' : '方程式只能有一個「=」' };
  const [lhs, rhs] = sides.map((s) => s.trim().toLowerCase());
  let solveFor: 'x' | 'y';
  let body: string;
  if (lhs === 'y' || lhs === 'x') {
    solveFor = lhs;
    body = sides[1];
  } else if (rhs === 'y' || rhs === 'x') {
    solveFor = rhs;
    body = sides[0];
  } else {
    return { ok: false, error: UNSUPPORTED_EQ };
  }
  const other: Var = solveFor === 'y' ? 'x' : 'y';
  const c = compileExpr(body, ['x', 'y']);
  if (!c.ok) return c;
  if (c.used.has(solveFor)) return { ok: false, error: UNSUPPORTED_EQ };
  const fn = c.fn;
  return {
    ok: true,
    solveFor,
    fn: other === 'x' ? (t) => fn(t, 0) : (t) => fn(0, t),
    constant: c.used.size === 0,
  };
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
