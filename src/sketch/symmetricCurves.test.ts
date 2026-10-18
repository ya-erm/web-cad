// Symmetric constraint on lines, arcs and circles about an axis line (Onshape: pick three lines,
// the middle one is the axis).

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData } from '../core/types';
import { addArc, addCircle, addConstraint, addLine } from './sketchOps';
import { initialVariant, solveSketch, symmetryFit } from './solver';
import { arcAngles, entityMap, pointOf } from './curves';

const empty = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });

function symmetric(d: SketchData, a: string, b: string, axis: string) {
  const variant = initialVariant({ id: 'tmp', type: 'symmetric', refs: [a, b, axis] }, d.entities);
  addConstraint(d, 'symmetric', [a, b, axis], { variant });
}

describe('symmetric curves', () => {
  it('mirrors two lines about a vertical axis (end points pair crosswise when drawn that way)', () => {
    let A = { id: '', p1: '', p2: '' };
    let B = { id: '', p1: '', p2: '' };
    let axis = { id: '', p1: '', p2: '' };
    const base = produce(empty(), (d) => {
      axis = addLine(d, [0, -20], [0, 20], true);
      addConstraint(d, 'fix', [axis.id]);
      A = addLine(d, [-10, 0], [-4, 12]);
      B = addLine(d, [5, 11], [12, 1]); // roughly mirrored, drawn in the other direction
      addConstraint(d, 'fix', [A.id]);
    });
    // the axis is found as the line about which the other two are most symmetric
    const ents = base.entities;
    const fits = [
      symmetryFit(ents, A.id, B.id, axis.id)!.err,
      symmetryFit(ents, axis.id, B.id, A.id)?.err ?? Infinity,
      symmetryFit(ents, axis.id, A.id, B.id)?.err ?? Infinity,
    ];
    expect(fits.indexOf(Math.min(...fits))).toBe(0);
    expect(symmetryFit(ents, A.id, B.id, axis.id)!.crossed).toBe(true);
    const next = produce(base, (d) => symmetric(d, A.id, B.id, axis.id));
    const res = solveSketch(next.entities, next.constraints, {}, { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    expect(res.status[B.id]).toBe('full');
    const m = entityMap(res.entities);
    // B.p2 mirrors A.p1, B.p1 mirrors A.p2
    expect(pointOf(m, B.p2)[0]).toBeCloseTo(10, 6);
    expect(pointOf(m, B.p2)[1]).toBeCloseTo(0, 6);
    expect(pointOf(m, B.p1)[0]).toBeCloseTo(4, 6);
    expect(pointOf(m, B.p1)[1]).toBeCloseTo(12, 6);
  });

  it('a V whose sides share the apex keeps the apex on the axis', () => {
    let A = { id: '', p1: '', p2: '' };
    let B = { id: '', p1: '', p2: '' };
    let axis = { id: '', p1: '', p2: '' };
    const base = produce(empty(), (d) => {
      axis = addLine(d, [0, -5], [0, 30], true);
      addConstraint(d, 'fix', [axis.id]);
      A = addLine(d, [0.5, 0], [-8, 20]);
      B = addLine(d, [0.5, 0], [9, 19]);
      addConstraint(d, 'coincident', [A.p1, B.p1]);
      symmetric(d, A.id, B.id, axis.id);
    });
    const res = solveSketch(base.entities, base.constraints, {}, { analyze: true });
    expect(res.ok).toBe(true);
    const m = entityMap(res.entities);
    expect(pointOf(m, A.p1)[0]).toBeCloseTo(0, 6);
    expect(pointOf(m, A.p2)[0]).toBeCloseTo(-pointOf(m, B.p2)[0], 6);
    expect(pointOf(m, A.p2)[1]).toBeCloseTo(pointOf(m, B.p2)[1], 6);
  });

  it('mirrors circles (centre + radius) and arcs (centre + end points)', () => {
    let c1 = { id: '', c: '' };
    let c2 = { id: '', c: '' };
    let a1 = { id: '', c: '', p1: '', p2: '' };
    let a2 = { id: '', c: '', p1: '', p2: '' };
    const base = produce(empty(), (d) => {
      const axis = addLine(d, [0, -30], [0, 30], true);
      addConstraint(d, 'fix', [axis.id]);
      c1 = addCircle(d, [-10, 5], 3);
      c2 = addCircle(d, [11, 4], 4);
      addConstraint(d, 'fix', [c1.id]);
      // arc around (-10, -10) from angle 0 to 90°, and a rough mirror image
      a1 = addArc(d, [-10, -10], [-5, -10], [-10, -5]);
      a2 = addArc(d, [10, -11], [10, -6], [4, -11]);
      addConstraint(d, 'fix', [a1.id]);
      symmetric(d, c1.id, c2.id, axis.id);
      symmetric(d, a1.id, a2.id, axis.id);
    });
    const res = solveSketch(base.entities, base.constraints, {}, { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    const m = entityMap(res.entities);
    const C2 = m.get(c2.id) as { r: number };
    expect(pointOf(m, c2.c)[0]).toBeCloseTo(10, 6);
    expect(pointOf(m, c2.c)[1]).toBeCloseTo(5, 6);
    expect(C2.r).toBeCloseTo(3, 6);
    const arc = arcAngles(m.get(a2.id) as never, m);
    expect(arc.c[0]).toBeCloseTo(10, 6);
    expect(arc.c[1]).toBeCloseTo(-10, 6);
    expect(arc.r).toBeCloseTo(5, 6);
    expect(pointOf(m, a2.p2)[0]).toBeCloseTo(5, 6);
    expect(pointOf(m, a2.p1)[1]).toBeCloseTo(-5, 6);
  });
});
