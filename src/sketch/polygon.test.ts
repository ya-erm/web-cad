// Regular polygons with any number of sides stay regular when the solver resizes them.

import { describe, expect, it } from 'vitest';
import type { SkLine, SkPoint, SketchData } from '../core/types';
import { addConstraint, addPolygon } from './sketchOps';
import { solveSketch } from './solver';

function solved(n: number, inscribed: boolean) {
  const d: SketchData = { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] };
  // slightly irregular start: the solver has to restore the shape
  const pg = addPolygon(d, [0, 0], [10, 0], n, false, inscribed);
  const moved = d.entities.find((e) => e.id === pg.lines[1].p1) as SkPoint;
  moved.x += 0.4;
  moved.y -= 0.3;
  addConstraint(d, 'diameter', [pg.circle.id], { value: '30' });
  const dimId = d.constraints[d.constraints.length - 1].id;
  const res = solveSketch(d.entities, d.constraints, { [dimId]: 30 });
  const pt = (id: string) => res.entities.find((e) => e.id === id) as SkPoint;
  const c = pt(pg.circle.c);
  const sides = pg.lines.map((l) => {
    const line = res.entities.find((e) => e.id === l.id) as SkLine;
    const a = pt(line.p1);
    const b = pt(line.p2);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // distance from the centre to the side's line and to its first vertex
    const dist = Math.abs((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / len;
    return { len, dist, vertex: Math.hypot(a.x - c.x, a.y - c.y) };
  });
  return { res, sides };
}

describe('polygon', () => {
  it.each([3, 4, 5, 8, 12, 50])('circumscribed, %i sides: equal sides, vertices on the circle', (n) => {
    const { res, sides } = solved(n, false);
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    // centre (2) + rotation (1) left after the diameter
    expect(res.dof).toBe(3);
    for (const s of sides) {
      expect(s.vertex).toBeCloseTo(15, 6);
      expect(s.len).toBeCloseTo(30 * Math.sin(Math.PI / n), 6);
    }
  });

  it.each([3, 4, 5, 6, 8, 11])('inscribed, %i sides: equal sides touching the circle', (n) => {
    const { res, sides } = solved(n, true);
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    expect(res.conflicting).toEqual([]);
    expect(res.dof).toBe(3);
    for (const s of sides) {
      expect(s.dist).toBeCloseTo(15, 6);
      expect(s.vertex).toBeCloseTo(15 / Math.cos(Math.PI / n), 6);
      expect(s.len).toBeCloseTo(30 * Math.tan(Math.PI / n), 6);
    }
  });
});
