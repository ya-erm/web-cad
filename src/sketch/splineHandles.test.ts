// Spline tangent handles (Onshape): Bézier control points of the end spans.

import { describe, expect, it } from 'vitest';
import type { SkPoint, SkSpline, SketchData, Vec2 } from '../core/types';
import { naturalHandles, sampleSpline } from './curves';
import { addArc, addConstraint, addLine, addSpline, addSplineHandle, deleteItems } from './sketchOps';
import { solveSketch } from './solver';

const sketch = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });
const pt = (d: { entities: SketchData['entities'] }, id: string) => d.entities.find((e) => e.id === id) as SkPoint;

const maxGap = (a: Vec2[], b: Vec2[]) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
const dir = (a: Vec2, b: Vec2) => Math.atan2(b[1] - a[1], b[0] - a[0]);

describe('spline tangent handles', () => {
  const pts: Vec2[] = [
    [0, 0],
    [10, 6],
    [25, 4],
    [31, 15],
  ];

  it('natural handles leave the curve unchanged', () => {
    for (const P of [pts, pts.slice(0, 3), pts.slice(0, 2)]) {
      const plain = sampleSpline(P, false, 16);
      const nat = naturalHandles(P)!;
      const withHandles = sampleSpline(P, false, 16, nat);
      expect(withHandles.length).toBe(plain.length);
      expect(maxGap(withHandles, plain)).toBeLessThan(1e-9);
    }
  });

  it('a handle sets the end tangent and keeps the through points', () => {
    const h0: Vec2 = [0, 8]; // leave the start straight up
    const h1: Vec2 = [40, 15]; // arrive at the end heading left (from the right)
    const out = sampleSpline(pts, false, 64, { h0, h1 });
    // through points stay at index i * perSpan
    pts.forEach((p, i) => expect(out[i * 64]).toEqual(p));
    // the first / last chords (1/64 of a span) follow the handles
    expect(dir(out[0], out[1])).toBeCloseTo(Math.PI / 2, 1);
    const n = out.length;
    expect(Math.abs(dir(out[n - 2], out[n - 1]))).toBeCloseTo(Math.PI, 1);
    // the inner spans are untouched
    const plain = sampleSpline(pts, false, 64);
    expect(maxGap(out.slice(64, 129), plain.slice(64, 129))).toBeLessThan(1e-12);
  });

  it('makes a spline tangent to a line at the joint', () => {
    const d = sketch();
    const l = addLine(d, [0, 0], [10, 0]);
    const s = addSpline(d, [
      [10, 0],
      [15, 6],
      [22, 2],
    ]);
    addConstraint(d, 'coincident', [l.p2, s.pts[0]]);
    const h0 = addSplineHandle(d, s.id, 'h0')!;
    expect(h0).toBeTruthy();
    addConstraint(d, 'tangent', [s.id, l.id]);
    const res = solveSketch(d.entities, d.constraints, {});
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    const p = pt(res, s.pts[0]);
    const h = pt(res, h0);
    const a = pt(res, l.p1);
    // the handle continues the line's direction (the line may turn: nothing fixes it)
    const u = [p.x - a.x, p.y - a.y];
    const v = [h.x - p.x, h.y - p.y];
    expect((u[0] * v[1] - u[1] * v[0]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])).toBeCloseTo(0, 6);
    expect(u[0] * v[0] + u[1] * v[1]).toBeGreaterThan(0);
  });

  it('makes a spline tangent to an arc at the joint', () => {
    const d = sketch();
    // quarter arc around the origin ending at (0, 10); the spline continues from there
    const a = addArc(d, [0, 0], [10, 0], [0, 10]);
    const s = addSpline(d, [
      [0, 10],
      [-6, 12],
      [-12, 9],
    ]);
    addConstraint(d, 'coincident', [a.p2, s.pts[0]]);
    const h0 = addSplineHandle(d, s.id, 'h0')!;
    addConstraint(d, 'tangent', [a.id, s.id]);
    const res = solveSketch(d.entities, d.constraints, {});
    expect(res.ok).toBe(true);
    const c = pt(res, a.c);
    const p = pt(res, s.pts[0]);
    const h = pt(res, h0);
    // handle ⟂ radius at the joint
    const dotp = (p.x - c.x) * (h.x - p.x) + (p.y - c.y) * (h.y - p.y);
    expect(dotp).toBeCloseTo(0, 6);
  });

  it('deleting a handle keeps the spline (back to the natural tangent)', () => {
    const d = sketch();
    const s = addSpline(d, pts);
    const h1 = addSplineHandle(d, s.id, 'h1')!;
    deleteItems(d, [h1]);
    const sp = d.entities.find((e) => e.id === s.id) as SkSpline;
    expect(sp).toBeTruthy();
    expect(sp.h1).toBeUndefined();
    expect(d.entities.some((e) => e.id === h1)).toBe(false);
    // deleting the spline removes its handles too
    const h0 = addSplineHandle(d, s.id, 'h0')!;
    deleteItems(d, [s.id]);
    expect(d.entities.some((e) => e.id === h0)).toBe(false);
  });

  it('closed splines ignore handles', () => {
    const plain = sampleSpline(pts, true, 16);
    expect(maxGap(sampleSpline(pts, true, 16, { h0: [5, 5] }), plain)).toBe(0);
  });
});
