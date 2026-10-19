// Shared 2D curve helpers for sketches: sampling (display / hit testing), closest points,
// intersections. Used by the sketch UI, the region finder and the 3D kernel.
//
// Internally every curve entity is converted to a parametric primitive (`Prim`):
//   seg  : P(t) = a + t (b - a),                       t in [0, 1]
//   arc  : P(t) = c + r (cos t, sin t),                t in [t0, t0 + sweep]   (CCW)
//   ell  : P(t) = c + R(rot) (rx cos t, ry sin t),     t in [t0, t0 + sweep]   (CCW)
//   poly : piecewise linear through pts,               t in [0, pts.length - 1] (closed: pts[0] == pts[last])
// Splines are represented by their dense Catmull-Rom polyline.

import type { SkArc, SkEntity, SkSpline, Vec2 } from '../core/types';

export type EntityMap = Map<string, SkEntity>;

export const TAU = Math.PI * 2;
/** Default angular step for display sampling of circles / arcs / ellipses (4°). */
export const DEFAULT_ANGLE_STEP = Math.PI / 45;

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

export function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}
export function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}
export function scale(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s];
}
export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}
export function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}
export function len(a: Vec2): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
}
export function dist(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}
export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
}
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
/** Left-hand perpendicular (rotated +90°). */
export function perp(a: Vec2): Vec2 {
  return [-a[1], a[0]];
}
export function rotate(a: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
}
/** Positive modulo: result in [0, m). */
export function mod(a: number, m: number): number {
  const r = a % m;
  return r < 0 ? r + m : r;
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Even-odd point in polygon test (polygon given without repeated closing point; a repeated one is harmless). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  const x = p[0];
  const y = p[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Entity access
// ---------------------------------------------------------------------------

export function entityMap(entities: SkEntity[]): EntityMap {
  const m: EntityMap = new Map();
  for (const e of entities) m.set(e.id, e);
  return m;
}

export function pointOf(map: EntityMap, id: string): Vec2 {
  const e = map.get(id);
  if (!e || e.type !== 'point') throw new Error(`Sketch point "${id}" not found`);
  return [e.x, e.y];
}

/** Arc geometry: radius from p1, end angle from p2 (p2 may be slightly off-radius). a1 > a0, a1 - a0 in (0, 2π]. */
export function arcAngles(ent: SkArc, map: EntityMap): { c: Vec2; r: number; a0: number; a1: number } {
  const c = pointOf(map, ent.c);
  const p1 = pointOf(map, ent.p1);
  const p2 = pointOf(map, ent.p2);
  const r = dist(p1, c);
  const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const b = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  let sw = mod(b - a0, TAU);
  if (!(sw > 0) || sw > TAU) sw = TAU;
  return { c, r, a0, a1: a0 + sw };
}

// ---------------------------------------------------------------------------
// Splines
// ---------------------------------------------------------------------------

function crPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  const k01 = Math.max(Math.sqrt(dist(p0, p1)), 1e-12);
  const k12 = Math.max(Math.sqrt(dist(p1, p2)), 1e-12);
  const k23 = Math.max(Math.sqrt(dist(p2, p3)), 1e-12);
  const t1 = k01;
  const t2 = t1 + k12;
  const t3 = t2 + k23;
  const t = t1 + k12 * u;
  const a1 = lerp(p0, p1, t / t1);
  const a2 = lerp(p1, p2, (t - t1) / (t2 - t1));
  const a3 = lerp(p2, p3, (t - t2) / (t3 - t2));
  const b1 = lerp(a1, a2, t / t2);
  const b2 = lerp(a2, a3, (t - t1) / (t3 - t1));
  return lerp(b1, b2, (t - t1) / (t2 - t1));
}

/**
 * Inner Bézier control points of the span p1 → p2 of the centripetal Catmull-Rom through p0..p3
 * (the same cubic as crPoint): from its tangents at the span ends, in the knots used by crPoint.
 */
function crBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): [Vec2, Vec2] {
  const t1 = Math.max(Math.sqrt(dist(p0, p1)), 1e-12);
  const k12 = Math.max(Math.sqrt(dist(p1, p2)), 1e-12);
  const t2 = t1 + k12;
  const t3 = t2 + Math.max(Math.sqrt(dist(p2, p3)), 1e-12);
  const tangent = (a: Vec2, b: Vec2, c: Vec2, ta: number, tb: number, tc: number): Vec2 => [
    (b[0] - a[0]) / (tb - ta) - (c[0] - a[0]) / (tc - ta) + (c[0] - b[0]) / (tc - tb),
    (b[1] - a[1]) / (tb - ta) - (c[1] - a[1]) / (tc - ta) + (c[1] - b[1]) / (tc - tb),
  ];
  const m1 = tangent(p0, p1, p2, 0, t1, t2);
  const m2 = tangent(p1, p2, p3, t1, t2, t3);
  return [
    [p1[0] + (m1[0] * k12) / 3, p1[1] + (m1[1] * k12) / 3],
    [p2[0] - (m2[0] * k12) / 3, p2[1] - (m2[1] * k12) / 3],
  ];
}

function bezierPoint(a: Vec2, b: Vec2, c: Vec2, d: Vec2, u: number): Vec2 {
  const v = 1 - u;
  const k0 = v * v * v;
  const k1 = 3 * v * v * u;
  const k2 = 3 * v * u * u;
  const k3 = u * u * u;
  return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]];
}

/** Tangent handles of an open spline (see SkSpline.h0 / h1). */
export interface SplineHandles {
  h0?: Vec2;
  h1?: Vec2;
}

/** Without consecutive duplicates (and the repeated first point of a closed spline). */
function splinePoints(points: Vec2[], closed: boolean): Vec2[] {
  const P: Vec2[] = [];
  for (const p of points) {
    const last = P[P.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) P.push([p[0], p[1]]);
  }
  if (closed && P.length > 1) {
    const f = P[0];
    const l = P[P.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) P.pop();
  }
  return P;
}

/** Natural tangent handles of an open spline: where h0 / h1 leave the curve unchanged. */
export function naturalHandles(points: Vec2[]): { h0: Vec2; h1: Vec2 } | null {
  const P = splinePoints(points, false);
  const n = P.length;
  if (n < 2) return null;
  const reflect = (a: Vec2, b: Vec2): Vec2 => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  const first = crBezier(reflect(P[0], P[1]), P[0], P[1], n > 2 ? P[2] : reflect(P[1], P[0]));
  const last = crBezier(n > 2 ? P[n - 3] : reflect(P[0], P[1]), P[n - 2], P[n - 1], reflect(P[n - 1], P[n - 2]));
  return { h0: first[0], h1: last[1] };
}

/**
 * Centripetal Catmull-Rom through points; returns dense polyline including the through points
 * (through point i is at index i * perSpan). Closed splines return a closed polyline whose last
 * point equals the first. Consecutive duplicate points are ignored. Tangent handles (open splines)
 * replace the inner control point of the first / last span.
 */
export function sampleSpline(points: Vec2[], closed: boolean, perSpan = 16, handles?: SplineHandles): Vec2[] {
  const P = splinePoints(points, closed);
  const n = P.length;
  if (n === 0) return [];
  if (n === 1) return [[P[0][0], P[0][1]]];
  const steps = Math.max(1, Math.floor(perSpan));
  const out: Vec2[] = [[P[0][0], P[0][1]]];
  const segs = closed ? n : n - 1;
  const h0 = closed ? undefined : handles?.h0;
  const h1 = closed ? undefined : handles?.h1;
  for (let i = 0; i < segs; i++) {
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p0: Vec2 = closed ? P[(i - 1 + n) % n] : i > 0 ? P[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    const p3: Vec2 = closed ? P[(i + 2) % n] : i + 2 < n ? P[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const b1 = i === 0 ? h0 : undefined;
    const b2 = i === segs - 1 ? h1 : undefined;
    if (b1 || b2) {
      // an end span with a tangent handle: the Bézier form of the span with that control point
      const [c1, c2] = crBezier(p0, p1, p2, p3);
      for (let k = 1; k < steps; k++) out.push(bezierPoint(p1, b1 ?? c1, b2 ?? c2, p2, k / steps));
    } else for (let k = 1; k < steps; k++) out.push(crPoint(p0, p1, p2, p3, k / steps));
    out.push([p2[0], p2[1]]);
  }
  return out;
}

/** Dense polyline of a spline entity, with its tangent handles. */
export function splineSamples(ent: SkSpline, map: EntityMap, perSpan = 16): Vec2[] {
  const pts = ent.pts.map((id) => pointOf(map, id));
  const closed = !!ent.closed && pts.length >= 3;
  const handles: SplineHandles = {};
  if (!closed) {
    if (ent.h0 && map.has(ent.h0)) handles.h0 = pointOf(map, ent.h0);
    if (ent.h1 && map.has(ent.h1)) handles.h1 = pointOf(map, ent.h1);
  }
  return sampleSpline(pts, closed, perSpan, handles);
}

// ---------------------------------------------------------------------------
// Parametric primitives
// ---------------------------------------------------------------------------

export type Prim =
  | { kind: 'seg'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; t0: number; sweep: number }
  | { kind: 'ell'; c: Vec2; rx: number; ry: number; rot: number; t0: number; sweep: number }
  | { kind: 'poly'; pts: Vec2[]; closed: boolean };

export type BBox = [number, number, number, number];

/** Primitive for a curve entity (null for points). Throws if referenced points are missing. */
export function entityPrim(ent: SkEntity, map: EntityMap, perSpan = 16): Prim | null {
  switch (ent.type) {
    case 'point':
    // a text is drawn and cut by its letters (derived lines and Bézier spans), not by itself
    case 'text':
      return null;
    case 'line':
      return { kind: 'seg', a: pointOf(map, ent.p1), b: pointOf(map, ent.p2) };
    case 'circle':
      return { kind: 'arc', c: pointOf(map, ent.c), r: Math.abs(ent.r), t0: 0, sweep: TAU };
    case 'arc': {
      const { c, r, a0, a1 } = arcAngles(ent, map);
      return { kind: 'arc', c, r, t0: a0, sweep: a1 - a0 };
    }
    case 'ellipse':
      return {
        kind: 'ell',
        c: pointOf(map, ent.c),
        rx: Math.abs(ent.rx),
        ry: Math.abs(ent.ry),
        rot: ent.rot,
        t0: 0,
        sweep: TAU,
      };
    case 'spline': {
      const closed = !!ent.closed && ent.pts.length >= 3;
      return { kind: 'poly', pts: splineSamples(ent, map, perSpan), closed };
    }
  }
}

export function primClosed(p: Prim): boolean {
  switch (p.kind) {
    case 'seg':
      return false;
    case 'arc':
    case 'ell':
      return p.sweep >= TAU - 1e-12;
    case 'poly':
      return p.closed;
  }
}

export function primRange(p: Prim): [number, number] {
  switch (p.kind) {
    case 'seg':
      return [0, 1];
    case 'arc':
    case 'ell':
      return [p.t0, p.t0 + p.sweep];
    case 'poly':
      return [0, Math.max(0, p.pts.length - 1)];
  }
}

/** Wrap (closed) or clamp (open) a parameter into the primitive's domain. */
export function primWrap(p: Prim, t: number): number {
  const [lo, hi] = primRange(p);
  if (primClosed(p)) {
    const per = hi - lo;
    const w = lo + mod(t - lo, per);
    return w >= hi ? lo : w;
  }
  return clamp(t, lo, hi);
}

function polySeg(m: number, closed: boolean, t: number, side: number): number {
  if (closed) t = mod(t, m);
  let i = side >= 0 ? Math.floor(t) : Math.ceil(t) - 1;
  if (closed) i = mod(i, m);
  else i = clamp(i, 0, m - 1);
  return i;
}

function polyEval(pts: Vec2[], closed: boolean, t: number): Vec2 {
  const m = pts.length - 1;
  if (m <= 0) return pts[0] ? [pts[0][0], pts[0][1]] : [0, 0];
  t = closed ? mod(t, m) : clamp(t, 0, m);
  const i = Math.min(Math.floor(t), m - 1);
  return lerp(pts[i], pts[i + 1], t - i);
}

function ellLocal(p: { rx: number; ry: number; rot: number }, x: number, y: number): Vec2 {
  const cr = Math.cos(p.rot);
  const sr = Math.sin(p.rot);
  const lx = p.rx * x;
  const ly = p.ry * y;
  return [lx * cr - ly * sr, lx * sr + ly * cr];
}

export function primEval(p: Prim, t: number): Vec2 {
  switch (p.kind) {
    case 'seg':
      return lerp(p.a, p.b, t);
    case 'arc':
      return [p.c[0] + p.r * Math.cos(t), p.c[1] + p.r * Math.sin(t)];
    case 'ell': {
      const q = ellLocal(p, Math.cos(t), Math.sin(t));
      return [p.c[0] + q[0], p.c[1] + q[1]];
    }
    case 'poly':
      return polyEval(p.pts, p.closed, t);
  }
}

/** dP/dt. For polylines `side` selects the segment after (+1) or before (-1) t. */
export function primDeriv(p: Prim, t: number, side = 1): Vec2 {
  switch (p.kind) {
    case 'seg':
      return sub(p.b, p.a);
    case 'arc':
      return [-p.r * Math.sin(t), p.r * Math.cos(t)];
    case 'ell':
      return ellLocal(p, -Math.sin(t), Math.cos(t));
    case 'poly': {
      const m = p.pts.length - 1;
      if (m <= 0) return [0, 0];
      const i = polySeg(m, p.closed, t, side);
      return sub(p.pts[i + 1], p.pts[i]);
    }
  }
}

function primDeriv2(p: Prim, t: number): Vec2 {
  switch (p.kind) {
    case 'arc':
      return [-p.r * Math.cos(t), -p.r * Math.sin(t)];
    case 'ell':
      return ellLocal(p, -Math.cos(t), -Math.sin(t));
    default:
      return [0, 0];
  }
}

/** Signed curvature w.r.t. increasing t (positive = turning left). Polylines: discrete estimate on `side`. */
export function primCurvature(p: Prim, t: number, side = 1): number {
  switch (p.kind) {
    case 'seg':
      return 0;
    case 'arc':
      return 1 / p.r;
    case 'ell': {
      const d1 = primDeriv(p, t);
      const d2 = primDeriv2(p, t);
      const l = len(d1);
      return l > 0 ? cross(d1, d2) / (l * l * l) : 0;
    }
    case 'poly': {
      const m = p.pts.length - 1;
      if (m < 2) return 0;
      const i = polySeg(m, p.closed, t, side);
      let j = side >= 0 ? i + 1 : i - 1;
      if (p.closed) j = mod(j, m);
      else if (j < 0 || j >= m) return 0;
      const s1 = side >= 0 ? i : j;
      const s2 = side >= 0 ? j : i;
      const d1 = sub(p.pts[s1 + 1], p.pts[s1]);
      const d2 = sub(p.pts[s2 + 1], p.pts[s2]);
      const l = (len(d1) + len(d2)) / 2;
      return l > 0 ? Math.atan2(cross(d1, d2), dot(d1, d2)) / l : 0;
    }
  }
}

export function primBBox(p: Prim): BBox {
  switch (p.kind) {
    case 'seg':
      return [Math.min(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.max(p.a[0], p.b[0]), Math.max(p.a[1], p.b[1])];
    case 'arc': {
      const [lo, hi] = primRange(p);
      const s = primEval(p, lo);
      const e = primEval(p, hi);
      const bb: BBox = [Math.min(s[0], e[0]), Math.min(s[1], e[1]), Math.max(s[0], e[0]), Math.max(s[1], e[1])];
      const q = Math.PI / 2;
      for (let k = Math.ceil(lo / q); k * q <= hi; k++) {
        const v = primEval(p, k * q);
        bb[0] = Math.min(bb[0], v[0]);
        bb[1] = Math.min(bb[1], v[1]);
        bb[2] = Math.max(bb[2], v[0]);
        bb[3] = Math.max(bb[3], v[1]);
      }
      return bb;
    }
    case 'ell': {
      const cr = Math.cos(p.rot);
      const sr = Math.sin(p.rot);
      const hx = Math.sqrt((p.rx * cr) ** 2 + (p.ry * sr) ** 2);
      const hy = Math.sqrt((p.rx * sr) ** 2 + (p.ry * cr) ** 2);
      return [p.c[0] - hx, p.c[1] - hy, p.c[0] + hx, p.c[1] + hy];
    }
    case 'poly': {
      const bb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const v of p.pts) {
        if (v[0] < bb[0]) bb[0] = v[0];
        if (v[1] < bb[1]) bb[1] = v[1];
        if (v[0] > bb[2]) bb[2] = v[0];
        if (v[1] > bb[3]) bb[3] = v[1];
      }
      return bb;
    }
  }
}

/** Parameter of angle `theta` on an arc [t0, t0 + sweep] (with angular tolerance), or null when outside. */
export function arcParam(theta: number, t0: number, sweep: number, angTol: number): number | null {
  const u = mod(theta - t0, TAU);
  if (sweep >= TAU - 1e-12) return t0 + u;
  if (u <= sweep + angTol) return t0 + Math.min(u, sweep);
  if (u >= TAU - angTol) return t0;
  return null;
}

/** Closest point on the primitive. */
export function primProject(p: Prim, q: Vec2): { t: number; pt: Vec2; d: number } {
  switch (p.kind) {
    case 'seg': {
      const d = sub(p.b, p.a);
      const l2 = dot(d, d);
      const t = l2 > 0 ? clamp(dot(sub(q, p.a), d) / l2, 0, 1) : 0;
      const pt = lerp(p.a, p.b, t);
      return { t, pt, d: dist(pt, q) };
    }
    case 'arc': {
      const v = sub(q, p.c);
      const th = len(v) > 0 ? Math.atan2(v[1], v[0]) : p.t0;
      const t = arcParam(th, p.t0, p.sweep, 0);
      if (t !== null) {
        const pt = primEval(p, t);
        return { t, pt, d: dist(pt, q) };
      }
      const e0 = primEval(p, p.t0);
      const e1 = primEval(p, p.t0 + p.sweep);
      const d0 = dist(e0, q);
      const d1 = dist(e1, q);
      return d0 <= d1 ? { t: p.t0, pt: e0, d: d0 } : { t: p.t0 + p.sweep, pt: e1, d: d1 };
    }
    case 'ell': {
      const [lo, hi] = primRange(p);
      const N = 64;
      let bt = lo;
      let bd = Infinity;
      for (let i = 0; i <= N; i++) {
        const t = lo + ((hi - lo) * i) / N;
        const d = dist(primEval(p, t), q);
        if (d < bd) {
          bd = d;
          bt = t;
        }
      }
      let t = bt;
      for (let it = 0; it < 30; it++) {
        const P = primEval(p, t);
        const d1 = primDeriv(p, t);
        const d2 = primDeriv2(p, t);
        const w = sub(P, q);
        const g = dot(w, d1);
        const gp = dot(d1, d1) + dot(w, d2);
        if (!(gp > 0)) break;
        const dt = -g / gp;
        t = primWrap(p, t + dt);
        if (Math.abs(dt) < 1e-15) break;
      }
      const pt = primEval(p, t);
      const d = dist(pt, q);
      if (d <= bd) return { t, pt, d };
      return { t: bt, pt: primEval(p, bt), d: bd };
    }
    case 'poly': {
      const pts = p.pts;
      if (pts.length < 2) {
        const pt: Vec2 = pts[0] ? [pts[0][0], pts[0][1]] : [0, 0];
        return { t: 0, pt, d: dist(pt, q) };
      }
      let bt = 0;
      let bd = Infinity;
      let bp: Vec2 = pts[0];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const d = sub(b, a);
        const l2 = dot(d, d);
        const s = l2 > 0 ? clamp(dot(sub(q, a), d) / l2, 0, 1) : 0;
        const pt = lerp(a, b, s);
        const dd = dist(pt, q);
        if (dd < bd) {
          bd = dd;
          bt = i + s;
          bp = pt;
        }
      }
      return { t: bt, pt: [bp[0], bp[1]], d: bd };
    }
  }
}

/** Polyline of the primitive between params tA < tB (both included). Curved prims: at most maxStep radians per segment. */
export function primSampleRange(p: Prim, tA: number, tB: number, maxStep = DEFAULT_ANGLE_STEP): Vec2[] {
  switch (p.kind) {
    case 'seg':
      return [primEval(p, tA), primEval(p, tB)];
    case 'arc':
    case 'ell': {
      let step = maxStep;
      if (p.kind === 'ell') {
        const ecc = Math.max(p.rx, p.ry) / Math.max(Math.min(p.rx, p.ry), 1e-300);
        step = maxStep / Math.min(Math.sqrt(ecc), 4);
      }
      const n = Math.max(2, Math.ceil((tB - tA) / step - 1e-9));
      const out: Vec2[] = [];
      for (let i = 0; i <= n; i++) out.push(primEval(p, tA + ((tB - tA) * i) / n));
      return out;
    }
    case 'poly': {
      const m = p.pts.length - 1;
      const out: Vec2[] = [primEval(p, tA)];
      for (let k = Math.floor(tA) + 1; k <= Math.ceil(tB) - 1; k++) {
        const v = p.pts[p.closed ? mod(k, m) : clamp(k, 0, m)];
        out.push([v[0], v[1]]);
      }
      out.push(primEval(p, tB));
      return out;
    }
  }
}

/** Exact ∫ (x dy - y dx) / 2 along the primitive from tA to tB, coordinates relative to origin o. */
export function primArea(p: Prim, tA: number, tB: number, o: Vec2): number {
  switch (p.kind) {
    case 'seg':
      return 0.5 * cross(sub(primEval(p, tA), o), sub(primEval(p, tB), o));
    case 'arc': {
      const c = sub(p.c, o);
      const du: Vec2 = [Math.cos(tB) - Math.cos(tA), Math.sin(tB) - Math.sin(tA)];
      return 0.5 * (p.r * cross(c, du) + p.r * p.r * (tB - tA));
    }
    case 'ell': {
      const c = sub(p.c, o);
      const qa = ellLocal(p, Math.cos(tA), Math.sin(tA));
      const qb = ellLocal(p, Math.cos(tB), Math.sin(tB));
      return 0.5 * (cross(c, sub(qb, qa)) + p.rx * p.ry * (tB - tA));
    }
    case 'poly': {
      const pts = primSampleRange(p, tA, tB);
      let a = 0;
      for (let i = 0; i + 1 < pts.length; i++) a += cross(sub(pts[i], o), sub(pts[i + 1], o));
      return 0.5 * a;
    }
  }
}

// ---------------------------------------------------------------------------
// Intersections
// ---------------------------------------------------------------------------

export interface PrimHit {
  ta: number;
  tb: number;
  p: Vec2;
}

function swapHits(h: PrimHit[]): PrimHit[] {
  return h.map((x) => ({ ta: x.tb, tb: x.ta, p: x.p }));
}

/** Segment/segment crossing params (s on a, u on b) with param tolerance ext, or null (also for parallel). */
function segSegParams(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, extA: number, extB: number): [number, number] | null {
  const r = sub(a1, a0);
  const s = sub(b1, b0);
  const den = cross(r, s);
  if (!(Math.abs(den) > 1e-12 * len(r) * len(s))) return null;
  const w = sub(b0, a0);
  const t = cross(w, s) / den;
  const u = cross(w, r) / den;
  if (t < -extA || t > 1 + extA || u < -extB || u > 1 + extB) return null;
  return [clamp(t, 0, 1), clamp(u, 0, 1)];
}

function segSegClosest(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): { s: number; u: number; d: number } {
  const ps = (q: Vec2, x: Vec2, y: Vec2) => {
    const d = sub(y, x);
    const l2 = dot(d, d);
    const t = l2 > 0 ? clamp(dot(sub(q, x), d) / l2, 0, 1) : 0;
    return { t, d: dist(lerp(x, y, t), q) };
  };
  const c1 = ps(a0, b0, b1);
  const c2 = ps(a1, b0, b1);
  const c3 = ps(b0, a0, a1);
  const c4 = ps(b1, a0, a1);
  let best = { s: 0, u: c1.t, d: c1.d };
  if (c2.d < best.d) best = { s: 1, u: c2.t, d: c2.d };
  if (c3.d < best.d) best = { s: c3.t, u: 0, d: c3.d };
  if (c4.d < best.d) best = { s: c4.t, u: 1, d: c4.d };
  return best;
}

function segSegHits(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, tol: number): PrimHit[] {
  const la = dist(a0, a1);
  const lb = dist(b0, b1);
  if (!(la > 0) || !(lb > 0)) return [];
  const x = segSegParams(a0, a1, b0, b1, tol / la, tol / lb);
  if (!x) return [];
  return [{ ta: x[0], tb: x[1], p: lerp(a0, a1, x[0]) }];
}

type ArcPrim = Extract<Prim, { kind: 'arc' }>;
type EllPrim = Extract<Prim, { kind: 'ell' }>;

/** Segment a0-a1 against a circular arc. Near-tangent lines (|dist - r| <= tol) give one touching point. */
function segArcHits(a0: Vec2, a1: Vec2, C: { c: Vec2; r: number; t0: number; sweep: number }, tol: number): PrimHit[] {
  const d = sub(a1, a0);
  const L2 = dot(d, d);
  if (!(L2 > 0)) return [];
  const L = Math.sqrt(L2);
  const f = sub(a0, C.c);
  const tf = -dot(f, d) / L2;
  const foot = lerp(a0, a1, tf);
  const h = dist(foot, C.c);
  const r = C.r;
  if (h > r + tol) return [];
  const ts = h >= r - tol ? [tf] : [tf - Math.sqrt(r * r - h * h) / L, tf + Math.sqrt(r * r - h * h) / L];
  const tolT = tol / L;
  const out: PrimHit[] = [];
  for (const t of ts) {
    if (t < -tolT || t > 1 + tolT) continue;
    const tc = clamp(t, 0, 1);
    const p = lerp(a0, a1, tc);
    const tb = arcParam(Math.atan2(p[1] - C.c[1], p[0] - C.c[0]), C.t0, C.sweep, tol / r);
    if (tb === null) continue;
    out.push({ ta: tc, tb, p });
  }
  return out;
}

function arcArcHits(A: ArcPrim, B: ArcPrim, tol: number): PrimHit[] {
  const e = sub(B.c, A.c);
  const d = len(e);
  if (d < tol) return []; // concentric (coincident overlaps are handled by end point projection)
  const r1 = A.r;
  const r2 = B.r;
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
  const u: Vec2 = [e[0] / d, e[1] / d];
  let pts: Vec2[];
  if (Math.abs(d - (r1 + r2)) <= tol) {
    const k = r1 + (d - r1 - r2) / 2;
    pts = [[A.c[0] + u[0] * k, A.c[1] + u[1] * k]];
  } else if (Math.abs(d - Math.abs(r1 - r2)) <= tol) {
    const sgn = r1 >= r2 ? 1 : -1;
    const pa: Vec2 = [A.c[0] + sgn * u[0] * r1, A.c[1] + sgn * u[1] * r1];
    const pb: Vec2 = [B.c[0] + sgn * u[0] * r2, B.c[1] + sgn * u[1] * r2];
    pts = [lerp(pa, pb, 0.5)];
  } else {
    const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const m: Vec2 = [A.c[0] + u[0] * a, A.c[1] + u[1] * a];
    pts = [
      [m[0] - u[1] * h, m[1] + u[0] * h],
      [m[0] + u[1] * h, m[1] - u[0] * h],
    ];
  }
  const out: PrimHit[] = [];
  for (const p of pts) {
    const ta = arcParam(Math.atan2(p[1] - A.c[1], p[0] - A.c[0]), A.t0, A.sweep, tol / r1);
    const tb = arcParam(Math.atan2(p[1] - B.c[1], p[0] - B.c[0]), B.t0, B.sweep, tol / r2);
    if (ta === null || tb === null) continue;
    out.push({ ta, tb, p });
  }
  return out;
}

function segEllHits(a0: Vec2, a1: Vec2, E: EllPrim, tol: number): PrimHit[] {
  const toLocal = (p: Vec2): Vec2 => {
    const q = rotate(sub(p, E.c), -E.rot);
    return [q[0] / E.rx, q[1] / E.ry];
  };
  const unit = { c: [0, 0] as Vec2, r: 1, t0: E.t0, sweep: E.sweep };
  const hits = segArcHits(toLocal(a0), toLocal(a1), unit, tol / Math.max(E.rx, E.ry));
  return hits.map((h) => ({ ta: h.ta, tb: h.tb, p: lerp(a0, a1, h.ta) }));
}

interface IsectSamples {
  pts: Vec2[];
  ts: number[];
  sag: number;
  curved: boolean;
}

function isectSamples(p: Prim): IsectSamples {
  if (p.kind === 'seg') return { pts: [p.a, p.b], ts: [0, 1], sag: 0, curved: false };
  if (p.kind === 'poly') return { pts: p.pts, ts: p.pts.map((_v, i) => i), sag: 0, curved: false };
  const [lo, hi] = primRange(p);
  let n = Math.ceil((hi - lo) / (Math.PI / 36));
  if (p.kind === 'ell') n = Math.ceil(n * Math.min(4, Math.sqrt(Math.max(p.rx, p.ry) / Math.min(p.rx, p.ry))));
  n = Math.max(4, Math.min(n, 2000));
  const pts: Vec2[] = [];
  const ts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    ts.push(t);
    pts.push(primEval(p, t));
  }
  let sag = 0;
  for (let i = 0; i < n; i++) {
    const m = primEval(p, (ts[i] + ts[i + 1]) / 2);
    sag = Math.max(sag, dist(m, lerp(pts[i], pts[i + 1], 0.5)));
  }
  return { pts, ts, sag: sag * 1.5, curved: true };
}

/** Newton refinement of A(ta) = B(tb). Returns refined params or null when not converged to within tol/2. */
function refine(A: Prim, B: Prim, ta0: number, tb0: number, tol: number): [number, number] | null {
  let ta = ta0;
  let tb = tb0;
  for (let it = 0; it < 40; it++) {
    const F = sub(primEval(A, ta), primEval(B, tb));
    if (len(F) <= tol * 1e-9) break;
    const da = primDeriv(A, ta, 1);
    const db = primDeriv(B, tb, 1);
    const det = -cross(da, db);
    if (!(Math.abs(det) > 1e-300)) break;
    const x = cross(F, db) / det;
    const y = cross(F, da) / det;
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    ta = primWrap(A, ta + x);
    tb = primWrap(B, tb + y);
    if (Math.abs(x) + Math.abs(y) < 1e-15) break;
  }
  return dist(primEval(A, ta), primEval(B, tb)) <= tol * 0.5 ? [ta, tb] : null;
}

/** Polyline approximation + Newton refinement. `self` finds self intersections of A (B ignored). */
function numericHits(A: Prim, B: Prim, tol: number, self: boolean): PrimHit[] {
  const sa = isectSamples(A);
  const sb = self ? sa : isectSamples(B);
  const curved = sa.curved || sb.curved;
  const margin = tol + sa.sag + sb.sag;
  const na = sa.pts.length - 1;
  const nb = sb.pts.length - 1;
  const closedSelf = self && primClosed(A);
  const hits: PrimHit[] = [];
  for (let i = 0; i < na; i++) {
    const a0 = sa.pts[i];
    const a1 = sa.pts[i + 1];
    const ax0 = Math.min(a0[0], a1[0]) - margin;
    const ax1 = Math.max(a0[0], a1[0]) + margin;
    const ay0 = Math.min(a0[1], a1[1]) - margin;
    const ay1 = Math.max(a0[1], a1[1]) + margin;
    for (let j = self ? i + 2 : 0; j < nb; j++) {
      if (closedSelf && i === 0 && j === nb - 1) continue;
      const b0 = sb.pts[j];
      const b1 = sb.pts[j + 1];
      if (
        Math.max(b0[0], b1[0]) < ax0 ||
        Math.min(b0[0], b1[0]) > ax1 ||
        Math.max(b0[1], b1[1]) < ay0 ||
        Math.min(b0[1], b1[1]) > ay1
      )
        continue;
      let s: number;
      let u: number;
      let proper = false;
      const x = segSegParams(a0, a1, b0, b1, 1e-12, 1e-12);
      if (x) {
        s = x[0];
        u = x[1];
        proper = true;
      } else {
        if (!curved) continue;
        const c = segSegClosest(a0, a1, b0, b1);
        if (c.d > margin) continue;
        s = c.s;
        u = c.u;
      }
      let ta = sa.ts[i] + (sa.ts[i + 1] - sa.ts[i]) * s;
      let tb = sb.ts[j] + (sb.ts[j + 1] - sb.ts[j]) * u;
      if (curved) {
        const r = refine(A, self ? A : B, ta, tb, tol);
        if (r) {
          ta = r[0];
          tb = r[1];
        } else if (!proper) continue;
      }
      const p = primEval(A, ta);
      if (hits.some((h) => dist(h.p, p) <= tol * 4)) continue;
      hits.push({ ta, tb, p });
    }
  }
  return hits;
}

/** Intersections of two primitives; analytic for line/line, line/arc, arc/arc, line/ellipse. */
export function intersectPrims(A: Prim, B: Prim, tol: number): PrimHit[] {
  if (A.kind === 'seg' && B.kind === 'seg') return segSegHits(A.a, A.b, B.a, B.b, tol);
  if (A.kind === 'seg' && B.kind === 'arc') return segArcHits(A.a, A.b, B, tol);
  if (A.kind === 'arc' && B.kind === 'seg') return swapHits(segArcHits(B.a, B.b, A, tol));
  if (A.kind === 'arc' && B.kind === 'arc') return arcArcHits(A, B, tol);
  if (A.kind === 'seg' && B.kind === 'ell') return segEllHits(A.a, A.b, B, tol);
  if (A.kind === 'ell' && B.kind === 'seg') return swapHits(segEllHits(B.a, B.b, A, tol));
  return numericHits(A, B, tol, false);
}

/** Self intersections (polylines / splines only). Each hit has two params on the same primitive. */
export function primSelfHits(p: Prim, tol: number): PrimHit[] {
  return p.kind === 'poly' ? numericHits(p, p, tol, true) : [];
}

// ---------------------------------------------------------------------------
// Entity level API
// ---------------------------------------------------------------------------

/** Polyline approximation of any curve entity for display/hit-testing. Closed curves repeat the first point at the end. */
export function sampleEntity(ent: SkEntity, map: EntityMap, maxAngleStep = DEFAULT_ANGLE_STEP): Vec2[] {
  if (ent.type === 'point') return [[ent.x, ent.y]];
  if (ent.type === 'spline') {
    const prim = entityPrim(ent, map);
    return prim && prim.kind === 'poly' ? prim.pts : [];
  }
  const prim = entityPrim(ent, map);
  if (!prim) return [];
  const [lo, hi] = primRange(prim);
  const step = Math.min(Math.max(maxAngleStep, 1e-3), Math.PI / 4);
  const pts = primSampleRange(prim, lo, hi, step);
  if (primClosed(prim) && pts.length > 1) pts[pts.length - 1] = [pts[0][0], pts[0][1]];
  return pts;
}

export function closestPointOnEntity(p: Vec2, ent: SkEntity, map: EntityMap): Vec2 {
  if (ent.type === 'point') return [ent.x, ent.y];
  const prim = entityPrim(ent, map);
  if (!prim) return [p[0], p[1]];
  return primProject(prim, p).pt;
}

/** Closest-point distance from p to the entity (for picking). Arcs respect their extent. */
export function distanceToEntity(p: Vec2, ent: SkEntity, map: EntityMap): number {
  return dist(p, closestPointOnEntity(p, ent, map));
}

/**
 * Intersections between two curve entities (line/circle/arc/ellipse/spline), analytic where possible.
 * Curves are bounded (no extension). Near-tangent contacts within the tolerance give a single point.
 * Passing the same entity twice returns spline self intersections.
 */
export function intersectEntities(a: SkEntity, b: SkEntity, map: EntityMap, tolerance?: number): Vec2[] {
  const pa = entityPrim(a, map);
  const pb = entityPrim(b, map);
  if (!pa || !pb) return [];
  const ba = primBBox(pa);
  const bb = primBBox(pb);
  const size = Math.hypot(
    Math.max(ba[2], bb[2]) - Math.min(ba[0], bb[0]),
    Math.max(ba[3], bb[3]) - Math.min(ba[1], bb[1]),
  );
  const tol = tolerance ?? Math.max(size * 1e-9, 1e-12);
  const hits = a.id === b.id ? primSelfHits(pa, tol) : intersectPrims(pa, pb, tol);
  const out: Vec2[] = [];
  for (const h of hits) if (!out.some((q) => dist(q, h.p) <= tol * 4)) out.push(h.p);
  return out;
}
