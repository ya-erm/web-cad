// Graphics of sketch dimensions (extension lines, dimension lines, arrows, label anchor).

import type { SkConstraint, Vec2 } from '../core/types';
import { arcAngles, pointOf, type EntityMap } from './curves';

export interface DimGeom {
  /** Line segments (x1,y1,x2,y2,...) in sketch coordinates. */
  segs: number[];
  arrows: { tip: Vec2; dir: Vec2 }[];
  label: Vec2;
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const nrm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];

function radiusOf(e: { type: string }, map: EntityMap, id: string): { c: Vec2; r: number } | null {
  const ent = map.get(id);
  if (!ent) return null;
  if (ent.type === 'circle') return { c: pointOf(map, ent.c), r: ent.r };
  if (ent.type === 'arc') {
    const a = arcAngles(ent, map);
    return { c: a.c, r: a.r };
  }
  void e;
  return null;
}

/** Linear dimension between a and b along direction `axis` (unit), label near `L`. */
function linear(a: Vec2, b: Vec2, axis: Vec2, L: Vec2, px: number): DimGeom {
  const n = perp(axis);
  // offset of the dimension line from a along n, through L
  const off = dot(sub(L, a), n);
  const offB = dot(sub(L, b), n);
  const A = add(a, mul(n, off));
  const B = add(b, mul(n, offB));
  const ext = 6 * px;
  const segs: number[] = [];
  const extLine = (p: Vec2, q: Vec2) => {
    const d = sub(q, p);
    const l = len(d);
    if (l < 1e-12) return;
    const u = mul(d, 1 / l);
    const start = add(p, mul(u, Math.min(3 * px, l)));
    const end = add(q, mul(u, ext));
    segs.push(start[0], start[1], end[0], end[1]);
  };
  extLine(a, A);
  extLine(b, B);
  // dimension line spans A..B and extends to the label if outside
  const t = (p: Vec2) => dot(sub(p, A), axis);
  const tB = t(B);
  const tL = t(L);
  const lo = Math.min(0, tB, tL);
  const hi = Math.max(0, tB, tL);
  const P = (s: number) => add(A, mul(axis, s));
  const p0 = P(lo);
  const p1 = P(hi);
  segs.push(p0[0], p0[1], p1[0], p1[1]);
  const dirAB = tB >= 0 ? axis : mul(axis, -1);
  const inside = tL > Math.min(0, tB) && tL < Math.max(0, tB);
  const arrows = [
    { tip: A, dir: inside ? mul(dirAB, -1) : dirAB },
    { tip: B, dir: inside ? dirAB : mul(dirAB, -1) },
  ];
  return { segs, arrows, label: P(tL) };
}

/** Default label position for a new dimension. */
export function defaultLabelPos(c: SkConstraint, map: EntityMap, px: number): Vec2 {
  const g = dimensionGeometry({ ...c, labelPos: undefined }, map, px);
  return g?.label ?? [0, 0];
}

export function dimensionGeometry(c: SkConstraint, map: EntityMap, px: number): DimGeom | null {
  try {
    const off = 30 * px;
    switch (c.type) {
      case 'distance':
      case 'hdistance':
      case 'vdistance': {
        let a: Vec2;
        let b: Vec2;
        const e0 = map.get(c.refs[0]);
        const e1 = c.refs[1] ? map.get(c.refs[1]) : undefined;
        if (!e0) return null;
        if (e0.type === 'line' && !e1) {
          a = pointOf(map, e0.p1);
          b = pointOf(map, e0.p2);
        } else if (e0.type === 'point' && e1?.type === 'point') {
          a = [e0.x, e0.y];
          b = [e1.x, e1.y];
        } else if ((e0.type === 'point' && e1?.type === 'line') || (e0.type === 'line' && e1?.type === 'point')) {
          const p = e0.type === 'point' ? e0 : (e1 as typeof e0 & { type: 'point' });
          const l = e0.type === 'line' ? e0 : (e1 as typeof e0 & { type: 'line' });
          a = [p.x, p.y];
          const la = pointOf(map, l.p1);
          const lb = pointOf(map, l.p2);
          const u = nrm(sub(lb, la));
          b = add(la, mul(u, dot(sub(a, la), u)));
        } else if (e0.type === 'line' && e1?.type === 'line') {
          const la = pointOf(map, e0.p1);
          const lb = pointOf(map, e0.p2);
          const m: Vec2 = mul(add(pointOf(map, e1.p1), pointOf(map, e1.p2)), 0.5);
          const u = nrm(sub(lb, la));
          a = add(la, mul(u, dot(sub(m, la), u)));
          b = m;
        } else return null;
        let axis: Vec2;
        if (c.type === 'hdistance') axis = [1, 0];
        else if (c.type === 'vdistance') axis = [0, 1];
        else {
          axis = nrm(sub(b, a));
          if (len(sub(b, a)) < 1e-12) axis = [1, 0];
        }
        const mid = mul(add(a, b), 0.5);
        const L = c.labelPos ?? add(mid, mul(perp(axis), off));
        return linear(a, b, axis, L, px);
      }
      case 'radius':
      case 'diameter': {
        const el = map.get(c.refs[0]);
        if (el?.type === 'ellipse') {
          // an axis of the ellipse, drawn as a linear dimension across it (radius: centre to the end)
          const ctr = pointOf(map, el.c);
          const second = c.variant === 1;
          const ax: Vec2 = second ? [-Math.sin(el.rot), Math.cos(el.rot)] : [Math.cos(el.rot), Math.sin(el.rot)];
          const r = second ? el.ry : el.rx;
          const other = second ? el.rx : el.ry;
          const a = c.type === 'diameter' ? add(ctr, mul(ax, -r)) : ctr;
          const b = add(ctr, mul(ax, r));
          const L = c.labelPos ?? add(mul(add(a, b), 0.5), mul(perp(ax), other + off));
          return linear(a, b, ax, L, px);
        }
        const rc = radiusOf({ type: '' }, map, c.refs[0]);
        if (!rc) return null;
        const L = c.labelPos ?? add(rc.c, mul(nrm([1, 1]), rc.r + off));
        const u = nrm(sub(L, rc.c));
        const onCircle = add(rc.c, mul(u, rc.r));
        const segs: number[] = [];
        if (c.type === 'radius') {
          segs.push(rc.c[0], rc.c[1], L[0], L[1]);
          return { segs, arrows: [{ tip: onCircle, dir: dot(sub(L, rc.c), u) > rc.r ? mul(u, -1) : u }], label: L };
        }
        if (dot(sub(L, rc.c), u) > rc.r) {
          // the label outside: only the outer part — from the label to the circle, one arrow at the circle
          segs.push(onCircle[0], onCircle[1], L[0], L[1]);
          return { segs, arrows: [{ tip: onCircle, dir: mul(u, -1) }], label: L };
        }
        // inside: across the diameter, the arrows from the centre to the circle
        const opp = add(rc.c, mul(u, -rc.r));
        segs.push(opp[0], opp[1], onCircle[0], onCircle[1]);
        return {
          segs,
          arrows: [
            { tip: onCircle, dir: u },
            { tip: opp, dir: mul(u, -1) },
          ],
          label: L,
        };
      }
      case 'offset': {
        // drawn between the first source curve and its copy
        const s = map.get(c.refs[0]);
        const t = map.get(c.refs[1]);
        if (!s || !t) return null;
        let a: Vec2;
        let b: Vec2;
        if (s.type === 'line' && t.type === 'line') {
          const la = pointOf(map, s.p1);
          const u = nrm(sub(pointOf(map, s.p2), la));
          b = mul(add(pointOf(map, t.p1), pointOf(map, t.p2)), 0.5);
          a = add(la, mul(u, dot(sub(b, la), u)));
        } else {
          const rs = radiusOf(s, map, s.id);
          const rt = radiusOf(t, map, t.id);
          if (!rs || !rt) return null;
          let u: Vec2 = [1, 0];
          if (t.type === 'arc') {
            const aa = arcAngles(t, map);
            const m = (aa.a0 + aa.a1) / 2;
            u = [Math.cos(m), Math.sin(m)];
          } else if (c.labelPos) u = nrm(sub(c.labelPos, rs.c));
          a = add(rs.c, mul(u, rs.r));
          b = add(rt.c, mul(u, rt.r));
        }
        const axis = len(sub(b, a)) > 1e-12 ? nrm(sub(b, a)) : ([1, 0] as Vec2);
        const L = c.labelPos ?? add(mul(add(a, b), 0.5), mul(perp(axis), off * 0.6));
        return linear(a, b, axis, L, px);
      }
      case 'angle': {
        const l1 = map.get(c.refs[0]);
        const l2 = map.get(c.refs[1]);
        if (l1?.type !== 'line' || l2?.type !== 'line') return null;
        const a1 = pointOf(map, l1.p1);
        const b1 = pointOf(map, l1.p2);
        const a2 = pointOf(map, l2.p1);
        const b2 = pointOf(map, l2.p2);
        const d1 = sub(b1, a1);
        const d2 = sub(b2, a2);
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        let O: Vec2;
        if (Math.abs(den) < 1e-12) O = mul(add(a1, a2), 0.5);
        else {
          const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
          O = add(a1, mul(d1, t));
        }
        // choose ray directions pointing towards the line midpoints
        const m1 = mul(add(a1, b1), 0.5);
        const m2 = mul(add(a2, b2), 0.5);
        let u1 = nrm(len(sub(m1, O)) > 1e-9 ? sub(m1, O) : d1);
        let u2 = nrm(len(sub(m2, O)) > 1e-9 ? sub(m2, O) : d2);
        const L = c.labelPos ?? add(O, mul(nrm(add(u1, u2)), Math.max(off * 1.5, 0.4 * Math.min(len(d1), len(d2)))));
        const R = Math.max(len(sub(L, O)), 1e-6);
        // the label direction selects which pair of rays (sector) to span
        const ul = nrm(sub(L, O));
        const inSector = (p: Vec2, q: Vec2) => {
          const cr = p[0] * q[1] - p[1] * q[0];
          const s1 = p[0] * ul[1] - p[1] * ul[0];
          const s2 = ul[0] * q[1] - ul[1] * q[0];
          return cr >= 0 ? s1 >= 0 && s2 >= 0 : s1 <= 0 && s2 <= 0;
        };
        if (!inSector(u1, u2)) {
          if (inSector(mul(u1, -1), u2)) u1 = mul(u1, -1);
          else if (inSector(u1, mul(u2, -1))) u2 = mul(u2, -1);
          else {
            u1 = mul(u1, -1);
            u2 = mul(u2, -1);
          }
        }
        let a0 = Math.atan2(u1[1], u1[0]);
        let aE = Math.atan2(u2[1], u2[0]);
        let sweep = aE - a0;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep < -Math.PI) sweep += 2 * Math.PI;
        const n = 24;
        const segs: number[] = [];
        let prev: Vec2 | null = null;
        for (let i = 0; i <= n; i++) {
          const a = a0 + (sweep * i) / n;
          const p: Vec2 = [O[0] + R * Math.cos(a), O[1] + R * Math.sin(a)];
          if (prev) segs.push(prev[0], prev[1], p[0], p[1]);
          prev = p;
        }
        aE = a0 + sweep;
        const s = Math.sign(sweep) || 1;
        const tipA: Vec2 = [O[0] + R * Math.cos(a0), O[1] + R * Math.sin(a0)];
        const tipB: Vec2 = [O[0] + R * Math.cos(aE), O[1] + R * Math.sin(aE)];
        // extension lines from the line ends to the arc
        const extTo = (u: Vec2, a: Vec2, b: Vec2) => {
          const far = Math.max(dot(sub(a, O), u), dot(sub(b, O), u));
          if (far < R) {
            const p = add(O, mul(u, Math.max(far, 0)));
            const q = add(O, mul(u, R + 4 * (R > 0 ? 0 : 0)));
            segs.push(p[0], p[1], q[0], q[1]);
          }
        };
        extTo(u1, a1, b1);
        extTo(u2, a2, b2);
        return {
          segs,
          arrows: [
            { tip: tipA, dir: mul(perp([Math.cos(a0), Math.sin(a0)]), -s) },
            { tip: tipB, dir: mul(perp([Math.cos(aE), Math.sin(aE)]), s) },
          ],
          label: L,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Arrowhead triangle vertices. */
export function arrowTriangle(tip: Vec2, dir: Vec2, size: number): number[] {
  const u = nrm(dir);
  const n = perp(u);
  const base = sub(tip, mul(u, size));
  const w = size * 0.3;
  return [tip[0], tip[1], 0, base[0] + n[0] * w, base[1] + n[1] * w, 0, base[0] - n[0] * w, base[1] - n[1] * w, 0];
}
