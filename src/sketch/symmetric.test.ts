// Regression: symmetric constraint on the top corners of a rectangle about a vertical
// construction axis (H + V already make "pq ⟂ axis" redundant) must be accepted.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData } from '../core/types';
import { addCircle, addConstraint, addLine, addRectangle } from './sketchOps';
import { solveSketch } from './solver';
import { entityMap, pointOf } from './curves';

describe('symmetric constraint with consistent redundancy', () => {
  it('is accepted and centres the rectangle on the axis', () => {
    let lines: ReturnType<typeof addRectangle> = [];
    let axisId = '';
    const base = produce({ plane: { kind: 'std', name: 'front' }, entities: [], constraints: [] } as SketchData, (d) => {
      const c = addCircle(d, [0, 0], 6);
      addConstraint(d, 'fix', [c.c], { frozen: [0, 0] });
      const axis = addLine(d, [0, 0], [0, 6], true);
      axisId = axis.id;
      addConstraint(d, 'coincident', [axis.p1, c.c]);
      addConstraint(d, 'coincident', [axis.p2, c.id]);
      addConstraint(d, 'vertical', [axis.id]);
      // rectangle sitting on the circle, deliberately off-centre
      lines = addRectangle(d, [-1.2, 5.9], [2.8, 9]);
      addConstraint(d, 'coincident', [lines[0].p1, c.id]);
      addConstraint(d, 'coincident', [lines[0].p2, c.id]);
    });
    const before = solveSketch(base.entities, base.constraints, {}, { analyze: true });
    expect(before.ok).toBe(true);
    // top edge goes from lines[2].p1 (top-right) to lines[2].p2 (top-left)
    const withSym = produce(base, (d) => {
      addConstraint(d, 'symmetric', [lines[2].p2, lines[2].p1, axisId]);
    });
    const res = solveSketch(withSym.entities, withSym.constraints, {}, { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    const m = entityMap(res.entities);
    const tl = pointOf(m, lines[2].p2);
    const tr = pointOf(m, lines[2].p1);
    expect(tl[0] + tr[0]).toBeCloseTo(0, 6);
    expect(tl[1]).toBeCloseTo(tr[1], 6);
    // nothing is reported as over-defined
    expect(Object.values(res.status).includes('over')).toBe(false);
  });
});
