// Split a curve at a point; move / turn sketch entities (Onshape Split, Transform).

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SkConstraint, SketchData } from '../core/types';
import { addArc, addConstraint, addLine, moveEntities, splitEntity } from './sketchOps';
import { solveSketch } from './solver';

const empty = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });
const pt = (d: SketchData, id: string): [number, number] => {
  const e = d.entities.find((x) => x.id === id);
  if (e?.type !== 'point') throw new Error(id);
  return [e.x, e.y];
};
const solved = (d: SketchData, dims: Record<string, number> = {}) => {
  const r = solveSketch(d.entities, d.constraints, dims);
  expect(r.ok).toBe(true);
  return { ...d, entities: r.entities };
};

describe('split', () => {
  it('a line in two collinear pieces, its length dimension dropped, its far end constraints with the second piece', () => {
    const ids = { l: '', p2: '', end: '' };
    const d0 = produce(empty(), (d) => {
      const l = addLine(d, [0, 0], [10, 0]);
      Object.assign(ids, { l: l.id, p2: l.p2 });
      addConstraint(d, 'horizontal', [l.id]);
      addConstraint(d, 'distance', [l.id], { value: '10 mm' });
      ids.end = addConstraint(d, 'fix', [l.p2]);
    });
    let second = '';
    const d1 = produce(d0, (d) => void (second = splitEntity(d, ids.l, [4, 0.3])!));
    expect(second).toBeTruthy();
    expect(d1.constraints.some((c) => c.type === 'distance')).toBe(false);
    const nl = d1.entities.find((e) => e.id === second);
    if (nl?.type !== 'line') throw new Error('no line');
    expect(pt(d1, ids.p2)).toEqual([4, 0]);
    expect(pt(d1, nl.p1)).toEqual([4, 0]);
    expect(d1.constraints.find((c) => c.id === ids.end)?.refs).toEqual([nl.p2]);
    expect(d1.constraints.filter((c) => c.type === 'horizontal').map((c) => c.refs[0]).sort()).toEqual([ids.l, second].sort());
    solved(d1);
    // at an end: nothing to split
    expect(produce(d0, (d) => void (second = splitEntity(d, ids.l, [0, 0]) ?? 'none'))).toBeTruthy();
    expect(second).toBe('none');
  });

  it('an arc in two arcs of one circle', () => {
    const ids = { a: '', c: '' };
    const d0 = produce(empty(), (d) => {
      const a = addArc(d, [0, 0], [10, 0], [0, 10]);
      Object.assign(ids, { a: a.id, c: a.c });
    });
    let second = '';
    const d1 = produce(d0, (d) => void (second = splitEntity(d, ids.a, [8.66, 5])!));
    const na = d1.entities.find((e) => e.id === second);
    if (na?.type !== 'arc') throw new Error('no arc');
    const p = pt(d1, na.p1);
    expect(Math.hypot(...p)).toBeCloseTo(10, 9);
    expect(Math.atan2(p[1], p[0])).toBeCloseTo(Math.atan2(5, 8.66), 9);
    expect(pt(d1, na.p2)).toEqual([0, 10]);
    solved(d1);
  });
});

describe('move / turn', () => {
  it('moves entities, fixes them at the new place, drops what ties them to others', () => {
    const ids = { l: '', p1: '', other: '', tie: '', fix: '' };
    const d0 = produce(empty(), (d) => {
      const l = addLine(d, [0, 0], [10, 0]);
      const o = addLine(d, [0, 5], [10, 5]);
      Object.assign(ids, { l: l.id, p1: l.p1, other: o.id });
      ids.fix = addConstraint(d, 'fix', [l.p1]);
      ids.tie = addConstraint(d, 'distance', [l.id, o.id], { value: '5 mm' });
      addConstraint(d, 'horizontal', [l.id]);
    });
    let removed = 0;
    const d1 = produce(d0, (d) => void (removed = moveEntities(d, [ids.l], ([x, y]) => [x + 3, y - 2])));
    expect(removed).toBe(1);
    expect(d1.constraints.some((c: SkConstraint) => c.id === ids.tie)).toBe(false);
    const s = solved(d1);
    expect(pt(s, ids.p1)).toEqual([3, -2]);
  });

  it('a quarter turn makes horizontal vertical; another turn drops it', () => {
    const ids = { l: '', p2: '' };
    const d0 = produce(empty(), (d) => {
      const l = addLine(d, [0, 0], [10, 0]);
      Object.assign(ids, { l: l.id, p2: l.p2 });
      addConstraint(d, 'horizontal', [l.id]);
    });
    const turn = (a: number) => ([x, y]: [number, number]): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const q = produce(d0, (d) => void moveEntities(d, [ids.l], turn(Math.PI / 2), Math.PI / 2));
    expect(q.constraints.map((c) => c.type)).toEqual(['vertical']);
    const p2 = pt(solved(q), ids.p2);
    expect(p2[0]).toBeCloseTo(0, 9);
    expect(p2[1]).toBeCloseTo(10, 9);
    const o = produce(d0, (d) => void moveEntities(d, [ids.l], turn(0.5), 0.5));
    expect(o.constraints).toEqual([]);
  });
});
