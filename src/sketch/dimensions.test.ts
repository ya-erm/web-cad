// Graphics of a diameter dimension: inside the circle — across it, the arrows from the centre to the circle;
// outside — one arrow by the label, the line breaking off past the centre.

import { describe, expect, it } from 'vitest';
import type { SkConstraint } from '../core/types';
import { entityMap } from './curves';
import { dimensionGeometry } from './dimensions';

const map = entityMap([
  { id: 'c', type: 'point', x: 0, y: 0 },
  { id: 'C', type: 'circle', c: 'c', r: 10 },
]);
const dia = (labelPos: [number, number]): SkConstraint => ({ id: 'd', type: 'diameter', refs: ['C'], value: '20 mm', labelPos });

describe('diameter dimension', () => {
  it('inside: across the diameter, two arrows pointing from the centre to the circle', () => {
    const g = dimensionGeometry(dia([3, 0]), map, 0.1)!;
    expect(g.segs).toEqual([-10, 0, 10, 0]);
    expect(g.arrows).toEqual([
      { tip: [10, 0], dir: [1, 0] },
      { tip: [-10, 0], dir: [-1, -0] },
    ]);
  });

  it('outside: one arrow at the circle by the label, the line from the label past the centre', () => {
    const g = dimensionGeometry(dia([30, 0]), map, 0.1)!;
    expect(g.arrows).toEqual([{ tip: [10, 0], dir: [-1, -0] }]);
    const [x0, y0, x1, y1] = g.segs;
    // breaks off past the centre (a third of the radius or so), not at the far side
    expect(x0).toBeCloseTo(-3.5, 9);
    expect([y0, x1, y1]).toEqual([0, 30, 0]);
  });
});
