// Mesh to CAD faces (as converters of STL to STEP do): the triangles of a closed mesh grouped into the faces they
// approximate — planes, and cylinders, cones and spheres the mesh's corners lie on — each with its surface fitted.
// A CAD program's mesh has its corners on the faces it was made of: they are fitted within a small tolerance; a curved
// face is made only of narrow strips around its axis (a hexagonal prism's corners lie on a cylinder as well).

import { perpendicular, v3 } from '../core/math';
import type { Vec3 } from '../core/types';

export type Tri = [number, number, number];

export interface Mesh {
  pts: Vec3[];
  faces: Tri[];
}

export type FitSurface =
  | { kind: 'plane'; normal: Vec3; origin: Vec3 }
  | { kind: 'cylinder'; axis: Vec3; origin: Vec3; radius: number }
  /** Its radius at `origin` (on the axis), growing by `slope` per unit along `axis`. */
  | { kind: 'cone'; axis: Vec3; origin: Vec3; radius: number; slope: number }
  | { kind: 'sphere'; origin: Vec3; radius: number };

export interface MeshRegion {
  /** Its triangles (indices in the mesh). */
  faces: number[];
  surface: FitSurface;
}

/** How far a point lies from a surface. */
export function surfaceDistance(s: FitSurface, p: Vec3): number {
  const d = v3.sub(p, s.origin);
  if (s.kind === 'plane') return Math.abs(v3.dot(d, s.normal));
  if (s.kind === 'sphere') return Math.abs(v3.len(d) - s.radius);
  const t = v3.dot(d, s.axis);
  const rho = v3.len(v3.sub(d, v3.scale(s.axis, t)));
  if (s.kind === 'cylinder') return Math.abs(rho - s.radius);
  return Math.abs(rho - (s.radius + s.slope * t)) / Math.hypot(1, s.slope);
}

// ---------------------------------------------------------------------------
// Small linear algebra
// ---------------------------------------------------------------------------

/** The eigenvectors of a symmetric 3×3 matrix (row by row), the smallest eigenvalue first (Jacobi rotations). */
export function eigen3(m: number[]): { values: number[]; vectors: Vec3[] } {
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off <= 1e-18 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2])) || off === 0) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (a[p][q] === 0) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const kp = a[k][p];
        const kq = a[k][q];
        a[k][p] = c * kp - s * kq;
        a[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = a[p][k];
        const qk = a[q][k];
        a[p][k] = c * pk - s * qk;
        a[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = v[k][p];
        const kq = v[k][q];
        v[k][p] = c * kp - s * kq;
        v[k][q] = s * kp + c * kq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => v3.norm([v[0][i], v[1][i], v[2][i]])) };
}

/** Least squares: the x minimising |A x − b| from the normal equations (AᵀA, Aᵀb); null when singular. */
function solve(ata: number[][], atb: number[]): number[] | null {
  const n = atb.length;
  const m = ata.map((r, i) => [...r, atb[i]]);
  const scale = Math.max(...ata.flat().map(Math.abs)) || 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-13 * scale) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      if (f) for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

/** Accumulates the normal equations of a linear least-squares fit row by row. */
function normalEquations(n: number) {
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);
  return {
    add(row: number[], b: number) {
      for (let i = 0; i < n; i++) {
        atb[i] += row[i] * b;
        for (let j = 0; j < n; j++) ata[i][j] += row[i] * row[j];
      }
    },
    solve: () => solve(ata, atb),
  };
}

// ---------------------------------------------------------------------------
// Fitting surfaces to points (with the normals of the flat pieces they come from)
// ---------------------------------------------------------------------------

/** A flat piece of the mesh: its normal, centre and area. */
interface Piece {
  n: Vec3;
  c: Vec3;
  w: number;
}

const maxDistance = (s: FitSurface, pts: Vec3[]) => pts.reduce((m, p) => Math.max(m, surfaceDistance(s, p)), 0);

/** The points about their centroid, scaled to about unit size (better conditioned fits), and back. */
function frameOf(pts: Vec3[]) {
  const c = v3.scale(pts.reduce((s, p) => v3.add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
  const k = Math.max(...pts.map((p) => v3.dist(p, c))) || 1;
  return { c, k, local: pts.map((p) => v3.scale(v3.sub(p, c), 1 / k)) };
}

/** A cylinder about `axis` through the points: the circle of their projections (algebraic fit). */
function cylinderAbout(axis: Vec3, pts: Vec3[]): FitSurface | null {
  const { c, k, local } = frameOf(pts);
  const e1 = perpendicular(axis);
  const e2 = v3.cross(axis, e1);
  const ne = normalEquations(3);
  for (const p of local) {
    const u = v3.dot(p, e1);
    const v = v3.dot(p, e2);
    ne.add([2 * u, 2 * v, 1], u * u + v * v);
  }
  const x = ne.solve();
  if (!x) return null;
  const r2 = x[2] + x[0] * x[0] + x[1] * x[1];
  if (!(r2 > 0)) return null;
  return { kind: 'cylinder', axis, origin: v3.add(c, v3.scale(v3.add(v3.scale(e1, x[0]), v3.scale(e2, x[1])), k)), radius: Math.sqrt(r2) * k };
}

/**
 * A cone about `axis` through the points: radius² of their projections quadratic along the axis (algebraic fit); the
 * points of a band of strips lie at a few heights only — then a circle at each height, the radius linear through them.
 */
function coneAbout(axis: Vec3, pts: Vec3[]): FitSurface | null {
  const { c, k, local } = frameOf(pts);
  const e1 = perpendicular(axis);
  const e2 = v3.cross(axis, e1);
  const ts = local.map((p) => v3.dot(p, axis));
  const levels: number[] = [];
  for (const t of [...ts].sort((a, b) => a - b)) if (!levels.length || t - levels[levels.length - 1] > 1e-6) levels.push(t);
  if (levels.length < 2) return null;
  let cx: number;
  let cy: number;
  let r0: number;
  let slope: number;
  if (levels.length <= 3) {
    // u² + v² = 2 cx u + 2 cy v + f(level)
    const ne = normalEquations(2 + levels.length);
    local.forEach((p, i) => {
      const u = v3.dot(p, e1);
      const v = v3.dot(p, e2);
      const row = [2 * u, 2 * v, ...levels.map((l) => (Math.abs(ts[i] - l) <= 1e-6 ? 1 : 0))];
      ne.add(row, u * u + v * v);
    });
    const x = ne.solve();
    if (!x) return null;
    [cx, cy] = x;
    const radii = levels.map((_, j) => Math.sqrt(Math.max(0, x[2 + j] + cx * cx + cy * cy)));
    // r = r0 + slope·t through the levels
    const n = levels.length;
    const mt = levels.reduce((s, t) => s + t, 0) / n;
    const mr = radii.reduce((s, r) => s + r, 0) / n;
    const stt = levels.reduce((s, t) => s + (t - mt) ** 2, 0);
    slope = levels.reduce((s, t, j) => s + (t - mt) * (radii[j] - mr), 0) / stt;
    r0 = mr - slope * mt;
  } else {
    const ne = normalEquations(5);
    local.forEach((p, i) => {
      const u = v3.dot(p, e1);
      const v = v3.dot(p, e2);
      const t = ts[i];
      ne.add([2 * u, 2 * v, t * t, t, 1], u * u + v * v);
    });
    const x = ne.solve();
    if (!x || !(x[2] > 1e-6)) return null;
    // r(t) = slope·t + r0: r² = slope² t² + 2 slope r0 t + r0²
    const r0sq = x[4] + x[0] * x[0] + x[1] * x[1];
    if (!(r0sq > 0)) return null;
    [cx, cy] = x;
    r0 = Math.sqrt(r0sq);
    slope = x[3] / (2 * r0);
    if (Math.abs(slope * slope - x[2]) > 0.05 * x[2] + 1e-6) return null;
  }
  if (!(r0 > 0) || !Number.isFinite(slope)) return null;
  return { kind: 'cone', axis, origin: v3.add(c, v3.scale(v3.add(v3.scale(e1, cx), v3.scale(e2, cy)), k)), radius: r0 * k, slope };
}

/** A sphere through the points (algebraic fit). */
function sphereThrough(pts: Vec3[]): FitSurface | null {
  const { c, k, local } = frameOf(pts);
  const ne = normalEquations(4);
  for (const p of local) ne.add([2 * p[0], 2 * p[1], 2 * p[2], 1], v3.dot(p, p));
  const x = ne.solve();
  if (!x) return null;
  const r2 = x[3] + x[0] * x[0] + x[1] * x[1] + x[2] * x[2];
  if (!(r2 > 0)) return null;
  return { kind: 'sphere', origin: v3.add(c, v3.scale([x[0], x[1], x[2]], k)), radius: Math.sqrt(r2) * k };
}

/**
 * The axis of a surface of revolution turned (a pattern search over two small rotations) to bring the points nearest
 * to the surface `about` fits about it.
 */
function refineAxis(axis: Vec3, pts: Vec3[], about: (a: Vec3, p: Vec3[]) => FitSurface | null, good: number): FitSurface | null {
  const score = (s: FitSurface | null) => (s ? maxDistance(s, pts) : Infinity);
  let best = about(axis, pts);
  let bestScore = score(best);
  let a = axis;
  // (to a ten-millionth of a radian — a hundred-thousandth of a millimetre at a hundred; still far off after a few
  // steps: no surface of this kind there, a freeform face)
  for (let step = 2e-2, k = 0; step > 1e-7 && k < 60 && bestScore > good && !(k >= 20 && bestScore > 400 * good); k++) {
    const e1 = perpendicular(a);
    const e2 = v3.cross(a, e1);
    let moved = false;
    for (const [d1, d2] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const cand = v3.norm(v3.add(a, v3.add(v3.scale(e1, d1), v3.scale(e2, d2))));
      const s = about(cand, pts);
      const sc = score(s);
      if (sc < bestScore) {
        best = s;
        bestScore = sc;
        a = cand;
        moved = true;
        break;
      }
    }
    if (!moved) step /= 3;
  }
  return best;
}

/** Normal covariance about the origin (centred: about the mean normal) — the axis is its least direction. */
function normalAxis(pieces: Piece[], centred: boolean): Vec3 {
  let mean: Vec3 = [0, 0, 0];
  let total = 0;
  for (const p of pieces) {
    mean = v3.add(mean, v3.scale(p.n, p.w));
    total += p.w;
  }
  mean = centred ? v3.scale(mean, 1 / total) : [0, 0, 0];
  const m = new Array<number>(9).fill(0);
  for (const p of pieces) {
    const d = v3.sub(p.n, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += p.w * d[i] * d[j];
  }
  return eigen3(m).vectors[0];
}

/** The plane through the points (least squares). */
export function fitPlane(pts: Vec3[]): FitSurface {
  const c = v3.scale(pts.reduce((s, p) => v3.add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
  const m = new Array<number>(9).fill(0);
  for (const p of pts) {
    const d = v3.sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  return { kind: 'plane', normal: eigen3(m).vectors[0], origin: c };
}

/**
 * The surfaces of revolution (cylinder, cone, sphere) through the points within `tol`, the simplest first; none for
 * points of a plane.
 */
export function fitRevolution(pts: Vec3[], pieces: Piece[], tol: number): FitSurface[] {
  return revolutionFits(pts, pieces, tol, []).fits;
}

/**
 * Surfaces of revolution through the points (see fitRevolution); `about`: those about the given axes (a part's own
 * directions: a small patch of a cone lies on a tilted cylinder as well, and its own normals do not show its axis).
 */
function revolutionFits(pts: Vec3[], pieces: Piece[], tol: number, axes: Vec3[]): { fits: FitSurface[]; about: FitSurface[] } {
  if (maxDistance(fitPlane(pts), pts) <= tol) return { fits: [], about: [] };
  const about: FitSurface[] = [];
  for (const a of axes) {
    for (const s of [cylinderAbout(a, pts), coneAbout(a, pts)])
      if (s && maxDistance(s, pts) <= tol && !(s.kind === 'cone' && (Math.abs(s.slope) < 1e-4 || Math.abs(s.slope) > 100)) && pts.length >= 6) about.push(s);
  }
  const fits: FitSurface[] = [];
  // (axes found to a twentieth of the tolerance are close enough)
  const close = tol / 20;
  const cylAxis = normalAxis(pieces, false);
  const cyl = refineAxis(cylAxis, pts, cylinderAbout, close);
  if (cyl) fits.push(cyl);
  const coneAxis = normalAxis(pieces, true);
  const cone = refineAxis(coneAxis, pts, coneAbout, close);
  if (cone) fits.push(cone);
  if (cyl && cyl.kind === 'cylinder') {
    const c2 = refineAxis(cyl.axis, pts, coneAbout, close);
    if (c2) fits.push(c2);
  }
  const sph = sphereThrough(pts);
  if (sph) fits.push(sph);
  // the simplest that fits: a cone of almost no slope is the cylinder; two circles about one axis lie on a sphere as
  // well as on a cone (a chamfer's strips), a sphere's rows of strips on no cone
  const rank = { plane: 0, cylinder: 1, cone: 2, sphere: 3 } as const;
  const extent = Math.max(...pts.map((p) => v3.dist(p, pts[0])));
  // (a sphere or a cone through a handful of points is no evidence of one)
  const enough = { plane: 3, cylinder: 6, cone: 8, sphere: 8 } as const;
  const good = fits.filter(
    (s) =>
      pts.length >= enough[s.kind] &&
      maxDistance(s, pts) <= tol &&
      !(s.kind === 'cone' && (Math.abs(s.slope) < 1e-4 || Math.abs(s.slope) > 100)) &&
      !(s.kind !== 'plane' && s.radius > 1e4 * extent),
  );
  good.sort((a, b) => rank[a.kind] - rank[b.kind]);
  // one of each kind
  return { fits: good.filter((s, i) => good.findIndex((t) => t.kind === s.kind) === i), about };
}

/**
 * How wide a flat piece (its corners) is about the surface: the angle it spans around the axis (a sphere: seen from
 * its centre). A strip of a tessellated curved face is narrow; a polygon prism's side is not.
 */
function span(s: FitSurface, pts: Vec3[]): number {
  if (s.kind === 'plane') return 0;
  if (s.kind === 'sphere') {
    let m = 0;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const a = v3.norm(v3.sub(pts[i], s.origin));
        const b = v3.norm(v3.sub(pts[j], s.origin));
        m = Math.max(m, Math.acos(Math.min(1, Math.max(-1, v3.dot(a, b)))));
      }
    return m;
  }
  const e1 = perpendicular(s.axis);
  const e2 = v3.cross(s.axis, e1);
  const angles: number[] = [];
  for (const p of pts) {
    const d = v3.sub(p, s.origin);
    const t = v3.dot(d, s.axis);
    const q = v3.sub(d, v3.scale(s.axis, t));
    if (v3.len(q) < 1e-9) continue;
    angles.push(Math.atan2(v3.dot(q, e2), v3.dot(q, e1)));
  }
  if (angles.length < 2) return 0;
  // the narrowest arc holding them all: 2π less the widest gap between neighbours
  angles.sort((a, b) => a - b);
  let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  return 2 * Math.PI - gap;
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/** Widest flat piece of a curved face, about its axis. */
const MAX_SPAN = (40 * Math.PI) / 180;
/** Flat pieces of one smooth face meet at less than this. */
const SMOOTH = (40 * Math.PI) / 180;
/** Triangles of one plane: normals within this. */
const COPLANAR = Math.cos((0.25 * Math.PI) / 180);

/**
 * The faces a closed mesh (its triangles `faces`, wound outwards) approximates: its coplanar triangles joined into
 * flat pieces, then (unless not `curved`) neighbouring narrow pieces into cylinders, cones and spheres all their
 * corners lie on (within `tol`); the pieces left are planes. Null: more curved faces than `maxRegions`, or only small
 * patches of them (a freeform shape) — given up.
 */
export function meshRegions(mesh: Mesh, faces: number[], tol: number, curved = true, maxRegions = Infinity): MeshRegion[] | null {
  const { pts } = mesh;
  const n = faces.length;
  const tri = faces.map((f) => mesh.faces[f]);
  const normal: Vec3[] = [];
  const area: number[] = [];
  const centre: Vec3[] = [];
  for (const [a, b, c] of tri) {
    const cr = v3.cross(v3.sub(pts[b], pts[a]), v3.sub(pts[c], pts[a]));
    area.push(v3.len(cr) / 2);
    normal.push(v3.norm(cr));
    centre.push(v3.scale(v3.add(v3.add(pts[a], pts[b]), pts[c]), 1 / 3));
  }
  // neighbours across the edges of two triangles
  const N = pts.length;
  const byEdge = new Map<number, number[]>();
  tri.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const a = f[k];
      const b = f[(k + 1) % 3];
      const key = a < b ? a * N + b : b * N + a;
      const l = byEdge.get(key);
      if (l) l.push(i);
      else byEdge.set(key, [i]);
    }
  });
  const nbrs: number[][] = tri.map(() => []);
  for (const l of byEdge.values())
    if (l.length === 2) {
      nbrs[l[0]].push(l[1]);
      nbrs[l[1]].push(l[0]);
    }

  // flat pieces: coplanar triangles joined
  const pieceOf = new Int32Array(n).fill(-1);
  const pieces: { tris: number[]; n: Vec3; c: Vec3; w: number; corners: number[] }[] = [];
  for (let s = 0; s < n; s++) {
    if (pieceOf[s] >= 0) continue;
    const id = pieces.length;
    const list = [s];
    pieceOf[s] = id;
    for (let q = 0; q < list.length; q++)
      for (const j of nbrs[list[q]]) {
        if (pieceOf[j] >= 0 || v3.dot(normal[j], normal[s]) < COPLANAR) continue;
        if (tri[j].some((p) => Math.abs(v3.dot(v3.sub(pts[p], centre[s]), normal[s])) > tol)) continue;
        pieceOf[j] = id;
        list.push(j);
      }
    let nn: Vec3 = [0, 0, 0];
    let cc: Vec3 = [0, 0, 0];
    let w = 0;
    for (const i of list) {
      nn = v3.add(nn, v3.scale(normal[i], area[i]));
      cc = v3.add(cc, v3.scale(centre[i], area[i]));
      w += area[i];
    }
    pieces.push({ tris: list, n: v3.norm(nn), c: v3.scale(cc, 1 / (w || 1)), w, corners: [...new Set(list.flatMap((i) => tri[i]))] });
  }
  // pieces of one plane apart only by their triangles' normals (slivers turn a little): joined while all their corners
  // lie on one plane to the file's precision (a twentieth of the tolerance: two strips of a curved face bend more), the
  // largest first
  {
    const into = pieces.map((_, i) => i);
    const root = (a: number): number => {
      while (into[a] !== a) a = into[a] = into[into[a]];
      return a;
    };
    const near: Set<number>[] = pieces.map(() => new Set());
    for (let i = 0; i < n; i++) for (const j of nbrs[i]) if (pieceOf[i] !== pieceOf[j]) near[pieceOf[i]].add(pieceOf[j]);
    const byArea = pieces.map((_, i) => i).sort((a, b) => pieces[b].w - pieces[a].w);
    for (const p of byArea) {
      if (root(p) !== p) continue;
      let corners = pieces[p].corners.map((c) => pts[c]);
      let plane = fitPlane(corners);
      const queue = [...near[p]];
      while (queue.length) {
        const q = queue.shift()!;
        if (root(q) !== q || q === p || v3.dot(pieces[q].n, pieces[p].n) < Math.cos((2 * Math.PI) / 180)) continue;
        const more = [...corners, ...pieces[q].corners.map((c) => pts[c])];
        const joined = fitPlane(more);
        if (maxDistance(joined, more) > tol / 20) continue;
        into[q] = p;
        corners = more;
        plane = joined;
        queue.push(...near[q]);
      }
      if (plane.kind === 'plane' && corners.length > pieces[p].corners.length) {
        const n0 = v3.dot(plane.normal, pieces[p].n) < 0 ? v3.neg(plane.normal) : plane.normal;
        pieces[p].n = n0;
      }
    }
    // the pieces joined: their triangles in the piece they joined
    const merged = new Map<number, number>();
    const kept: typeof pieces = [];
    pieces.forEach((pc, i) => {
      if (root(i) !== i) return;
      merged.set(i, kept.length);
      kept.push({ ...pc, tris: [], corners: [] });
    });
    pieces.forEach((pc, i) => {
      const k = merged.get(root(i))!;
      kept[k].tris.push(...pc.tris);
    });
    kept.forEach((pc, k) => {
      pc.corners = [...new Set(pc.tris.flatMap((t) => tri[t]))];
      let cc: Vec3 = [0, 0, 0];
      let w = 0;
      for (const t of pc.tris) {
        cc = v3.add(cc, v3.scale(centre[t], area[t]));
        w += area[t];
      }
      pc.c = v3.scale(cc, 1 / (w || 1));
      pc.w = w;
      for (const t of pc.tris) pieceOf[t] = k;
    });
    pieces.length = 0;
    pieces.push(...kept);
  }
  const touching: Set<number>[] = pieces.map(() => new Set());
  for (let i = 0; i < n; i++) for (const j of nbrs[i]) if (pieceOf[i] !== pieceOf[j]) touching[pieceOf[i]].add(pieceOf[j]);
  const smooth = (a: number, b: number) => v3.dot(pieces[a].n, pieces[b].n) >= Math.cos(SMOOTH);

  // curved faces grown from narrow pieces
  const regionOf = new Int32Array(pieces.length).fill(-1);
  const regions: MeshRegion[] = [];
  const spanOf = (s: FitSurface, p: number) => span(s, pieces[p].corners.map((c) => pts[c]));
  const fitsAll = (s: FitSurface, ids: number[]) => ids.every((p) => pieces[p].corners.every((c) => surfaceDistance(s, pts[c]) <= tol) && spanOf(s, p) <= MAX_SPAN);
  // the part's own directions: its largest planes' normals, then the axes of the faces found
  // (a dozen at most: each fit tries them all)
  const known: Vec3[] = [];
  const addKnown = (d: Vec3) => {
    if (known.length < 12 && !known.some((k) => Math.abs(v3.dot(k, d)) > 1 - 1e-6)) known.push(d);
  };
  const totalArea = pieces.reduce((s, p) => s + p.w, 0);
  for (const p of [...pieces].sort((a, b) => b.w - a.w).slice(0, 8)) if (p.w >= 0.01 * totalArea) addKnown(p.n);
  const fitsOf = (ids: number[]) =>
    revolutionFits(
      [...new Set(ids.flatMap((p) => pieces[p].corners))].map((c) => pts[c]),
      ids.map((p) => pieces[p]),
      tol,
      known,
    );
  // surfaces about a known axis: refitted about it as they grow
  const aboutKnown = new Set<FitSurface>();
  const fit = (ids: number[], like: FitSurface): FitSurface | undefined => {
    if (aboutKnown.has(like) && like.kind !== 'plane' && like.kind !== 'sphere') {
      const c = [...new Set(ids.flatMap((p) => pieces[p].corners))].map((i) => pts[i]);
      const t = like.kind === 'cylinder' ? cylinderAbout(like.axis, c) : coneAbout(like.axis, c);
      if (t) aboutKnown.add(t);
      return t ?? undefined;
    }
    return fitsOf(ids).fits.find((x) => x.kind === like.kind);
  };
  const free = (p: number) => regionOf[p] < 0;
  // a tessellated face's strips are about as wide as each other: a plane tangent to it is not one of them (with its
  // neighbouring strips it lies on some huge cylinder)
  const STRIPS = 3;
  const MIN_SPAN = (1 * Math.PI) / 180;
  const grow = (seed: number[], surface: FitSurface): { ids: number[]; surface: FitSurface; area: number } | null => {
    const ids = [...seed];
    const inside = new Set(ids);
    let s = surface;
    let widest = Math.max(...ids.map((p) => spanOf(s, p)));
    let refitAt = ids.length * 2;
    const queue = ids.flatMap((p) => [...touching[p]]);
    while (queue.length) {
      const g = queue.shift()!;
      if (inside.has(g) || !free(g) || ![...touching[g]].some((h) => inside.has(h) && smooth(g, h))) continue;
      if (!fitsAll(s, [g])) continue;
      const w = spanOf(s, g);
      if (w > Math.max(STRIPS * widest, MIN_SPAN)) continue;
      widest = Math.max(widest, w);
      ids.push(g);
      inside.add(g);
      queue.push(...touching[g]);
      if (ids.length >= refitAt) {
        const t = fit(ids, s);
        if (t && fitsAll(t, ids)) s = t;
        refitAt = Math.ceil(ids.length * 1.5);
      }
    }
    const t = fit(ids, s);
    if (t && fitsAll(t, ids)) s = t;
    return ids.length >= 3 && fitsAll(s, ids) ? { ids, surface: s, area: ids.reduce((sum, p) => sum + pieces[p].w, 0) } : null;
  };
  const cornersOf = (ids: number[]) => [...new Set(ids.flatMap((p) => pieces[p].corners))].map((c) => pts[c]);
  /**
   * A seed for a curved face: neighbouring pieces of about the same size, from `p` on both ways, until they bend away
   * from a plane by more than the tolerance (fine strips: many of them).
   */
  const seedFrom = (p: number): number[] | null => {
    const ids = [p];
    const inside = new Set(ids);
    let least = pieces[p].w;
    let most = pieces[p].w;
    for (let k = 0; ids.length < 96; k++) {
      if (ids.length >= 3) {
        const c = cornersOf(ids);
        if (maxDistance(fitPlane(c), c) > tol) return ids;
      }
      // the next: off either end (the newest first), a free smooth neighbour of similar size
      const ends = [ids[ids.length - 1], ids[0]];
      let next = -1;
      for (const e of ends) {
        for (const q of touching[e]) {
          if (inside.has(q) || !free(q) || !smooth(e, q)) continue;
          if (pieces[q].w > 8 * most || pieces[q].w < least / 8) continue;
          next = q;
          break;
        }
        if (next >= 0) {
          if (e === ids[0] && ids.length > 1) ids.unshift(next);
          else ids.push(next);
          break;
        }
      }
      if (next < 0) return null;
      inside.add(next);
      least = Math.min(least, pieces[next].w);
      most = Math.max(most, pieces[next].w);
    }
    return null;
  };
  // narrow pieces first (a curved face's strips are smaller than the planes beside them); large faces first (a few
  // triangles at a sphere's pole lie on some cylinder too: they would keep the sphere from growing over them), then
  // the rest
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].w - pieces[b].w);
  // pieces of a seed that grew nothing start no other (a freeform face's every piece would try again)
  const tried = new Uint8Array(pieces.length);
  let covered = 0;
  for (const least of curved ? [16, 3] : []) {
    for (const p of order) {
      if (!free(p) || tried[p]) continue;
      const seed = seedFrom(p);
      if (!seed) {
        if (least === 3) tried[p] = 1;
        continue;
      }
      // each surface that fits the seed grown: the one that covers most (a cone's patch lies on a tilted cylinder too);
      // about the part's own directions when it covers about as much
      const { fits, about } = fitsOf(seed);
      for (const s of about) aboutKnown.add(s);
      const grown: { ids: number[]; surface: FitSurface; area: number; known: boolean }[] = [];
      for (const s of [...about, ...fits]) {
        if (!fitsAll(s, seed)) continue;
        const spans = seed.map((q) => spanOf(s, q));
        if (Math.max(...spans) > Math.max(STRIPS * Math.min(...spans), MIN_SPAN)) continue;
        const g = grow(seed, s);
        if (g && g.ids.length >= least) grown.push({ ...g, known: aboutKnown.has(s) });
      }
      const most = grown.reduce((m, g) => Math.max(m, g.area), 0);
      const found = grown.find((g) => g.known && g.area >= 0.95 * most) ?? grown.find((g) => g.area >= most * (1 - 1e-9));
      if (!found) {
        if (least === 3) for (const q of seed) tried[q] = 1;
        continue;
      }
      for (const q of found.ids) regionOf[q] = regions.length;
      regions.push({ faces: found.ids.flatMap((q) => pieces[q].tris.map((i) => faces[i])), surface: found.surface });
      if ((found.surface.kind === 'cylinder' || found.surface.kind === 'cone') && found.ids.length >= 16) addKnown(found.surface.axis);
      // past the most faces a result is taken with, it is not taken: no use going on; nor where only small patches are
      // found (a freeform face lies on some cylinder or cone a few pieces at a time)
      covered += found.ids.length;
      if (regions.length > maxRegions || (regions.length >= 200 && covered < 8 * regions.length)) return null;
    }
  }
  // the rest: planes
  pieces.forEach((pc, i) => {
    if (regionOf[i] >= 0) return;
    regions.push({ faces: pc.tris.map((t) => faces[t]), surface: { kind: 'plane', normal: pc.n, origin: pc.c } });
  });
  return regularized(mesh, regions, tol);
}

/** Directions apart by less than this (radians) are one: a part's faces are square to each other, its holes too. */
const SAME_DIRECTION = 1e-4;

/**
 * The regions' surfaces with their directions (planes' normals, axes) made exactly the same where they nearly are —
 * the world's axes where near them: a hole's axis square to its ends, so that their circle lies on both (fitted to
 * the file's precision they cross a little askew, and OpenCascade's edges are checked to 1e-7). Surfaces that would
 * then miss their corners keep their own.
 */
export function regularized(mesh: Mesh, regions: MeshRegion[], tol: number): MeshRegion[] {
  const cos = Math.cos(SAME_DIRECTION);
  const dirOf = (s: FitSurface): Vec3 | null => (s.kind === 'plane' ? s.normal : s.kind === 'sphere' ? null : s.axis);
  const area = (r: MeshRegion) =>
    r.faces.reduce((sum, f) => {
      const [a, b, c] = mesh.faces[f].map((i) => mesh.pts[i]);
      return sum + v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2;
    }, 0);
  // the directions in groups (the larger regions first set them), each as the world's axis it is near or as its mean
  const groups: { dir: Vec3; sum: Vec3 }[] = [];
  const world: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const order = regions.map((r, i) => ({ i, w: area(r) })).sort((a, b) => b.w - a.w);
  const groupOf = new Map<number, number>();
  for (const { i, w } of order) {
    const d = dirOf(regions[i].surface);
    if (!d) continue;
    let g = groups.findIndex((x) => Math.abs(v3.dot(x.dir, d)) >= cos);
    if (g < 0) {
      groups.push({ dir: d, sum: [0, 0, 0] });
      g = groups.length - 1;
    }
    const grp = groups[g];
    grp.sum = v3.add(grp.sum, v3.scale(d, (v3.dot(d, grp.dir) >= 0 ? 1 : -1) * w));
    groupOf.set(i, g);
  }
  for (const g of groups) {
    const mean = v3.norm(g.sum);
    g.dir = world.find((e) => Math.abs(v3.dot(e, mean)) >= cos) ?? mean;
  }
  const cornersOf = (r: MeshRegion) => [...new Set(r.faces.flatMap((f) => mesh.faces[f]))].map((c) => mesh.pts[c]);
  const directed = regions.map((r, i) => {
    const g = groupOf.get(i);
    const s = r.surface;
    const d = dirOf(s);
    if (g === undefined || !d) return r;
    const dir = v3.dot(groups[g].dir, d) >= 0 ? groups[g].dir : v3.neg(groups[g].dir);
    const corners = cornersOf(r);
    let t: FitSurface | null;
    if (s.kind === 'plane') t = { kind: 'plane', normal: dir, origin: s.origin };
    else if (s.kind === 'cylinder') t = cylinderAbout(dir, corners);
    else t = coneAbout(dir, corners);
    return t && t.kind === s.kind && maxDistance(t, corners) <= tol ? { faces: r.faces, surface: t } : r;
  });
  // turned faces about nearly one line about exactly one (a countersink's cone and its hole meet in a circle on both),
  // spheres centred near it centred on it
  const lines: { dir: Vec3; point: Vec3 }[] = [];
  const offLine = (p: Vec3, l: { dir: Vec3; point: Vec3 }) => {
    const d = v3.sub(p, l.point);
    return v3.len(v3.sub(d, v3.scale(l.dir, v3.dot(d, l.dir))));
  };
  const byArea = regions.map((r, i) => ({ i, w: area(r) })).sort((a, b) => b.w - a.w);
  for (const { i } of byArea) {
    const s = directed[i].surface;
    if ((s.kind === 'cylinder' || s.kind === 'cone') && !lines.some((l) => Math.abs(v3.dot(l.dir, s.axis)) >= cos && offLine(s.origin, l) <= tol)) lines.push({ dir: s.axis, point: s.origin });
  }
  return directed.map((r) => {
    const s = r.surface;
    if (s.kind === 'plane') return r;
    const centre = s.origin;
    const line = lines.find((l) => (s.kind === 'sphere' || Math.abs(v3.dot(l.dir, s.axis)) >= cos) && offLine(centre, l) <= tol);
    if (!line) return r;
    const corners = cornersOf(r);
    // along the line from its point: t; off it: ρ
    const tOf = (p: Vec3) => v3.dot(v3.sub(p, line.point), line.dir);
    const rhoOf = (p: Vec3) => offLine(p, line);
    let t: FitSurface;
    if (s.kind === 'sphere') {
      const c = v3.add(line.point, v3.scale(line.dir, tOf(centre)));
      t = { kind: 'sphere', origin: c, radius: corners.reduce((sum, p) => sum + v3.dist(p, c), 0) / corners.length };
    } else {
      const axis = v3.dot(line.dir, s.axis) >= 0 ? line.dir : v3.neg(line.dir);
      const ts = corners.map((p) => v3.dot(v3.sub(p, line.point), axis));
      const rs = corners.map(rhoOf);
      const mt = ts.reduce((a, b) => a + b, 0) / ts.length;
      const mr = rs.reduce((a, b) => a + b, 0) / rs.length;
      const origin = v3.add(line.point, v3.scale(axis, mt));
      if (s.kind === 'cylinder') t = { kind: 'cylinder', axis, origin, radius: mr };
      else {
        const stt = ts.reduce((a, x) => a + (x - mt) ** 2, 0);
        const slope = stt > 0 ? ts.reduce((a, x, k) => a + (x - mt) * (rs[k] - mr), 0) / stt : s.slope;
        t = { kind: 'cone', axis, origin, radius: mr, slope };
      }
    }
    return maxDistance(t, corners) <= tol ? { faces: r.faces, surface: t } : r;
  });
}
