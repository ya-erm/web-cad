import { describe, expect, it } from 'vitest';
import { arcSweep, arrowTriangle, parseColor, primBounds, STYLE_DEFAULTS, textWidth, textFrame } from './prim2d';

describe('prim2d', () => {
  it('computes bounds of lines, arcs, circles and ellipses', () => {
    const b = primBounds([
      { t: 'line', a: [-1, 2], b: [3, 4] },
      { t: 'arc', c: [10, 0], r: 2, a0: 0, a1: Math.PI / 2 },
    ]);
    expect(b.min[0]).toBeCloseTo(-1);
    expect(b.min[1]).toBeCloseTo(0);
    expect(b.max[0]).toBeCloseTo(12);
    expect(b.max[1]).toBeCloseTo(4);

    const e = primBounds([{ t: 'ellipse', c: [0, 0], rx: 4, ry: 1, rot: Math.PI / 2 }]);
    expect(e.max[0]).toBeCloseTo(1);
    expect(e.max[1]).toBeCloseTo(4);

    const arc = primBounds([{ t: 'arc', c: [0, 0], r: 1, a0: Math.PI / 4, a1: (3 * Math.PI) / 4 }]);
    expect(arc.max[1]).toBeCloseTo(1); // passes through 90°
    expect(arc.min[1]).toBeCloseTo(Math.SQRT1_2);

    expect(primBounds([])).toEqual({ min: [0, 0], max: [0, 0] });
  });

  it('normalises arc sweeps', () => {
    expect(arcSweep(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(arcSweep(0, -Math.PI / 2)).toBeCloseTo(1.5 * Math.PI);
    expect(arcSweep(1, 1 + 2 * Math.PI)).toBeCloseTo(2 * Math.PI);
    expect(arcSweep(1, 1)).toBe(0);
  });

  it('builds arrowheads and text frames', () => {
    const [tip, l, r] = arrowTriangle({ tip: [0, 0], dir: [0, 2], size: 3 });
    expect(tip).toEqual([0, 0]);
    expect(l[1]).toBeCloseTo(-3);
    expect(r[1]).toBeCloseTo(-3);
    expect(Math.abs(l[0] - r[0])).toBeCloseTo(1);

    expect(textWidth('AB', 10)).toBeCloseTo(13.34);
    const f = textFrame({ t: 'text', p: [10, 0], text: 'AB', h: 10, align: 'right' });
    expect(f.origin[0]).toBeCloseTo(10 - 13.34);
  });

  it('parses colours', () => {
    expect(parseColor('#f80')).toEqual([255, 136, 0, 255]);
    expect(parseColor('#11223344')).toEqual([17, 34, 51, 68]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 255]);
    expect(parseColor('nope')).toBeNull();
    expect(STYLE_DEFAULTS.hidden.dash).toEqual([3, 1.5]);
  });
});
