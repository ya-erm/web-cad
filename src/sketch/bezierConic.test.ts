// Bézier curves and conics as splines with tangent handles: exact Bézier; conics within a hair of the true curve.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData, Vec2 } from '../core/types';
import { entityMap, splineSamples } from './curves';
import { addBezier, conicControls, conicRho } from './sketchOps';

const empty = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });
const bezier = (a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [k[0] * a[0] + k[1] * b[0] + k[2] * c[0] + k[3] * d[0], k[0] * a[1] + k[1] * b[1] + k[2] * c[1] + k[3] * d[1]];
};

describe('Bézier and conic', () => {
  it('a Bézier spline is exactly the cubic Bézier of its four points', () => {
    const P: Vec2[] = [
      [0, 0],
      [2, 6],
      [8, 7],
      [10, 0],
    ];
    const d = produce(empty(), (dd) => void addBezier(dd, P[0], P[1], P[2], P[3]));
    const sp = d.entities.find((e) => e.type === 'spline');
    if (sp?.type !== 'spline') throw new Error('no spline');
    expect(sp.pts.length).toBe(2);
    const pts = splineSamples(sp, entityMap(d.entities), 10);
    pts.forEach((p, i) => {
      const q = bezier(P[0], P[1], P[2], P[3], i / 10);
      expect(p[0]).toBeCloseTo(q[0], 9);
      expect(p[1]).toBeCloseTo(q[1], 9);
    });
  });

  it('a conic: a quarter circle within 0.03 %, ρ found again from its shoulder', () => {
    const rho = Math.SQRT1_2 / (1 + Math.SQRT1_2);
    const [c1, c2] = conicControls([1, 0], [0, 1], [1, 1], rho);
    for (let i = 0; i <= 20; i++) expect(Math.abs(Math.hypot(...bezier([1, 0], c1, c2, [0, 1], i / 20)) - 1)).toBeLessThan(3e-4);
    // the shoulder of a conic: from the chord's middle towards the apex by ρ
    const m: Vec2 = [0.5, 0.5];
    expect(conicRho([1, 0], [0, 1], [1, 1], [m[0] + rho * 0.5, m[1] + rho * 0.5])).toBeCloseTo(rho, 12);
    // a parabola (ρ = 0.5): exact, its middle point is the shoulder
    const [p1, p2] = conicControls([0, 0], [10, 0], [5, 10], 0.5);
    expect(bezier([0, 0], p1, p2, [10, 0], 0.5)).toEqual([5, 5]);
  });
});
