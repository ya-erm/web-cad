// Inference while drawing (Onshape): the direction of a new line parallel / perpendicular to a line, tangent to the
// arc it starts on; a point on the extension of a line. Sizes in sketch units; `px` — the size of a screen pixel.

import type { SkEntity, Vec2 } from '../core/types';
import { closestPointOnEntity, pointOf, sampleEntity, type EntityMap } from './curves';

/** How close (screen pixels) the cursor has to come to an inferred guide. */
export const INFER_PX = 7;

export interface DirectionInference {
  kind: 'parallel' | 'perpendicular' | 'tangent';
  /** The line or arc the new line is parallel / perpendicular / tangent to. */
  ref: string;
  /** The inferred direction (a unit vector). */
  dir: Vec2;
  /** The cursor moved onto that direction from the anchor. */
  pos: Vec2;
}

const unit = (v: Vec2): Vec2 | null => {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-12 ? null : [v[0] / l, v[1] / l];
};

/**
 * The direction of a line drawn from `anchor` towards cursor `p`, when it comes close to one of: parallel or
 * perpendicular to a line of `refs`; tangent to an arc / circle of `startRefs` (those the line starts on, whose
 * curve passes through `anchor`). The closest one, or null.
 */
export function inferDirection(map: EntityMap, anchor: Vec2, p: Vec2, refs: string[], startRefs: string[], px: number): DirectionInference | null {
  const cands: Omit<DirectionInference, 'pos'>[] = [];
  for (const id of new Set([...startRefs, ...refs])) {
    const e = map.get(id);
    if (e?.type === 'line') {
      const u = unit([pointOf(map, e.p2)[0] - pointOf(map, e.p1)[0], pointOf(map, e.p2)[1] - pointOf(map, e.p1)[1]]);
      if (!u) continue;
      cands.push({ kind: 'parallel', ref: id, dir: u }, { kind: 'perpendicular', ref: id, dir: [-u[1], u[0]] });
    } else if ((e?.type === 'arc' || e?.type === 'circle') && startRefs.includes(id)) {
      // tangent where the line starts: square to the radius there
      const c = pointOf(map, e.c);
      const r = unit([anchor[0] - c[0], anchor[1] - c[1]]);
      if (r) cands.push({ kind: 'tangent', ref: id, dir: [-r[1], r[0]] });
    }
  }
  let best: DirectionInference | null = null;
  let bestPx = INFER_PX;
  const v: Vec2 = [p[0] - anchor[0], p[1] - anchor[1]];
  for (const c of cands) {
    const t = v[0] * c.dir[0] + v[1] * c.dir[1];
    // too close to the anchor to tell a direction
    if (Math.abs(t) / px < 12) continue;
    const q: Vec2 = [anchor[0] + c.dir[0] * t, anchor[1] + c.dir[1] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]) / px;
    if (d < bestPx) {
      bestPx = d;
      best = { ...c, pos: q };
    }
  }
  return best;
}

/** The quarter points of a circle or arc (those on the arc): top, bottom, left, right. */
export function quadrants(e: SkEntity, map: EntityMap): { q: 'top' | 'bottom' | 'left' | 'right'; pos: Vec2 }[] {
  if (e.type !== 'circle' && e.type !== 'arc') return [];
  const c = pointOf(map, e.c);
  const r = e.type === 'circle' ? e.r : Math.hypot(pointOf(map, e.p1)[0] - c[0], pointOf(map, e.p1)[1] - c[1]);
  const all: { q: 'top' | 'bottom' | 'left' | 'right'; pos: Vec2 }[] = [
    { q: 'top', pos: [c[0], c[1] + r] },
    { q: 'bottom', pos: [c[0], c[1] - r] },
    { q: 'left', pos: [c[0] - r, c[1]] },
    { q: 'right', pos: [c[0] + r, c[1]] },
  ];
  if (e.type === 'circle') return all;
  return all.filter(({ pos }) => {
    const on = closestPointOnEntity(pos, e, map);
    return Math.hypot(on[0] - pos[0], on[1] - pos[1]) < 1e-6 * Math.max(1, r);
  });
}

/** Where a quarter point acquired for alignment (`quad:<curve>:<top|bottom|left|right>`) is now, or null. */
export function quadrantPos(id: string, map: EntityMap): Vec2 | null {
  const [, curve, q] = id.split(':');
  const e = map.get(curve);
  return e ? (quadrants(e, map).find((x) => x.q === q)?.pos ?? null) : null;
}

/**
 * Where a horizontal (`y`) or vertical (`x`) guide crosses entity `e`: the crossing nearest `p`, or null — the curve's
 * point that keeps an alignment too (Onshape: the top of a circle straight above its centre, the end of a horizontal
 * line on another line).
 */
export function guideCrossing(e: SkEntity, map: EntityMap, guide: { x?: number; y?: number }, p: Vec2): Vec2 | null {
  const k = guide.y !== undefined ? 1 : 0;
  const at = guide.y ?? guide.x;
  if (at === undefined) return null;
  const pts: Vec2[] = [];
  const pt = (along: number): Vec2 => (k === 1 ? [along, at] : [at, along]);
  if (e.type === 'circle' || e.type === 'arc') {
    const c = pointOf(map, e.c);
    const r = e.type === 'circle' ? e.r : Math.hypot(pointOf(map, e.p1)[0] - c[0], pointOf(map, e.p1)[1] - c[1]);
    const off = at - c[k];
    if (Math.abs(off) <= r) {
      const s = Math.sqrt(r * r - off * off);
      for (const q of [pt(c[1 - k] - s), pt(c[1 - k] + s)]) {
        // an arc: only where it is
        if (e.type === 'arc') {
          const on = closestPointOnEntity(q, e, map);
          if (Math.hypot(on[0] - q[0], on[1] - q[1]) > 1e-6 * Math.max(1, r)) continue;
        }
        pts.push(q);
      }
    }
  } else {
    const poly = sampleEntity(e, map);
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      if ((a[k] - at) * (b[k] - at) > 0 || Math.abs(b[k] - a[k]) < 1e-12) continue;
      const t = (at - a[k]) / (b[k] - a[k]);
      pts.push(pt(a[1 - k] + (b[1 - k] - a[1 - k]) * t));
    }
  }
  let best: Vec2 | null = null;
  for (const q of pts) if (!best || Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1])) best = q;
  return best;
}

/**
 * A point on the extension of one of `lines` (beyond its ends) near cursor `p`: the closest. With `guide` — the
 * horizontal (`y`) or vertical (`x`) line the point already keeps to — where the two cross.
 */
export function extensionPoint(map: EntityMap, lines: string[], p: Vec2, px: number, guide?: { x?: number; y?: number }): { id: string; pos: Vec2 } | null {
  let best: { id: string; pos: Vec2 } | null = null;
  let bestPx = INFER_PX;
  for (const id of lines) {
    const e = map.get(id);
    if (e?.type !== 'line') continue;
    const a = pointOf(map, e.p1);
    const b = pointOf(map, e.p2);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-12) continue;
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
    // on the line itself it is the line (a curve snap), not its extension
    if (t > -10 * px && t < len + 10 * px) continue;
    const d = Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]) / px;
    if (d >= bestPx) continue;
    let pos: Vec2 = [a[0] + u[0] * t, a[1] + u[1] * t];
    if (guide?.y !== undefined) {
      // where it crosses the horizontal guide (not along it)
      if (Math.abs(u[1]) < 0.2) continue;
      const s = (guide.y - a[1]) / u[1];
      pos = [a[0] + u[0] * s, guide.y];
    } else if (guide?.x !== undefined) {
      if (Math.abs(u[0]) < 0.2) continue;
      const s = (guide.x - a[0]) / u[0];
      pos = [guide.x, a[1] + u[1] * s];
    }
    bestPx = d;
    best = { id, pos };
  }
  return best;
}
