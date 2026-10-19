// A path (a wire of edges) measured along its length: points, tangents and frames that turn with it — for curve
// patterns (Onshape Curve pattern). The frames are rotation-minimizing (carried along without twisting): for a planar
// path one axis stays the plane's normal.

import * as R from 'replicad';
import { perpendicular, rotateVec, v3 } from '../core/math';
import type { PlaneFrame, Vec3 } from '../core/types';

export interface PathFrames {
  length: number;
  closed: boolean;
  /** The frame at distance `s` from the start: origin on the path, xDir along it. */
  frameAt(s: number): PlaneFrame;
}

const SAMPLES = 400;

export function pathFrames(wire: R.Wire): PathFrames {
  const oc = R.getOC();
  const c = new oc.BRepAdaptor_CompCurve(wire.wrapped, true);
  const u0 = c.FirstParameter();
  const u1 = c.LastParameter();
  const P = (u: number): Vec3 => {
    const p = c.EvalD0(Math.min(u1, Math.max(u0, u)));
    const out: Vec3 = [p.X(), p.Y(), p.Z()];
    p.delete();
    return out;
  };
  const h = (u1 - u0) * 1e-6;
  const T = (u: number): Vec3 => {
    const a = P(Math.max(u0, u - h));
    const b = P(Math.min(u1, u + h));
    return v3.norm(v3.sub(b, a));
  };
  // the length table: parameter → distance along the path
  const us: number[] = [];
  const ls: number[] = [];
  const pts: Vec3[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = u0 + ((u1 - u0) * i) / SAMPLES;
    const p = P(u);
    us.push(u);
    pts.push(p);
    ls.push(i ? ls[i - 1] + v3.dist(pts[i - 1], p) : 0);
  }
  const length = ls[SAMPLES];
  const closed = v3.dist(pts[0], pts[SAMPLES]) < 1e-6 * Math.max(1, length);
  // a planar path: its plane's normal (from the points' spread), else none
  const normal = planeNormal(pts, length);
  // frames carried along the samples without twisting
  const tans = us.map(T);
  const sides: Vec3[] = [normal ? v3.norm(v3.cross(normal, tans[0])) : perpendicular(tans[0])];
  for (let i = 1; i <= SAMPLES; i++) {
    const a = tans[i - 1];
    const b = tans[i];
    const axis = v3.cross(a, b);
    const s = v3.len(axis);
    let n = sides[i - 1];
    if (s > 1e-12) n = rotateVec(n, v3.scale(axis, 1 / s), Math.atan2(s, v3.dot(a, b)));
    // straightened against the tangent (rounding drift)
    sides.push(v3.norm(v3.sub(n, v3.scale(b, v3.dot(n, b)))));
  }
  return {
    length,
    closed,
    frameAt(dist: number): PlaneFrame {
      const s = Math.min(length, Math.max(0, dist));
      let k = 0;
      while (k < SAMPLES - 1 && ls[k + 1] < s) k++;
      const f = ls[k + 1] > ls[k] ? (s - ls[k]) / (ls[k + 1] - ls[k]) : 0;
      const u = us[k] + (us[k + 1] - us[k]) * f;
      const t = T(u);
      const side = v3.add(v3.scale(sides[k], 1 - f), v3.scale(sides[k + 1], f));
      const y = v3.norm(v3.sub(side, v3.scale(t, v3.dot(side, t))));
      return { origin: P(u), xDir: t, yDir: y, normal: v3.cross(t, y) };
    },
  };
}

/** The normal of the plane the points lie in (within a small tolerance), or none. */
function planeNormal(pts: Vec3[], length: number): Vec3 | null {
  const o = pts[0];
  let best: Vec3 | null = null;
  let bestLen = 0;
  // the widest cross product of chords from the first point
  for (let i = 1; i < pts.length; i += 7)
    for (let j = i + 3; j < pts.length; j += 11) {
      const n = v3.cross(v3.sub(pts[i], o), v3.sub(pts[j], o));
      const l = v3.len(n);
      if (l > bestLen) [best, bestLen] = [n, l];
    }
  // a straight line: any plane would do — none
  if (!best || bestLen < 1e-9 * length * length) return null;
  const n = v3.norm(best);
  const tol = 1e-6 * Math.max(1, length);
  return pts.every((p) => Math.abs(v3.dot(v3.sub(p, o), n)) < tol) ? n : null;
}
