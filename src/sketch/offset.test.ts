import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SkEntity, SketchData, Vec2 } from '../core/types';
import { addConstraint, addLine, addRectangle, addSlot, deleteItems } from './sketchOps';
import { applyOffset, computeOffset, extendEntity, offsetChains, offsetDistanceAt } from './offset';
import { solveSketch } from './solver';
import { arcAngles, entityMap, pointOf } from './curves';

const empty = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });

/** Offset the curves `ids` through point `through`, solved with the offset value `value` (mm). */
function offsetThrough(d: SketchData, ids: string[], through: Vec2) {
  const chains = offsetChains(entityMap(d.entities), ids);
  const delta = offsetDistanceAt(chains, through);
  const off = computeOffset(chains, delta)!;
  expect(off).not.toBeNull();
  let cid = '';
  let made: string[] = [];
  const next = produce(d, (x) => {
    const r = applyOffset(x, off, `${Math.abs(delta)} mm`);
    cid = r.constraintId;
    made = r.ids;
  });
  return { next, cid, made, delta };
}

function lineEnds(ents: SkEntity[], id: string): [Vec2, Vec2] {
  const m = entityMap(ents);
  const l = m.get(id) as { p1: string; p2: string };
  return [pointOf(m, l.p1), pointOf(m, l.p2)];
}

describe('sketch offset', () => {
  it('offsets a dimensioned rectangle outward and follows the value and the source', () => {
    let lines: ReturnType<typeof addRectangle> = [];
    const dims: Record<string, number> = {};
    const base = produce(empty(), (d) => {
      lines = addRectangle(d, [0, 0], [40, 20]);
      addConstraint(d, 'fix', [lines[0].p1], { frozen: [0, 0] });
      dims.w = 40;
      dims.h = 20;
      d.constraints.push({ id: 'w', type: 'distance', refs: [lines[0].id], value: '40' });
      d.constraints.push({ id: 'h', type: 'distance', refs: [lines[1].id], value: '20' });
    });
    const { next, cid, made, delta } = offsetThrough(
      base,
      lines.map((l) => l.id),
      [-5, 10],
    );
    expect(delta).toBeCloseTo(-5, 9);
    expect(made.length).toBe(4);
    const res = solveSketch(next.entities, next.constraints, { ...dims, [cid]: 5 }, { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    expect(res.dof).toBe(0);
    const xs = made.flatMap((id) => lineEnds(res.entities, id).map((p) => p[0]));
    const ys = made.flatMap((id) => lineEnds(res.entities, id).map((p) => p[1]));
    expect(Math.min(...xs)).toBeCloseTo(-5, 6);
    expect(Math.max(...xs)).toBeCloseTo(45, 6);
    expect(Math.min(...ys)).toBeCloseTo(-5, 6);
    expect(Math.max(...ys)).toBeCloseTo(25, 6);
    // new offset value and a wider source
    const r2 = solveSketch(res.entities, next.constraints, { ...dims, w: 60, [cid]: 8 }, { analyze: true });
    expect(r2.ok).toBe(true);
    const xs2 = made.flatMap((id) => lineEnds(r2.entities, id).map((p) => p[0]));
    expect(Math.min(...xs2)).toBeCloseTo(-8, 6);
    expect(Math.max(...xs2)).toBeCloseTo(68, 6);
  });

  it('offsets a slot (tangent arcs and lines) without over-constraining it', () => {
    let slot: ReturnType<typeof addSlot> | null = null;
    const base = produce(empty(), (d) => {
      slot = addSlot(d, [0, 0], [30, 0], 5);
      for (const c of [...slot.arcs, ...slot.lines]) addConstraint(d, 'fix', [c.id]);
    });
    const s = slot!;
    const ids = [...s.arcs.map((a) => a.id), ...s.lines.map((l) => l.id)];
    const { next, cid, made, delta } = offsetThrough(base, ids, [-7, 0]);
    expect(delta).toBeCloseTo(-2, 9);
    const res = solveSketch(next.entities, next.constraints, { [cid]: 2 }, { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    expect(res.dof).toBe(0);
    for (const id of made) expect(res.status[id]).toBe('full');
    const m = entityMap(res.entities);
    for (const id of made) {
      const e = m.get(id)!;
      if (e.type === 'arc') expect(arcAngles(e, m).r).toBeCloseTo(7, 6);
      if (e.type === 'line') for (const p of lineEnds(res.entities, id)) expect(Math.abs(p[1])).toBeCloseTo(7, 6);
    }
    // a larger distance keeps the joints tangent
    const r2 = solveSketch(res.entities, next.constraints, { [cid]: 4 }, { analyze: true });
    expect(r2.ok).toBe(true);
    const m2 = entityMap(r2.entities);
    for (const id of made) {
      const e = m2.get(id)!;
      if (e.type === 'arc') expect(arcAngles(e, m2).r).toBeCloseTo(9, 6);
    }
  });

  it('keeps the free ends of an open chain square to the source', () => {
    let l = { id: '', p1: '', p2: '' };
    const base = produce(empty(), (d) => {
      l = addLine(d, [0, 0], [10, 0]);
      addConstraint(d, 'fix', [l.id]);
    });
    const { next, cid, made } = offsetThrough(base, [l.id], [5, 3]);
    const res = solveSketch(next.entities, next.constraints, { [cid]: 4 }, { analyze: true });
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(0);
    const [a, b] = lineEnds(res.entities, made[0]);
    expect(a[0]).toBeCloseTo(0, 6);
    expect(a[1]).toBeCloseTo(4, 6);
    expect(b[0]).toBeCloseTo(10, 6);
    expect(b[1]).toBeCloseTo(4, 6);
  });

  it('rejects distances that collapse the geometry', () => {
    const d = produce(empty(), (x) => {
      addRectangle(x, [0, 0], [10, 4]);
    });
    const chains = offsetChains(entityMap(d.entities), d.entities.filter((e) => e.type === 'line').map((e) => e.id));
    expect(computeOffset(chains, 1)).not.toBeNull();
    expect(computeOffset(chains, 3)).toBeNull();
  });

  it('deleting one copy keeps the offset of the others', () => {
    let lines: ReturnType<typeof addRectangle> = [];
    const base = produce(empty(), (d) => {
      lines = addRectangle(d, [0, 0], [40, 20]);
    });
    const { next, cid, made } = offsetThrough(
      base,
      lines.map((l) => l.id),
      [-5, 10],
    );
    const after = produce(next, (d) => deleteItems(d, [made[0]]));
    const c = after.constraints.find((x) => x.id === cid)!;
    expect(c.refs.length).toBe(6);
    expect(c.refs).not.toContain(made[0]);
  });
});

describe('sketch extend', () => {
  it('extends a line to the next curve and attaches it', () => {
    let a = { id: '', p1: '', p2: '' };
    let b = { id: '', p1: '', p2: '' };
    const d0 = produce(empty(), (d) => {
      a = addLine(d, [0, 0], [5, 0]);
      b = addLine(d, [10, -5], [10, 5]);
    });
    let res: boolean | 'connected' = false;
    const d1 = produce(d0, (d) => {
      res = extendEntity(d, a.id, [4.5, 0.1]);
    });
    expect(res).toBe(true);
    const [, end] = lineEnds(d1.entities, a.id);
    expect(end[0]).toBeCloseTo(10, 9);
    expect(end[1]).toBeCloseTo(0, 9);
    expect(d1.constraints.some((c) => c.type === 'coincident' && c.refs.includes(a.p2) && c.refs.includes(b.id))).toBe(true);
  });

  it('refuses a connected end and reports when nothing is hit', () => {
    let a = { id: '', p1: '', p2: '' };
    const d0 = produce(empty(), (d) => {
      a = addLine(d, [0, 0], [5, 0]);
      const c = addLine(d, [5, 0], [5, 5]);
      addConstraint(d, 'coincident', [a.p2, c.p1]);
    });
    produce(d0, (d) => {
      expect(extendEntity(d, a.id, [4.9, 0])).toBe('connected');
      expect(extendEntity(d, a.id, [0.1, 0])).toBe(false);
    });
  });
});
