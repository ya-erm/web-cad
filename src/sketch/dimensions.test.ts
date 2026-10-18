// Graphics of a diameter dimension: inside the circle — across it, the arrows from the centre to the circle;
// outside — only the outer part, from the label to the circle with one arrow.

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

  it('outside: only the outer part — from the label to the circle, one arrow at the circle', () => {
    const g = dimensionGeometry(dia([30, 0]), map, 0.1)!;
    expect(g.arrows).toEqual([{ tip: [10, 0], dir: [-1, -0] }]);
    expect(g.segs).toEqual([10, 0, 30, 0]);
  });
});
