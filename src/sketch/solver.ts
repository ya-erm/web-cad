// 2D geometric constraint solver for sketches.
//
// Pipeline of solveSketch():
//  1. Every point contributes (x, y), every circle r, every ellipse (rx, ry, rot).
//  2. Equality-type constraints (coincident point/point, horizontal, vertical, concentric, fix)
//     are applied by substitution: variables are merged with a union-find and fixed
//     classes become constants. Cycles / clashes are reported as redundant / conflicting.
//  3. All other constraints become residual equations built from a few analytic "terms".
//  4. Equations are split into connected components over the remaining (reduced) variables.
//     Each component is solved with a damped minimum-norm Gauss–Newton (Levenberg–Marquardt
//     on J Jᵀ), using a sparse envelope LDLᵀ factorisation with reverse Cuthill–McKee ordering.
//  5. Analysis: LDLᵀ of the row-normalised Gram matrix J Jᵀ gives the rank (dof) and detects
//     linearly dependent rows; a variable is "determined" when its unit vector lies in the row
//     space of J. Dependencies are attributed to the most recently created constraints (rank
//     test in creation order, with substitutions as explicit rows). When the solve fails, those
//     rows are dropped and the rest is solved again, so earlier constraints win (like Onshape);
//     a conflicting substitution constraint is left out and the whole sketch re-solved.

import type { SkConstraint, SkEntity, Vec2 } from '../core/types';
import { textAspect, textBoxCorners } from './text';

export interface DragTargets {
  /** Desired positions of points being dragged by the user. */
  points?: Record<string, Vec2>;
  /** Desired radius of circles/arcs (dragging the rim). For arcs: move p1/p2 radially. */
  radii?: Record<string, number>;
}

export interface SolveOptions {
  drag?: DragTargets;
  /** default 50 */
  maxIterations?: number;
  /** default 1e-7 (residuals are in mm / radians) */
  tolerance?: number;
  /** Compute degrees of freedom and per-entity status (more expensive). default true */
  analyze?: boolean;
}

export type EntityStatus = 'under' | 'full' | 'over';

export interface SolveResult {
  /** New array; entities whose variables changed are new objects, others are reused. */
  entities: SkEntity[];
  /** Every constraint satisfied within tolerance. */
  ok: boolean;
  maxResidual: number;
  /** Ids of constraints that cannot be satisfied. */
  conflicting: string[];
  /** Ids of constraints that are satisfied but linearly dependent on others (over-defining). */
  redundant: string[];
  /** Remaining degrees of freedom of the whole sketch (-1 when analyze is false). */
  dof: number;
  /** Per entity id (empty when analyze is false). */
  status: Record<string, EntityStatus>;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Pivot threshold (squared sine to the span of previous rows) for dependent rows. */
const DEP_TOL = 1e-10;
/** Looser threshold used at a least-squares point when looking for conflicts. */
const CONFLICT_DEP_TOL = 1e-9;
/** A variable is determined when its squared nullspace component is below this. */
const DET_TOL = 1e-8;
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Variable model
// ---------------------------------------------------------------------------

interface Model {
  byId: Map<string, SkEntity>;
  /** First variable index of points (x, y), circles (r) and ellipses (rx, ry, rot). */
  base: Map<string, number>;
  nVars: number;
  x0: Float64Array;
  /** Length that one unit of the variable corresponds to (1, or ellipse size for rot). */
  lenScale: Float64Array;
  /** Variables that must stay positive (circle radius, ellipse semi-axes). */
  positive: Uint8Array;
  /** Characteristic size of the sketch. */
  scale: number;
}

const num = (v: number): number => (Number.isFinite(v) ? v : 0);

function buildModel(entities: SkEntity[]): Model {
  const byId = new Map<string, SkEntity>();
  const base = new Map<string, number>();
  let n = 0;
  for (const e of entities) {
    if (byId.has(e.id)) continue;
    byId.set(e.id, e);
    if (e.type === 'point') {
      base.set(e.id, n);
      n += 2;
    } else if (e.type === 'circle') {
      base.set(e.id, n);
      n += 1;
    } else if (e.type === 'ellipse') {
      base.set(e.id, n);
      n += 3;
    }
  }
  const x0 = new Float64Array(n);
  const lenScale = new Float64Array(n).fill(1);
  const positive = new Uint8Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (const [id, e] of byId) {
    const b = base.get(id);
    if (b === undefined) continue;
    if (e.type === 'point') {
      const x = num(e.x);
      const y = num(e.y);
      x0[b] = x;
      x0[b + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (e.type === 'circle') {
      x0[b] = num(e.r);
      positive[b] = 1;
      maxR = Math.max(maxR, Math.abs(x0[b]));
    } else if (e.type === 'ellipse') {
      x0[b] = num(e.rx);
      x0[b + 1] = num(e.ry);
      x0[b + 2] = num(e.rot);
      positive[b] = positive[b + 1] = 1;
      maxR = Math.max(maxR, Math.abs(x0[b]), Math.abs(x0[b + 1]));
    }
  }
  const diag = minX <= maxX ? Math.hypot(maxX - minX, maxY - minY) : 0;
  let scale = Math.max(diag, 2 * maxR);
  if (!(scale > 0)) scale = 1;
  for (const [id, e] of byId) {
    if (e.type !== 'ellipse') continue;
    const b = base.get(id)!;
    lenScale[b + 2] = Math.max(Math.abs(x0[b]), Math.abs(x0[b + 1]), 1e-6 * scale);
  }
  return { byId, base, nVars: n, x0, lenScale, positive, scale };
}

function ptVar(m: Model, id: string | undefined): number {
  if (id === undefined) return -1;
  const e = m.byId.get(id);
  if (!e || e.type !== 'point') return -1;
  return m.base.get(id) ?? -1;
}

function lineVars(m: Model, id: string | undefined): [number, number] | null {
  if (id === undefined) return null;
  const e = m.byId.get(id);
  if (!e || e.type !== 'line') return null;
  const a = ptVar(m, e.p1);
  const b = ptVar(m, e.p2);
  return a >= 0 && b >= 0 ? [a, b] : null;
}

/** Centre point of a circle/arc/ellipse, or the point itself. */
function centreVar(m: Model, id: string | undefined): number {
  const e = id === undefined ? undefined : m.byId.get(id);
  if (!e) return -1;
  if (e.type === 'point') return m.base.get(e.id) ?? -1;
  if (e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse') return ptVar(m, e.c);
  return -1;
}

const isCircleLike = (m: Model, id: string | undefined): boolean => {
  const e = id === undefined ? undefined : m.byId.get(id);
  return !!e && (e.type === 'circle' || e.type === 'arc');
};

/** Radius of a circle (its r variable) or arc (|p1 - c|) as an equation term. */
interface RTerm {
  type: number;
  vars: number[];
}

/** Radius of a circle / arc; of an ellipse only with `ellipseAxis` (0: rx, 1: ry — radius dimensions). */
function radiusTerm(m: Model, id: string | undefined, ellipseAxis?: number): RTerm | null {
  const e = id === undefined ? undefined : m.byId.get(id);
  if (!e) return null;
  if (e.type === 'ellipse') {
    const b = m.base.get(e.id);
    return ellipseAxis !== undefined && b !== undefined ? { type: T_VAR, vars: [b + (ellipseAxis === 1 ? 1 : 0)] } : null;
  }
  if (e.type === 'circle') {
    const c = ptVar(m, e.c);
    const b = m.base.get(e.id);
    return c >= 0 && b !== undefined ? { type: T_VAR, vars: [b] } : null;
  }
  if (e.type === 'arc') {
    const c = ptVar(m, e.c);
    const p = ptVar(m, e.p1);
    return c >= 0 && p >= 0 ? { type: T_DIST, vars: [p, p + 1, c, c + 1] } : null;
  }
  return null;
}

/** All variables of an entity, in the order used by 'fix' / frozenValues. */
function entityVars(m: Model, e: SkEntity): number[] {
  const out: number[] = [];
  const pushPt = (id: string) => {
    const p = ptVar(m, id);
    if (p >= 0) out.push(p, p + 1);
  };
  switch (e.type) {
    case 'point': {
      const b = m.base.get(e.id);
      if (b !== undefined) out.push(b, b + 1);
      break;
    }
    case 'line':
      pushPt(e.p1);
      pushPt(e.p2);
      break;
    case 'circle': {
      pushPt(e.c);
      const b = m.base.get(e.id);
      if (b !== undefined) out.push(b);
      break;
    }
    case 'arc':
      pushPt(e.c);
      pushPt(e.p1);
      pushPt(e.p2);
      break;
    case 'ellipse': {
      pushPt(e.c);
      const b = m.base.get(e.id);
      if (b !== undefined) out.push(b, b + 1, b + 2);
      break;
    }
    case 'spline':
      for (const p of e.pts) pushPt(p);
      // tangent handles last: frozen values of a 'fix' made before them stay aligned
      if (e.h0) pushPt(e.h0);
      if (e.h1) pushPt(e.h1);
      break;
    case 'text':
      // the other corners of its box follow these two (fixing them keeps it fixed when its string changes)
      pushPt(e.p1);
      pushPt(e.p2);
      break;
    case 'gear':
      pushPt(e.c);
      break;
  }
  return out;
}

/**
 * The texts with a box of their own: the variables of its corners (p1…p4) and its aspect `k` (width to height in its
 * font). A box not as wide as its text (its string or font changed, the font arrived) first gets its right side where
 * the left side puts it — or, its width held by a dimension, its top where the baseline puts it: the solve starts
 * there, so the text keeps its start and the size that is held unless something else holds it.
 */
function textBoxes(m: Model, X: Float64Array, tol: number, constraints: SkConstraint[]): { k: number; p: [number, number, number, number] }[] {
  const out: { k: number; p: [number, number, number, number] }[] = [];
  const pair = (a: string, b: string, x: string, y: string) => (a === x && b === y) || (a === y && b === x);
  for (const e of m.byId.values()) {
    if (e.type !== 'text' || !e.p3 || !e.p4) continue;
    const p = [e.p1, e.p2, e.p3, e.p4].map((id) => ptVar(m, id)) as [number, number, number, number];
    if (p.some((v) => v < 0) || new Set(p).size < 4) continue;
    const k = textAspect(e.text, e.font);
    const at = (v: number): Vec2 => [X[v], X[v + 1]];
    const { p3, p4 } = textBoxCorners(at(p[0]), at(p[1]), k);
    const off = Math.max(Math.abs(X[p[2]] - p3[0]), Math.abs(X[p[2] + 1] - p3[1]), Math.abs(X[p[3]] - p4[0]), Math.abs(X[p[3] + 1] - p4[1]));
    out.push({ k, p });
    if (!(off > tol)) continue;
    const widthHeld = constraints.some((c) => {
      if (c.type !== 'distance' || c.driven || !c.refs) return false;
      const l = c.refs.length === 1 ? m.byId.get(c.refs[0]) : undefined;
      const [a, b] = l?.type === 'line' ? [l.p1, l.p2] : c.refs.length === 2 ? c.refs : ['', ''];
      return pair(a, b, e.p1, e.p3!) || pair(a, b, e.p2, e.p4!);
    });
    if (widthHeld) {
      // the top from the baseline: (p3 − p1) turned a quarter counter-clockwise, k times shorter
      const [a, c] = [at(p[0]), at(p[2])];
      const top: Vec2 = [a[0] - (c[1] - a[1]) / k, a[1] + (c[0] - a[0]) / k];
      [X[p[1]], X[p[1] + 1], X[p[3]], X[p[3] + 1]] = [...top, top[0] + c[0] - a[0], top[1] + c[1] - a[1]];
    } else [X[p[2]], X[p[2] + 1], X[p[3]], X[p[3] + 1]] = [...p3, ...p4];
  }
  return out;
}

// --- direct geometric measurements on a value array --------------------------

function distAt(X: Float64Array, p: number, q: number): number {
  return Math.hypot(X[p] - X[q], X[p + 1] - X[q + 1]);
}

/** Signed distance of point p from the infinite line a→b (positive on the left). */
function sdAt(X: Float64Array, p: number, a: number, b: number): number {
  const ex = X[b] - X[a];
  const ey = X[b + 1] - X[a + 1];
  const L = Math.hypot(ex, ey);
  if (L === 0) return X[p + 1] - X[a + 1];
  return (ex * (X[p + 1] - X[a + 1]) - ey * (X[p] - X[a])) / L;
}

function radiusAt(X: Float64Array, rt: RTerm): number {
  return rt.type === T_VAR ? X[rt.vars[0]] : distAt(X, rt.vars[0], rt.vars[2]);
}

/** cross and dot of the two line directions, and the line lengths. */
function crossDotAt(X: Float64Array, l1: [number, number], l2: [number, number]): [number, number, number, number] {
  const ax = X[l1[1]] - X[l1[0]];
  const ay = X[l1[1] + 1] - X[l1[0] + 1];
  const bx = X[l2[1]] - X[l2[0]];
  const by = X[l2[1] + 1] - X[l2[0] + 1];
  return [ax * by - ay * bx, ax * bx + ay * by, Math.hypot(ax, ay), Math.hypot(bx, by)];
}

const sign = (v: number): number => (v < 0 ? -1 : 1);

type DistKind =
  | { k: 'pp'; p: number; q: number }
  | { k: 'pl'; p: number; l: [number, number] }
  | { k: 'll'; l1: [number, number]; l2: [number, number] }
  /** To a circle / arc itself (`toCurve`): from a point, a line, another circle / arc. */
  | { k: 'pc'; p: number; cc: number; r: RTerm }
  | { k: 'lc'; l: [number, number]; cc: number; r: RTerm }
  | { k: 'cc'; c1: number; r1: RTerm; c2: number; r2: RTerm };

/**
 * Classify the refs of a 'distance' constraint. Circles/arcs/ellipses act as their centre — with `toCurve`, a
 * circle / arc as itself.
 */
function distanceKind(m: Model, refs: string[], toCurve = false): DistKind | null {
  if (toCurve && refs.length >= 2) {
    const curve = (id: string) => {
      const r = isCircleLike(m, id) ? radiusTerm(m, id) : null;
      const cc = centreVar(m, id);
      return r && cc >= 0 ? { cc, r } : null;
    };
    const a = curve(refs[0]);
    const b = curve(refs[1]);
    if (a && b) return { k: 'cc', c1: a.cc, r1: a.r, c2: b.cc, r2: b.r };
    const cv = a ?? b;
    const other = a ? refs[1] : refs[0];
    if (cv) {
      const l = lineVars(m, other);
      if (l) return { k: 'lc', l, cc: cv.cc, r: cv.r };
      const p = centreVar(m, other);
      if (p >= 0) return { k: 'pc', p, cc: cv.cc, r: cv.r };
    }
  }
  if (refs.length === 1) {
    const l = lineVars(m, refs[0]);
    return l ? { k: 'pp', p: l[0], q: l[1] } : null;
  }
  if (refs.length < 2) return null;
  const l1 = lineVars(m, refs[0]);
  const l2 = lineVars(m, refs[1]);
  if (l1 && l2) return { k: 'll', l1, l2 };
  const p1 = centreVar(m, refs[0]);
  const p2 = centreVar(m, refs[1]);
  if (p1 >= 0 && p2 >= 0) return { k: 'pp', p: p1, q: p2 };
  if (p1 >= 0 && l2) return { k: 'pl', p: p1, l: l2 };
  if (p2 >= 0 && l1) return { k: 'pl', p: p2, l: l1 };
  return null;
}

/** [p, q] of an hdistance / vdistance constraint ([point-like, point-like] or [line]). */
function pointPair(m: Model, refs: string[]): [number, number] | null {
  if (refs.length === 1) return lineVars(m, refs[0]);
  if (refs.length < 2) return null;
  const a = centreVar(m, refs[0]);
  const b = centreVar(m, refs[1]);
  return a >= 0 && b >= 0 ? [a, b] : null;
}

/** Two lines among the refs (first two refs). */
function twoLines(m: Model, refs: string[]): [[number, number], [number, number]] | null {
  if (refs.length < 2) return null;
  const a = lineVars(m, refs[0]);
  const b = lineVars(m, refs[1]);
  return a && b ? [a, b] : null;
}

/** The two directions of an angle dimension: two lines, or three points — rays from the middle one to the others. */
function angleRays(m: Model, refs: string[]): [[number, number], [number, number]] | null {
  if (refs.length === 3) {
    const [a, v, b] = refs.map((r) => (m.byId.get(r)?.type === 'point' ? (m.base.get(r) ?? -1) : -1));
    return a >= 0 && v >= 0 && b >= 0 ? [
      [v, a],
      [v, b],
    ] : null;
  }
  return twoLines(m, refs);
}

/**
 * Side / kind of a distance to a circle (kept from when it was made): from a point — 1 outside, -1 inside; from a
 * line — the side of the centre (±1), times 2 when the line cuts the circle; between circles — 1 apart, -1 one in
 * the other.
 */
function curveVariant(X: Float64Array, dk: DistKind): number {
  if (dk.k === 'pc') return sign(distAt(X, dk.p, dk.cc) - radiusAt(X, dk.r));
  if (dk.k === 'lc') {
    const sd = sdAt(X, dk.cc, dk.l[0], dk.l[1]);
    return sign(sd) * (Math.abs(sd) < radiusAt(X, dk.r) ? 2 : 1);
  }
  if (dk.k === 'cc') {
    const d = distAt(X, dk.c1, dk.c2);
    return d < Math.abs(radiusAt(X, dk.r1) - radiusAt(X, dk.r2)) ? -1 : 1;
  }
  return 0;
}

/** The gap a distance to a circle measures (with its variant). */
function curveGap(X: Float64Array, dk: DistKind, variant: number): number {
  if (dk.k === 'pc') return (variant || 1) * (distAt(X, dk.p, dk.cc) - radiusAt(X, dk.r));
  if (dk.k === 'lc') {
    const s1 = variant < 0 ? -1 : 1;
    const out = Math.abs(variant) === 2 ? -1 : 1;
    return out * (s1 * sdAt(X, dk.cc, dk.l[0], dk.l[1]) - radiusAt(X, dk.r));
  }
  if (dk.k === 'cc') {
    const d = distAt(X, dk.c1, dk.c2);
    const r1 = radiusAt(X, dk.r1);
    const r2 = radiusAt(X, dk.r2);
    return variant < 0 ? Math.abs(r1 - r2) - d : d - r1 - r2;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Equations: residual = Σ coef·term - rhs, each term with analytic gradient
// ---------------------------------------------------------------------------

const T_VAR = 0; // x                                                  [x]
const T_DIST = 1; // |p - q|                                            [px py qx qy]
const T_SD = 2; // signed distance of p from line a→b                   [px py ax ay bx by]
const T_PROJ = 3; // (q - p)·(b - a) / |b - a|                          [px py qx qy ax ay bx by]
// wrap(φ - param), φ = angle from dir(a→b) to dir(c→d). Linear in φ (no saddle points
// like sin/cos residuals have); used for angle, parallel and perpendicular.  [ax ay bx by cx cy dx dy]
const T_ANG = 4;
const T_ELL = 5; // normalised ellipse radius - 1                       [px py cx cy rx ry rot]
// arc length r·θ: r = |p1 - c|, θ the counter-clockwise angle from p1 to p2 about c, in (0, 2π]  [cx cy ax ay bx by]
const T_ARC = 6;

interface Eq {
  /** Index of the owning constraint, -1 for implicit (arc radius) equations. */
  owner: number;
  types: Uint8Array;
  coefs: Float64Array;
  params: Float64Array;
  /** Full variable indices of all terms, concatenated (duplicates allowed). */
  v: Int32Array;
  rhs: number;
  /** Residual weight: raw residual (mm or rad) = value / w. */
  w: number;
}

interface EqDraft {
  owner: number;
  rhs: number;
  w: number;
  types: number[];
  coefs: number[];
  params: number[];
  v: number[];
}

function draft(owner: number, rhs = 0, w = 1): EqDraft {
  return { owner, rhs, w, types: [], coefs: [], params: [], v: [] };
}

function addT(e: EqDraft, type: number, coef: number, vars: number[], param = 0): EqDraft {
  e.types.push(type);
  e.coefs.push(coef);
  e.params.push(param);
  for (const k of vars) e.v.push(k);
  return e;
}

function finalize(d: EqDraft): Eq {
  return {
    owner: d.owner,
    types: Uint8Array.from(d.types),
    coefs: Float64Array.from(d.coefs),
    params: Float64Array.from(d.params),
    v: Int32Array.from(d.v),
    rhs: d.rhs,
    w: d.w,
  };
}

const wrapAngle = (a: number): number => a - TWO_PI * Math.round(a / TWO_PI);

/** Evaluates the residual of e at X and writes its gradient (per entry of e.v) into g. */
function evalEq(e: Eq, X: Float64Array, g: Float64Array): number {
  const v = e.v;
  const types = e.types;
  const coefs = e.coefs;
  let f = -e.rhs;
  let o = 0;
  for (let t = 0; t < types.length; t++) {
    const c = coefs[t];
    switch (types[t]) {
      case T_VAR:
        f += c * X[v[o]];
        g[o] = c;
        o += 1;
        break;
      case T_DIST: {
        const dx = X[v[o]] - X[v[o + 2]];
        const dy = X[v[o + 1]] - X[v[o + 3]];
        const d = Math.sqrt(dx * dx + dy * dy);
        let ux = 1;
        let uy = 0;
        if (d > 0) {
          ux = dx / d;
          uy = dy / d;
        }
        f += c * d;
        g[o] = c * ux;
        g[o + 1] = c * uy;
        g[o + 2] = -c * ux;
        g[o + 3] = -c * uy;
        o += 4;
        break;
      }
      case T_SD: {
        const ax = X[v[o + 2]];
        const ay = X[v[o + 3]];
        const rx = X[v[o]] - ax;
        const ry = X[v[o + 1]] - ay;
        const ex = X[v[o + 4]] - ax;
        const ey = X[v[o + 5]] - ay;
        const L2 = ex * ex + ey * ey;
        if (L2 > 0) {
          const L = Math.sqrt(L2);
          const cr = ex * ry - ey * rx;
          const k = cr / (L2 * L);
          const gpx = -ey / L;
          const gpy = ex / L;
          const gex = ry / L - k * ex;
          const gey = -rx / L - k * ey;
          f += (c * cr) / L;
          g[o] = c * gpx;
          g[o + 1] = c * gpy;
          g[o + 2] = -c * (gpx + gex);
          g[o + 3] = -c * (gpy + gey);
          g[o + 4] = c * gex;
          g[o + 5] = c * gey;
        } else {
          // degenerate line: fall back to direction (1, 0)
          f += c * ry;
          g[o] = 0;
          g[o + 1] = c;
          g[o + 2] = 0;
          g[o + 3] = -c;
          g[o + 4] = 0;
          g[o + 5] = 0;
        }
        o += 6;
        break;
      }
      case T_PROJ: {
        const qx = X[v[o + 2]] - X[v[o]];
        const qy = X[v[o + 3]] - X[v[o + 1]];
        const ex = X[v[o + 6]] - X[v[o + 4]];
        const ey = X[v[o + 7]] - X[v[o + 5]];
        const L2 = ex * ex + ey * ey;
        if (L2 > 0) {
          const L = Math.sqrt(L2);
          const dt = qx * ex + qy * ey;
          const k = dt / (L2 * L);
          const gex = qx / L - k * ex;
          const gey = qy / L - k * ey;
          f += (c * dt) / L;
          g[o] = (-c * ex) / L;
          g[o + 1] = (-c * ey) / L;
          g[o + 2] = (c * ex) / L;
          g[o + 3] = (c * ey) / L;
          g[o + 4] = -c * gex;
          g[o + 5] = -c * gey;
          g[o + 6] = c * gex;
          g[o + 7] = c * gey;
        } else {
          f += c * qx;
          g[o] = -c;
          g[o + 1] = 0;
          g[o + 2] = c;
          g[o + 3] = 0;
          g[o + 4] = 0;
          g[o + 5] = 0;
          g[o + 6] = 0;
          g[o + 7] = 0;
        }
        o += 8;
        break;
      }
      case T_ANG: {
        const ax = X[v[o + 2]] - X[v[o]];
        const ay = X[v[o + 3]] - X[v[o + 1]];
        const bx = X[v[o + 6]] - X[v[o + 4]];
        const by = X[v[o + 7]] - X[v[o + 5]];
        const n1 = ax * ax + ay * ay;
        const n2 = bx * bx + by * by;
        if (n1 > 0 && n2 > 0) {
          const phi = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
          f += c * wrapAngle(phi - e.params[t]);
          // dφ/d(dir1) = (ay, -ax)/n1, dφ/d(dir2) = (-by, bx)/n2
          const g1x = (c * ay) / n1;
          const g1y = (-c * ax) / n1;
          const g2x = (-c * by) / n2;
          const g2y = (c * bx) / n2;
          g[o] = -g1x;
          g[o + 1] = -g1y;
          g[o + 2] = g1x;
          g[o + 3] = g1y;
          g[o + 4] = -g2x;
          g[o + 5] = -g2y;
          g[o + 6] = g2x;
          g[o + 7] = g2y;
        } else {
          for (let j = 0; j < 8; j++) g[o + j] = 0;
        }
        o += 8;
        break;
      }
      case T_ELL: {
        const dx = X[v[o]] - X[v[o + 2]];
        const dy = X[v[o + 1]] - X[v[o + 3]];
        const rx = X[v[o + 4]];
        const ry = X[v[o + 5]];
        const th = X[v[o + 6]];
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const u = cs * dx + sn * dy;
        const w = -sn * dx + cs * dy;
        const rx2 = rx * rx;
        const ry2 = ry * ry;
        const rho = rx2 > 0 && ry2 > 0 ? Math.sqrt((u * u) / rx2 + (w * w) / ry2) : 0;
        if (rho > 0) {
          f += c * (rho - 1);
          const ru = u / (rx2 * rho);
          const rw = w / (ry2 * rho);
          const gpx = ru * cs - rw * sn;
          const gpy = ru * sn + rw * cs;
          g[o] = c * gpx;
          g[o + 1] = c * gpy;
          g[o + 2] = -c * gpx;
          g[o + 3] = -c * gpy;
          g[o + 4] = (-c * u * u) / (rx2 * rx * rho);
          g[o + 5] = (-c * w * w) / (ry2 * ry * rho);
          g[o + 6] = c * (ru * w - rw * u);
        } else {
          f -= c;
          for (let j = 0; j < 7; j++) g[o + j] = 0;
        }
        o += 7;
        break;
      }
      case T_ARC: {
        const ax = X[v[o + 2]] - X[v[o]];
        const ay = X[v[o + 3]] - X[v[o + 1]];
        const bx = X[v[o + 4]] - X[v[o]];
        const by = X[v[o + 5]] - X[v[o + 1]];
        const n1 = ax * ax + ay * ay;
        const n2 = bx * bx + by * by;
        if (n1 > 0 && n2 > 0) {
          const r = Math.sqrt(n1);
          let th = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
          if (th <= 0) th += TWO_PI;
          f += c * r * th;
          // d(rθ)/da = θ·a/r + r·(ay, -ax)/|a|², d(rθ)/db = r·(-by, bx)/|b|²
          const gax = c * ((th * ax) / r + ay / r);
          const gay = c * ((th * ay) / r - ax / r);
          const gbx = (c * r * -by) / n2;
          const gby = (c * r * bx) / n2;
          g[o] = -(gax + gbx);
          g[o + 1] = -(gay + gby);
          g[o + 2] = gax;
          g[o + 3] = gay;
          g[o + 4] = gbx;
          g[o + 5] = gby;
        } else {
          for (let j = 0; j < 6; j++) g[o + j] = 0;
        }
        o += 6;
        break;
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------------------
// Sparse system of one component
// ---------------------------------------------------------------------------

interface Ctx {
  X: Float64Array;
  /** full variable → reduced variable (-1: constant) */
  red: Int32Array;
  /** members (full variables) of each reduced variable */
  memPtr: Int32Array;
  memIdx: Int32Array;
  /** column scale of each reduced variable (1 / (sqrt(#members) · length unit)) */
  redScale: Float64Array;
  /** reduced variables that must stay positive */
  positive: Uint8Array;
  /** scratch: reduced variable → active column, -1 elsewhere */
  colOf: Int32Array;
}

interface Sys {
  X: Float64Array;
  eqs: Eq[];
  m: number;
  n: number;
  /** column → reduced variable */
  colRed: Int32Array;
  cscale: Float64Array;
  /** CSR Jacobian (scaled columns) */
  rowPtr: Int32Array;
  colIdx: Int32Array;
  jv: Float64Array;
  /** per equation slot (entry of eq.v) → CSR position or -1 (constant) */
  slotOff: Int32Array;
  slotPos: Int32Array;
  memPtr: Int32Array;
  memIdx: Int32Array;
  g: Float64Array;
  /** columns that must stay positive (a step may not push them through zero) */
  posCols: Int32Array;
}

function buildSys(ctx: Ctx, eqs: Eq[], cols: number[]): Sys {
  const { red, colOf } = ctx;
  const n = cols.length;
  const m = eqs.length;
  for (let i = 0; i < n; i++) colOf[cols[i]] = i;
  let nSlots = 0;
  let maxSlots = 1;
  for (const e of eqs) {
    nSlots += e.v.length;
    if (e.v.length > maxSlots) maxSlots = e.v.length;
  }
  const rowPtr = new Int32Array(m + 1);
  const colIdx = new Int32Array(nSlots);
  const slotOff = new Int32Array(m + 1);
  const slotPos = new Int32Array(nSlots);
  let nnz = 0;
  let so = 0;
  for (let i = 0; i < m; i++) {
    const v = eqs[i].v;
    const start = nnz;
    for (let j = 0; j < v.length; j++) {
      const r = red[v[j]];
      const c = r >= 0 ? colOf[r] : -1;
      let pos = -1;
      if (c >= 0) {
        for (let q = start; q < nnz; q++) {
          if (colIdx[q] === c) {
            pos = q;
            break;
          }
        }
        if (pos < 0) {
          pos = nnz;
          colIdx[nnz++] = c;
        }
      }
      slotPos[so++] = pos;
    }
    rowPtr[i + 1] = nnz;
    slotOff[i + 1] = so;
  }
  for (let i = 0; i < n; i++) colOf[cols[i]] = -1;
  const cscale = new Float64Array(n);
  for (let i = 0; i < n; i++) cscale[i] = ctx.redScale[cols[i]];
  const posCols: number[] = [];
  for (let i = 0; i < n; i++) if (ctx.positive[cols[i]]) posCols.push(i);
  return {
    X: ctx.X,
    eqs,
    m,
    n,
    colRed: Int32Array.from(cols),
    cscale,
    rowPtr,
    colIdx: colIdx.slice(0, nnz),
    jv: new Float64Array(nnz),
    slotOff,
    slotPos,
    memPtr: ctx.memPtr,
    memIdx: ctx.memIdx,
    g: new Float64Array(maxSlots),
    posCols: Int32Array.from(posCols),
  };
}

/** Residuals into f (and the Jacobian into s.jv); returns the max raw residual. */
function evalSys(s: Sys, f: Float64Array, withJ: boolean): number {
  const { X, eqs, g, rowPtr, slotOff, slotPos, jv, colIdx, cscale } = s;
  let mx = 0;
  let bad = false;
  for (let i = 0; i < s.m; i++) {
    const e = eqs[i];
    const val = evalEq(e, X, g);
    f[i] = val;
    const raw = Math.abs(val) / e.w;
    if (raw > mx) mx = raw;
    else if (raw !== raw) bad = true;
    if (withJ) {
      for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) jv[k] = 0;
      const so = slotOff[i];
      const nv = e.v.length;
      for (let j = 0; j < nv; j++) {
        const pos = slotPos[so + j];
        if (pos >= 0) jv[pos] += g[j] * cscale[colIdx[pos]];
      }
    }
  }
  return bad ? Infinity : mx;
}

function saveCols(s: Sys, z: Float64Array): void {
  for (let c = 0; c < s.n; c++) z[c] = s.X[s.memIdx[s.memPtr[s.colRed[c]]]];
}

/** X[members of col c] = z[c] + cscale[c]·du[c] (du = null: plain restore). */
function setCols(s: Sys, z: Float64Array, du: Float64Array | null): void {
  const { X, memPtr, memIdx, colRed, cscale } = s;
  for (let c = 0; c < s.n; c++) {
    const val = du ? z[c] + cscale[c] * du[c] : z[c];
    const r = colRed[c];
    for (let k = memPtr[r]; k < memPtr[r + 1]; k++) X[memIdx[k]] = val;
  }
}

// ---------------------------------------------------------------------------
// Envelope (skyline) LDLᵀ of J Jᵀ in a given row order
// ---------------------------------------------------------------------------

interface Env {
  m: number;
  /** position → row */
  perm: Int32Array;
  /** position → first position stored in its envelope row */
  first: Int32Array;
  /** start offset of each envelope row; entry (p, q) is at off[p] - first[p] + q */
  off: Int32Array;
  a: Float64Array;
  l: Float64Array;
  d: Float64Array;
  tmp: Float64Array;
  w: Float64Array;
  /** column lists in position order: positions and CSR indices */
  cPtr: Int32Array;
  cPos: Int32Array;
  cNz: Int32Array;
}

function makeEnv(s: Sys, perm: Int32Array): Env {
  const { m, n, rowPtr, colIdx } = s;
  const nnz = colIdx.length;
  const cPtr = new Int32Array(n + 1);
  for (let k = 0; k < nnz; k++) cPtr[colIdx[k] + 1]++;
  for (let c = 0; c < n; c++) cPtr[c + 1] += cPtr[c];
  const fill = cPtr.slice(0, n);
  const cPos = new Int32Array(nnz);
  const cNz = new Int32Array(nnz);
  for (let p = 0; p < m; p++) {
    const i = perm[p];
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      const j = fill[colIdx[k]]++;
      cPos[j] = p;
      cNz[j] = k;
    }
  }
  const first = new Int32Array(m);
  const off = new Int32Array(m + 1);
  for (let p = 0; p < m; p++) {
    const i = perm[p];
    let f = p;
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      const fp = cPos[cPtr[colIdx[k]]];
      if (fp < f) f = fp;
    }
    first[p] = f;
    off[p + 1] = off[p] + p - f + 1;
  }
  const size = off[m];
  return {
    m,
    perm,
    first,
    off,
    a: new Float64Array(size),
    l: new Float64Array(size),
    d: new Float64Array(m),
    tmp: new Float64Array(m),
    w: new Float64Array(m),
    cPtr,
    cPos,
    cNz,
  };
}

/** a = (R J)(R J)ᵀ with optional row scaling R. */
function assemble(s: Sys, env: Env, rs: Float64Array | null): void {
  const { a, off, first, cPtr, cPos, cNz, perm } = env;
  const jv = s.jv;
  a.fill(0);
  for (let c = 0; c < s.n; c++) {
    const k0 = cPtr[c];
    const k1 = cPtr[c + 1];
    for (let i = k0; i < k1; i++) {
      const p = cPos[i];
      const vi = rs ? jv[cNz[i]] * rs[perm[p]] : jv[cNz[i]];
      if (vi === 0) continue;
      const op = off[p] - first[p];
      a[op + p] += vi * vi;
      for (let j = k0; j < i; j++) {
        const q = cPos[j];
        const vj = rs ? jv[cNz[j]] * rs[perm[q]] : jv[cNz[j]];
        a[op + q] += vi * vj;
      }
    }
  }
}

/**
 * LDLᵀ of a + λI. With depTol >= 0 (analysis mode, λ = 0, unit diagonal) pivots below depTol
 * mark the row as dependent: d = ∞, which removes it from all later rows.
 */
function factor(env: Env, lambda: number, depTol: number): void {
  const { m, first, off, a, l, d, tmp } = env;
  for (let p = 0; p < m; p++) {
    const fp = first[p];
    const op = off[p] - fp;
    for (let q = fp; q < p; q++) {
      const fq = first[q];
      const oq = off[q] - fq;
      let t = a[op + q];
      for (let k = fp > fq ? fp : fq; k < q; k++) t -= tmp[k] * l[oq + k];
      tmp[q] = t;
      l[op + q] = t / d[q];
    }
    let dd = a[op + p] + lambda;
    for (let q = fp; q < p; q++) dd -= tmp[q] * l[op + q];
    if (depTol >= 0) d[p] = dd > depTol ? dd : Infinity;
    else d[p] = dd > 1e-300 ? dd : Math.max(lambda, 1e-300);
  }
}

/** Solves (L D Lᵀ) out = rhs; rhs/out are indexed by row (not position). */
function solveEnv(env: Env, rhs: Float64Array, out: Float64Array): void {
  const { m, first, off, l, d, w, perm } = env;
  for (let p = 0; p < m; p++) {
    const fp = first[p];
    const op = off[p] - fp;
    let s = rhs[perm[p]];
    for (let q = fp; q < p; q++) s -= l[op + q] * w[q];
    w[p] = s;
  }
  for (let p = 0; p < m; p++) w[p] /= d[p];
  for (let p = m - 1; p >= 0; p--) {
    const fp = first[p];
    const op = off[p] - fp;
    const yp = w[p];
    if (yp !== 0) for (let q = fp; q < p; q++) w[q] -= l[op + q] * yp;
  }
  for (let p = 0; p < m; p++) out[perm[p]] = w[p];
}

function identityPerm(m: number): Int32Array {
  const p = new Int32Array(m);
  for (let i = 0; i < m; i++) p[i] = i;
  return p;
}

/** Reverse Cuthill–McKee ordering of the rows (rows adjacent when they share a column). */
function rcm(s: Sys): Int32Array {
  const { m, n, rowPtr, colIdx } = s;
  const nnz = colIdx.length;
  const cPtr = new Int32Array(n + 1);
  for (let k = 0; k < nnz; k++) cPtr[colIdx[k] + 1]++;
  for (let c = 0; c < n; c++) cPtr[c + 1] += cPtr[c];
  const fill = cPtr.slice(0, n);
  const cRow = new Int32Array(nnz);
  for (let i = 0; i < m; i++) for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) cRow[fill[colIdx[k]]++] = i;
  const deg = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    let dg = 0;
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) dg += cPtr[colIdx[k] + 1] - cPtr[colIdx[k]] - 1;
    deg[i] = dg;
  }
  const byDeg = Array.from({ length: m }, (_, i) => i).sort((x, y) => deg[x] - deg[y]);
  const order = new Int32Array(m);
  const seen = new Uint8Array(m);
  const nb: number[] = [];
  const byDegree = (x: number, y: number) => deg[x] - deg[y];
  let head = 0;
  let tail = 0;
  for (const st of byDeg) {
    if (seen[st]) continue;
    seen[st] = 1;
    order[tail++] = st;
    while (head < tail) {
      const u = order[head++];
      nb.length = 0;
      for (let k = rowPtr[u]; k < rowPtr[u + 1]; k++) {
        const c = colIdx[k];
        for (let j = cPtr[c]; j < cPtr[c + 1]; j++) {
          const w = cRow[j];
          if (!seen[w]) {
            seen[w] = 1;
            nb.push(w);
          }
        }
      }
      if (nb.length > 1) nb.sort(byDegree);
      for (const w of nb) order[tail++] = w;
    }
  }
  order.reverse();
  return order;
}

// ---------------------------------------------------------------------------
// Levenberg–Marquardt with minimum-norm steps: dx = -Jᵀ (J Jᵀ + λI)⁻¹ F
// ---------------------------------------------------------------------------

function sumSq(f: Float64Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return s;
}

/** Solves s in place (moves X). Returns true when every residual is within tol. */
function lm(s: Sys, maxIter: number, tol: number): boolean {
  const { m, n } = s;
  const f = new Float64Array(m);
  let res = evalSys(s, f, true);
  if (res <= tol) return true;
  if (n === 0 || m === 0) return false;
  const tolIn = tol * 1e-3;
  const env = makeEnv(s, rcm(s));
  const ft = new Float64Array(m);
  const y = new Float64Array(m);
  const du = new Float64Array(n);
  const z0 = new Float64Array(n);
  const { rowPtr, colIdx, jv } = s;
  let cost = sumSq(f);
  let mu = 1e-8;
  let stall = 0;
  for (let it = 0; it < maxIter; it++) {
    assemble(s, env, null);
    let tr = 0;
    for (let p = 0; p < m; p++) tr += env.a[env.off[p + 1] - 1];
    const dm = tr > 0 ? tr / m : 1;
    saveCols(s, z0);
    let accepted = false;
    let costT = cost;
    for (let tries = 0; tries < 12; tries++) {
      factor(env, mu * dm, -1);
      solveEnv(env, f, y);
      du.fill(0);
      for (let i = 0; i < m; i++) {
        const yi = y[i];
        for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) du[colIdx[k]] -= jv[k] * yi;
      }
      // a radius may not be pushed through zero (negative radii satisfy tangency spuriously)
      let flips = false;
      for (const c of s.posCols) if (z0[c] > 0 && z0[c] + s.cscale[c] * du[c] <= 0) flips = true;
      setCols(s, z0, du);
      const resT = flips ? Infinity : evalSys(s, ft, false);
      costT = flips ? Infinity : sumSq(ft);
      if (resT <= tolIn || costT < cost) {
        accepted = true;
        break;
      }
      setCols(s, z0, null);
      mu *= 10;
      if (mu > 1e12) break;
    }
    if (!accepted) return res <= tol;
    stall = cost - costT <= 1e-7 * cost ? stall + 1 : 0;
    mu = Math.max(mu * 0.1, 1e-14);
    res = evalSys(s, f, true);
    cost = sumSq(f);
    if (res <= tolIn) return true;
    if (stall >= 3) return res <= tol;
  }
  return res <= tol;
}

// ---------------------------------------------------------------------------
// Rank analysis
// ---------------------------------------------------------------------------

interface Analysis {
  /** per row: linearly dependent on earlier rows (in the given order) */
  dep: Uint8Array;
  rank: number;
  /** per column: variable is determined (null when not requested) */
  det: Uint8Array | null;
}

function analyzeSys(s: Sys, perm: Int32Array, depTol: number, wantDet: boolean): Analysis {
  const { m, n, rowPtr, jv } = s;
  evalSys(s, new Float64Array(m), true);
  const rs = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let q = 0;
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) q += jv[k] * jv[k];
    rs[i] = q > 1e-24 ? 1 / Math.sqrt(q) : 0;
  }
  const env = makeEnv(s, perm);
  assemble(s, env, rs);
  factor(env, 0, depTol);
  const dep = new Uint8Array(m);
  let rank = 0;
  for (let p = 0; p < m; p++) {
    if (env.d[p] === Infinity) dep[perm[p]] = 1;
    else rank++;
  }
  let det: Uint8Array | null = null;
  if (wantDet) {
    det = new Uint8Array(n);
    if (rank >= n) det.fill(1);
    else {
      // ||P_rowspace e_c||² = b ᵀ G⁻¹ b with b = column c of the normalised Jacobian
      const { first, off, l, d, w, cPtr, cPos, cNz } = env;
      for (let c = 0; c < n; c++) {
        const k0 = cPtr[c];
        const k1 = cPtr[c + 1];
        if (k0 === k1) continue;
        const p0 = cPos[k0];
        for (let k = k0; k < k1; k++) w[cPos[k]] = jv[cNz[k]] * rs[perm[cPos[k]]];
        let q2 = 0;
        for (let p = p0; p < m; p++) {
          const fp = first[p];
          const op = off[p] - fp;
          let acc = w[p];
          for (let q = fp > p0 ? fp : p0; q < p; q++) acc -= l[op + q] * w[q];
          w[p] = acc;
          if (d[p] !== Infinity) q2 += (acc * acc) / d[p];
        }
        for (let p = p0; p < m; p++) w[p] = 0;
        det[c] = 1 - q2 < DET_TOL ? 1 : 0;
      }
    }
  }
  return { dep, rank, det };
}

const DIMENSION_TYPES = new Set(['distance', 'hdistance', 'vdistance', 'radius', 'diameter', 'angle']);

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/** dims: numeric value per dimensional constraint id; lengths in mm, angles in RADIANS. */
export function solveSketch(
  entities: SkEntity[],
  constraints: SkConstraint[],
  dims: Record<string, number>,
  opts: SolveOptions = {},
): SolveResult {
  // Substitution constraints (coincident, horizontal, ...) found to conflict with earlier
  // constraints are left out and the sketch is solved again without them.
  const excluded = new Uint8Array(constraints.length);
  for (let attempt = 0; ; attempt++) {
    const { result, substConflicts } = solveOnce(entities, constraints, dims, opts, excluded);
    if (!substConflicts.length || attempt >= 3) return result;
    for (const ci of substConflicts) excluded[ci] = 1;
  }
}

/** Equality relation applied by substitution: x[a] = x[b], or x[a] fixed when b < 0. */
interface SubstOp {
  owner: number;
  a: number;
  b: number;
}

function solveOnce(
  entities: SkEntity[],
  constraints: SkConstraint[],
  dims: Record<string, number>,
  opts: SolveOptions,
  excluded: Uint8Array,
): { result: SolveResult; substConflicts: number[] } {
  const tol = opts.tolerance ?? 1e-7;
  const maxIter = opts.maxIterations ?? 50;
  const doAnalyze = opts.analyze !== false;
  const model = buildModel(entities);
  const N = model.nVars;
  const X = model.x0.slice();
  const S = model.scale;
  const texts = textBoxes(model, X, tol, constraints);

  // --- union-find over full variables (substitution of equality constraints) ---
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const isFixed = new Uint8Array(N);
  const fixVal = new Float64Array(N);
  let maxRes = 0;
  const substOps: SubstOp[] = [];
  let curOwner = -1;
  // measuring mode: report the residual of a substitution instead of applying it
  let measuring = false;
  let measured = 0;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  /** 0 = applied, 1 = redundant, 2 = conflicting */
  const ufMerge = (a: number, b: number): number => {
    if (measuring) {
      measured = Math.max(measured, Math.abs(X[a] - X[b]));
      return 0;
    }
    if (a === b) return 0;
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return 1;
    if (isFixed[ra] && isFixed[rb]) {
      const diff = Math.abs(fixVal[ra] - fixVal[rb]);
      if (diff > tol) {
        maxRes = Math.max(maxRes, diff);
        return 2;
      }
      parent[rb] = ra;
      return 1;
    }
    if (isFixed[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    substOps.push({ owner: curOwner, a, b });
    return 0;
  };
  const ufFix = (a: number, val: number): number => {
    if (measuring) {
      measured = Math.max(measured, Math.abs(X[a] - val));
      return 0;
    }
    const ra = find(a);
    if (isFixed[ra]) {
      const diff = Math.abs(fixVal[ra] - val);
      if (diff > tol) {
        maxRes = Math.max(maxRes, diff);
        return 2;
      }
      return 1;
    }
    isFixed[ra] = 1;
    fixVal[ra] = val;
    substOps.push({ owner: curOwner, a, b: -1 });
    return 0;
  };
  const mergePt = (a: number, b: number): number => Math.max(ufMerge(a, b), ufMerge(a + 1, b + 1));

  const drafts: EqDraft[] = [];
  const cflag = new Uint8Array(constraints.length); // 1 redundant, 2 conflicting
  const pv = (p: number): [number, number] => [p, p + 1];
  const lineWeight = (l1: [number, number], l2: [number, number]): number => {
    const w = Math.sqrt(distAt(X, l1[0], l1[1]) * distAt(X, l2[0], l2[1]));
    return w > 1e-9 * S ? w : S;
  };

  // implicit arc equations first, so they are never the ones reported as dependent
  for (const e of model.byId.values()) {
    if (e.type !== 'arc') continue;
    const c = ptVar(model, e.c);
    const a = ptVar(model, e.p1);
    const b = ptVar(model, e.p2);
    if (c < 0 || a < 0 || b < 0 || a === b || a === c || b === c) continue;
    const d = draft(-1);
    addT(d, T_DIST, 1, [a, a + 1, c, c + 1]);
    addT(d, T_DIST, -1, [b, b + 1, c, c + 1]);
    drafts.push(d);
  }
  // the box of a text: p3 = p1 + k·(p2 − p1) turned a quarter clockwise, p4 = p2 + p3 − p1 — a rectangle k times as
  // wide as it is high (linear: so a width dimension sets the height, a parallel side turns the text)
  const lin = (terms: [number, number][]) => {
    const d = draft(-1);
    for (const [coef, v] of terms) addT(d, T_VAR, coef, [v]);
    drafts.push(d);
  };
  for (const { k, p: [p1, p2, p3, p4] } of texts) {
    lin([[1, p3], [-1, p1], [-k, p2 + 1], [k, p1 + 1]]);
    lin([[1, p3 + 1], [-1, p1 + 1], [k, p2], [-k, p1]]);
    lin([[1, p4], [-1, p2], [-1, p3], [1, p1]]);
    lin([[1, p4 + 1], [-1, p2 + 1], [-1, p3 + 1], [1, p1 + 1]]);
  }

  const dimOf = (c: SkConstraint): number | undefined => {
    const v = dims[c.id];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };

  /** Angle equation between the directions of two lines with target angle `target`. */
  const angleEq = (ci: number, l1: [number, number], l2: [number, number], target: number): EqDraft => {
    const w = lineWeight(l1, l2);
    return addT(draft(ci, 0, w), T_ANG, w, [...pv(l1[0]), ...pv(l1[1]), ...pv(l2[0]), ...pv(l2[1])], target);
  };
  /** Points identical after substitution (same variable classes). */
  const samePt = (p: number, q: number) => p === q || (find(p) === find(q) && find(p + 1) === find(q + 1));
  /** Arc endpoints (point vars) or [] for other entities. */
  const arcEnds = (id: string | undefined): number[] => {
    const e = id === undefined ? undefined : model.byId.get(id);
    if (!e || e.type !== 'arc') return [];
    return [ptVar(model, e.p1), ptVar(model, e.p2)].filter((p) => p >= 0);
  };
  /** Points coincident constraints hold on circles / arcs: curve id → point vars (made when first asked). */
  let held: Map<string, number[]> | null = null;
  const heldOn = (id: string): number[] => {
    if (!held) {
      held = new Map();
      for (const k of constraints) {
        if (k.type !== 'coincident' || k.driven || !k.refs || k.refs.length < 2) continue;
        const pi = model.byId.get(k.refs[0])?.type === 'point' ? 0 : model.byId.get(k.refs[1])?.type === 'point' ? 1 : -1;
        const p = pi < 0 ? -1 : ptVar(model, k.refs[pi]);
        if (p >= 0) held.set(k.refs[1 - pi], [...(held.get(k.refs[1 - pi]) ?? []), p]);
      }
    }
    return held.get(id) ?? [];
  };

  /**
   * Translates one constraint. Phase 0 applies substitutions (returns the UF flag), phase 1
   * pushes equations; all substitutions are known when equations are built.
   */
  const translate = (c: SkConstraint, ci: number, phase: number): number => {
    // a driven (reference) dimension only shows what the geometry measures
    if (c.driven) return 0;
    const refs = c.refs ?? [];
    const E = (i: number) => (refs[i] === undefined ? undefined : model.byId.get(refs[i]));
    const push = (d: EqDraft) => {
      drafts.push(d);
      return 0;
    };
    const isSubst =
      c.type === 'horizontal' ||
      c.type === 'vertical' ||
      c.type === 'concentric' ||
      c.type === 'fix' ||
      (c.type === 'coincident' && E(0)?.type === 'point' && E(1)?.type === 'point');
    if (isSubst !== (phase === 0)) return 0;
    switch (c.type) {
      case 'coincident': {
        if (refs.length < 2) return 0;
        // two lines: the ends of the second on the first (collinear, Onshape)
        const l1 = lineVars(model, refs[0]);
        const l2 = lineVars(model, refs[1]);
        if (l1 && l2) {
          for (const q of l2) if (!samePt(q, l1[0]) && !samePt(q, l1[1])) push(addT(draft(ci), T_SD, 1, [...pv(q), ...pv(l1[0]), ...pv(l1[1])]));
          return 0;
        }
        const pi = E(0)?.type === 'point' ? 0 : 1;
        const p = ptVar(model, refs[pi]);
        const other = E(1 - pi);
        if (p < 0 || !other) return 0;
        switch (other.type) {
          case 'point':
            return mergePt(p, model.base.get(other.id)!);
          case 'line': {
            const l = lineVars(model, other.id);
            if (!l) return 0;
            return push(addT(draft(ci), T_SD, 1, [...pv(p), ...pv(l[0]), ...pv(l[1])]));
          }
          case 'circle':
          case 'arc': {
            const cc = centreVar(model, other.id);
            const rt = radiusTerm(model, other.id);
            if (cc < 0 || !rt) return 0;
            const d = addT(draft(ci), T_DIST, 1, [...pv(p), ...pv(cc)]);
            return push(addT(d, rt.type, -1, rt.vars));
          }
          case 'ellipse': {
            const cc = centreVar(model, other.id);
            const b = model.base.get(other.id);
            if (cc < 0 || b === undefined) return 0;
            const w = Math.sqrt(Math.abs(X[b] * X[b + 1]));
            const ww = w > 1e-9 * S ? w : S;
            return push(addT(draft(ci, 0, ww), T_ELL, ww, [...pv(p), ...pv(cc), b, b + 1, b + 2]));
          }
          default:
            return 0; // point on spline: ignored
        }
      }
      case 'horizontal':
      case 'vertical': {
        const k = c.type === 'horizontal' ? 1 : 0;
        if (refs.length >= 2) {
          const a = ptVar(model, refs[0]);
          const b = ptVar(model, refs[1]);
          if (a >= 0 && b >= 0) return ufMerge(a + k, b + k);
        }
        let code = 0;
        for (const r of refs) {
          const l = lineVars(model, r);
          if (l) code = Math.max(code, ufMerge(l[0] + k, l[1] + k));
        }
        return code;
      }
      case 'parallel':
      case 'perpendicular': {
        const ll = twoLines(model, refs);
        if (!ll) return 0;
        // keep the nearest valid configuration (0 / π resp. ±π/2)
        const [cr, dt] = crossDotAt(X, ll[0], ll[1]);
        const target = c.type === 'parallel' ? (dt >= 0 ? 0 : Math.PI) : (sign(cr) * Math.PI) / 2;
        return push(angleEq(ci, ll[0], ll[1], target));
      }
      case 'tangent': {
        if (refs.length < 2) return 0;
        // spline end joined to a line / arc: its tangent handle along the line / across the radius
        const si = E(0)?.type === 'spline' ? 0 : E(1)?.type === 'spline' ? 1 : -1;
        if (si >= 0) {
          const sp = E(si);
          if (!sp || sp.type !== 'spline' || sp.closed) return 0;
          const otherId = refs[1 - si];
          const line = lineVars(model, otherId);
          const ends = line ? [line[0], line[1]] : arcEnds(otherId);
          for (const [pid, hid] of [
            [sp.pts[0], sp.h0],
            [sp.pts[sp.pts.length - 1], sp.h1],
          ] as const) {
            const p = ptVar(model, pid);
            const h = ptVar(model, hid);
            if (p < 0 || h < 0 || !ends.some((q) => samePt(p, q))) continue;
            if (line) {
              const [, dt] = crossDotAt(X, [p, h], line);
              return push(angleEq(ci, [p, h], line, dt >= 0 ? 0 : Math.PI));
            }
            const cc = centreVar(model, otherId);
            if (cc < 0) return 0;
            const [cr] = crossDotAt(X, [cc, p], [p, h]);
            return push(angleEq(ci, [cc, p], [p, h], ((cr >= 0 ? 1 : -1) * Math.PI) / 2));
          }
          return 0;
        }
        const ll = twoLines(model, refs);
        if (ll) {
          const [, dt] = crossDotAt(X, ll[0], ll[1]);
          return push(angleEq(ci, ll[0], ll[1], dt >= 0 ? 0 : Math.PI));
        }
        const li = lineVars(model, refs[0]) ? 0 : lineVars(model, refs[1]) ? 1 : -1;
        if (li >= 0) {
          const l = lineVars(model, refs[li])!;
          const cid = refs[1 - li];
          if (!isCircleLike(model, cid)) return 0;
          const cc = centreVar(model, cid);
          const rt = radiusTerm(model, cid);
          if (cc < 0 || !rt) return 0;
          // Arc and line share an endpoint — or a line's end is held on the circle / arc: radius ⟂
          // line at the joint. (The distance form below has a double root there, i.e. a singular
          // Jacobian: the point on the circle would seem free to slide along the line.)
          const atJoint = (p: number) => samePt(p, l[0]) || samePt(p, l[1]);
          const joint = arcEnds(cid).find(atJoint) ?? heldOn(cid).find(atJoint);
          if (joint !== undefined) {
            return push(addT(draft(ci), T_PROJ, 1, [...pv(cc), ...pv(joint), ...pv(l[0]), ...pv(l[1])]));
          }
          const s = sign(sdAt(X, cc, l[0], l[1]));
          const d = addT(draft(ci), T_SD, s, [...pv(cc), ...pv(l[0]), ...pv(l[1])]);
          return push(addT(d, rt.type, -1, rt.vars));
        }
        if (!isCircleLike(model, refs[0]) || !isCircleLike(model, refs[1])) return 0;
        const c1 = centreVar(model, refs[0]);
        const c2 = centreVar(model, refs[1]);
        const r1 = radiusTerm(model, refs[0]);
        const r2 = radiusTerm(model, refs[1]);
        if (c1 < 0 || c2 < 0 || !r1 || !r2) return 0;
        // Two arcs sharing an endpoint: both radii at the joint are collinear.
        const ends2 = arcEnds(refs[1]);
        const joint = arcEnds(refs[0]).find((p) => ends2.some((q) => samePt(p, q)));
        if (joint !== undefined && !samePt(c1, c2)) {
          const [, dt] = crossDotAt(X, [c1, joint], [c2, joint]);
          return push(angleEq(ci, [c1, joint], [c2, joint], dt >= 0 ? 0 : Math.PI));
        }
        const d = addT(draft(ci), T_DIST, 1, [...pv(c1), ...pv(c2)]);
        if (c.variant === 1) {
          const s = sign(radiusAt(X, r1) - radiusAt(X, r2));
          addT(d, r1.type, -s, r1.vars);
          addT(d, r2.type, s, r2.vars);
        } else {
          addT(d, r1.type, -1, r1.vars);
          addT(d, r2.type, -1, r2.vars);
        }
        return push(d);
      }
      case 'equal': {
        const ll = twoLines(model, refs);
        if (ll) {
          const d = addT(draft(ci), T_DIST, 1, [...pv(ll[0][0]), ...pv(ll[0][1])]);
          return push(addT(d, T_DIST, -1, [...pv(ll[1][0]), ...pv(ll[1][1])]));
        }
        if (refs.length < 2 || !isCircleLike(model, refs[0]) || !isCircleLike(model, refs[1])) return 0;
        const r1 = radiusTerm(model, refs[0]);
        const r2 = radiusTerm(model, refs[1]);
        if (!r1 || !r2) return 0;
        return push(addT(addT(draft(ci), r1.type, 1, r1.vars), r2.type, -1, r2.vars));
      }
      case 'midpoint': {
        if (refs.length < 2) return 0;
        const pi = E(0)?.type === 'point' ? 0 : 1;
        const p = ptVar(model, refs[pi]);
        const l = lineVars(model, refs[1 - pi]);
        if (p < 0 || !l) return 0;
        for (let k = 0; k < 2; k++) {
          const d = addT(draft(ci), T_VAR, 1, [p + k]);
          addT(d, T_VAR, -0.5, [l[0] + k]);
          push(addT(d, T_VAR, -0.5, [l[1] + k]));
        }
        return 0;
      }
      case 'concentric': {
        if (refs.length < 2) return 0;
        const a = centreVar(model, refs[0]);
        const b = centreVar(model, refs[1]);
        if (a < 0 || b < 0) return 0;
        return mergePt(a, b);
      }
      case 'symmetric': {
        // [a, b, axis]: two points, two lines (end points mirrored), two circles (centres + radii)
        // or two arcs (centres + end points); mirrored pairs are chosen by `variant`
        const pts: number[] = [];
        let l: [number, number] | null = null;
        for (const r of refs) {
          const p = ptVar(model, r);
          if (p >= 0) pts.push(p);
          else if (pts.length >= 2) l = l ?? lineVars(model, r);
        }
        if (pts.length < 2) l = lineVars(model, refs[2]);
        if (!l) return 0;
        const ab = [...pv(l[0]), ...pv(l[1])];
        const pair = (p: number, q: number) => {
          if (p < 0 || q < 0) return;
          if (samePt(p, q)) {
            // a shared point (apex of a V) lies on the axis
            push(addT(draft(ci), T_SD, 1, [...pv(p), ...ab]));
            return;
          }
          const d = addT(draft(ci), T_SD, 0.5, [...pv(p), ...ab]);
          push(addT(d, T_SD, 0.5, [...pv(q), ...ab]));
          push(addT(draft(ci), T_PROJ, 1, [...pv(p), ...pv(q), ...ab]));
        };
        if (pts.length >= 2) {
          pair(pts[0], pts[1]);
          return 0;
        }
        const A = E(0);
        const B = E(1);
        if (!A || !B) return 0;
        const crossed = c.variant === 1;
        if (A.type === 'line' && B.type === 'line') {
          const la = lineVars(model, A.id)!;
          const lb = lineVars(model, B.id)!;
          pair(la[0], crossed ? lb[1] : lb[0]);
          pair(la[1], crossed ? lb[0] : lb[1]);
          return 0;
        }
        if (!isCircleLike(model, A.id) || !isCircleLike(model, B.id)) return 0;
        pair(centreVar(model, A.id), centreVar(model, B.id));
        if (A.type === 'arc' && B.type === 'arc') {
          // mirroring reverses the CCW orientation: p1 ↔ p2 by default
          const ea = arcEnds(A.id);
          const eb = arcEnds(B.id);
          if (ea.length === 2 && eb.length === 2) {
            pair(ea[0], crossed ? eb[0] : eb[1]);
            pair(ea[1], crossed ? eb[1] : eb[0]);
          }
          return 0;
        }
        const r1 = radiusTerm(model, A.id);
        const r2 = radiusTerm(model, B.id);
        if (r1 && r2) push(addT(addT(draft(ci), r1.type, 1, r1.vars), r2.type, -1, r2.vars));
        return 0;
      }
      case 'fix': {
        let code = 0;
        for (const r of refs) {
          const e = model.byId.get(r);
          if (!e) continue;
          const vars = entityVars(model, e);
          const fr = refs.length === 1 ? c.frozen : undefined;
          for (let i = 0; i < vars.length; i++) {
            // without frozen values: the values the sketch came in with
            const val = fr && i < fr.length && Number.isFinite(fr[i]) ? fr[i] : model.x0[vars[i]];
            code = Math.max(code, ufFix(vars[i], val));
          }
        }
        return code;
      }
      case 'distance': {
        const dv = dimOf(c);
        const dk = distanceKind(model, refs, c.toCurve);
        if (dv === undefined || !dk) return 0;
        if (dk.k === 'pc' || dk.k === 'lc' || dk.k === 'cc') {
          // to a circle / arc itself: the gap on the side it was made on
          const v = c.variant || curveVariant(X, dk);
          if (dk.k === 'pc') return push(addT(addT(draft(ci, dv), T_DIST, v, [...pv(dk.p), ...pv(dk.cc)]), dk.r.type, -v, dk.r.vars));
          if (dk.k === 'lc') {
            const s1 = v < 0 ? -1 : 1;
            const out = Math.abs(v) === 2 ? -1 : 1;
            const d = addT(draft(ci, dv), T_SD, out * s1, [...pv(dk.cc), ...pv(dk.l[0]), ...pv(dk.l[1])]);
            return push(addT(d, dk.r.type, -out, dk.r.vars));
          }
          const d = draft(ci, dv);
          if (v < 0) {
            // one in the other: |r1 - r2| - |c1 c2|
            const s = sign(radiusAt(X, dk.r1) - radiusAt(X, dk.r2));
            addT(addT(d, dk.r1.type, s, dk.r1.vars), dk.r2.type, -s, dk.r2.vars);
            return push(addT(d, T_DIST, -1, [...pv(dk.c1), ...pv(dk.c2)]));
          }
          addT(addT(d, T_DIST, 1, [...pv(dk.c1), ...pv(dk.c2)]), dk.r1.type, -1, dk.r1.vars);
          return push(addT(d, dk.r2.type, -1, dk.r2.vars));
        }
        if (dk.k === 'pp') {
          if (dk.p === dk.q) return 0;
          return push(addT(draft(ci, dv), T_DIST, 1, [...pv(dk.p), ...pv(dk.q)]));
        }
        if (dk.k === 'pl') {
          const s = c.variant === 1 || c.variant === -1 ? c.variant : sign(sdAt(X, dk.p, dk.l[0], dk.l[1]));
          return push(addT(draft(ci, dv), T_SD, s, [...pv(dk.p), ...pv(dk.l[0]), ...pv(dk.l[1])]));
        }
        const [a, b] = dk.l1;
        const [p, q] = dk.l2;
        const s =
          c.variant === 1 || c.variant === -1 ? c.variant : sign(sdAt(X, p, a, b) + sdAt(X, q, a, b));
        const d = addT(draft(ci, dv), T_SD, 0.5 * s, [...pv(p), ...pv(a), ...pv(b)]);
        return push(addT(d, T_SD, 0.5 * s, [...pv(q), ...pv(a), ...pv(b)]));
      }
      case 'hdistance':
      case 'vdistance': {
        const dv = dimOf(c);
        const pq = pointPair(model, refs);
        if (dv === undefined || !pq) return 0;
        const k = c.type === 'hdistance' ? 0 : 1;
        const [p, q] = pq;
        const s = c.variant === 1 || c.variant === -1 ? c.variant : sign(X[q + k] - X[p + k]);
        return push(addT(addT(draft(ci, dv), T_VAR, s, [q + k]), T_VAR, -s, [p + k]));
      }
      case 'radius':
      case 'diameter': {
        const dv = dimOf(c);
        const rt = radiusTerm(model, refs[0], c.variant ?? 0);
        if (dv === undefined || !rt) return 0;
        return push(addT(draft(ci, dv), rt.type, c.type === 'diameter' ? 2 : 1, rt.vars));
      }
      case 'angle': {
        const dv = dimOf(c);
        const ll = angleRays(model, refs);
        if (dv === undefined || !ll) return 0;
        // dv is the unsigned angle between the directions; keep the current rotation sense
        const [cr] = crossDotAt(X, ll[0], ll[1]);
        return push(angleEq(ci, ll[0], ll[1], sign(cr) * dv));
      }
      case 'arclength': {
        const dv = dimOf(c);
        const e = E(0);
        if (dv === undefined || e?.type !== 'arc') return 0;
        const cc = ptVar(model, e.c);
        const [a, b] = arcEnds(e.id);
        if (cc < 0 || a === undefined || b === undefined) return 0;
        return push(addT(draft(ci, dv), T_ARC, 1, [...pv(cc), ...pv(a), ...pv(b)]));
      }
      case 'offset': {
        const dv0 = dimOf(c);
        if (dv0 === undefined) return 0;
        const dv = Math.abs(dv0);
        // copies of the pairs; the side of each copy is kept from the current configuration
        type Piece = { ends: number[]; line?: [number, number]; cc?: number; src: { line?: [number, number]; cc?: number; ends: number[] } };
        const pieces: Piece[] = [];
        for (let i = 0; i + 1 < refs.length; i += 2) {
          const ls = lineVars(model, refs[i]);
          const lt = lineVars(model, refs[i + 1]);
          if (ls && lt) {
            const [, dt] = crossDotAt(X, ls, lt);
            push(angleEq(ci, ls, lt, dt >= 0 ? 0 : Math.PI));
            const s = sign(sdAt(X, lt[0], ls[0], ls[1]) + sdAt(X, lt[1], ls[0], ls[1]));
            const d = addT(draft(ci, dv), T_SD, 0.5 * s, [...pv(lt[0]), ...pv(ls[0]), ...pv(ls[1])]);
            push(addT(d, T_SD, 0.5 * s, [...pv(lt[1]), ...pv(ls[0]), ...pv(ls[1])]));
            pieces.push({ ends: [lt[0], lt[1]], line: lt, src: { line: ls, ends: [ls[0], ls[1]] } });
            continue;
          }
          if (!isCircleLike(model, refs[i]) || !isCircleLike(model, refs[i + 1])) continue;
          const cs = centreVar(model, refs[i]);
          const ct = centreVar(model, refs[i + 1]);
          const rs = radiusTerm(model, refs[i]);
          const rt = radiusTerm(model, refs[i + 1]);
          if (cs < 0 || ct < 0 || !rs || !rt) continue;
          if (!samePt(cs, ct)) for (let k = 0; k < 2; k++) push(addT(addT(draft(ci), T_VAR, 1, [ct + k]), T_VAR, -1, [cs + k]));
          const s = sign(radiusAt(X, rt) - radiusAt(X, rs));
          push(addT(addT(draft(ci, s * dv), rt.type, 1, rt.vars), rs.type, -1, rs.vars));
          pieces.push({ ends: arcEnds(refs[i + 1]), cc: ct, src: { cc: cs, ends: arcEnds(refs[i]) } });
        }
        // Joints between copies: the distance equations alone are singular at tangent joints,
        // so these get an explicit tangency. Free ends stay square to the source ends.
        const joined = new Set<string>();
        const unit = (p: number, q: number): Vec2 => {
          const dx = X[q] - X[p];
          const dy = X[q + 1] - X[p + 1];
          const l = Math.hypot(dx, dy) || 1;
          return [dx / l, dy / l];
        };
        for (let i = 0; i < pieces.length; i++)
          for (let j = i + 1; j < pieces.length; j++)
            for (const a of pieces[i].ends)
              for (const b of pieces[j].ends) {
                if (!samePt(a, b)) continue;
                joined.add(`${i}:${a}`);
                joined.add(`${j}:${b}`);
                const P = pieces[i];
                const Q = pieces[j];
                const L = P.line ?? Q.line;
                const C = P.line ? Q.cc : Q.line ? P.cc : undefined;
                if (L && C !== undefined) {
                  const r = unit(C, a);
                  const u = unit(L[0], L[1]);
                  if (Math.abs(r[0] * u[0] + r[1] * u[1]) < 1e-4) push(addT(draft(ci), T_PROJ, 1, [...pv(C), ...pv(a), ...pv(L[0]), ...pv(L[1])]));
                } else if (P.cc !== undefined && Q.cc !== undefined && !samePt(P.cc, Q.cc)) {
                  const r1 = unit(P.cc, a);
                  const r2 = unit(Q.cc, a);
                  if (Math.abs(r1[0] * r2[1] - r1[1] * r2[0]) < 1e-4) {
                    const [, dt] = crossDotAt(X, [P.cc, a], [Q.cc, a]);
                    push(angleEq(ci, [P.cc, a], [Q.cc, a], dt >= 0 ? 0 : Math.PI));
                  }
                }
              }
        pieces.forEach((P, i) => {
          for (const e of P.ends) {
            if (joined.has(`${i}:${e}`) || !P.src.ends.length) continue;
            const se = P.src.ends.reduce((best, q) => (distAt(X, q, e) < distAt(X, best, e) ? q : best));
            if (samePt(se, e)) continue;
            if (P.src.line) push(addT(draft(ci), T_PROJ, 1, [...pv(se), ...pv(e), ...pv(P.src.line[0]), ...pv(P.src.line[1])]));
            else if (P.src.cc !== undefined && P.cc !== undefined) {
              const [, dt] = crossDotAt(X, [P.src.cc, se], [P.cc, e]);
              push(angleEq(ci, [P.src.cc, se], [P.cc, e], dt >= 0 ? 0 : Math.PI));
            }
          }
        });
        return 0;
      }
      default:
        return 0;
    }
  };

  for (let phase = 0; phase < 2; phase++) {
    constraints.forEach((c, ci) => {
      if (excluded[ci]) return;
      curOwner = ci;
      const code = translate(c, ci, phase);
      if (code > cflag[ci]) cflag[ci] = code;
    });
  }

  // --- reduced variables: free union-find classes ---
  const red = new Int32Array(N);
  const rootRed = new Int32Array(N).fill(-1);
  let nRed = 0;
  for (let k = 0; k < N; k++) {
    const r = find(k);
    if (isFixed[r]) {
      red[k] = -1;
      X[k] = fixVal[r];
    } else {
      if (rootRed[r] < 0) rootRed[r] = nRed++;
      red[k] = rootRed[r];
    }
  }
  const memPtr = new Int32Array(nRed + 1);
  for (let k = 0; k < N; k++) if (red[k] >= 0) memPtr[red[k] + 1]++;
  for (let r = 0; r < nRed; r++) memPtr[r + 1] += memPtr[r];
  const memIdx = new Int32Array(memPtr[nRed]);
  {
    const fillPos = memPtr.slice(0, nRed);
    for (let k = 0; k < N; k++) if (red[k] >= 0) memIdx[fillPos[red[k]]++] = k;
  }
  const setRed = (r: number, val: number) => {
    for (let k = memPtr[r]; k < memPtr[r + 1]; k++) X[memIdx[k]] = val;
  };
  const getRed = (r: number) => X[memIdx[memPtr[r]]];
  const redScale = new Float64Array(nRed);
  const redPositive = new Uint8Array(nRed);
  for (let r = 0; r < nRed; r++) {
    const k0 = memPtr[r];
    const k1 = memPtr[r + 1];
    const v0 = X[memIdx[k0]];
    let sum = 0;
    let same = true;
    for (let k = k0; k < k1; k++) {
      sum += X[memIdx[k]];
      if (X[memIdx[k]] !== v0) same = false;
    }
    if (!same) setRed(r, sum / (k1 - k0));
    redScale[r] = 1 / (Math.sqrt(k1 - k0) * model.lenScale[memIdx[k0]]);
    redPositive[r] = model.positive[memIdx[k0]];
  }

  // --- drag targets per reduced variable ---
  const tSum = new Float64Array(nRed);
  const tCnt = new Int32Array(nRed);
  const addTarget = (k: number, val: number) => {
    const r = red[k];
    if (r >= 0 && Number.isFinite(val)) {
      tSum[r] += val;
      tCnt[r]++;
    }
  };
  const drag = opts.drag;
  if (drag?.points) {
    for (const id of Object.keys(drag.points)) {
      const p = ptVar(model, id);
      const t = drag.points[id];
      if (p < 0 || !t) continue;
      addTarget(p, t[0]);
      addTarget(p + 1, t[1]);
    }
  }
  if (drag?.radii) {
    for (const id of Object.keys(drag.radii)) {
      const rv = drag.radii[id];
      const e = model.byId.get(id);
      if (!e || !(rv > 0)) continue;
      if (e.type === 'circle') {
        const b = model.base.get(id);
        if (b !== undefined) addTarget(b, rv);
      } else if (e.type === 'arc') {
        const c = ptVar(model, e.c);
        if (c < 0) continue;
        for (const pid of [e.p1, e.p2]) {
          const p = ptVar(model, pid);
          if (p < 0) continue;
          const dx = X[p] - X[c];
          const dy = X[p + 1] - X[c + 1];
          const len = Math.hypot(dx, dy);
          const ux = len > 0 ? dx / len : 1;
          const uy = len > 0 ? dy / len : 0;
          addTarget(p, X[c] + ux * rv);
          addTarget(p + 1, X[c + 1] + uy * rv);
        }
      }
    }
  }
  const targetOf = (r: number) => tSum[r] / tCnt[r];

  // --- equations and connected components ---
  const eqs = drafts.map(finalize);
  const nEq = eqs.length;
  const g = new Float64Array(64);
  const cpar = new Int32Array(nRed);
  for (let r = 0; r < nRed; r++) cpar[r] = r;
  const cfind = (i: number): number => {
    while (cpar[i] !== i) {
      cpar[i] = cpar[cpar[i]];
      i = cpar[i];
    }
    return i;
  };
  const eqFirst = new Int32Array(nEq).fill(-1);
  const eqDepend = new Uint8Array(nEq);
  const constEqs: number[] = [];
  for (let i = 0; i < nEq; i++) {
    const v = eqs[i].v;
    for (let j = 0; j < v.length; j++) {
      const r = red[v[j]];
      if (r < 0) continue;
      if (eqFirst[i] < 0) eqFirst[i] = r;
      else {
        const a = cfind(eqFirst[i]);
        const b = cfind(r);
        if (a !== b) cpar[b] = a;
      }
    }
    if (eqFirst[i] < 0) constEqs.push(i); // only constants: a zero row of the reduced Jacobian
  }
  const compOf = new Int32Array(nRed).fill(-1);
  const comps: { eqs: number[]; cols: number[] }[] = [];
  const rootComp = new Int32Array(nRed).fill(-1);
  for (let i = 0; i < nEq; i++) {
    if (eqFirst[i] < 0) continue;
    const root = cfind(eqFirst[i]);
    if (rootComp[root] < 0) {
      rootComp[root] = comps.length;
      comps.push({ eqs: [], cols: [] });
    }
    const ci = rootComp[root];
    const comp = comps[ci];
    comp.eqs.push(i);
    const v = eqs[i].v;
    for (let j = 0; j < v.length; j++) {
      const r = red[v[j]];
      if (r >= 0 && compOf[r] < 0) {
        compOf[r] = ci;
        comp.cols.push(r);
      }
    }
  }

  // --- ordered attribution of dependencies ---
  // In the reduced system substitutions are implicit, so they can never be "the later row".
  // When dependencies exist, redo the rank test in the full variable space with substitutions
  // as explicit linear rows, everything ordered by creation (constraint index).
  let fullCtx: Ctx | null = null;
  const getFullCtx = (): Ctx => {
    if (!fullCtx) {
      const id = new Int32Array(N + 1);
      for (let i = 0; i <= N; i++) id[i] = i;
      const sc = new Float64Array(N);
      for (let i = 0; i < N; i++) sc[i] = 1 / model.lenScale[i];
      fullCtx = {
        X,
        red: id.subarray(0, N),
        memPtr: id,
        memIdx: id.subarray(0, N),
        redScale: sc,
        positive: model.positive,
        colOf: new Int32Array(N).fill(-1),
      };
    }
    return fullCtx;
  };
  /** Returns dependent equation indices and constraint indices of dependent substitutions. */
  const attribute = (rowsEq: number[], depTol: number): { eqs: number[]; subst: number[] } => {
    const roots = new Set<number>();
    for (const i of rowsEq) for (const k of eqs[i].v) roots.add(find(k));
    const rows: { eq: Eq; idx: number; owner: number }[] = [];
    for (const op of substOps) {
      if (!roots.has(find(op.a))) continue;
      const d = addT(draft(op.owner), T_VAR, 1, [op.a]);
      if (op.b >= 0) addT(d, T_VAR, -1, [op.b]);
      rows.push({ eq: finalize(d), idx: -1, owner: op.owner });
    }
    for (const i of rowsEq) rows.push({ eq: eqs[i], idx: i, owner: eqs[i].owner });
    rows.sort((x, y) => x.owner - y.owner); // stable: implicit equations first
    const vars = new Set<number>();
    for (const r of rows) for (const k of r.eq.v) vars.add(k);
    const sys = buildSys(
      getFullCtx(),
      rows.map((r) => r.eq),
      [...vars],
    );
    const an = analyzeSys(sys, identityPerm(sys.m), depTol, false);
    const out = { eqs: [] as number[], subst: [] as number[] };
    rows.forEach((r, i) => {
      if (!an.dep[i] || r.owner < 0) return;
      if (r.idx >= 0) out.eqs.push(r.idx);
      else if (!out.subst.includes(r.owner)) out.subst.push(r.owner);
    });
    return out;
  };
  const substConflicts: number[] = [];

  // Equations on constants only are always dependent: on their own or, when a later
  // substitution (e.g. a fix) made them constant, that substitution is the one to blame.
  for (const i of constEqs) {
    const e = eqs[i];
    const unsat = !(Math.abs(evalEq(e, X, g)) / e.w <= tol);
    if (e.owner < 0 && !unsat) continue; // e.g. arc radius of a fixed arc
    const at = attribute([i], unsat ? CONFLICT_DEP_TOL : DEP_TOL);
    if (!at.subst.length) eqDepend[i] = 1;
    else if (unsat) substConflicts.push(...at.subst);
    else for (const ci of at.subst) if (cflag[ci] < 1) cflag[ci] = 1;
  }

  // --- solve every component ---
  const ctx: Ctx = { X, red, memPtr, memIdx, redScale, positive: redPositive, colOf: new Int32Array(nRed).fill(-1) };
  const detRed = new Uint8Array(nRed);
  let dof = 0;
  let nInComp = 0;

  for (const comp of comps) {
    const cols = comp.cols;
    nInComp += cols.length;
    const snap = (): Float64Array => Float64Array.from(cols, getRed);
    const restore = (z: Float64Array) => cols.forEach((r, i) => setRed(r, z[i]));
    const setTargets = (rs: number[]) => rs.forEach((r) => setRed(r, targetOf(r)));
    const without = (rs: number[]) => {
      const ex = new Set(rs);
      return cols.filter((r) => !ex.has(r));
    };
    let active = comp.eqs;
    const activeEqs = () => active.map((i) => eqs[i]);

    // Normal solve; when it fails, drop rows that are dependent at the least-squares point
    // (the later constraints in creation order) and solve again from the start. A dependent
    // substitution constraint is reported to solveSketch, which re-solves without it. When no
    // row is dependent, the most recently created unsatisfied constraint is dropped instead.
    const solveWithConflicts = () => {
      const start = snap();
      for (let pass = 0; ; pass++) {
        const sys = buildSys(ctx, activeEqs(), cols);
        if (lm(sys, maxIter, tol) || pass >= 6) return;
        const at = attribute(active, CONFLICT_DEP_TOL);
        if (at.subst.length) {
          substConflicts.push(...at.subst);
          return;
        }
        const drop = new Set(at.eqs);
        if (!drop.size) {
          let last = -1;
          for (const i of active) {
            const e = eqs[i];
            if (e.owner > last && !(Math.abs(evalEq(e, X, g)) / e.w <= tol)) last = e.owner;
          }
          for (const i of active) if (eqs[i].owner === last && last >= 0) drop.add(i);
        }
        if (!drop.size) return;
        active = active.filter((i) => !drop.has(i));
        for (const i of drop) eqDepend[i] = 1;
        restore(start);
      }
    };

    let done = false;
    const dragged = cols.filter((r) => tCnt[r] > 0);
    if (dragged.length) {
      // Start dragging from a consistent configuration (resolves pre-existing conflicts).
      const base = buildSys(ctx, activeEqs(), cols);
      if (!(evalSys(base, new Float64Array(base.m), false) <= tol)) solveWithConflicts();
      // First try: dragged variables locked at their targets.
      const pre = snap();
      setTargets(dragged);
      if (lm(buildSys(ctx, activeEqs(), without(dragged)), maxIter, tol)) done = true;
      else {
        // Drop targets of variables that cannot move (first order), retry locked, else unlocked.
        restore(pre);
        const full = buildSys(ctx, activeEqs(), cols);
        const an = analyzeSys(full, rcm(full), DEP_TOL, true);
        const colIndex = new Map(cols.map((r, i) => [r, i]));
        const movable = dragged.filter((r) => !an.det![colIndex.get(r)!]);
        setTargets(movable);
        if (movable.length > 0 && movable.length < dragged.length) {
          const st = snap();
          if (lm(buildSys(ctx, activeEqs(), without(movable)), maxIter, tol)) done = true;
          else restore(st);
        }
      }
    }
    if (!done) solveWithConflicts();

    if (doAnalyze) {
      const sys = buildSys(ctx, activeEqs(), cols);
      const an = analyzeSys(sys, rcm(sys), DEP_TOL, true);
      if (an.rank < sys.m) {
        // dependent rows exist: flag the later constraints in creation order
        const at = attribute(active, DEP_TOL);
        for (const i of at.eqs) eqDepend[i] = 1;
        for (const ci of at.subst) if (cflag[ci] < 1) cflag[ci] = 1;
        if (!at.eqs.length && !at.subst.length) {
          const nat = analyzeSys(sys, identityPerm(sys.m), DEP_TOL, false);
          for (let i = 0; i < sys.m; i++) if (nat.dep[i]) eqDepend[active[i]] = 1;
        }
      }
      cols.forEach((r, i) => {
        detRed[r] = an.det![i];
      });
      dof += cols.length - an.rank;
    }
  }

  // dragged free variables that are not part of any equation simply follow the target
  for (let r = 0; r < nRed; r++) if (tCnt[r] > 0 && compOf[r] < 0) setRed(r, targetOf(r));
  dof += nRed - nInComp;

  // --- final residuals and constraint flags ---
  let implicitFail = false;
  for (let i = 0; i < nEq; i++) {
    const e = eqs[i];
    const raw = Math.abs(evalEq(e, X, g)) / e.w;
    const unsat = !(raw <= tol);
    if (!(raw <= maxRes)) maxRes = raw;
    if (e.owner < 0) {
      if (unsat) implicitFail = true;
      continue;
    }
    if (unsat) cflag[e.owner] = 2;
    else if (eqDepend[i] && cflag[e.owner] < 1) cflag[e.owner] = 1;
  }
  // substitution constraints left out because they conflicted: measure them now
  constraints.forEach((c, ci) => {
    if (!excluded[ci]) return;
    measuring = true;
    measured = 0;
    translate(c, ci, 0);
    measuring = false;
    cflag[ci] = measured > tol ? 2 : 1;
    if (measured > maxRes) maxRes = measured;
  });
  if (maxRes !== maxRes) maxRes = Infinity;

  const conflicting: string[] = [];
  const redundant: string[] = [];
  constraints.forEach((c, ci) => {
    if (cflag[ci] === 2) conflicting.push(c.id);
    else if (cflag[ci] === 1) redundant.push(c.id);
  });

  // --- write back ---
  const out = entities.map((e): SkEntity => {
    const b = model.base.get(e.id);
    if (b === undefined || model.byId.get(e.id) !== e) return e;
    if (e.type === 'point') {
      return X[b] !== e.x || X[b + 1] !== e.y ? { ...e, x: X[b], y: X[b + 1] } : e;
    }
    if (e.type === 'circle') return X[b] !== e.r ? { ...e, r: X[b] } : e;
    if (e.type === 'ellipse') {
      return X[b] !== e.rx || X[b + 1] !== e.ry || X[b + 2] !== e.rot
        ? { ...e, rx: X[b], ry: X[b + 1], rot: X[b + 2] }
        : e;
    }
    return e;
  });

  // --- per entity status ---
  const status: Record<string, EntityStatus> = {};
  if (doAnalyze) {
    const over = new Set<string>();
    // Consistent redundancy of geometric constraints is harmless (Onshape accepts it);
    // only conflicts and redundant dimensions over-define the sketch.
    constraints.forEach((c, ci) => {
      if (cflag[ci] === 2 || (cflag[ci] === 1 && DIMENSION_TYPES.has(c.type))) for (const r of c.refs ?? []) over.add(r);
    });
    for (const e of model.byId.values()) {
      if (over.has(e.id)) status[e.id] = 'over';
      else {
        const vars = entityVars(model, e);
        const full = vars.every((k) => red[k] < 0 || detRed[red[k]] === 1);
        status[e.id] = full ? 'full' : 'under';
      }
    }
  }

  return {
    result: {
      entities: out,
      ok: conflicting.length === 0 && !implicitFail && maxRes <= tol,
      maxResidual: maxRes,
      conflicting,
      redundant,
      dof: doAnalyze ? dof : -1,
      status,
    },
    substConflicts,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the UI
// ---------------------------------------------------------------------------

/** Values to store in a 'fix' constraint's `frozen` field for the given entity. */
export function frozenValues(entityId: string, entities: SkEntity[]): number[] {
  const m = buildModel(entities);
  const e = m.byId.get(entityId);
  if (!e) return [];
  return entityVars(m, e).map((k) => m.x0[k]);
}

/** Variant hint to store on a new constraint so the solver keeps the current configuration. */
/**
 * How far entities `a` and `b` are from being mirror images about line `axis` (sum of point
 * distances, mm) and whether their end points pair crosswise. Null if they cannot be symmetric.
 */
export function symmetryFit(entities: SkEntity[], a: string, b: string, axis: string): { err: number; crossed: boolean } | null {
  const m = buildModel(entities);
  const X = m.x0;
  const l = lineVars(m, axis);
  if (!l || a === axis || b === axis) return null;
  const [ax, ay, bx, by] = [X[l[0]], X[l[0] + 1], X[l[1]], X[l[1] + 1]];
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-18) return null;
  const d = (p: number, q: number) => {
    const t = ((X[p] - ax) * dx + (X[p + 1] - ay) * dy) / L2;
    return Math.hypot(2 * (ax + t * dx) - X[p] - X[q], 2 * (ay + t * dy) - X[p + 1] - X[q + 1]);
  };
  const A = m.byId.get(a);
  const B = m.byId.get(b);
  if (!A || !B) return null;
  if (A.type === 'point' && B.type === 'point') return { err: d(ptVar(m, a), ptVar(m, b)), crossed: false };
  if (A.type === 'line' && B.type === 'line') {
    const la = lineVars(m, a)!;
    const lb = lineVars(m, b)!;
    const straight = d(la[0], lb[0]) + d(la[1], lb[1]);
    const cross = d(la[0], lb[1]) + d(la[1], lb[0]);
    return { err: Math.min(straight, cross), crossed: cross < straight };
  }
  if (A.type === 'arc' && B.type === 'arc') {
    const [a1, a2, b1, b2] = [ptVar(m, A.p1), ptVar(m, A.p2), ptVar(m, B.p1), ptVar(m, B.p2)];
    // default pairing p1 ↔ p2 (mirroring reverses the orientation); "crossed" = p1 ↔ p1
    const def = d(a1, b2) + d(a2, b1);
    const cross = d(a1, b1) + d(a2, b2);
    return { err: d(centreVar(m, a), centreVar(m, b)) + Math.min(def, cross), crossed: cross < def };
  }
  if (A.type === 'circle' && B.type === 'circle') {
    const r1 = radiusTerm(m, a);
    const r2 = radiusTerm(m, b);
    if (!r1 || !r2) return null;
    return { err: d(centreVar(m, a), centreVar(m, b)) + Math.abs(radiusAt(X, r1) - radiusAt(X, r2)), crossed: false };
  }
  return null;
}

export function initialVariant(c: Omit<SkConstraint, 'variant'>, entities: SkEntity[]): number {
  const m = buildModel(entities);
  const X = m.x0;
  const refs = c.refs ?? [];
  switch (c.type) {
    case 'symmetric': {
      if (refs.length < 3) return 0;
      return symmetryFit(entities, refs[0], refs[1], refs[2])?.crossed ? 1 : 0;
    }
    case 'hdistance':
    case 'vdistance': {
      const pq = pointPair(m, refs);
      if (!pq) return 0;
      const k = c.type === 'hdistance' ? 0 : 1;
      return sign(X[pq[1] + k] - X[pq[0] + k]);
    }
    case 'tangent': {
      if (refs.length < 2 || !isCircleLike(m, refs[0]) || !isCircleLike(m, refs[1])) return 0;
      const c1 = centreVar(m, refs[0]);
      const c2 = centreVar(m, refs[1]);
      const r1 = radiusTerm(m, refs[0]);
      const r2 = radiusTerm(m, refs[1]);
      if (c1 < 0 || c2 < 0 || !r1 || !r2) return 0;
      const d = distAt(X, c1, c2);
      const a = radiusAt(X, r1);
      const b = radiusAt(X, r2);
      return Math.abs(d - Math.abs(a - b)) < Math.abs(d - (a + b)) ? 1 : 0;
    }
    case 'distance': {
      const dk = distanceKind(m, refs, c.toCurve);
      if (!dk) return 0;
      if (dk.k === 'pc' || dk.k === 'lc' || dk.k === 'cc') return curveVariant(X, dk);
      if (dk.k !== 'pl') return 0;
      return sign(sdAt(X, dk.p, dk.l[0], dk.l[1]));
    }
    default:
      return 0;
  }
}

/** The length of an arc of the entities (counter-clockwise from p1 to p2). */
function arcLengthAt(m: Model, X: Float64Array, id: string | undefined): number {
  const e = id === undefined ? undefined : m.byId.get(id);
  if (e?.type !== 'arc') return 0;
  const c = ptVar(m, e.c);
  const a = ptVar(m, e.p1);
  const b = ptVar(m, e.p2);
  if (c < 0 || a < 0 || b < 0) return 0;
  const ax = X[a] - X[c];
  const ay = X[a + 1] - X[c + 1];
  const bx = X[b] - X[c];
  const by = X[b + 1] - X[c + 1];
  let th = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  if (th <= 0) th += TWO_PI;
  return Math.hypot(ax, ay) * th;
}

/** Current measured value of a dimensional constraint (mm or radians). */
export function measureConstraint(c: SkConstraint, entities: SkEntity[]): number {
  const m = buildModel(entities);
  const X = m.x0;
  const refs = c.refs ?? [];
  switch (c.type) {
    case 'distance': {
      const dk = distanceKind(m, refs, c.toCurve);
      if (!dk) return 0;
      if (dk.k === 'pp') return distAt(X, dk.p, dk.q);
      if (dk.k === 'pl') return Math.abs(sdAt(X, dk.p, dk.l[0], dk.l[1]));
      if (dk.k === 'pc' || dk.k === 'lc' || dk.k === 'cc') return Math.abs(curveGap(X, dk, c.variant || curveVariant(X, dk)));
      const [a, b] = dk.l1;
      return Math.abs(0.5 * (sdAt(X, dk.l2[0], a, b) + sdAt(X, dk.l2[1], a, b)));
    }
    case 'arclength':
      return arcLengthAt(m, X, refs[0]);
    case 'hdistance':
    case 'vdistance': {
      const pq = pointPair(m, refs);
      if (!pq) return 0;
      const k = c.type === 'hdistance' ? 0 : 1;
      return Math.abs(X[pq[1] + k] - X[pq[0] + k]);
    }
    case 'radius':
    case 'diameter': {
      const rt = radiusTerm(m, refs[0], c.variant ?? 0);
      if (!rt) return 0;
      return Math.abs(radiusAt(X, rt)) * (c.type === 'diameter' ? 2 : 1);
    }
    case 'angle': {
      const ll = angleRays(m, refs);
      if (!ll) return 0;
      const [, dt, n1, n2] = crossDotAt(X, ll[0], ll[1]);
      if (!(n1 > 0 && n2 > 0)) return 0;
      return Math.acos(Math.max(-1, Math.min(1, dt / (n1 * n2))));
    }
    case 'offset': {
      const ls = lineVars(m, refs[0]);
      const lt = lineVars(m, refs[1]);
      if (ls && lt) return Math.abs(0.5 * (sdAt(X, lt[0], ls[0], ls[1]) + sdAt(X, lt[1], ls[0], ls[1])));
      const rs = radiusTerm(m, refs[0]);
      const rt = radiusTerm(m, refs[1]);
      return rs && rt ? Math.abs(radiusAt(X, rt) - radiusAt(X, rs)) : 0;
    }
    default:
      return 0;
  }
}
