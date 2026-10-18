import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData, SkPattern, Vec2 } from '../core/types';
import type { EvalContext } from '../core/expr';
import { addCircle, addConstraint, addLine, deleteItems } from './sketchOps';
import { copyId, expandPatterns } from './patterns';
import { solveSketch } from './solver';
import { computeRegions } from './regions';
import { entityMap, pointOf } from './curves';

const ctx: EvalContext = { vars: {}, lengthUnit: 'mm', angleUnit: 'deg' };

function toothSketch(count: string) {
  let topLine = '';
  let width = '';
  const d = produce({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] } as SketchData, (dd) => {
    const root = addCircle(dd, [0, 0], 20);
    addConstraint(dd, 'fix', [root.c], { frozen: [0, 0] });
    const a: Vec2 = [-2, Math.sqrt(400 - 4)];
    const b: Vec2 = [2, Math.sqrt(400 - 4)];
    const l1 = addLine(dd, a, [-1.2, 24]);
    const top = addLine(dd, [-1.2, 24], [1.2, 24]);
    const l2 = addLine(dd, [1.2, 24], b);
    addConstraint(dd, 'coincident', [l1.p2, top.p1]);
    addConstraint(dd, 'coincident', [top.p2, l2.p1]);
    addConstraint(dd, 'coincident', [l1.p1, root.id]);
    addConstraint(dd, 'coincident', [l2.p2, root.id]);
    addConstraint(dd, 'horizontal', [top.id]);
    width = addConstraint(dd, 'distance', [top.id], { value: '2.4 mm' });
    topLine = top.id;
    const pattern: SkPattern = { id: 'P', kind: 'circular', seed: [l1.id, top.id, l2.id], count, angle: '360 deg', centerRef: root.c };
    dd.patterns = [pattern];
  });
  return { d, topLine, width };
}

function solveAndExpand(d: SketchData) {
  const dims: Record<string, number> = {};
  for (const c of d.constraints) if (c.value) dims[c.id] = parseFloat(c.value);
  const res = solveSketch(d.entities, d.constraints, dims, { analyze: true });
  return { res, all: expandPatterns(res.entities, d.patterns, ctx) };
}

describe('associative sketch patterns', () => {
  it('generates copies that follow the seed and adds no constraints', () => {
    const { d, topLine, width } = toothSketch('12');
    const constraintsBefore = d.constraints.length;
    const { res, all } = solveAndExpand(d);
    expect(res.ok).toBe(true);
    expect(all.filter((e) => e.type === 'line').length).toBe(36);
    expect(d.constraints.length).toBe(constraintsBefore);
    // change the seed dimension: every copy updates on the next evaluation
    const wider = produce(d, (dd) => {
      dd.constraints.find((c) => c.id === width)!.value = '4 mm';
    });
    const { all: all2 } = solveAndExpand(wider);
    const m = entityMap(all2);
    for (let i = 1; i < 12; i++) {
      const line = m.get(copyId(topLine, 'P', `${i}`));
      expect(line?.type).toBe('line');
      if (line?.type !== 'line') continue;
      const a = pointOf(m, line.p1);
      const b = pointOf(m, line.p2);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(4, 6);
    }
  });

  it('deleting one copy leaves a gap that survives a count change', () => {
    const { d, topLine } = toothSketch('6');
    const deleted = produce(d, (dd) => deleteItems(dd, [copyId(topLine, 'P', '2')]));
    expect(deleted.patterns![0].skipped).toEqual([copyId(topLine, 'P', '2')]);
    const more = produce(deleted, (dd) => {
      dd.patterns![0].count = '8';
    });
    const { all } = solveAndExpand(more);
    const ids = new Set(all.map((e) => e.id));
    expect(ids.has(copyId(topLine, 'P', '2'))).toBe(false);
    expect(ids.has(copyId(topLine, 'P', '7'))).toBe(true);
  });

  it('deleting the seed removes the pattern; deleting the pattern keeps the seed', () => {
    const { d, topLine } = toothSketch('6');
    const noPattern = produce(d, (dd) => deleteItems(dd, ['P']));
    expect(noPattern.patterns).toEqual([]);
    expect(noPattern.entities.some((e) => e.id === topLine)).toBe(true);
    const noSeed = produce(d, (dd) => deleteItems(dd, [...d.patterns![0].seed]));
    expect(noSeed.patterns).toEqual([]);
  });

  it('pattern copies close regions with the root circle', () => {
    const { d } = toothSketch('10');
    const { all } = solveAndExpand(d);
    expect(computeRegions(all).length).toBe(11);
  });

  it('linear pattern in two directions', () => {
    const d = produce({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] } as SketchData, (dd) => {
      const c = addCircle(dd, [0, 0], 2);
      dd.patterns = [{ id: 'L', kind: 'linear', seed: [c.id], count: '4', spacing: '10 mm', dirAngle: '0 deg', count2: '3', spacing2: '7 mm' }];
    });
    const all = expandPatterns(d.entities, d.patterns, ctx);
    const circles = all.filter((e) => e.type === 'circle');
    expect(circles.length).toBe(12);
    const m = entityMap(all);
    const far = m.get(copyId(d.entities.find((e) => e.type === 'circle')!.id, 'L', '3_2'));
    expect(far?.type).toBe('circle');
    if (far?.type === 'circle') {
      const c = pointOf(m, far.c);
      expect(c[0]).toBeCloseTo(30, 9);
      expect(c[1]).toBeCloseTo(14, 9);
    }
  });
});
