import { describe, expect, it } from 'vitest';
import type { SkEntity, Vec2 } from '../core/types';
import {
  arcAngles,
  closestPointOnEntity,
  dist,
  distanceToEntity,
  entityMap,
  intersectEntities,
  pointOf,
  sampleEntity,
  sampleSpline,
} from './curves';

const P = (id: string, x: number, y: number): SkEntity => ({ id, type: 'point', x, y });

describe('sampleSpline', () => {
  it('passes through the given points (open)', () => {
    const pts: Vec2[] = [
      [0, 0],
      [1, 2],
      [3, 1],
      [4, 4],
    ];
    const s = sampleSpline(pts, false, 10);
    expect(s.length).toBe(1 + 3 * 10);
    pts.forEach((p, i) => {
      expect(s[i * 10][0]).toBeCloseTo(p[0], 12);
      expect(s[i * 10][1]).toBeCloseTo(p[1], 12);
    });
  });

  it('closed spline returns a closed polyline through all points', () => {
    const pts: Vec2[] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    const s = sampleSpline(pts, true, 8);
    expect(s.length).toBe(1 + 4 * 8);
    expect(s[0]).toEqual(s[s.length - 1]);
    pts.forEach((p, i) => expect(dist(s[i * 8], p)).toBeLessThan(1e-12));
    // smooth: no sample far outside the hull
    for (const q of s) {
      expect(q[0]).toBeGreaterThan(-0.6);
      expect(q[0]).toBeLessThan(2.6);
    }
  });

  it('handles degenerate inputs', () => {
    expect(sampleSpline([], false)).toEqual([]);
    expect(sampleSpline([[1, 1]], false)).toEqual([[1, 1]]);
    const two = sampleSpline(
      [
        [0, 0],
        [0, 0],
        [2, 0],
      ],
      false,
      4,
    );
    expect(two.length).toBe(5);
    for (const q of two) expect(Math.abs(q[1])).toBeLessThan(1e-12);
  });
});

describe('arcAngles / sampleEntity', () => {
  it('computes a CCW sweep in (0, 2π] and uses only the angle of p2', () => {
    const ents: SkEntity[] = [
      P('c', 0, 0),
      P('a', 1, 0),
      P('b', 0, 1.01), // slightly off radius
      { id: 'arc', type: 'arc', c: 'c', p1: 'a', p2: 'b' },
      { id: 'arc2', type: 'arc', c: 'c', p1: 'b', p2: 'a' },
    ];
    const map = entityMap(ents);
    const g = arcAngles(ents[3] as never, map);
    expect(g.r).toBeCloseTo(1, 12);
    expect(g.a1 - g.a0).toBeCloseTo(Math.PI / 2, 12);
    const g2 = arcAngles(ents[4] as never, map);
    expect(g2.a1 - g2.a0).toBeCloseTo((3 * Math.PI) / 2, 12);
    const s = sampleEntity(ents[3], map);
    expect(dist(s[0], [1, 0])).toBeLessThan(1e-12);
    expect(dist(s[s.length - 1], [0, 1])).toBeLessThan(1e-12);
    expect(s.length).toBeGreaterThanOrEqual(19); // ~every 4–5°
  });

  it('samples circles closed and lines as 2 points', () => {
    const ents: SkEntity[] = [
      P('c', 1, 1),
      P('a', 0, 0),
      P('b', 3, 4),
      { id: 'ci', type: 'circle', c: 'c', r: 2 },
      { id: 'l', type: 'line', p1: 'a', p2: 'b' },
    ];
    const map = entityMap(ents);
    const s = sampleEntity(ents[3], map);
    expect(s[0]).toEqual(s[s.length - 1]);
    for (const q of s) expect(dist(q, [1, 1])).toBeCloseTo(2, 12);
    expect(sampleEntity(ents[4], map)).toEqual([
      [0, 0],
      [3, 4],
    ]);
  });

  it('pointOf throws for missing points', () => {
    expect(() => pointOf(entityMap([]), 'x')).toThrow();
  });
});

describe('intersectEntities', () => {
  const base: SkEntity[] = [
    P('o', 0, 0),
    { id: 'circ', type: 'circle', c: 'o', r: 1 },
    P('l1', -2, 0.5),
    P('l2', 2, 0.5),
    { id: 'line', type: 'line', p1: 'l1', p2: 'l2' },
    P('t1', -2, 1),
    P('t2', 2, 1),
    { id: 'tan', type: 'line', p1: 't1', p2: 't2' },
    P('s1', -2, 2),
    P('s2', 2, 2),
    { id: 'miss', type: 'line', p1: 's1', p2: 's2' },
  ];
  const map = entityMap(base);
  const get = (id: string) => map.get(id) as SkEntity;

  it('line / circle gives two points', () => {
    const pts = intersectEntities(get('line'), get('circ'), map).sort((a, b) => a[0] - b[0]);
    expect(pts.length).toBe(2);
    const x = Math.sqrt(1 - 0.25);
    expect(dist(pts[0], [-x, 0.5])).toBeLessThan(1e-12);
    expect(dist(pts[1], [x, 0.5])).toBeLessThan(1e-12);
  });

  it('tangent line gives one point, distant line none', () => {
    const t = intersectEntities(get('tan'), get('circ'), map);
    expect(t.length).toBe(1);
    expect(dist(t[0], [0, 1])).toBeLessThan(1e-9);
    expect(intersectEntities(get('miss'), get('circ'), map)).toEqual([]);
  });

  it('line / line, circle / circle, arc extent', () => {
    const ents: SkEntity[] = [
      P('a', 0, 0),
      P('b', 2, 2),
      P('c', 0, 2),
      P('d', 2, 0),
      { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
      { id: 'l2', type: 'line', p1: 'c', p2: 'd' },
      P('o1', 0, 0),
      P('o2', 1, 0),
      { id: 'c1', type: 'circle', c: 'o1', r: 1 },
      { id: 'c2', type: 'circle', c: 'o2', r: 1 },
      P('q1', 1, 0),
      P('q2', -1, 0),
      { id: 'upper', type: 'arc', c: 'o1', p1: 'q1', p2: 'q2' }, // upper half of c1
    ];
    const m = entityMap(ents);
    const g = (id: string) => m.get(id) as SkEntity;
    const ll = intersectEntities(g('l1'), g('l2'), m);
    expect(ll.length).toBe(1);
    expect(dist(ll[0], [1, 1])).toBeLessThan(1e-12);
    const cc = intersectEntities(g('c1'), g('c2'), m);
    expect(cc.length).toBe(2);
    for (const p of cc) {
      expect(p[0]).toBeCloseTo(0.5, 12);
      expect(Math.abs(p[1])).toBeCloseTo(Math.sqrt(3) / 2, 12);
    }
    const ac = intersectEntities(g('upper'), g('c2'), m);
    expect(ac.length).toBe(1);
    expect(ac[0][1]).toBeGreaterThan(0);
  });

  it('ellipse and spline intersections (numeric)', () => {
    const ents: SkEntity[] = [
      P('o', 0, 0),
      { id: 'el', type: 'ellipse', c: 'o', rx: 2, ry: 1, rot: 0 },
      { id: 'ci', type: 'circle', c: 'o', r: 1.5 },
      P('a', -3, 0),
      P('b', 3, 0),
      { id: 'ln', type: 'line', p1: 'a', p2: 'b' },
      P('s1', -3, -1),
      P('s2', 0, 1),
      P('s3', 3, -1),
      { id: 'sp', type: 'spline', pts: ['s1', 's2', 's3'] },
    ];
    const m = entityMap(ents);
    const g = (id: string) => m.get(id) as SkEntity;
    const le = intersectEntities(g('ln'), g('el'), m);
    expect(le.length).toBe(2);
    for (const p of le) expect(Math.abs(p[0])).toBeCloseTo(2, 10);
    const ce = intersectEntities(g('ci'), g('el'), m);
    expect(ce.length).toBe(4);
    for (const p of ce) {
      expect(dist(p, [0, 0])).toBeCloseTo(1.5, 8);
      expect((p[0] / 2) ** 2 + p[1] ** 2).toBeCloseTo(1, 8);
    }
    const sl = intersectEntities(g('sp'), g('ln'), m);
    expect(sl.length).toBe(2);
    for (const p of sl) expect(Math.abs(p[1])).toBeLessThan(1e-9);
  });
});

describe('distanceToEntity / closestPointOnEntity', () => {
  const ents: SkEntity[] = [
    P('c', 0, 0),
    P('a', 1, 0),
    P('b', 0, 1),
    { id: 'arc', type: 'arc', c: 'c', p1: 'a', p2: 'b' }, // quarter arc in the first quadrant
    P('l1', 0, 0),
    P('l2', 4, 0),
    { id: 'line', type: 'line', p1: 'l1', p2: 'l2' },
    { id: 'el', type: 'ellipse', c: 'c', rx: 3, ry: 1, rot: Math.PI / 2 },
  ];
  const map = entityMap(ents);

  it('respects the arc extent', () => {
    // radial distance inside the sweep
    expect(distanceToEntity([2, 2], ents[3], map)).toBeCloseTo(2 * Math.SQRT2 - 1, 12);
    // opposite side of the circle: nearest is an end point, not the radial distance
    const d = distanceToEntity([-2, -0.1], ents[3], map);
    expect(d).toBeCloseTo(dist([-2, -0.1], [0, 1]), 12);
    expect(d).toBeGreaterThan(1.5);
  });

  it('lines clamp to the segment, ellipses are exact', () => {
    expect(distanceToEntity([5, 1], ents[6], map)).toBeCloseTo(Math.SQRT2, 12);
    expect(distanceToEntity([2, -3], ents[6], map)).toBeCloseTo(3, 12);
    // rotated ellipse: major axis along y
    expect(distanceToEntity([0, 5], ents[7], map)).toBeCloseTo(2, 9);
    expect(distanceToEntity([3, 0], ents[7], map)).toBeCloseTo(2, 9);
    const q = closestPointOnEntity([0.1, 5], ents[7], map);
    expect((q[0] / 1) ** 2 + (q[1] / 3) ** 2).toBeCloseTo(1, 9);
  });
});
