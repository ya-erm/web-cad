// Sketch Offset (Onshape "Offset", O) and Extend.
//
// Offset copies curves / connected chains of lines and arcs at a distance. Corners of the offset
// chain are joined at the intersection of the neighbouring offset curves (sharp corners), tangent
// joints stay tangent. The result is driven by ONE 'offset' dimension whose refs are the pairs
// [source, offset, source, offset, ...], so editing the source or the value updates the copy.
//
// Extend moves the end of a line or arc nearest to the click up to the next intersecting curve.

import type { SkEntity, SketchData, Vec2 } from '../core/types';
import { add, arcAngles, cross, dist, dot, entityMap, entityPrim, intersectPrims, len, mod, norm, perp, pointOf, scale, sub, type EntityMap, type Prim } from './curves';
import { addArc, addCircle, addConstraint, addLine, attachToHit } from './sketchOps';

const TAU = Math.PI * 2;

/** Oriented piece of a chain; `a` → `b` is the travel direction (arcs: ccw = travel is CCW). */
export type OffsetPiece =
  | { id: string; kind: 'line'; a: Vec2; b: Vec2 }
  | { id: string; kind: 'arc'; c: Vec2; r: number; a: Vec2; b: Vec2; ccw: boolean }
  | { id: string; kind: 'circle'; c: Vec2; r: number };

export interface OffsetChain {
  pieces: OffsetPiece[];
  closed: boolean;
}

const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function extentOf(map: EntityMap): number {
  let ext = 1;
  for (const e of map.values()) if (e.type === 'point') ext = Math.max(ext, Math.abs(e.x), Math.abs(e.y));
  return ext;
}

function endsOf(e: SkEntity, map: EntityMap): [Vec2, Vec2] | null {
  if (e.type === 'line' || e.type === 'arc') return [pointOf(map, e.p1), pointOf(map, e.p2)];
  return null;
}

function orient(e: SkEntity, map: EntityMap, rev: boolean): OffsetPiece | null {
  if (e.type === 'line') {
    const p = [pointOf(map, e.p1), pointOf(map, e.p2)];
    return { id: e.id, kind: 'line', a: rev ? p[1] : p[0], b: rev ? p[0] : p[1] };
  }
  if (e.type === 'arc') {
    const aa = arcAngles(e, map);
    const p = [pointOf(map, e.p1), pointOf(map, e.p2)];
    return { id: e.id, kind: 'arc', c: aa.c, r: aa.r, a: rev ? p[1] : p[0], b: rev ? p[0] : p[1], ccw: !rev };
  }
  if (e.type === 'circle') return { id: e.id, kind: 'circle', c: pointOf(map, e.c), r: Math.abs(e.r) };
  return null;
}

/** Group lines / arcs / circles into connected, consistently oriented chains. */
export function offsetChains(map: EntityMap, ids: string[]): OffsetChain[] {
  const curves = [...new Set(ids)]
    .map((id) => map.get(id))
    .filter((e): e is SkEntity => !!e && (e.type === 'line' || e.type === 'arc' || e.type === 'circle'));
  const tol = 1e-7 * extentOf(map);
  const chains: OffsetChain[] = [];
  const open = curves.filter((e) => e.type !== 'circle');
  for (const e of curves) if (e.type === 'circle') chains.push({ pieces: [orient(e, map, false)!], closed: true });
  const ends = new Map(open.map((e) => [e.id, endsOf(e, map)!]));
  const used = new Set<string>();
  /** Unused curve with an end at p; `startAt` orients it to start (true) or end (false) there. */
  const findAt = (p: Vec2, startAt: boolean): OffsetPiece | null => {
    for (const e of open) {
      if (used.has(e.id)) continue;
      const [s, t] = ends.get(e.id)!;
      if (dist(s, p) <= tol) {
        used.add(e.id);
        return orient(e, map, !startAt);
      }
      if (dist(t, p) <= tol) {
        used.add(e.id);
        return orient(e, map, startAt);
      }
    }
    return null;
  };
  for (const e0 of open) {
    if (used.has(e0.id)) continue;
    used.add(e0.id);
    const pieces: OffsetPiece[] = [orient(e0, map, false)!];
    const endOf = (p: OffsetPiece) => (p.kind === 'circle' ? p.c : p.b);
    const startOf = (p: OffsetPiece) => (p.kind === 'circle' ? p.c : p.a);
    for (let nx = findAt(endOf(pieces[pieces.length - 1]), true); nx; nx = findAt(endOf(pieces[pieces.length - 1]), true)) pieces.push(nx);
    const closed = pieces.length > 1 && dist(endOf(pieces[pieces.length - 1]), startOf(pieces[0])) <= tol;
    if (!closed) for (let pv = findAt(startOf(pieces[0]), false); pv; pv = findAt(startOf(pieces[0]), false)) pieces.unshift(pv);
    chains.push({ pieces, closed });
  }
  return chains;
}

/** The connected chain (of curves with the same construction state) containing `id`. */
export function chainIdsOf(d: SketchData, id: string): string[] {
  const map = entityMap(d.entities);
  const seed = map.get(id);
  if (!seed || seed.type === 'point') return [];
  const ids = d.entities.filter((e) => (e.type === 'line' || e.type === 'arc') && !!e.construction === !!seed.construction).map((e) => e.id);
  const ch = offsetChains(map, ids).find((c) => c.pieces.some((p) => p.id === id));
  return ch ? ch.pieces.map((p) => p.id) : [id];
}

/** Offset one piece by `delta` to its left (travel direction). Null if a radius would vanish. */
function offsetPiece(p: OffsetPiece, delta: number): OffsetPiece | null {
  if (p.kind === 'line') {
    const n = perp(norm(sub(p.b, p.a)));
    return { ...p, a: add(p.a, scale(n, delta)), b: add(p.b, scale(n, delta)) };
  }
  // left of a CCW travel is the centre
  const r = p.kind === 'circle' || p.ccw ? p.r - delta : p.r + delta;
  if (!(r > 1e-9 * (1 + p.r))) return null;
  if (p.kind === 'circle') return { ...p, r };
  const k = r / p.r;
  return { ...p, r, a: add(p.c, scale(sub(p.a, p.c), k)), b: add(p.c, scale(sub(p.b, p.c), k)) };
}

/** Intersections of the infinite supports (line / full circle) of two pieces. */
function supportHits(p: OffsetPiece, q: OffsetPiece): Vec2[] {
  if (p.kind === 'circle' || q.kind === 'circle') return [];
  if (p.kind === 'line' && q.kind === 'line') {
    const d1 = sub(p.b, p.a);
    const d2 = sub(q.b, q.a);
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-14 * len(d1) * len(d2)) return [];
    const t = cross(sub(q.a, p.a), d2) / den;
    return [add(p.a, scale(d1, t))];
  }
  if (p.kind === 'line' || q.kind === 'line') {
    const l = (p.kind === 'line' ? p : q) as { a: Vec2; b: Vec2 };
    const c = (p.kind === 'line' ? q : p) as { c: Vec2; r: number };
    const u = norm(sub(l.b, l.a));
    const foot = add(l.a, scale(u, dot(sub(c.c, l.a), u)));
    const h = dist(foot, c.c);
    if (h > c.r * (1 + 1e-9)) return [];
    const s = Math.sqrt(Math.max(0, c.r * c.r - h * h));
    return [add(foot, scale(u, s)), add(foot, scale(u, -s))];
  }
  const A = p as { c: Vec2; r: number };
  const B = q as { c: Vec2; r: number };
  const dd = dist(A.c, B.c);
  if (dd < 1e-12 || dd > A.r + B.r || dd < Math.abs(A.r - B.r)) return [];
  const x = (dd * dd + A.r * A.r - B.r * B.r) / (2 * dd);
  const y = Math.sqrt(Math.max(0, A.r * A.r - x * x));
  const u = scale(sub(B.c, A.c), 1 / dd);
  const base = add(A.c, scale(u, x));
  const n = perp(u);
  return [add(base, scale(n, y)), add(base, scale(n, -y))];
}

/** Signed travel sweep of an arc piece from a to b (positive). */
function arcSweep(p: { c: Vec2; a: Vec2; b: Vec2; ccw: boolean }): number {
  const a0 = Math.atan2(p.a[1] - p.c[1], p.a[0] - p.c[0]);
  const a1 = Math.atan2(p.b[1] - p.c[1], p.b[0] - p.c[0]);
  const s = mod(p.ccw ? a1 - a0 : a0 - a1, TAU);
  return s < 1e-12 ? TAU : s;
}

/**
 * Offset chains by `delta` (positive = left of the travel direction; inside for CCW loops).
 * Returns null when the distance is too large for the geometry (a piece would flip or vanish).
 */
export function computeOffset(chains: OffsetChain[], delta: number): OffsetChain[] | null {
  const out: OffsetChain[] = [];
  let ext = 1;
  for (const ch of chains)
    for (const p of ch.pieces) for (const v of p.kind === 'circle' ? [p.c] : [p.a, p.b]) ext = Math.max(ext, Math.abs(v[0]), Math.abs(v[1]));
  const tol = 1e-7 * ext;
  for (const ch of chains) {
    const pieces: OffsetPiece[] = [];
    for (const p of ch.pieces) {
      const o = offsetPiece(p, delta);
      if (!o) return null;
      pieces.push(o);
    }
    const n = pieces.length;
    const joints = ch.closed && n > 1 ? n : n - 1;
    for (let i = 0; i < joints; i++) {
      const p = pieces[i];
      const q = pieces[(i + 1) % n];
      if (p.kind === 'circle' || q.kind === 'circle') continue;
      const target = mid(p.b, q.a);
      let J = target;
      if (dist(p.b, q.a) > tol) {
        const hits = supportHits(p, q);
        if (hits.length) J = hits.reduce((best, h) => (dist(h, target) < dist(best, target) ? h : best));
      }
      pieces[i] = { ...p, b: J };
      pieces[(i + 1) % n] = { ...(pieces[(i + 1) % n] as typeof q), a: J };
    }
    // validity: no piece may flip or collapse
    for (let i = 0; i < n; i++) {
      const o = pieces[i];
      const s = ch.pieces[i];
      if (o.kind === 'line' && s.kind === 'line') {
        if (dot(sub(o.b, o.a), sub(s.b, s.a)) <= 0 || dist(o.a, o.b) <= tol) return null;
      } else if (o.kind === 'arc' && s.kind === 'arc') {
        const sw = arcSweep(o);
        if (dist(o.a, o.b) <= tol || Math.abs(sw - arcSweep(s)) > Math.PI) return null;
      }
    }
    out.push({ pieces, closed: ch.closed });
  }
  return out;
}

/** Signed offset distance (left positive) of point `q` from the nearest piece of the chains. */
export function offsetDistanceAt(chains: OffsetChain[], q: Vec2): number {
  let best = Infinity;
  let sd = 0;
  for (const ch of chains)
    for (const p of ch.pieces) {
      let d: number;
      let s: number;
      if (p.kind === 'line') {
        const v = sub(p.b, p.a);
        const L = len(v) || 1;
        const u = scale(v, 1 / L);
        const t = Math.max(0, Math.min(L, dot(sub(q, p.a), u)));
        d = dist(q, add(p.a, scale(u, t)));
        s = dot(sub(q, p.a), perp(u));
      } else {
        const rq = dist(q, p.c);
        s = p.kind === 'circle' || p.ccw ? p.r - rq : rq - p.r;
        d = Math.abs(rq - p.r);
        if (p.kind === 'arc') {
          // outside the angular range: distance to the nearer end
          const sw = arcSweep(p);
          const aq = Math.atan2(q[1] - p.c[1], q[0] - p.c[0]);
          const a0 = Math.atan2(p.a[1] - p.c[1], p.a[0] - p.c[0]);
          const rel = mod(p.ccw ? aq - a0 : a0 - aq, TAU);
          if (rel > sw) d = Math.min(dist(q, p.a), dist(q, p.b));
        }
      }
      if (d < best) {
        best = d;
        sd = s;
      }
    }
  return sd;
}

/** Sampled polylines of chains (for previews). */
export function chainPolylines(chains: OffsetChain[]): Vec2[][] {
  const out: Vec2[][] = [];
  for (const ch of chains)
    for (const p of ch.pieces) {
      if (p.kind === 'line') out.push([p.a, p.b]);
      else {
        const sw = p.kind === 'circle' ? TAU : arcSweep(p);
        const start = p.kind === 'circle' ? 0 : Math.atan2(p.a[1] - p.c[1], p.a[0] - p.c[0]);
        const dir = p.kind === 'circle' || p.ccw ? 1 : -1;
        const n = Math.max(8, Math.ceil(sw / 0.05));
        const pts: Vec2[] = [];
        for (let i = 0; i <= n; i++) {
          const a = start + (dir * sw * i) / n;
          pts.push([p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)]);
        }
        out.push(pts);
      }
    }
  return out;
}

/**
 * Create the offset curves, join consecutive pieces and add one 'offset' dimension with
 * expression `value`. Returns the dimension id and the new curve ids.
 */
export function applyOffset(d: SketchData, off: OffsetChain[], value: string): { constraintId: string; ids: string[] } {
  const map = entityMap(d.entities);
  const refs: string[] = [];
  const ids: string[] = [];
  for (const ch of off) {
    const ends: { s: string; e: string }[] = [];
    for (const p of ch.pieces) {
      const cons = !!map.get(p.id)?.construction;
      let id: string;
      let s = '';
      let e = '';
      if (p.kind === 'line') {
        const l = addLine(d, p.a, p.b, cons);
        [id, s, e] = [l.id, l.p1, l.p2];
      } else if (p.kind === 'circle') id = addCircle(d, p.c, p.r, cons).id;
      else if (p.ccw) {
        const a = addArc(d, p.c, p.a, p.b, cons);
        [id, s, e] = [a.id, a.p1, a.p2];
      } else {
        const a = addArc(d, p.c, p.b, p.a, cons);
        [id, s, e] = [a.id, a.p2, a.p1];
      }
      refs.push(p.id, id);
      ids.push(id);
      ends.push({ s, e });
    }
    const n = ends.length;
    for (let i = 0; i + 1 < n; i++) addConstraint(d, 'coincident', [ends[i].e, ends[i + 1].s]);
    if (ch.closed && n > 1) addConstraint(d, 'coincident', [ends[n - 1].e, ends[0].s]);
  }
  const constraintId = addConstraint(d, 'offset', refs, { value });
  return { constraintId, ids };
}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

export interface ExtendTarget {
  /** Point entity that moves. */
  pointId: string;
  from: Vec2;
  to: Vec2;
  /** Arc extension: centre and travel sense, for previews. */
  arc?: { c: Vec2; r: number; ccw: boolean };
}

/** Where the end of curve `id` nearest to `at` would move when extended (null: nothing to hit). */
export function extendTarget(d: SketchData, id: string, at: Vec2): ExtendTarget | null {
  const map = entityMap(d.entities);
  const e = map.get(id);
  if (!e || (e.type !== 'line' && e.type !== 'arc')) return null;
  const P1 = pointOf(map, e.p1);
  const P2 = pointOf(map, e.p2);
  const atP2 = dist(at, P2) < dist(at, P1);
  const end = atP2 ? P2 : P1;
  const ext = extentOf(map);
  const tol = 1e-7 * ext;
  let prim: Prim;
  let param: (p: Vec2) => number;
  let arc: ExtendTarget['arc'];
  if (e.type === 'line') {
    const u = norm(atP2 ? sub(P2, P1) : sub(P1, P2));
    prim = { kind: 'seg', a: end, b: add(end, scale(u, 1e4 * ext)) };
    param = (p) => dot(sub(p, end), u);
  } else {
    const aa = arcAngles(e, map);
    // the rest of the circle beyond the arc: CCW from a1 to a0 + 2π
    prim = { kind: 'arc', c: aa.c, r: aa.r, t0: aa.a1, sweep: TAU - (aa.a1 - aa.a0) };
    const endAng = atP2 ? aa.a1 : aa.a0;
    param = (p) => {
      const a = Math.atan2(p[1] - aa.c[1], p[0] - aa.c[0]);
      return aa.r * mod(atP2 ? a - endAng : endAng - a, TAU);
    };
    arc = { c: aa.c, r: aa.r, ccw: atP2 };
  }
  let best: Vec2 | null = null;
  let bestT = Infinity;
  for (const o of d.entities) {
    if (o.id === id || o.type === 'point') continue;
    const op = entityPrim(o, map);
    if (!op) continue;
    for (const h of intersectPrims(prim, op, tol)) {
      const t = param(h.p);
      if (t > tol * 10 && t < bestT) {
        bestT = t;
        best = h.p;
      }
    }
  }
  if (!best) return null;
  return { pointId: atP2 ? e.p2 : e.p1, from: end, to: best, arc };
}

/**
 * Extend the end of a line / arc nearest to `at` to the next intersecting curve.
 * Returns 'connected' when that end is joined to another curve, false when nothing is hit.
 */
export function extendEntity(d: SketchData, id: string, at: Vec2): boolean | 'connected' {
  const map = entityMap(d.entities);
  const e = map.get(id);
  // (a side of a text's box goes with the text)
  if (!e || (e.type !== 'line' && e.type !== 'arc') || (e.type === 'line' && e.owner)) return false;
  const pid = dist(at, pointOf(map, e.p2)) < dist(at, pointOf(map, e.p1)) ? e.p2 : e.p1;
  const joined = d.constraints.some(
    (c) => c.type === 'coincident' && c.refs.includes(pid) && c.refs.some((r) => r !== pid && map.get(r)?.type === 'point'),
  );
  if (joined) return 'connected';
  const tg = extendTarget(d, id, at);
  if (!tg) return false;
  // the moved end drops its own constraints; a length dimension of the line would block it
  d.constraints = d.constraints.filter(
    (c) => !c.refs.includes(tg.pointId) && !(c.refs.length === 1 && c.refs[0] === id && (c.type === 'distance' || c.type === 'fix')),
  );
  const pt = d.entities.find((x) => x.id === tg.pointId);
  if (pt && pt.type === 'point') [pt.x, pt.y] = tg.to;
  attachToHit(
    d,
    tg.pointId,
    d.entities.filter((x) => x.id !== id && x.type !== 'point'),
    tg.to,
  );
  return true;
}
