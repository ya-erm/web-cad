// "Use" (project) geometry into a sketch: world-space edges/points projected onto the
// sketch plane become fixed sketch entities that stay linked to their source.

import type { Draft } from 'immer';
import type { PlaneFrame, SelRef, SkEntity, SketchData, Vec2, Vec3 } from '../core/types';
import { toLocal, v3 } from '../core/math';
import { addArc, addCircle, addConstraint, addLine, addPoint, addSpline, circumcircle, onCcwArc } from './sketchOps';
import { frozenValues } from './solver';

export type WorldGeom =
  | { kind: 'point'; p: Vec3 }
  | { kind: 'line'; a: Vec3; b: Vec3 }
  | { kind: 'circle'; c: Vec3; r: number; axis: Vec3 }
  | { kind: 'arc'; c: Vec3; r: number; axis: Vec3; start: Vec3; mid: Vec3; end: Vec3 }
  | { kind: 'poly'; pts: Vec3[] };

const parallel = (axis: Vec3, n: Vec3) => Math.abs(v3.dot(v3.norm(axis), n)) > 1 - 1e-6;

/** Plane-local 2D description of the projected geometry. */
export type LocalGeom =
  | { kind: 'point'; p: Vec2 }
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'arc'; c: Vec2; start: Vec2; end: Vec2 } // CCW start → end
  | { kind: 'spline'; pts: Vec2[] };

export function projectGeometry(g: WorldGeom, f: PlaneFrame): LocalGeom | null {
  const L = (p: Vec3) => toLocal(f, p);
  switch (g.kind) {
    case 'point':
      return { kind: 'point', p: L(g.p) };
    case 'line': {
      const a = L(g.a);
      const b = L(g.b);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) return { kind: 'point', p: a };
      return { kind: 'line', a, b };
    }
    case 'circle':
      if (parallel(g.axis, f.normal)) return { kind: 'circle', c: L(g.c), r: g.r };
      return { kind: 'spline', pts: sampleCircle(g.c, g.r, g.axis).map(L) };
    case 'arc': {
      const s = L(g.start);
      const m = L(g.mid);
      const e = L(g.end);
      if (parallel(g.axis, f.normal)) {
        const cc = circumcircle(s, m, e);
        if (cc) return onCcwArc(cc.c, s, e, m) ? { kind: 'arc', c: cc.c, start: s, end: e } : { kind: 'arc', c: cc.c, start: e, end: s };
      }
      return { kind: 'spline', pts: [s, m, e] };
    }
    case 'poly': {
      const pts = g.pts.map(L);
      if (pts.length === 2) return { kind: 'line', a: pts[0], b: pts[1] };
      return { kind: 'spline', pts: decimate(pts, 24) };
    }
  }
}

function sampleCircle(c: Vec3, r: number, axis: Vec3): Vec3[] {
  const n = v3.norm(axis);
  const x = Math.abs(n[0]) < 0.9 ? v3.norm(v3.cross(n, [1, 0, 0])) : v3.norm(v3.cross(n, [0, 1, 0]));
  const y = v3.cross(n, x);
  const out: Vec3[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    out.push(v3.add(c, v3.add(v3.scale(x, r * Math.cos(a)), v3.scale(y, r * Math.sin(a)))));
  }
  return out;
}

function decimate(pts: Vec2[], max: number): Vec2[] {
  if (pts.length <= max) return pts;
  const out: Vec2[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))]);
  return out;
}

/** Add projected geometry as fixed, linked entities. Returns the created entity id. */
export function addUsedGeometry(d: Draft<SketchData>, g: LocalGeom, ref: SelRef): string | null {
  const sd = d as SketchData;
  let id: string | null = null;
  switch (g.kind) {
    case 'point':
      id = addPoint(sd, g.p);
      break;
    case 'line':
      id = addLine(sd, g.a, g.b).id;
      break;
    case 'circle':
      id = addCircle(sd, g.c, g.r).id;
      break;
    case 'arc':
      id = addArc(sd, g.c, g.start, g.end).id;
      break;
    case 'spline':
      id = addSpline(sd, g.pts).id;
      break;
  }
  if (!id) return null;
  const e = sd.entities.find((x) => x.id === id)!;
  e.use = ref;
  addConstraint(sd, 'fix', [id], { frozen: frozenValues(id, sd.entities) });
  return id;
}

/**
 * Rewrite the geometry of a used entity from freshly projected geometry (kernel rebuild).
 * Only shape-compatible updates are applied; returns false when the source changed type.
 */
export function updateUsedEntity(entities: SkEntity[], id: string, g: LocalGeom): boolean {
  const byId = new Map(entities.map((e) => [e.id, e] as const));
  const e = byId.get(id);
  if (!e) return false;
  const setP = (pid: string, p: Vec2) => {
    const pt = byId.get(pid);
    if (pt && pt.type === 'point') {
      pt.x = p[0];
      pt.y = p[1];
    }
  };
  if (e.type === 'point' && g.kind === 'point') {
    e.x = g.p[0];
    e.y = g.p[1];
    return true;
  }
  if (e.type === 'line' && g.kind === 'line') {
    setP(e.p1, g.a);
    setP(e.p2, g.b);
    return true;
  }
  if (e.type === 'circle' && g.kind === 'circle') {
    setP(e.c, g.c);
    e.r = g.r;
    return true;
  }
  if (e.type === 'arc' && g.kind === 'arc') {
    setP(e.c, g.c);
    setP(e.p1, g.start);
    setP(e.p2, g.end);
    return true;
  }
  if (e.type === 'spline' && g.kind === 'spline' && e.pts.length === g.pts.length) {
    e.pts.forEach((pid, i) => setP(pid, g.pts[i]));
    return true;
  }
  return false;
}
