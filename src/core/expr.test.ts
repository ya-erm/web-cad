// The expression evaluator of value fields: units, variables, functions, the decimal comma.

import { describe, expect, it } from 'vitest';
import { evaluate, parseDecimal, parseExpression } from './expr';

const ctx = { vars: { w: { v: 40, len: 1, ang: 0 } }, lengthUnit: 'mm' as const, angleUnit: 'deg' as const };
const len = (s: string) => evaluate(s, 'length', ctx);

describe('Expressions', () => {
  it('reads units, variables and functions', () => {
    expect(len('25')).toBe(25);
    expect(len('1 in + 3 mm')).toBeCloseTo(28.4, 9);
    expect(len('#w / 2')).toBe(20);
    expect(len('max(10, 20)')).toBe(20);
    expect(evaluate('30 deg', 'angle', ctx)).toBeCloseTo(Math.PI / 6, 12);
  });

  it('takes a decimal comma as well as the point', () => {
    expect(len('2,5')).toBe(2.5);
    expect(len('2,5 mm')).toBe(2.5);
    expect(len('1,5 cm + 0.5 mm')).toBe(15.5);
    expect(len('#w * 0,25')).toBe(10);
    expect(len('sqrt(6,25)')).toBe(2.5);
    expect(len('1,5e1')).toBe(15);
    expect(evaluate('22,5 deg', 'angle', ctx)).toBeCloseTo(Math.PI / 8, 12);
  });

  it('keeps the comma between the arguments of min, max and atan2', () => {
    // as before: of 1 and 5
    expect(len('max(1,5)')).toBe(5);
    expect(len('min(1,5)')).toBe(1);
    expect(len('max(1, 5)')).toBe(5);
    // a decimal there: in brackets of its own, or with the point
    expect(len('max((2,5), 2)')).toBe(2.5);
    expect(len('max(2.5, 2)')).toBe(2.5);
    // inside another function within them the comma is decimal again
    expect(len('max(sqrt(6,25), 2)')).toBe(2.5);
    // and after them
    expect(len('max(1, 2) + 0,5')).toBe(2.5);
  });

  it('refuses a comma that is not between digits', () => {
    expect(() => parseExpression('2,')).toThrow();
    expect(() => parseExpression(',5')).toThrow();
    expect(() => parseExpression('2, 5')).toThrow();
  });

  it('reads plain decimal numbers of other fields', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal(' 7.25 ')).toBe(7.25);
    expect(parseDecimal('')).toBeNaN();
    expect(parseDecimal('abc')).toBeNaN();
  });
});
