import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData } from '../core/types';
import { addArc, addCircle, addConstraint, addLine, addRectangle, circularPattern, linearPattern, mirrorEntities } from './sketchOps';
import { solveSketch } from './solver';
import { computeRegions } from './regions';
import { entityMap, pointOf } from './curves';

const empty = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });

describe('sketch mirror', () => {
  it('mirrors a line and an arc about a vertical axis and keeps them associative', () => {
    let lineId = '';
    let p2 = '';
    const d0 = produce(empty(), (d) => {
      const axis = addLine(d, [0, -10], [0, 10], true);
      addConstraint(d, 'fix', [axis.id], { frozen: [0, -10, 0, 10] });
      const l = addLine(d, [2, 0], [6, 3]);
      lineId = l.id;
      p2 = l.p2;
      addArc(d, [4, 0], [6, 0], [4, 2]);
      expect(mirrorEntities(d, [l.id, d.entities[d.entities.length - 1].type === 'arc' ? d.entities[d.entities.length - 1].id : ''], axis.id)).toBe(true);
    });
    const res = solveSketch(d0.entities, d0.constraints, {});
    expect(res.ok).toBe(true);
    expect(d0.entities.filter((e) => e.type === 'line').length).toBe(3);
    expect(d0.entities.filter((e) => e.type === 'arc').length).toBe(2);
    // drag the original end point: the mirrored copy follows
    const dragged = solveSketch(res.entities, d0.constraints, {}, { drag: { points: { [p2]: [8, 5] } } });
    const m = entityMap(dragged.entities);
    const copy = d0.constraints.find((c) => c.type === 'symmetric' && c.refs[0] === p2)!;
    const q = pointOf(m, copy.refs[1]);
    expect(q[0]).toBeCloseTo(-8, 5);
    expect(q[1]).toBeCloseTo(5, 5);
    void lineId;
  });
});

describe('sketch patterns', () => {
  it('linear pattern of a rectangle produces separate regions', () => {
    const d = produce(empty(), (dd) => {
      const r = addRectangle(dd, [0, 0], [10, 5]);
      linearPattern(dd, r.map((l) => l.id), [15, 0], 3, [0, 10], 2);
    });
    expect(d.entities.filter((e) => e.type === 'line').length).toBe(4 * 6);
    expect(computeRegions(d.entities).length).toBe(6);
    expect(solveSketch(d.entities, d.constraints, {}).ok).toBe(true);
  });

  it('circular pattern of a circle', () => {
    const d = produce(empty(), (dd) => {
      const c = addCircle(dd, [20, 0], 3);
      circularPattern(dd, [c.id], [0, 0], 6, Math.PI * 2);
    });
    const circles = d.entities.filter((e) => e.type === 'circle');
    expect(circles.length).toBe(6);
    const m = entityMap(d.entities);
    for (const c of circles) {
      if (c.type !== 'circle') continue;
      const p = pointOf(m, c.c);
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(20, 9);
    }
  });
});
