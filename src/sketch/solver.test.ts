import { describe, it, expect } from 'vitest';
import type { SkConstraint, SkEntity, SkPoint, SkCircle, SkEllipse } from '../core/types';
import { solveSketch, frozenValues, initialVariant, measureConstraint } from './solver';

// --- helpers ----------------------------------------------------------------

const pt = (id: string, x: number, y: number): SkPoint => ({ id, type: 'point', x, y });
const ln = (id: string, p1: string, p2: string): SkEntity => ({ id, type: 'line', p1, p2 });
const circ = (id: string, c: string, r: number): SkCircle => ({ id, type: 'circle', c, r });
const arc = (id: string, c: string, p1: string, p2: string): SkEntity => ({ id, type: 'arc', c, p1, p2 });
const con = (id: string, type: SkConstraint['type'], refs: string[], extra: Partial<SkConstraint> = {}): SkConstraint => ({
  id,
  type,
  refs,
  ...extra,
});

function P(ents: SkEntity[], id: string): [number, number] {
  const e = ents.find((x) => x.id === id);
  if (!e || e.type !== 'point') throw new Error(`no point ${id}`);
  return [e.x, e.y];
}
function C(ents: SkEntity[], id: string): SkCircle {
  const e = ents.find((x) => x.id === id);
  if (!e || e.type !== 'circle') throw new Error(`no circle ${id}`);
  return e;
}
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Rectangle a-b-c-d (4 shared points, 4 lines) with H/V constraints. */
function rectangle(x: number, y: number, w: number, h: number, pre = '') {
  const n = (s: string) => pre + s;
  const entities: SkEntity[] = [
    pt(n('a'), x, y),
    pt(n('b'), x + w, y),
    pt(n('c'), x + w, y + h),
    pt(n('d'), x, y + h),
    ln(n('ab'), n('a'), n('b')),
    ln(n('bc'), n('b'), n('c')),
    ln(n('cd'), n('c'), n('d')),
    ln(n('da'), n('d'), n('a')),
  ];
  const constraints: SkConstraint[] = [
    con(n('h1'), 'horizontal', [n('ab')]),
    con(n('v1'), 'vertical', [n('bc')]),
    con(n('h2'), 'horizontal', [n('cd')]),
    con(n('v2'), 'vertical', [n('da')]),
  ];
  return { entities, constraints };
}

describe('rectangle', () => {
  const build = () => {
    const r = rectangle(0.3, -0.2, 9, 4.5);
    // perturb so that H/V are not satisfied initially
    (r.entities[1] as SkPoint).y = 0.4;
    (r.entities[2] as SkPoint).x = 9.7;
    r.constraints.push(
      con('w', 'distance', ['ab']),
      con('h', 'distance', ['bc']),
      con('fix', 'fix', ['a'], { frozen: [0, 0] }),
    );
    return r;
  };

  it('fully defines with width/height and a fixed corner', () => {
    const { entities, constraints } = build();
    const res = solveSketch(entities, constraints, { w: 20, h: 8 });
    expect(res.ok).toBe(true);
    expect(res.conflicting).toEqual([]);
    expect(res.redundant).toEqual([]);
    expect(res.dof).toBe(0);
    for (const e of entities) expect(res.status[e.id]).toBe('full');
    expect(P(res.entities, 'a')).toEqual([0, 0]);
    const b = P(res.entities, 'b');
    const c = P(res.entities, 'c');
    expect(b[0]).toBeCloseTo(20, 9);
    expect(b[1]).toBeCloseTo(0, 9);
    expect(c[0]).toBeCloseTo(20, 9);
    expect(c[1]).toBeCloseTo(8, 9);
  });

  it('resizes when a dimension value changes', () => {
    const { entities, constraints } = build();
    const r1 = solveSketch(entities, constraints, { w: 20, h: 8 });
    const r2 = solveSketch(r1.entities, constraints, { w: 35.5, h: 8 });
    expect(r2.ok).toBe(true);
    expect(P(r2.entities, 'c')[0]).toBeCloseTo(35.5, 9);
    expect(P(r2.entities, 'c')[1]).toBeCloseTo(8, 9);
    // solving an already solved sketch keeps the entity objects
    const r3 = solveSketch(r2.entities, constraints, { w: 35.5, h: 8 });
    expect(r3.entities.every((e, i) => e === r2.entities[i])).toBe(true);
  });

  it('works with separate line endpoints joined by coincident constraints', () => {
    const entities: SkEntity[] = [];
    const constraints: SkConstraint[] = [];
    const corners: [number, number][] = [
      [0, 0],
      [10, 0.5],
      [10.3, 6],
      [-0.4, 5],
    ];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i];
      const [x2, y2] = corners[(i + 1) % 4];
      entities.push(pt(`s${i}`, x1 + 0.1 * i, y1), pt(`e${i}`, x2, y2 - 0.1 * i), ln(`l${i}`, `s${i}`, `e${i}`));
      constraints.push(con(`co${i}`, 'coincident', [`e${i}`, `s${(i + 1) % 4}`]));
      constraints.push(con(`hv${i}`, i % 2 === 0 ? 'horizontal' : 'vertical', [`l${i}`]));
    }
    constraints.push(con('w', 'distance', ['l0']), con('h', 'distance', ['l1']), con('f', 'fix', ['s0']));
    const res = solveSketch(entities, constraints, { w: 12, h: 7 });
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(0);
    expect(res.redundant).toEqual([]);
    for (const e of entities) expect(res.status[e.id]).toBe('full');
    const s0 = P(res.entities, 's0');
    const e1 = P(res.entities, 'e1');
    expect(e1[0] - s0[0]).toBeCloseTo(12, 9);
    expect(e1[1] - s0[1]).toBeCloseTo(7, 9);
  });

  it('is scale robust (0.01 mm and 10 m)', () => {
    for (const k of [0.001, 1000]) {
      const r = rectangle(0.3 * k, -0.2 * k, 9 * k, 4.5 * k);
      (r.entities[2] as SkPoint).x = 9.7 * k;
      r.constraints.push(con('w', 'distance', ['ab']), con('h', 'distance', ['bc']), con('fix', 'fix', ['a']));
      const res = solveSketch(r.entities, r.constraints, { w: 10 * k, h: 5 * k });
      expect(res.ok).toBe(true);
      expect(res.dof).toBe(0);
      const c = P(res.entities, 'c');
      expect(c[0]).toBeCloseTo(10.3 * k, 6);
      expect(c[1]).toBeCloseTo(4.8 * k, 6);
    }
  });
});

describe('basic constraints', () => {
  it('unconstrained line has 4 dof', () => {
    const entities = [pt('a', 0, 0), pt('b', 3, 1), ln('l', 'a', 'b')];
    const res = solveSketch(entities, [], {});
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(4);
    expect(res.status.l).toBe('under');
    expect(res.status.a).toBe('under');
    expect(res.entities.every((e, i) => e === entities[i])).toBe(true);
  });

  it('line tangent to circle', () => {
    const entities = [pt('c', 0, 0), circ('k', 'c', 5), pt('a', -10, 7), pt('b', 10, 6), ln('l', 'a', 'b')];
    const constraints = [con('f', 'fix', ['c']), con('fa', 'fix', ['a']), con('t', 'tangent', ['l', 'k'])];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(true);
    const a = P(res.entities, 'a');
    const b = P(res.entities, 'b');
    const r = C(res.entities, 'k').r;
    const sd = ((b[0] - a[0]) * (0 - a[1]) - (b[1] - a[1]) * (0 - a[0])) / dist(a, b);
    expect(Math.abs(Math.abs(sd) - r)).toBeLessThan(1e-7);
    expect(a).toEqual([-10, 7]);
  });

  it('tangent circles (external and internal)', () => {
    const entities = [pt('c1', 0, 0), circ('k1', 'c1', 5), pt('c2', 9, 1), circ('k2', 'c2', 3)];
    const ext = solveSketch(entities, [con('f', 'fix', ['k1']), con('t', 'tangent', ['k1', 'k2'], { variant: 0 })], {});
    expect(ext.ok).toBe(true);
    expect(dist(P(ext.entities, 'c1'), P(ext.entities, 'c2'))).toBeCloseTo(5 + C(ext.entities, 'k2').r, 9);
    const inside = [pt('c1', 0, 0), circ('k1', 'c1', 5), pt('c2', 1, 1), circ('k2', 'c2', 3)];
    const tc = con('t', 'tangent', ['k1', 'k2']);
    expect(initialVariant(tc, inside)).toBe(1);
    const int = solveSketch(inside, [con('f', 'fix', ['k1']), { ...tc, variant: 1 }], {});
    expect(int.ok).toBe(true);
    expect(dist(P(int.entities, 'c1'), P(int.entities, 'c2'))).toBeCloseTo(5 - C(int.entities, 'k2').r, 9);
  });

  it('arc keeps an implicit radius', () => {
    const entities = [pt('c', 0, 0), pt('p1', 5, 0), pt('p2', 0, 7), arc('a', 'c', 'p1', 'p2')];
    const res = solveSketch(entities, [], {});
    expect(res.ok).toBe(true);
    const c = P(res.entities, 'c');
    expect(dist(P(res.entities, 'p1'), c)).toBeCloseTo(dist(P(res.entities, 'p2'), c), 9);
    expect(res.dof).toBe(5);
    const res2 = solveSketch(entities, [con('r', 'radius', ['a']), con('f', 'fix', ['c'])], { r: 6 });
    expect(res2.ok).toBe(true);
    expect(dist(P(res2.entities, 'p1'), [0, 0])).toBeCloseTo(6, 9);
    expect(dist(P(res2.entities, 'p2'), [0, 0])).toBeCloseTo(6, 9);
    expect(measureConstraint(con('r', 'radius', ['a']), res2.entities)).toBeCloseTo(6, 9);
  });

  it('circle radius and diameter', () => {
    const entities = [pt('c', 1, 1), circ('k', 'c', 3)];
    const r1 = solveSketch(entities, [con('r', 'radius', ['k'])], { r: 5 });
    expect(r1.ok).toBe(true);
    expect(C(r1.entities, 'k').r).toBeCloseTo(5, 12);
    const r2 = solveSketch(entities, [con('d', 'diameter', ['k']), con('f', 'fix', ['c'])], { d: 12 });
    expect(C(r2.entities, 'k').r).toBeCloseTo(6, 12);
    expect(r2.dof).toBe(0);
    expect(r2.status.k).toBe('full');
    expect(measureConstraint(con('d', 'diameter', ['k']), r2.entities)).toBeCloseTo(12, 12);
  });

  it('angle of 30 degrees between two lines', () => {
    const entities = [pt('o', 0, 0), pt('a', 10, 0), pt('b', 8, 8), ln('l1', 'o', 'a'), ln('l2', 'o', 'b')];
    const constraints = [con('f', 'fix', ['l1']), con('ang', 'angle', ['l1', 'l2'])];
    const res = solveSketch(entities, constraints, { ang: Math.PI / 6 });
    expect(res.ok).toBe(true);
    const b = P(res.entities, 'b');
    expect(Math.atan2(b[1], b[0])).toBeCloseTo(Math.PI / 6, 9);
    expect(measureConstraint(constraints[1], res.entities)).toBeCloseTo(Math.PI / 6, 9);
    // clockwise configuration keeps its orientation
    const cw = solveSketch([pt('o', 0, 0), pt('a', 10, 0), pt('b', 8, -8), ln('l1', 'o', 'a'), ln('l2', 'o', 'b')], constraints, {
      ang: Math.PI / 6,
    });
    const b2 = P(cw.entities, 'b');
    expect(Math.atan2(b2[1], b2[0])).toBeCloseTo(-Math.PI / 6, 9);
    // large change: 150 degrees
    const wide = solveSketch(res.entities, constraints, { ang: (5 * Math.PI) / 6 });
    expect(measureConstraint(constraints[1], wide.entities)).toBeCloseTo((5 * Math.PI) / 6, 9);
  });

  it('parallel and perpendicular', () => {
    const entities: SkEntity[] = [pt('a', 0, 0), pt('b', 10, 1), pt('c', 0, 5), pt('d', 9, 7), pt('e', 3, 3), pt('f', 4, 9)];
    entities.push(ln('l1', 'a', 'b'), ln('l2', 'c', 'd'), ln('l3', 'e', 'f'));
    const constraints = [con('p', 'parallel', ['l1', 'l2']), con('q', 'perpendicular', ['l1', 'l3'])];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(true);
    const v = (p: string, q: string) => {
      const A = P(res.entities, p);
      const B = P(res.entities, q);
      return [B[0] - A[0], B[1] - A[1]];
    };
    const [u1, u2, u3] = [v('a', 'b'), v('c', 'd'), v('e', 'f')];
    expect(Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) / Math.hypot(...u1) / Math.hypot(...u2)).toBeLessThan(1e-9);
    expect(Math.abs(u1[0] * u3[0] + u1[1] * u3[1]) / Math.hypot(...u1) / Math.hypot(...u3)).toBeLessThan(1e-9);
  });

  it('symmetric', () => {
    const entities = [pt('a', 0, -5), pt('b', 0.5, 5), ln('axis', 'a', 'b'), pt('p', -3, 1), pt('q', 4, 2)];
    const constraints = [con('f', 'fix', ['axis']), con('s', 'symmetric', ['p', 'q', 'axis'])];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(true);
    const a = P(res.entities, 'a');
    const b = P(res.entities, 'b');
    const p = P(res.entities, 'p');
    const q = P(res.entities, 'q');
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const mx = (p[0] + q[0]) / 2 - a[0];
    const my = (p[1] + q[1]) / 2 - a[1];
    expect(Math.abs(ex * my - ey * mx)).toBeLessThan(1e-7);
    expect(Math.abs((q[0] - p[0]) * ex + (q[1] - p[1]) * ey)).toBeLessThan(1e-7);
    expect(res.dof).toBe(2);
  });

  it('midpoint', () => {
    const entities = [pt('a', 0, 0), pt('b', 10, 4), ln('l', 'a', 'b'), pt('m', 3, 7)];
    const res = solveSketch(entities, [con('fl', 'fix', ['l']), con('mid', 'midpoint', ['m', 'l'])], {});
    expect(res.ok).toBe(true);
    expect(P(res.entities, 'm')[0]).toBeCloseTo(5, 12);
    expect(P(res.entities, 'm')[1]).toBeCloseTo(2, 12);
    expect(res.status.m).toBe('full');
  });

  it('point on line / circle / arc / ellipse, concentric and equal', () => {
    const ell: SkEllipse = { id: 'el', type: 'ellipse', c: 'ec', rx: 6, ry: 3, rot: 0.3 };
    const entities: SkEntity[] = [
      pt('a', 0, 0),
      pt('b', 10, 0),
      ln('l', 'a', 'b'),
      pt('p', 4, 2),
      pt('c', 20, 0),
      circ('k', 'c', 4),
      pt('q', 26, 1),
      pt('ac', 20.5, 0.5),
      pt('a1', 23, 0.5),
      pt('a2', 20.5, 3),
      arc('arc', 'ac', 'a1', 'a2'),
      pt('r', 18, 6),
      pt('ec', 0, 20),
      ell,
      pt('s', 7, 22),
      pt('m1', 0, 40),
      pt('m2', 10, 40),
      ln('lm', 'm1', 'm2'),
    ];
    const constraints = [
      con('c1', 'coincident', ['p', 'l']),
      con('c2', 'coincident', ['k', 'q']),
      con('c3', 'concentric', ['k', 'arc']),
      con('c4', 'coincident', ['r', 'arc']),
      con('c5', 'coincident', ['s', 'el']),
      con('c6', 'equal', ['k', 'arc']),
      con('c7', 'equal', ['l', 'lm']),
    ];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    const o = res.entities;
    const a = P(o, 'a');
    const b = P(o, 'b');
    const p = P(o, 'p');
    expect(Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))).toBeLessThan(1e-6);
    const r = C(o, 'k').r;
    expect(dist(P(o, 'q'), P(o, 'c'))).toBeCloseTo(r, 9);
    expect(P(o, 'ac')[0]).toBeCloseTo(P(o, 'c')[0], 12);
    expect(dist(P(o, 'a1'), P(o, 'ac'))).toBeCloseTo(r, 9);
    expect(dist(P(o, 'r'), P(o, 'ac'))).toBeCloseTo(r, 9);
    expect(dist(P(o, 'm1'), P(o, 'm2'))).toBeCloseTo(dist(a, b), 9);
    const e = o.find((x) => x.id === 'el') as SkEllipse;
    const [sx, sy] = P(o, 's');
    const [cx, cy] = P(o, 'ec');
    const u = Math.cos(e.rot) * (sx - cx) + Math.sin(e.rot) * (sy - cy);
    const w = -Math.sin(e.rot) * (sx - cx) + Math.cos(e.rot) * (sy - cy);
    expect((u / e.rx) ** 2 + (w / e.ry) ** 2).toBeCloseTo(1, 9);
  });

  it('hdistance / vdistance keep their sign', () => {
    const entities = [pt('a', 0, 0), pt('b', -3, 2)];
    const h = con('h', 'hdistance', ['a', 'b']);
    const v = initialVariant(h, entities);
    expect(v).toBe(-1);
    const res = solveSketch(entities, [con('f', 'fix', ['a']), { ...h, variant: v }, con('v', 'vdistance', ['a', 'b'], { variant: 1 })], {
      h: 5,
      v: 1,
    });
    expect(P(res.entities, 'b')[0]).toBeCloseTo(-5, 12);
    expect(P(res.entities, 'b')[1]).toBeCloseTo(1, 12);
    expect(res.dof).toBe(0);
  });

  it('point-line and line-line distance', () => {
    const entities = [pt('a', 0, 0), pt('b', 10, 0), ln('l', 'a', 'b'), pt('p', 3, -2), pt('c', 1, 5), pt('d', 9, 6), ln('m', 'c', 'd')];
    const pl = con('pl', 'distance', ['p', 'l']);
    expect(initialVariant(pl, entities)).toBe(-1);
    expect(measureConstraint(pl, entities)).toBeCloseTo(2, 12);
    const constraints = [con('f', 'fix', ['l']), { ...pl, variant: -1 }, con('ll', 'distance', ['l', 'm']), con('par', 'parallel', ['l', 'm'])];
    const res = solveSketch(entities, constraints, { pl: 4, ll: 7 });
    expect(res.ok).toBe(true);
    expect(P(res.entities, 'p')[1]).toBeCloseTo(-4, 9);
    expect(P(res.entities, 'c')[1]).toBeCloseTo(7, 9);
    expect(P(res.entities, 'd')[1]).toBeCloseTo(7, 9);
  });
});

describe('dragging', () => {
  it('a free point follows the target exactly', () => {
    const entities = [pt('a', 0, 0), pt('b', 5, 5), ln('l', 'a', 'b')];
    const res = solveSketch(entities, [], {}, { drag: { points: { b: [7.25, -3.5] } } });
    expect(P(res.entities, 'b')).toEqual([7.25, -3.5]);
    expect(P(res.entities, 'a')).toEqual([0, 0]);
  });

  it('a constrained point follows when possible, others move', () => {
    const entities = [pt('a', 0, 0), pt('b', 10, 0), ln('l', 'a', 'b')];
    const res = solveSketch(entities, [con('len', 'distance', ['l'])], { len: 10 }, { drag: { points: { b: [20, 5] } } });
    expect(res.ok).toBe(true);
    expect(P(res.entities, 'b')).toEqual([20, 5]);
    expect(dist(P(res.entities, 'a'), P(res.entities, 'b'))).toBeCloseTo(10, 9);
  });

  it('a fixed point does not move', () => {
    const entities = [pt('a', 1, 2), pt('b', 5, 5), ln('l', 'a', 'b')];
    const res = solveSketch(entities, [con('f', 'fix', ['a'])], {}, { drag: { points: { a: [10, 10] } } });
    expect(P(res.entities, 'a')).toEqual([1, 2]);
    expect(res.ok).toBe(true);
  });

  it('a fully dimensioned corner does not move or flip', () => {
    const r = rectangle(0, 0, 10, 5);
    r.constraints.push(con('w', 'distance', ['ab']), con('h', 'distance', ['bc']), con('fix', 'fix', ['a']));
    const res = solveSketch(r.entities, r.constraints, { w: 10, h: 5 }, { drag: { points: { c: [-30, -20] } } });
    expect(P(res.entities, 'c')[0]).toBeCloseTo(10, 9);
    expect(P(res.entities, 'c')[1]).toBeCloseTo(5, 9);
  });

  it('partially defined corner moves along its free direction', () => {
    const r = rectangle(0, 0, 10, 5);
    r.constraints.push(con('w', 'distance', ['ab']), con('fix', 'fix', ['a']));
    const res = solveSketch(r.entities, r.constraints, { w: 10 }, { drag: { points: { c: [-30, 12] } } });
    expect(res.ok).toBe(true);
    expect(P(res.entities, 'c')[0]).toBeCloseTo(10, 9);
    expect(P(res.entities, 'c')[1]).toBeCloseTo(12, 9);
  });

  it('a point on a fixed circle is projected onto it', () => {
    const entities = [pt('c', 0, 0), circ('k', 'c', 5), pt('p', 4, 3)];
    const res = solveSketch(entities, [con('f', 'fix', ['k']), con('on', 'coincident', ['p', 'k'])], {}, { drag: { points: { p: [0, 9] } } });
    expect(res.ok).toBe(true);
    const p = P(res.entities, 'p');
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(5, 9);
    expect(p[1]).toBeGreaterThan(4.9);
  });

  it('drags in a sketch that already has a conflict', () => {
    const entities = [pt('a', 0, 0), pt('b', 12, 0), ln('l', 'a', 'b'), pt('c', 15, 3)];
    const constraints = [
      con('f', 'fix', ['a']),
      con('d1', 'distance', ['l']),
      con('d2', 'distance', ['l']),
      con('bc', 'distance', ['b', 'c']),
    ];
    const res = solveSketch(entities, constraints, { d1: 10, d2: 20, bc: 5 }, { drag: { points: { c: [3, 12] } } });
    expect(res.conflicting).toEqual(['d2']);
    expect(P(res.entities, 'c')).toEqual([3, 12]);
    expect(dist(P(res.entities, 'a'), P(res.entities, 'b'))).toBeCloseTo(10, 9);
    expect(dist(P(res.entities, 'b'), P(res.entities, 'c'))).toBeCloseTo(5, 9);
  });

  it('dragging circle and arc radii', () => {
    const entities = [pt('c', 0, 0), circ('k', 'c', 5), pt('ac', 20, 0), pt('a1', 23, 0), pt('a2', 20, 3), arc('a', 'ac', 'a1', 'a2')];
    const res = solveSketch(entities, [], {}, { drag: { radii: { k: 8, a: 4 } } });
    expect(C(res.entities, 'k').r).toBe(8);
    expect(dist(P(res.entities, 'a1'), P(res.entities, 'ac'))).toBeCloseTo(4, 9);
    expect(dist(P(res.entities, 'a2'), P(res.entities, 'ac'))).toBeCloseTo(4, 9);
  });
});

describe('over-constrained sketches', () => {
  it('reports conflicting dimensions', () => {
    const entities = [pt('a', 0, 0), pt('b', 12, 0), ln('l', 'a', 'b')];
    const constraints = [con('d1', 'distance', ['l']), con('d2', 'distance', ['l'])];
    const res = solveSketch(entities, constraints, { d1: 10, d2: 20 });
    expect(res.ok).toBe(false);
    expect(res.conflicting).toEqual(['d2']);
    expect(dist(P(res.entities, 'a'), P(res.entities, 'b'))).toBeCloseTo(10, 9);
    expect(res.status.l).toBe('over');
  });

  it('reports conflicting fixes', () => {
    const entities = [pt('a', 0, 0), pt('b', 12, 0)];
    const constraints = [con('f1', 'fix', ['a']), con('f2', 'fix', ['b']), con('co', 'coincident', ['a', 'b'])];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(false);
    expect(res.conflicting).toEqual(['co']);
  });

  it('a conflicting coincident added after a dimension is reported and not applied', () => {
    const entities = [pt('a', 0, 0), pt('b', 12, 0), ln('l', 'a', 'b'), pt('c', 30, 5)];
    const constraints = [con('f', 'fix', ['a']), con('d', 'distance', ['l']), con('co', 'coincident', ['b', 'a'])];
    const res = solveSketch(entities, constraints, { d: 10 });
    expect(res.ok).toBe(false);
    expect(res.conflicting).toEqual(['co']);
    expect(dist(P(res.entities, 'a'), P(res.entities, 'b'))).toBeCloseTo(10, 9);
    // a vertical added on a line whose direction is fixed by an angle dimension
    const ents2 = [pt('o', 0, 0), pt('p', 10, 0), pt('q', 8, 6), ln('l1', 'o', 'p'), ln('l2', 'o', 'q')];
    const cons2 = [con('h', 'horizontal', ['l1']), con('ang', 'angle', ['l1', 'l2']), con('v', 'vertical', ['l2'])];
    const res2 = solveSketch(ents2, cons2, { ang: Math.PI / 4 });
    expect(res2.conflicting).toEqual(['v']);
    const q = P(res2.entities, 'q');
    const o = P(res2.entities, 'o');
    expect(Math.atan2(q[1] - o[1], q[0] - o[0])).toBeCloseTo(Math.PI / 4, 9);
  });

  it('reports a redundant horizontal constraint', () => {
    const entities = [pt('a', 0, 0), pt('b', 5, 0), pt('c', 9, 0), ln('l1', 'a', 'b'), ln('l2', 'b', 'c'), ln('l3', 'a', 'c')];
    const constraints = [con('h1', 'horizontal', ['l1']), con('h2', 'horizontal', ['l2']), con('h3', 'horizontal', ['l3'])];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual(['h3']);
    // consistent redundancy of a geometric constraint does not over-define the sketch
    expect(res.status.l3).not.toBe('over');
  });

  it('reports redundancy found by rank analysis', () => {
    const r = rectangle(0, 0, 10, 5);
    r.constraints.push(con('par', 'parallel', ['ab', 'cd']));
    const res = solveSketch(r.entities, r.constraints, {});
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual(['par']);
    // a triangle with a redundant fourth dimension
    const tri = [pt('a', 0, 0), pt('b', 4, 0), pt('c', 0, 3), ln('ab', 'a', 'b'), ln('bc', 'b', 'c'), ln('ca', 'c', 'a')];
    const cons = [
      con('f', 'fix', ['a']),
      con('h', 'horizontal', ['ab']),
      con('d1', 'distance', ['ab']),
      con('d2', 'distance', ['bc']),
      con('d3', 'distance', ['ca']),
      con('pp', 'perpendicular', ['ab', 'ca']),
    ];
    const tr = solveSketch(tri, cons, { d1: 4, d2: 5, d3: 3 });
    expect(tr.ok).toBe(true);
    expect(tr.redundant).toEqual(['pp']);
    expect(tr.dof).toBe(0);
  });

  it('a line tangent to two circles with its ends on them is fully defined (ends at the tangent points)', () => {
    // a belt: circles ⌀8 at (0, 0) and (5, 40), the left line tangent to both, each end on its circle
    const entities: SkEntity[] = [pt('c1', 0, 0), pt('c2', 5, 40), circ('k1', 'c1', 4), circ('k2', 'c2', 4), pt('a', -3.9, 0.6), pt('b', 1.1, 40.6), ln('L', 'a', 'b')];
    const constraints = [
      con('f1', 'fix', ['c1']),
      con('f2', 'fix', ['c2']),
      con('r1', 'diameter', ['k1']),
      con('r2', 'diameter', ['k2']),
      con('t1', 'tangent', ['L', 'k1']),
      con('t2', 'tangent', ['L', 'k2']),
      con('o1', 'coincident', ['a', 'k1']),
      con('o2', 'coincident', ['b', 'k2']),
    ];
    const res = solveSketch(entities, constraints, { r1: 8, r2: 8 });
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    expect(res.dof).toBe(0);
    for (const id of ['L', 'a', 'b']) expect(res.status[id]).toBe('full');
    // the ends at the tangent points: the radius there across the line
    const [a, b, c1, c2] = ['a', 'b', 'c1', 'c2'].map((id) => P(res.entities, id));
    const u = [b[0] - a[0], b[1] - a[1]];
    expect((a[0] - c1[0]) * u[0] + (a[1] - c1[1]) * u[1]).toBeCloseTo(0, 6);
    expect((b[0] - c2[0]) * u[0] + (b[1] - c2[1]) * u[1]).toBeCloseTo(0, 6);
    expect(dist(a, c1)).toBeCloseTo(4, 6);
  });

  it('slot (two arcs, two tangent lines) is fully defined without redundancy', () => {
    const entities: SkEntity[] = [
      pt('c1', 0, 0),
      pt('c2', 19, 0.7),
      pt('t1', 0.2, 5.1),
      pt('b1', -0.1, -4.8),
      pt('b2', 19.5, -4.6),
      pt('t2', 19.2, 5.4),
      arc('A1', 'c1', 't1', 'b1'),
      arc('A2', 'c2', 'b2', 't2'),
      ln('L1', 'b1', 'b2'),
      ln('L2', 't2', 't1'),
    ];
    const constraints = [
      con('ta', 'tangent', ['A1', 'L1']),
      con('tb', 'tangent', ['L2', 'A1']),
      con('tc', 'tangent', ['A2', 'L1']),
      con('td', 'tangent', ['A2', 'L2']),
      con('eq', 'equal', ['A1', 'A2']),
      con('f', 'fix', ['c1']),
      con('h', 'horizontal', ['L1']),
      con('r', 'radius', ['A1']),
      con('d', 'distance', ['c1', 'c2']),
    ];
    const dims = { r: 5, d: 20 };
    const res = solveSketch(entities, constraints, dims);
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    expect(res.dof).toBe(0);
    for (const e of entities) expect(res.status[e.id]).toBe('full');
    expect(P(res.entities, 'c2')[0]).toBeCloseTo(20, 9);
    expect(P(res.entities, 'c2')[1]).toBeCloseTo(0, 9);
    expect(P(res.entities, 't1')[1]).toBeCloseTo(5, 9);
    expect(P(res.entities, 'b2')[1]).toBeCloseTo(-5, 9);
    // a horizontal on the top line is implied by the other constraints
    const res2 = solveSketch(res.entities, [...constraints, con('h2', 'horizontal', ['L2'])], dims);
    expect(res2.ok).toBe(true);
    expect(res2.redundant).toEqual(['h2']);
    expect(res2.status.L2).toBe('full');
  });

  it('circle through three fixed points is fully defined', () => {
    const entities = [pt('c', 1, 1), circ('k', 'c', 3), pt('a', 5, 0), pt('b', 0, 5), pt('d', -5, 0)];
    const constraints = [
      con('fa', 'fix', ['a']),
      con('fb', 'fix', ['b']),
      con('fd', 'fix', ['d']),
      con('ca', 'coincident', ['a', 'k']),
      con('cb', 'coincident', ['k', 'b']),
      con('cd', 'coincident', ['d', 'k']),
    ];
    const res = solveSketch(entities, constraints, {});
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(0);
    expect(res.status.k).toBe('full');
    expect(C(res.entities, 'k').r).toBeCloseTo(5, 9);
    expect(dist(P(res.entities, 'c'), [0, 0])).toBeLessThan(1e-9);
  });

  it('degenerate start geometry still solves', () => {
    const entities = [pt('a', 0, 0), pt('b', 0, 0), ln('l', 'a', 'b'), pt('c', 0, 0), ln('m', 'a', 'c')];
    const constraints = [con('len', 'distance', ['l']), con('len2', 'distance', ['m']), con('pp', 'perpendicular', ['l', 'm'])];
    const res = solveSketch(entities, constraints, { len: 10, len2: 4 });
    expect(res.ok).toBe(true);
    expect(dist(P(res.entities, 'a'), P(res.entities, 'b'))).toBeCloseTo(10, 9);
  });

  it('analyze: false skips dof and status', () => {
    const entities = [pt('a', 0, 0), pt('b', 3, 1), ln('l', 'a', 'b')];
    const res = solveSketch(entities, [con('len', 'distance', ['l'])], { len: 5 }, { analyze: false });
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(-1);
    expect(res.status).toEqual({});
  });

  it('unknown refs are ignored', () => {
    const entities = [pt('a', 0, 0)];
    const res = solveSketch(entities, [con('x', 'distance', ['a', 'zzz']), con('y', 'parallel', ['a'])], { x: 3 });
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(2);
  });
});

describe('robustness', () => {
  it('random sketches never throw and return finite, consistent results', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const types: SkConstraint['type'][] = [
      'coincident',
      'horizontal',
      'vertical',
      'parallel',
      'perpendicular',
      'tangent',
      'equal',
      'midpoint',
      'concentric',
      'symmetric',
      'fix',
      'distance',
      'hdistance',
      'vdistance',
      'radius',
      'diameter',
      'angle',
    ];
    let unconverged = 0;
    const runs = 400;
    for (let iter = 0; iter < runs; iter++) {
      const entities: SkEntity[] = [];
      const np = 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < np; i++) entities.push(pt(`p${i}`, rnd() * 20 - 10, rnd() * 20 - 10));
      const pid = () => `p${Math.floor(rnd() * np)}`;
      for (let i = 0; i < 3; i++) entities.push(ln(`l${i}`, pid(), pid()));
      entities.push(circ('k0', pid(), 1 + rnd() * 5), arc('a0', pid(), pid(), pid()));
      entities.push({ id: 'e0', type: 'ellipse', c: pid(), rx: 4, ry: 2, rot: rnd() });
      const ids = entities.map((e) => e.id).concat(['missing']);
      const constraints: SkConstraint[] = [];
      const dims: Record<string, number> = {};
      const nc = Math.floor(rnd() * 8);
      for (let i = 0; i < nc; i++) {
        const type = pick(types);
        const refs = [pick(ids), pick(ids), pick(ids)].slice(0, 1 + Math.floor(rnd() * 3));
        constraints.push(con(`c${i}`, type, refs, { variant: pick([0, 1, -1]) }));
        dims[`c${i}`] = type === 'angle' ? rnd() * Math.PI : rnd() * 15;
      }
      const drag = rnd() < 0.5 ? { points: { [pid()]: [rnd() * 30 - 15, rnd() * 30 - 15] as [number, number] } } : undefined;
      const res = solveSketch(entities, constraints, dims, { drag });
      expect(res.entities.length).toBe(entities.length);
      for (const e of res.entities) {
        if (e.type === 'point') expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        if (e.type === 'circle') expect(Number.isFinite(e.r)).toBe(true);
      }
      if (res.ok) expect(res.maxResidual).toBeLessThanOrEqual(1e-7);
      expect(res.dof).toBeGreaterThanOrEqual(0);
      for (const id of res.conflicting) expect(res.redundant).not.toContain(id);
      if (res.conflicting.length) expect(res.ok).toBe(false);
      // Pathological far-from-solution starts may fail to converge or collapse a line/arc to a
      // point (a degenerate configuration that trivially satisfies e.g. an arc's equal radii).
      const points = (es: SkEntity[]) => new Map(es.flatMap((e) => (e.type === 'point' ? [[e.id, e] as const] : [])));
      const [before, after] = [points(entities), points(res.entities)];
      const span = (m: typeof before, ids: string[]) => {
        const [a, b] = ids.map((id) => m.get(id));
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      };
      const collapsed = res.entities.some((e) => {
        const ends = e.type === 'line' || e.type === 'arc' ? [e.p1, e.p2] : [];
        return ends.length > 0 && span(after, ends) < 1e-2 * span(before, ends);
      });
      if ((!res.ok && !res.conflicting.length) || (!res.ok && collapsed)) {
        unconverged++;
        continue;
      }
      // everything that is not reported as conflicting is satisfied by the result
      const rest = constraints.filter((c) => !res.conflicting.includes(c.id));
      const again = solveSketch(res.entities, rest, dims);
      expect(again.ok).toBe(true);
      let moved = 0;
      again.entities.forEach((e, i) => {
        const o = res.entities[i];
        if (e.type === 'point' && o.type === 'point') moved = Math.max(moved, Math.hypot(e.x - o.x, e.y - o.y));
      });
      expect(moved).toBeLessThan(1e-6);
    }
    expect(unconverged).toBeLessThanOrEqual(runs / 50);
  });
});

describe('helpers', () => {
  it('frozenValues', () => {
    const entities = [pt('c', 1, 2), circ('k', 'c', 3), pt('p', 4, 5), ln('l', 'c', 'p'), arc('a', 'c', 'p', 'c')];
    expect(frozenValues('c', entities)).toEqual([1, 2]);
    expect(frozenValues('k', entities)).toEqual([1, 2, 3]);
    expect(frozenValues('l', entities)).toEqual([1, 2, 4, 5]);
    expect(frozenValues('a', entities)).toEqual([1, 2, 4, 5, 1, 2]);
    expect(frozenValues('nope', entities)).toEqual([]);
  });

  it('measureConstraint', () => {
    const entities = [pt('a', 0, 0), pt('b', 3, 4), ln('l', 'a', 'b'), pt('c', 0, 0), pt('d', 0, 2), ln('m', 'c', 'd')];
    expect(measureConstraint(con('d', 'distance', ['l']), entities)).toBeCloseTo(5, 12);
    expect(measureConstraint(con('h', 'hdistance', ['b', 'a']), entities)).toBeCloseTo(3, 12);
    expect(measureConstraint(con('v', 'vdistance', ['a', 'b']), entities)).toBeCloseTo(4, 12);
    expect(measureConstraint(con('an', 'angle', ['l', 'm']), entities)).toBeCloseTo(Math.atan2(3, 4), 12);
  });
});

describe('performance', () => {
  /** Time budget in ms: strict locally, looser on shared CI runners (CI=true on GitHub Actions). */
  const budget = (ms: number) => (process.env.CI ? ms * 5 : ms);

  /** nx × ny rectangles, each dimensioned and positioned relative to its neighbour. */
  function grid(nx: number, ny: number, separatePoints: boolean) {
    let entities: SkEntity[] = [];
    const constraints: SkConstraint[] = [];
    const dims: Record<string, number> = {};
    let seed = 1;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const pre = `r${i}_${j}_`;
        const x = i * 15;
        const y = j * 12;
        if (separatePoints) {
          const cs: [number, number][] = [
            [x, y],
            [x + 10, y],
            [x + 10, y + 8],
            [x, y + 8],
          ];
          for (let k = 0; k < 4; k++) {
            const [x1, y1] = cs[k];
            const [x2, y2] = cs[(k + 1) % 4];
            entities.push(pt(`${pre}s${k}`, x1 + rnd(), y1 + rnd()), pt(`${pre}e${k}`, x2 + rnd(), y2 + rnd()));
            entities.push(ln(`${pre}l${k}`, `${pre}s${k}`, `${pre}e${k}`));
            constraints.push(con(`${pre}co${k}`, 'coincident', [`${pre}e${k}`, `${pre}s${(k + 1) % 4}`]));
            constraints.push(con(`${pre}hv${k}`, k % 2 ? 'vertical' : 'horizontal', [`${pre}l${k}`]));
          }
          constraints.push(con(`${pre}w`, 'distance', [`${pre}l0`]), con(`${pre}h`, 'distance', [`${pre}l1`]));
        } else {
          const r = rectangle(x + rnd(), y + rnd(), 10 + rnd(), 8 + rnd(), pre);
          for (const e of r.entities) if (e.type === 'point') e.x += rnd();
          entities = entities.concat(r.entities);
          constraints.push(...r.constraints);
          constraints.push(con(`${pre}w`, 'distance', [`${pre}ab`]), con(`${pre}h`, 'distance', [`${pre}bc`]));
        }
        dims[`${pre}w`] = 11;
        dims[`${pre}h`] = 7;
        const corner = separatePoints ? 's0' : 'a';
        if (i > 0 || j > 0) {
          const nb = i > 0 ? `r${i - 1}_${j}_${corner}` : `r${i}_${j - 1}_${corner}`;
          constraints.push(con(`${pre}hd`, 'hdistance', [nb, `${pre}${corner}`]), con(`${pre}vd`, 'vdistance', [nb, `${pre}${corner}`]));
          dims[`${pre}hd`] = i > 0 ? 15 : 0;
          dims[`${pre}vd`] = i > 0 ? 0 : 12;
        } else constraints.push(con('fix0', 'fix', [`${pre}${corner}`], { frozen: [0, 0] }));
      }
    }
    return { entities, constraints, dims };
  }

  it('solves a grid of 100 connected rectangles quickly', () => {
    const { entities, constraints, dims } = grid(10, 10, false);
    solveSketch(entities, constraints, dims); // warm-up
    const t0 = performance.now();
    const res = solveSketch(entities, constraints, dims);
    const t = performance.now() - t0;
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(0);
    expect(res.redundant).toEqual([]);
    expect(P(res.entities, 'r9_9_c')[0]).toBeCloseTo(9 * 15 + 11, 7);
    expect(P(res.entities, 'r9_9_c')[1]).toBeCloseTo(9 * 12 + 7, 7);
    expect(t).toBeLessThan(budget(150));
  });

  it('solves ~200 entities / 300 constraints in < 30 ms', () => {
    const { entities, constraints, dims } = grid(4, 4, true);
    solveSketch(entities, constraints, dims);
    const t0 = performance.now();
    const res = solveSketch(entities, constraints, dims);
    const t = performance.now() - t0;
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(0);
    expect(t).toBeLessThan(budget(30));
  });

  /** Polyline with lengths/angles plus tangent circles: ~200 entities, ~300 non-substitutable constraints. */
  function chain(fixed: boolean) {
    const entities: SkEntity[] = [];
    const constraints: SkConstraint[] = [];
    const dims: Record<string, number> = {};
    const n = 60;
    let x = 0;
    let y = 0;
    for (let i = 0; i <= n; i++) {
      entities.push(pt(`p${i}`, x, y));
      const a = 0.3 * Math.sin(i * 0.7);
      x += 10 * Math.cos(a);
      y += 10 * Math.sin(a);
    }
    for (let i = 0; i < n; i++) {
      entities.push(ln(`l${i}`, `p${i}`, `p${i + 1}`));
      constraints.push(con(`d${i}`, 'distance', [`l${i}`]));
      dims[`d${i}`] = 11 + (i % 3);
      if (i > 0) {
        const c = con(`a${i}`, 'angle', [`l${i - 1}`, `l${i}`]);
        constraints.push(c);
        dims[`a${i}`] = 0.1 + 0.05 * (i % 4);
      }
    }
    for (let i = 0; i < 40; i++) {
      const p = entities.find((e) => e.id === `p${i}`) as SkPoint;
      entities.push(pt(`c${i}`, p.x + 1, p.y + 4), circ(`k${i}`, `c${i}`, 3));
      constraints.push(con(`t${i}`, 'tangent', [`l${i}`, `k${i}`]), con(`r${i}`, 'radius', [`k${i}`]), con(`cd${i}`, 'distance', [`c${i}`, `p${i}`]));
      constraints.push(con(`e${i}`, 'equal', [`k${i}`, `k${(i + 1) % 40}`]));
      dims[`r${i}`] = 3.5;
      dims[`cd${i}`] = 6;
    }
    if (fixed) constraints.push(con('f', 'fix', ['p0']), con('h', 'horizontal', ['l0']));
    return { entities, constraints, dims };
  }

  it('solves a nonlinear chain of ~200 entities / ~300 constraints in < 30 ms', () => {
    for (const fixed of [true, false]) {
      const { entities, constraints, dims } = chain(fixed);
      solveSketch(entities, constraints, dims);
      const t0 = performance.now();
      const res = solveSketch(entities, constraints, dims);
      const t = performance.now() - t0;
      expect(res.ok).toBe(true);
      expect(res.conflicting).toEqual([]);
      // the 'equal' ring is redundant with the radius dimensions: 40 radius + 40 equal constraints on 40 radii
      expect(res.redundant.length).toBe(40);
      expect(res.dof).toBe(fixed ? 0 : 3);
      expect(t).toBeLessThan(budget(30));
      // dragging the end of the free chain
      if (!fixed) {
        const t1 = performance.now();
        const dr = solveSketch(res.entities, constraints, dims, { drag: { points: { p60: [500, 300] } }, analyze: false });
        expect(performance.now() - t1).toBeLessThan(budget(30));
        expect(dr.ok).toBe(true);
        expect(P(dr.entities, 'p60')[0]).toBeCloseTo(500, 9);
      }
    }
  });

  it('handles a conflict in a large sketch reasonably fast', () => {
    const { entities, constraints, dims } = chain(true);
    constraints.push(con('bad', 'distance', ['p0', 'p5']));
    dims.bad = 1;
    solveSketch(entities, constraints, dims);
    const t0 = performance.now();
    const res = solveSketch(entities, constraints, dims);
    const t = performance.now() - t0;
    expect(res.ok).toBe(false);
    expect(res.conflicting).toContain('bad');
    expect(t).toBeLessThan(budget(200));
  });

  it('typical small sketch with a drag is fast', () => {
    const { entities, constraints, dims } = grid(2, 1, false);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) solveSketch(entities, constraints, dims, { drag: { points: { r1_0_c: [40 + i * 0.01, 9] } } });
    const t = (performance.now() - t0) / 100;
    expect(t).toBeLessThan(budget(2));
  });
});

describe('more dimensions: to a circle itself, arc length, angle by three points, driven', () => {
  /** A distance to a circle / arc itself, with the variant it gets when made. */
  const toCurve = (id: string, refs: string[], entities: SkEntity[]): SkConstraint => {
    const c = con(id, 'distance', refs, { toCurve: true });
    return { ...c, variant: initialVariant(c, entities) };
  };
  const fixedCircle = [pt('c', 0, 0), circ('C', 'c', 10)];
  const fixC = con('fc', 'fix', ['C']);

  it('from a point to a circle: outside and inside', () => {
    for (const [x0, gap, x] of [
      [25, 5, 15],
      [3, 4, 6],
    ]) {
      const entities = [...fixedCircle, pt('p', x0, 0)];
      const d = toCurve('d', ['p', 'C'], entities);
      expect(measureConstraint(d, entities)).toBeCloseTo(Math.abs(x0 - 10), 9);
      const res = solveSketch(entities, [fixC, con('h', 'horizontal', ['c', 'p']), d], { d: gap });
      expect(res.ok).toBe(true);
      expect(P(res.entities, 'p')[0]).toBeCloseTo(x, 6);
    }
  });

  it('from a line to a circle, and between circles (apart and one in the other)', () => {
    const line = [pt('a', -10, 20), pt('b', 10, 20), ln('L', 'a', 'b')];
    const entities = [...fixedCircle, ...line];
    const res = solveSketch(entities, [fixC, con('h', 'horizontal', ['L']), toCurve('d', ['L', 'C'], entities)], { d: 5 });
    expect(P(res.entities, 'a')[1]).toBeCloseTo(15, 6);

    for (const [x0, gap, x] of [
      [30, 8, 23],
      [2, 3, 2],
    ]) {
      const ents = [...fixedCircle, pt('k', x0, 0), circ('K', 'k', 5)];
      const d = toCurve('d', ['K', 'C'], ents);
      const r = solveSketch(ents, [fixC, con('hk', 'horizontal', ['c', 'k']), con('r', 'radius', ['K']), d], { d: gap, r: 5 });
      expect(r.ok).toBe(true);
      expect(P(r.entities, 'k')[0]).toBeCloseTo(x, 6);
    }
  });

  it('the length of an arc', () => {
    const entities = [pt('c', 0, 0), pt('s', 10, 0), pt('e', 7, 7), arc('A', 'c', 's', 'e')];
    const len = con('l', 'arclength', ['A']);
    expect(measureConstraint(len, entities)).toBeCloseTo(Math.hypot(10, 0) * (Math.PI / 4), 6);
    const res = solveSketch(entities, [con('f1', 'fix', ['c']), con('f2', 'fix', ['s']), len], { l: (10 * Math.PI) / 2 });
    expect(res.ok).toBe(true);
    const e = P(res.entities, 'e');
    expect(e[0]).toBeCloseTo(0, 5);
    expect(e[1]).toBeCloseTo(10, 5);
  });

  it('the angle at the middle of three points', () => {
    const entities = [pt('a', 10, 0), pt('v', 0, 0), pt('b', 10, 3)];
    const ang = con('g', 'angle', ['a', 'v', 'b']);
    expect(measureConstraint(ang, entities)).toBeCloseTo(Math.atan2(3, 10), 9);
    const res = solveSketch(entities, [con('f1', 'fix', ['a']), con('f2', 'fix', ['v']), con('d', 'distance', ['v', 'b']), ang], { d: 10, g: Math.PI / 3 });
    expect(res.ok).toBe(true);
    const b = P(res.entities, 'b');
    expect(b[0]).toBeCloseTo(5, 5);
    expect(b[1]).toBeCloseTo(10 * Math.sin(Math.PI / 3), 5);
  });

  it('a driven dimension does not move the geometry', () => {
    const entities = [pt('a', 0, 0), pt('b', 10, 0), ln('L', 'a', 'b')];
    const res = solveSketch(entities, [con('f', 'fix', ['a']), con('d', 'distance', ['L'], { driven: true })], { d: 50 });
    expect(res.ok).toBe(true);
    expect(P(res.entities, 'b')).toEqual([10, 0]);
  });
});
