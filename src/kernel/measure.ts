// Measuring between two selections (Onshape Measure): the maximum distance (over points of their edges and of the
// meshes of curved faces — exact for straight edges and planar faces, whose farthest points are vertices), the
// distance between centres (circles, arcs, spheres; the axes of cylinders and cones), and the angle between lines
// and planes (the acute one).

import * as R from 'replicad';
import { v3 } from '../core/math';
import type { Vec3 } from '../core/types';

/** A centre to measure from: a point (a circle's, a sphere's) or an axis (a cylinder's). */
export type Center = { kind: 'point'; p: Vec3 } | { kind: 'axis'; p: Vec3; dir: Vec3 };

/** A direction to measure an angle with: a line's (an edge, an axis) or a plane's normal. */
export type Direction = { kind: 'line' | 'plane'; dir: Vec3 };

/** Points of a shape for the maximum distance: its vertices, points along its edges, its curved faces' mesh vertices. */
export function samplePoints(shape: R.AnyShape, cap = 2500): Vec3[] {
  const out: Vec3[] = [];
  const [lo, hi] = shape.boundingBox.bounds as [Vec3, Vec3];
  const step = Math.max(v3.dist(lo, hi) / 96, 1e-6);
  const edges = shape instanceof R.Edge ? [shape] : shape.edges;
  for (const e of edges) {
    const straight = e.geomType === 'LINE';
    const n = straight ? 1 : Math.max(8, Math.min(96, Math.ceil(e.length / step)));
    for (let i = 0; i <= n; i++) {
      const q = e.pointAt(i / n);
      out.push([q.x, q.y, q.z]);
      q.delete();
    }
  }
  const faces = shape instanceof R.Face ? [shape] : shape instanceof R.Edge ? [] : shape.faces;
  for (const f of faces) {
    if (f.geomType === 'PLANE') continue;
    const tri = f.triangulation();
    if (!tri) continue;
    for (let i = 0; i < tri.vertices.length; i += 3) out.push([tri.vertices[i], tri.vertices[i + 1], tri.vertices[i + 2]]);
  }
  if (out.length <= cap) return out;
  // evenly thinned
  const k = out.length / cap;
  return Array.from({ length: cap }, (_, i) => out[Math.floor(i * k)]);
}

/** The farthest pair of points of two shapes (over their sample points). */
export function maxDistance(a: R.AnyShape, b: R.AnyShape): { value: number; points: [Vec3, Vec3] } | null {
  const pa = samplePoints(a);
  const pb = samplePoints(b);
  if (!pa.length || !pb.length) return null;
  let best = -1;
  let points: [Vec3, Vec3] = [pa[0], pb[0]];
  for (const p of pa)
    for (const q of pb) {
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      if (d > best) [best, points] = [d, [p, q]];
    }
  return { value: Math.sqrt(best), points };
}

/** The nearest points of a point and a line, of two lines (parallel: from `a.p` across). */
function closest(a: Center, b: Center): [Vec3, Vec3] {
  const onLine = (q: Vec3, p: Vec3, d: Vec3): Vec3 => v3.add(p, v3.scale(d, v3.dot(v3.sub(q, p), d)));
  if (a.kind === 'point' && b.kind === 'point') return [a.p, b.p];
  if (a.kind === 'point' && b.kind === 'axis') return [a.p, onLine(a.p, b.p, b.dir)];
  if (a.kind === 'axis' && b.kind === 'point') return [onLine(b.p, a.p, a.dir), b.p];
  if (a.kind !== 'axis' || b.kind !== 'axis') return [a.p, b.p];
  const [p, d1, q, d2] = [a.p, a.dir, b.p, b.dir];
  const n = v3.cross(d1, d2);
  if (v3.len(n) < 1e-9) return [p, onLine(p, q, d2)];
  // the common perpendicular of skew lines
  const w = v3.sub(p, q);
  const b1 = v3.dot(d1, d2);
  const d = v3.dot(d1, w);
  const e = v3.dot(d2, w);
  const den = 1 - b1 * b1;
  const s = (b1 * e - d) / den;
  const t = (e - b1 * d) / den;
  return [v3.add(p, v3.scale(d1, s)), v3.add(q, v3.scale(d2, t))];
}

/** Centre to centre: points, a point and an axis, two axes (parallel: their distance; skew: the shortest). */
export function centerDistance(a: Center, b: Center): { value: number; points: [Vec3, Vec3] } {
  const points = closest(a, b);
  return { value: v3.dist(points[0], points[1]), points };
}

/** The acute angle (radians) between two lines, two planes, or a line and a plane. */
export function angleBetween(a: Direction, b: Direction): number {
  const c = Math.min(1, Math.abs(v3.dot(v3.norm(a.dir), v3.norm(b.dir))));
  const between = Math.acos(c);
  // a line and a plane: from the line to the plane, not to its normal
  return a.kind === b.kind ? between : Math.PI / 2 - between;
}
