// Measuring an STL file shown as meshes (the embedded viewer has no solids of it): as the kernel measures solids,
// but from the triangles — a body (its one face): area and, closed, volume; an edge of the shape (a polyline):
// length, and when its points lie on a circle (a hole's rim) — radius, diameter and centre; a corner: its point.
// Two of them: the minimum distance (exact between points and segments, between a point or a segment and
// triangles; between two bodies — from their corners to the other's triangles), the maximum one, centre to centre,
// the angle between straight edges and circles' planes.

import type { SelRef, Vec3 } from '../core/types';
import type { MeasureResult, PartMesh } from '../kernel/protocol';

export type Measured = Omit<MeasureResult, 'type' | 'reqId'>;
type Item = Measured['items'][number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};

/** A circle through points (a hole's rim): its centre, radius and the normal of its plane. */
export interface Circle {
  center: Vec3;
  radius: number;
  normal: Vec3;
}

/**
 * The circle the points of a polyline lie on, if they do: at least 5 distinct points in a plane, each as far from
 * the centre as the others (to `tol`, and to a hundredth of the radius) — a straight line is no circle.
 */
export function fitCircle(points: Vec3[], tol: number): Circle | null {
  const pts = points.length > 1 && dist(points[0], points[points.length - 1]) <= tol ? points.slice(0, -1) : points;
  if (pts.length < 5) return null;
  const c = scale(pts.reduce(add, [0, 0, 0] as Vec3), 1 / pts.length);
  // the plane's normal: the turns of the polygon about its centroid (Newell)
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) n = add(n, cross(sub(pts[i], c), sub(pts[(i + 1) % pts.length], c)));
  if (len(n) < 1e-12) return null;
  n = norm(n);
  if (pts.some((p) => Math.abs(dot(sub(p, c), n)) > tol)) return null;
  // in the plane: x² + y² + Dx + Ey + F = 0 by least squares (Kåsa)
  const u = norm(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
  const v = cross(n, u);
  const xy = pts.map((p) => [dot(sub(p, c), u), dot(sub(p, c), v)]);
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const r = [0, 0, 0];
  for (const [x, y] of xy) {
    const row = [x, y, 1];
    const rhs = -(x * x + y * y);
    for (let i = 0; i < 3; i++) {
      r[i] += row[i] * rhs;
      for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j];
    }
  }
  const s = solve3(m, r);
  if (!s) return null;
  const [D, E, F] = s;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  if (xy.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - radius) > Math.max(tol, radius * 0.01))) return null;
  return { center: add(c, add(scale(u, cx), scale(v, cy))), radius, normal: n };
}

/** A 3 × 3 linear system (Cramer); null when it is singular. */
function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  const col = (k: number) => m.map((row, i) => row.map((x, j) => (j === k ? r[i] : x)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/** The nearest points of two segments (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentSegment(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): [Vec3, Vec3] {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  let s: number;
  let t: number;
  if (a <= 1e-18 && e <= 1e-18) return [p1, p2];
  if (a <= 1e-18) {
    s = 0;
    t = clamp(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-18) {
      t = 0;
      s = clamp(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-18 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  return [add(p1, scale(d1, s)), add(p2, scale(d2, t))];
}

/** The point of a triangle nearest to `p` (Ericson 5.1.5). */
export function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const den = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * den), scale(ac, vc * den)));
}

/** A selection on the meshes, as measuring needs it. */
interface Entity {
  kind: 'body' | 'edge' | 'point';
  /** Its points (a body: its corners or, without them, its mesh's vertices; thinned for the maximum distance). */
  points: Vec3[];
  /** An edge's segments (a point: one of zero length). */
  segments: [Vec3, Vec3][];
  /** A body's triangles (9 coordinates each) and the segments of its edges. */
  triangles?: Float32Array;
  crease?: [Vec3, Vec3][];
  length?: number;
  area?: number;
  volume?: number;
  circle?: Circle;
  /** A straight edge's direction. */
  dir?: Vec3;
  point?: Vec3;
}

const at = (a: ArrayLike<number>, i: number): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

function bodyEntity(p: PartMesh): Entity {
  const t = p.positions;
  let area = 0;
  let volume = 0;
  for (let i = 0; i < t.length; i += 9) {
    const a = at(t, i / 3);
    const b = at(t, i / 3 + 1);
    const c = at(t, i / 3 + 2);
    area += len(cross(sub(b, a), sub(c, a))) / 2;
    volume += dot(a, cross(b, c)) / 6;
  }
  const corners = Array.from({ length: p.vertices.length / 3 }, (_, i) => at(p.vertices, i));
  // no corners (a smooth body): its mesh's vertices, thinned
  const n = t.length / 3;
  const step = Math.max(1, n / 3000);
  const mesh = Array.from({ length: Math.min(n, 3000) }, (_, i) => at(t, Math.floor(i * step)));
  const crease: [Vec3, Vec3][] = [];
  for (let e = 0; e < p.edgeRanges.length / 2; e++)
    for (let k = 1; k < p.edgeRanges[e * 2 + 1]; k++) crease.push([at(p.edgePositions, p.edgeRanges[e * 2] + k - 1), at(p.edgePositions, p.edgeRanges[e * 2] + k)]);
  return { kind: 'body', points: corners.length ? corners : mesh, segments: [], crease, triangles: t, area, ...(p.surface ? {} : { volume: Math.abs(volume) }) };
}

function edgeEntity(p: PartMesh, index: number, tol: number): Entity | null {
  if (index >= p.edgeRanges.length / 2) return null;
  const s = p.edgeRanges[index * 2];
  const n = p.edgeRanges[index * 2 + 1];
  const points = Array.from({ length: n }, (_, k) => at(p.edgePositions, s + k));
  const segments: [Vec3, Vec3][] = [];
  let length = 0;
  for (let k = 1; k < n; k++) {
    segments.push([points[k - 1], points[k]]);
    length += dist(points[k - 1], points[k]);
  }
  if (!segments.length) return null;
  const chord = sub(points[n - 1], points[0]);
  const straight = len(chord) > tol && points.every((q) => len(cross(sub(q, points[0]), norm(chord))) <= tol);
  const circle = straight ? null : fitCircle(points, tol);
  return { kind: 'edge', points, segments, length, ...(straight ? { dir: norm(chord) } : {}), ...(circle ? { circle } : {}) };
}

/** Evenly thinned to at most `cap` items. */
function thin<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const k = items.length / cap;
  return Array.from({ length: cap }, (_, i) => items[Math.floor(i * k)]);
}

/** The nearest points of a point and a body (over its triangles). */
function nearestOnTriangles(p: Vec3, t: Float32Array, best: { d: number; pts: [Vec3, Vec3] | null }, swap: boolean) {
  for (let i = 0; i < t.length; i += 9) {
    const q = pointTriangle(p, at(t, i / 3), at(t, i / 3 + 1), at(t, i / 3 + 2));
    const d = dist(p, q);
    if (d < best.d) {
      best.d = d;
      best.pts = swap ? [q, p] : [p, q];
    }
  }
}

/** Of the work for the minimum distance: point–triangle and segment–segment pairs at most (a moment's count). */
const BUDGET = 3e7;

/**
 * The minimum distance between two selections and its points: between their segments (edges; a body's edges; a
 * point — one of zero length), and from the points of each to the other's triangles (a body's points: its corners).
 */
function minimum(a: Entity, b: Entity): { value: number; points: [Vec3, Vec3] } | null {
  const best: { d: number; pts: [Vec3, Vec3] | null } = { d: Infinity, pts: null };
  const segsOf = (e: Entity): [Vec3, Vec3][] => (e.segments.length ? e.segments : e.crease?.length ? e.crease : e.points.map((p) => [p, p]));
  const sa = segsOf(a);
  const sb = segsOf(b);
  if (sa.length * sb.length <= BUDGET)
    for (const [p1, q1] of sa)
      for (const [p2, q2] of sb) {
        const [x, y] = segmentSegment(p1, q1, p2, q2);
        const d = dist(x, y);
        if (d < best.d) [best.d, best.pts] = [d, [x, y]];
      }
  const toTriangles = (from: Entity, body: Entity, swap: boolean) => {
    const pts = thin(from.points, Math.max(16, Math.floor(BUDGET / (body.triangles!.length / 9))));
    for (const p of pts) nearestOnTriangles(p, body.triangles!, best, swap);
  };
  if (b.triangles) toTriangles(a, b, false);
  if (a.triangles) toTriangles(b, a, true);
  return best.pts ? { value: best.d, points: best.pts } : null;
}

/** The farthest pair of their points (thinned). */
function maximum(a: Entity, b: Entity): { value: number; points: [Vec3, Vec3] } | null {
  const pa = thin(a.points, 2500);
  const pb = thin(b.points, 2500);
  let best = -1;
  let points: [Vec3, Vec3] | null = null;
  for (const p of pa)
    for (const q of pb) {
      const d = dist(p, q);
      if (d > best) [best, points] = [d, [p, q]];
    }
  return points ? { value: best, points } : null;
}

/** The size of the parts shown (their bounding box). */
function partsBox(parts: PartMesh[]): [Vec3, Vec3] | null {
  const shown = parts.filter((p) => !p.hidden);
  if (!shown.length) return null;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of shown)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p.bbox[0][k]);
      hi[k] = Math.max(hi[k], p.bbox[1][k]);
    }
  return [lo, hi];
}

/** The overall size of the model (nothing selected): along X, Y and Z. */
export function overallSize(parts: PartMesh[]): Measured {
  const box = partsBox(parts);
  if (!box) return { items: [] };
  const [lo, hi] = box;
  return {
    items: [
      { label: 'ΔX', value: hi[0] - lo[0], kind: 'length' },
      { label: 'ΔY', value: hi[1] - lo[1], kind: 'length' },
      { label: 'ΔZ', value: hi[2] - lo[2], kind: 'length' },
    ],
  };
}

/** Measure selections on STL meshes (`parts`: the meshes shown). */
export function measureMesh(refs: SelRef[], parts: PartMesh[]): Measured {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const box = partsBox(parts);
  // points of a file closer than this are one (its coordinates are 32-bit floats)
  const tol = box ? Math.max(1e-6, dist(box[0], box[1]) * 1e-5) : 1e-6;
  const entities: Entity[] = [];
  for (const r of refs) {
    if (r.kind === 'origin') entities.push({ kind: 'point', points: [[0, 0, 0]], segments: [], point: [0, 0, 0] });
    if (r.kind !== 'face' && r.kind !== 'edge' && r.kind !== 'vertex') continue;
    const p = byId.get(r.partId);
    if (!p) continue;
    if (r.kind === 'face') entities.push(bodyEntity(p));
    else if (r.kind === 'edge') {
      const e = edgeEntity(p, r.index, tol);
      if (e) entities.push(e);
    } else if (r.index < p.vertices.length / 3) {
      const q = at(p.vertices, r.index);
      entities.push({ kind: 'point', points: [q], segments: [], point: q });
    }
  }
  const items: Item[] = [];
  const lines: NonNullable<Measured['lines']> = [];
  let points: [Vec3, Vec3] | undefined;
  if (entities.length === 1) {
    const [e] = entities;
    if (e.kind === 'body') {
      items.push({ label: 'Area', value: e.area!, kind: 'area' });
      if (e.volume !== undefined) items.push({ label: 'Volume', value: e.volume, kind: 'volume' });
    } else if (e.kind === 'edge') {
      items.push({ label: 'Length', value: e.length!, kind: 'length' });
      if (e.circle) {
        items.push({ label: 'Radius', value: e.circle.radius, kind: 'length' });
        items.push({ label: 'Diameter', value: e.circle.radius * 2, kind: 'length' });
      }
    } else {
      items.push({ label: 'X', value: e.point![0], kind: 'length' }, { label: 'Y', value: e.point![1], kind: 'length' }, { label: 'Z', value: e.point![2], kind: 'length' });
    }
  }
  if (entities.length === 2) {
    const [a, b] = entities;
    const near = minimum(a, b);
    if (near) {
      points = near.points;
      items.push({ label: 'Minimum distance', value: near.value, kind: 'length', line: 'min' });
      lines.push({ key: 'min', points: near.points });
      const d = sub(near.points[1], near.points[0]);
      items.push({ label: 'ΔX', value: Math.abs(d[0]), kind: 'length' }, { label: 'ΔY', value: Math.abs(d[1]), kind: 'length' }, { label: 'ΔZ', value: Math.abs(d[2]), kind: 'length' });
    }
    const far = maximum(a, b);
    if (far && far.value > (near?.value ?? 0) + 1e-9) {
      items.push({ label: 'Maximum distance', value: far.value, kind: 'length', line: 'max' });
      lines.push({ key: 'max', points: far.points });
    }
    // centre to centre: of circles and points — when one of them is a circle (two corners: the minimum is that)
    const center = (e: Entity) => e.circle?.center ?? e.point;
    const ca = center(a);
    const cb = center(b);
    if (ca && cb && (a.circle || b.circle)) {
      items.push({ label: 'Center to center', value: dist(ca, cb), kind: 'length', line: 'center' });
      lines.push({ key: 'center', points: [ca, cb] });
    }
    // the angle: between lines (straight edges) and planes (of circles), the acute one; a line and a plane — to the plane
    const dir = (e: Entity) => (e.dir ? { kind: 'line', dir: e.dir } : e.circle ? { kind: 'plane', dir: e.circle.normal } : null);
    const da = dir(a);
    const db = dir(b);
    if (da && db) {
      const between = Math.acos(Math.min(1, Math.abs(dot(da.dir, db.dir))));
      items.push({ label: 'Angle', value: da.kind === db.kind ? between : Math.PI / 2 - between, kind: 'angle' });
    }
  }
  if (entities.length > 1 && entities.every((e) => e.kind === 'edge')) items.push({ label: 'Total length', value: entities.reduce((s, e) => s + e.length!, 0), kind: 'length' });
  if (entities.length > 1 && entities.every((e) => e.kind === 'body')) items.push({ label: 'Total area', value: entities.reduce((s, e) => s + e.area!, 0), kind: 'area' });
  return { items, ...(points ? { points } : {}), ...(lines.length ? { lines } : {}) };
}
