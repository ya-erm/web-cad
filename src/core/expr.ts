// Expression evaluator with units, used for every numeric field (Onshape style):
//   "25", "25 mm", "1 in + 3 mm", "#width / 2", "30 deg", "sqrt(#a^2 + #b^2)".
// Quantities carry a length exponent and an angle exponent so units are checked loosely.

import type { AngleUnit, LengthUnit } from './types';

export interface Quantity {
  /** Value in base units: millimetres for length, radians for angle. */
  v: number;
  len: number;
  ang: number;
}

export type ValueKind = 'length' | 'angle' | 'number';

export type VariableTable = Record<string, Quantity>;

const LENGTH_UNITS: Record<string, number> = {
  mm: 1,
  millimeter: 1,
  cm: 10,
  centimeter: 10,
  m: 1000,
  meter: 1000,
  in: 25.4,
  inch: 25.4,
  ft: 304.8,
  foot: 304.8,
  yd: 914.4,
  um: 0.001,
};

const ANGLE_UNITS: Record<string, number> = {
  deg: Math.PI / 180,
  degree: Math.PI / 180,
  '°': Math.PI / 180,
  rad: 1,
  radian: 1,
};

export const LENGTH_FACTOR: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export class ExprError extends Error {}

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'var'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new ExprError(`Bad number near "${src.slice(i)}"`);
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '#') {
      const m = /^#[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (!m) throw new ExprError('Bad variable name');
      out.push({ t: 'var', v: m[0].slice(1) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_°]/.test(ch)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*|°)/.exec(src.slice(i));
      out.push({ t: 'id', v: m![0] });
      i += m![0].length;
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character "${ch}"`);
  }
  return out;
}

const q = (v: number, len = 0, ang = 0): Quantity => ({ v, len, ang });

function sameDims(a: Quantity, b: Quantity) {
  return a.len === b.len && a.ang === b.ang;
}

const FUNCS: Record<string, (args: Quantity[]) => Quantity> = {
  sqrt: ([a]) => q(Math.sqrt(a.v), a.len / 2, a.ang / 2),
  abs: ([a]) => q(Math.abs(a.v), a.len, a.ang),
  sin: ([a]) => q(Math.sin(a.ang ? a.v : (a.v * Math.PI) / 180)),
  cos: ([a]) => q(Math.cos(a.ang ? a.v : (a.v * Math.PI) / 180)),
  tan: ([a]) => q(Math.tan(a.ang ? a.v : (a.v * Math.PI) / 180)),
  asin: ([a]) => q(Math.asin(a.v), 0, 1),
  acos: ([a]) => q(Math.acos(a.v), 0, 1),
  atan: ([a]) => q(Math.atan(a.v), 0, 1),
  atan2: ([a, b]) => q(Math.atan2(a.v, b.v), 0, 1),
  min: (args) => args.reduce((m, x) => (x.v < m.v ? x : m)),
  max: (args) => args.reduce((m, x) => (x.v > m.v ? x : m)),
  floor: ([a]) => q(Math.floor(a.v), a.len, a.ang),
  ceil: ([a]) => q(Math.ceil(a.v), a.len, a.ang),
  round: ([a]) => q(Math.round(a.v), a.len, a.ang),
};

class Parser {
  private pos = 0;
  private readonly toks: Token[];
  private readonly vars: VariableTable;
  constructor(toks: Token[], vars: VariableTable) {
    this.toks = toks;
    this.vars = vars;
  }

  parse(): Quantity {
    const r = this.expr();
    if (this.pos < this.toks.length) throw new ExprError('Unexpected input');
    return r;
  }

  private peek() {
    return this.toks[this.pos];
  }

  private isOp(v: string) {
    const t = this.peek();
    return t && t.t === 'op' && t.v === v;
  }

  private expr(): Quantity {
    let a = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.pos++] as { v: string }).v;
      const b = this.term();
      a = addSub(a, b, op === '+' ? 1 : -1);
    }
    return a;
  }

  private term(): Quantity {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.toks[this.pos++] as { v: string }).v;
      const b = this.unary();
      a = op === '*' ? q(a.v * b.v, a.len + b.len, a.ang + b.ang) : q(a.v / b.v, a.len - b.len, a.ang - b.ang);
    }
    return a;
  }

  private unary(): Quantity {
    if (this.isOp('-')) {
      this.pos++;
      const a = this.unary();
      return q(-a.v, a.len, a.ang);
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Quantity {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.pos++;
      const e = this.unary();
      return q(Math.pow(base.v, e.v), base.len * e.v, base.ang * e.v);
    }
    return base;
  }

  /** Primary optionally followed by a unit identifier ("10 mm", "(a+b) in"). */
  private postfix(): Quantity {
    const p = this.primary();
    const t = this.peek();
    if (t && t.t === 'id' && !(t.v in FUNCS)) {
      const u = t.v;
      if (u in LENGTH_UNITS) {
        this.pos++;
        return q(p.v * LENGTH_UNITS[u], p.len + 1, p.ang);
      }
      if (u in ANGLE_UNITS) {
        this.pos++;
        return q(p.v * ANGLE_UNITS[u], p.len, p.ang + 1);
      }
    }
    return p;
  }

  private primary(): Quantity {
    const t = this.toks[this.pos++];
    if (!t) throw new ExprError('Unexpected end of expression');
    if (t.t === 'num') return q(t.v);
    if (t.t === 'var') {
      const v = this.vars[t.v];
      if (!v) throw new ExprError(`Unknown variable #${t.v}`);
      return v;
    }
    if (t.t === 'id') {
      if (t.v === 'PI' || t.v === 'pi') return q(Math.PI);
      const fn = FUNCS[t.v];
      if (fn) {
        if (!this.isOp('(')) throw new ExprError(`Expected ( after ${t.v}`);
        this.pos++;
        const args: Quantity[] = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) {
            this.pos++;
            args.push(this.expr());
          }
        }
        if (!this.isOp(')')) throw new ExprError('Expected )');
        this.pos++;
        return fn(args);
      }
      throw new ExprError(`Unknown name "${t.v}"`);
    }
    if (t.t === 'op' && t.v === '(') {
      const r = this.expr();
      if (!this.isOp(')')) throw new ExprError('Expected )');
      this.pos++;
      return r;
    }
    throw new ExprError('Unexpected token');
  }
}

function addSub(a: Quantity, b: Quantity, sign: number): Quantity {
  // Allow adding a bare number to a dimensioned value: the number takes the same dimension
  // (keeps "10 + 5 mm" usable). Mismatched dimensions are an error.
  if (!sameDims(a, b)) {
    const aBare = a.len === 0 && a.ang === 0;
    const bBare = b.len === 0 && b.ang === 0;
    if (!aBare && !bBare) throw new ExprError('Mismatched units');
    const dims = aBare ? b : a;
    return q(a.v + sign * b.v, dims.len, dims.ang);
  }
  return q(a.v + sign * b.v, a.len, a.ang);
}

export function parseExpression(src: string, vars: VariableTable = {}): Quantity {
  const s = src.trim();
  if (!s) throw new ExprError('Empty expression');
  return new Parser(tokenize(s), vars).parse();
}

export interface EvalContext {
  vars: VariableTable;
  lengthUnit: LengthUnit;
  angleUnit: AngleUnit;
}

/** Evaluate to a plain number in base units: mm for lengths, radians for angles.
 *  Unitless input is interpreted in the document's default unit. */
export function evaluate(src: string, kind: ValueKind, ctx: EvalContext): number {
  const r = parseExpression(src, ctx.vars);
  if (kind === 'length') {
    if (r.len === 0 && r.ang === 0) return r.v * LENGTH_FACTOR[ctx.lengthUnit];
    if (r.len !== 1 || r.ang !== 0) throw new ExprError('Expected a length');
    return r.v;
  }
  if (kind === 'angle') {
    if (r.len === 0 && r.ang === 0) return ctx.angleUnit === 'deg' ? (r.v * Math.PI) / 180 : r.v;
    if (r.ang !== 1 || r.len !== 0) throw new ExprError('Expected an angle');
    return r.v;
  }
  return r.v;
}

/** Try-evaluate helper: returns null instead of throwing. */
export function tryEvaluate(src: string, kind: ValueKind, ctx: EvalContext): number | null {
  try {
    const v = evaluate(src, kind, ctx);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Variable definition: keeps the dimension of the expression; bare numbers stay unitless. */
export function evaluateVariable(src: string, vars: VariableTable): Quantity {
  return parseExpression(src, vars);
}

export function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
}

/** Format a base-unit length for display in the document unit, e.g. "25 mm". */
export function formatLength(mm: number, unit: LengthUnit, digits = 3): string {
  return `${formatNumber(mm / LENGTH_FACTOR[unit], digits)} ${unit}`;
}

export function formatAngle(rad: number, unit: AngleUnit = 'deg', digits = 3): string {
  return unit === 'deg' ? `${formatNumber((rad * 180) / Math.PI, digits)} deg` : `${formatNumber(rad, digits)} rad`;
}

export function formatQuantity(qv: Quantity, unit: LengthUnit): string {
  if (qv.len === 1 && qv.ang === 0) return formatLength(qv.v, unit);
  if (qv.ang === 1 && qv.len === 0) return formatAngle(qv.v);
  if (qv.len === 0 && qv.ang === 0) return formatNumber(qv.v, 4);
  const f = LENGTH_FACTOR[unit] ** qv.len;
  return `${formatNumber(qv.v / f, 4)} ${unit}^${qv.len}`;
}

export function isValidVariableName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Evaluate a typed variable definition (Onshape: Length / Angle / Number / Any). */
export function evaluateTypedVariable(
  src: string,
  type: 'length' | 'angle' | 'number' | 'any' | undefined,
  ctx: EvalContext,
): Quantity {
  if (!type || type === 'any') return parseExpression(src, ctx.vars);
  const v = evaluate(src, type, ctx);
  if (type === 'length') return { v, len: 1, ang: 0 };
  if (type === 'angle') return { v, len: 0, ang: 1 };
  return { v, len: 0, ang: 0 };
}
