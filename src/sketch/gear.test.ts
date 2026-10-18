// Regression: circular sketch pattern of a gear tooth must keep every copy in place.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData, Vec2 } from '../core/types';
import { addCircle, addConstraint, addLine, circularPattern } from './sketchOps';
import { solveSketch } from './solver';
import { computeRegions } from './regions';
import { entityMap, pointOf } from './curves';

function gearSketch(teeth: number) {
  let toothIds: string[] = [];
  let centerId = '';
  const R = 20;
  const d0 = produce({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] } as SketchData, (d) => {
    const root = addCircle(d, [0, 0], R);
    centerId = root.c;
    addConstraint(d, 'fix', [root.c], { frozen: [0, 0] });
    addConstraint(d, 'radius', [root.id], { value: `${R}` });
    // tooth: two flanks and a horizontal-free top land (vertical tooth on +Y)
    const a: Vec2 = [-2, Math.sqrt(R * R - 4)];
    const b: Vec2 = [2, Math.sqrt(R * R - 4)];
    const l1 = addLine(d, a, [-1.2, R + 4]);
    const top = addLine(d, [-1.2, R + 4], [1.2, R + 4]);
    const l2 = addLine(d, [1.2, R + 4], b);
    addConstraint(d, 'coincident', [l1.p2, top.p1]);
    addConstraint(d, 'coincident', [top.p2, l2.p1]);
    addConstraint(d, 'coincident', [l1.p1, root.id]);
    addConstraint(d, 'coincident', [l2.p2, root.id]);
    addConstraint(d, 'horizontal', [top.id]);
    addConstraint(d, 'distance', [top.id], { value: '2.4' });
    addConstraint(d, 'equal', [l1.id, l2.id]);
    toothIds = [l1.id, top.id, l2.id];
  });
  const solved = solveSketch(d0.entities, d0.constraints, { [d0.constraints.find((c) => c.type === 'radius')!.id]: R, [d0.constraints.find((c) => c.type === 'distance')!.id]: 2.4 });
  const base = { ...d0, entities: solved.entities };
  const withPattern = produce(base, (d) => {
    circularPattern(d, toothIds, [0, 0], teeth, Math.PI * 2);
  });
  return { base, withPattern, toothIds, centerId, R };
}

function dimsOf(d: SketchData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of d.constraints) if (c.value !== undefined) out[c.id] = parseFloat(c.value);
  return out;
}

describe('gear: circular pattern of a tooth', () => {
  it('keeps all copies where they were placed after solving', () => {
    const { withPattern } = gearSketch(12);
    const before = entityMap(withPattern.entities);
    const res = solveSketch(withPattern.entities, withPattern.constraints, dimsOf(withPattern), { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    const after = entityMap(res.entities);
    let maxMove = 0;
    for (const e of withPattern.entities) {
      if (e.type !== 'point') continue;
      const p = pointOf(before, e.id);
      const q = pointOf(after, e.id);
      maxMove = Math.max(maxMove, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
    expect(maxMove).toBeLessThan(1e-6);
    expect(withPattern.entities.filter((e) => e.type === 'line').length).toBe(36);
  });

  it('teeth stay on the root circle when its radius changes', () => {
    const { withPattern } = gearSketch(8);
    const radius = withPattern.constraints.find((c) => c.type === 'radius')!;
    const changed = produce(withPattern, (d) => {
      d.constraints.find((c) => c.id === radius.id)!.value = '25';
    });
    const res = solveSketch(changed.entities, changed.constraints, dimsOf(changed), { analyze: true });
    expect(res.ok).toBe(true);
    const m = entityMap(res.entities);
    // every flank start point lies on the root circle
    for (const c of changed.constraints) {
      if (c.type !== 'coincident' || c.refs.length !== 2) continue;
      const curve = m.get(c.refs[1]);
      if (curve?.type !== 'circle') continue;
      const p = pointOf(m, c.refs[0]);
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(25, 5);
    }
  });

  it('produces one gear region (tooth outline merged with the circle)', () => {
    const { withPattern } = gearSketch(10);
    const regions = computeRegions(withPattern.entities);
    // root disc + 10 tooth regions
    expect(regions.length).toBe(11);
  });
});

describe('gear: root circle in the selection', () => {
  it('is not duplicated by the circular pattern', () => {
    const { base, toothIds } = gearSketch(6);
    const root = base.entities.find((e) => e.type === 'circle')!;
    const d = produce(base, (dd) => {
      circularPattern(dd, [...toothIds, root.id], [0, 0], 6, Math.PI * 2);
    });
    expect(d.entities.filter((e) => e.type === 'circle').length).toBe(1);
    expect(d.entities.filter((e) => e.type === 'line').length).toBe(18);
  });
});
