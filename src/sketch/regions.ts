// Closed regions of a sketch (Onshape-like): every bounded area enclosed by sketch curves.
//
// Planar arrangement: curves are split at all mutual intersections / touching end points,
// pieces become edges of a half-edge graph with merged vertices, dangling edges and bridges
// are removed, faces are traced from the angular order of half-edges around every vertex and
// connected components are nested so that inner components become holes.

import type { RegionKey, SkEntity, Vec2 } from '../core/types';
import {
  TAU,
  cross,
  dist,
  entityMap,
  entityPrim,
  intersectPrims,
  mod,
  pointInPolygon,
  pointOf,
  primArea,
  primBBox,
  primClosed,
  primCurvature,
  primDeriv,
  primEval,
  primProject,
  primRange,
  primSampleRange,
  primSelfHits,
  sub,
} from './curves';
import type { BBox, Prim } from './curves';

export type ProfileCurve =
  | { kind: 'line'; ent: string; a: Vec2; b: Vec2 }
  | { kind: 'arc'; ent: string; c: Vec2; r: number; start: Vec2; end: Vec2; ccw: boolean } // oriented along the loop
  | { kind: 'circle'; ent: string; c: Vec2; r: number } // full circle, alone in its loop
  | { kind: 'ellipse'; ent: string; c: Vec2; rx: number; ry: number; rot: number } // full ellipse, alone in its loop
  | {
      kind: 'ellipseArc';
      ent: string;
      c: Vec2;
      rx: number;
      ry: number;
      rot: number;
      /** Ellipse parameters (P(t) = c + R(rot)(rx cos t, ry sin t)) at start / end; t1 > t0 iff ccw. */
      t0: number;
      t1: number;
      ccw: boolean;
      start: Vec2;
      end: Vec2;
    }
  | { kind: 'spline'; ent: string; pts: Vec2[] }; // oriented dense polyline of (a piece of) a spline, first/last = piece ends

export interface ProfileLoop {
  curves: ProfileCurve[];
  /** Signed area, > 0 = CCW. */
  area: number;
}

export interface SketchRegion {
  /** ents: sorted unique entity ids of all bounding curves (outer + holes); pt: a point strictly inside. */
  key: RegionKey;
  /** CCW */
  outer: ProfileLoop;
  /** CW */
  holes: ProfileLoop[];
  /** Positive, outer minus holes. */
  area: number;
  centroid: Vec2;
  /** Outer boundary polyline (CCW, not repeating the first point). */
  polygon: Vec2[];
  holePolygons: Vec2[][];
}

/** Angular resolution of region polygons (3°). */
const POLY_STEP = Math.PI / 60;
/** Outgoing tangents closer than this (radians) are considered tangent and ordered by curvature. */
const ANG_TOL = 1e-6;

interface Curve {
  ent: string;
  prim: Prim;
  closed: boolean;
  lo: number;
  hi: number;
  period: number;
  bbox: BBox;
  pids: [string, string] | null;
}

interface Split {
  t: number;
  node: number;
  end: boolean;
}

interface Edge {
  ci: number;
  tA: number;
  tB: number;
  v0: number;
  v1: number;
  /** Exact signed area contribution of the forward half-edge (incl. tiny gaps to the vertex positions). */
  area: number;
  alive: boolean;
}

interface Loop {
  hes: number[];
  area: number;
  poly: Vec2[];
  bbox: BBox;
}

interface Face {
  comp: number;
  outer: Loop;
  holes: Loop[];
}

interface Run {
  ci: number;
  tA: number;
  tB: number;
  rev: boolean;
  vs: number;
  ve: number;
}

function bboxOverlap(a: BBox, b: BBox, m: number): boolean {
  return a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;
}

function bboxHas(b: BBox, p: Vec2, m: number): boolean {
  return p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m;
}

function polyBBox(poly: Vec2[]): BBox {
  const bb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const v of poly) {
    if (v[0] < bb[0]) bb[0] = v[0];
    if (v[1] < bb[1]) bb[1] = v[1];
    if (v[0] > bb[2]) bb[2] = v[0];
    if (v[1] > bb[3]) bb[3] = v[1];
  }
  return bb;
}

/** Sorts outgoing half-edges CCW by tangent angle; (near) tangent ones by signed curvature. */
function sortAround(l: number[], th: Float64Array, k: Float64Array): void {
  const n = l.length;
  if (n < 2) return;
  l.sort((a, b) => th[a] - th[b] || a - b);
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (mod(th[l[i]] - th[l[(i - 1 + n) % n]], TAU) > ANG_TOL) {
      start = i;
      break;
    }
  }
  const byK = (a: number, b: number) => k[a] - k[b] || a - b;
  if (start < 0) {
    l.sort(byK);
    return;
  }
  const r = l.slice(start).concat(l.slice(0, start));
  const out: number[] = [];
  let cl: number[] = [r[0]];
  const flush = () => {
    if (cl.length > 1) cl.sort(byK);
    for (const h of cl) out.push(h);
  };
  for (let i = 1; i < n; i++) {
    if (mod(th[r[i]] - th[r[i - 1]], TAU) <= ANG_TOL) cl.push(r[i]);
    else {
      flush();
      cl = [r[i]];
    }
  }
  flush();
  for (let i = 0; i < n; i++) l[i] = out[i];
}

function polyCentroid(rings: Vec2[][]): Vec2 {
  const o = rings[0][0];
  let A = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = sub(ring[i], o);
      const q = sub(ring[(i + 1) % ring.length], o);
      const c = cross(p, q);
      A += c;
      cx += (p[0] + q[0]) * c;
      cy += (p[1] + q[1]) * c;
      sx += p[0];
      sy += p[1];
      cnt++;
    }
  }
  if (Math.abs(A) < 1e-300) return [o[0] + sx / cnt, o[1] + sy / cnt];
  return [o[0] + cx / (3 * A), o[1] + cy / (3 * A)];
}

/** Sorted y coordinates where the vertical line x = v crosses the rings. */
function verticalCrossings(rings: Vec2[][], v: number): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[0] > v !== b[0] > v) out.push(a[1] + ((v - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
    }
  }
  return out.sort((x, y) => x - y);
}

/** A point well inside a polygon with holes (scanline search for the widest interior span). */
function interiorPoint(outer: Vec2[], holes: Vec2[][], bb: BBox): Vec2 | null {
  const rings = [outer, ...holes];
  const H = bb[3] - bb[1];
  if (!(H > 0)) return null;
  const N = 9;
  const lines: number[] = [];
  const xs: number[][] = [];
  for (let k = 0; k < N; k++) {
    lines.push(bb[1] + (H * (k + 0.5 + 0.0137 * ((k % 3) - 1))) / N);
    xs.push([]);
  }
  // all horizontal scanlines in one pass over the edges
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      const lo = Math.min(a[1], b[1]);
      const hi = Math.max(a[1], b[1]);
      const k0 = Math.max(0, Math.floor(((lo - bb[1]) / H) * N) - 1);
      const k1 = Math.min(N - 1, Math.ceil(((hi - bb[1]) / H) * N) + 1);
      for (let k = k0; k <= k1; k++) {
        const y = lines[k];
        if (a[1] > y !== b[1] > y) xs[k].push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
  }
  // horizontal spans [width, x mid, y]
  const spans: [number, number, number][] = [];
  for (let k = 0; k < N; k++) {
    const row = xs[k].sort((p, q) => p - q);
    for (let j = 0; j + 1 < row.length; j += 2) spans.push([row[j + 1] - row[j], (row[j] + row[j + 1]) / 2, lines[k]]);
  }
  spans.sort((a, b) => b[0] - a[0]);
  let best: Vec2 | null = null;
  let bestScore = -1;
  for (let i = 0; i < spans.length && i < 3; i++) {
    const [w, xm, y] = spans[i];
    if (!(w > bestScore)) break;
    const ys = verticalCrossings(rings, xm);
    for (let q = 0; q + 1 < ys.length; q += 2) {
      if (ys[q] <= y && y <= ys[q + 1]) {
        const score = Math.min(w, ys[q + 1] - ys[q]);
        if (score > bestScore) {
          bestScore = score;
          best = [xm, (ys[q] + ys[q + 1]) / 2];
        }
        break;
      }
    }
  }
  return best;
}

function regionContains(r: SketchRegion, p: Vec2): boolean {
  if (!pointInPolygon(p, r.polygon)) return false;
  for (const h of r.holePolygons) if (pointInPolygon(p, h)) return false;
  return true;
}

/** Smallest region containing the point (point-in-polygon accounting for holes), or null. */
export function regionAt(regions: SketchRegion[], pt: Vec2): SketchRegion | null {
  let best: SketchRegion | null = null;
  for (const r of regions) if ((!best || r.area < best.area) && regionContains(r, pt)) best = r;
  return best;
}

/**
 * Re-find a region after sketch edits: best Jaccard match of key.ents; ties / zero overlap resolved by
 * the region containing key.pt (ties without a containing region: nearest centroid); null if nothing plausible.
 */
export function findRegion(regions: SketchRegion[], key: RegionKey): SketchRegion | null {
  if (!regions.length) return null;
  const want = new Set(key.ents);
  let bestJ = 0;
  let best: SketchRegion[] = [];
  for (const r of regions) {
    let inter = 0;
    for (const e of r.key.ents) if (want.has(e)) inter++;
    const uni = want.size + r.key.ents.length - inter;
    const j = uni > 0 ? inter / uni : 0;
    if (j <= 0) continue;
    if (j > bestJ + 1e-12) {
      bestJ = j;
      best = [r];
    } else if (Math.abs(j - bestJ) <= 1e-12) best.push(r);
  }
  if (!best.length) return regionAt(regions, key.pt);
  if (best.length === 1) return best[0];
  const inside = regionAt(best, key.pt);
  if (inside) return inside;
  let near = best[0];
  for (const r of best) if (dist(r.centroid, key.pt) < dist(near.centroid, key.pt)) near = r;
  return near;
}

/** All closed regions of the sketch. Construction geometry, points and dangling curves are ignored. */
export function computeRegions(entities: SkEntity[], opts?: { tolerance?: number }): SketchRegion[] {
  const map = entityMap(entities);

  // ---- 1. curves -----------------------------------------------------------
  const pre: { ent: string; prim: Prim; pids: [string, string] | null; bbox: BBox }[] = [];
  for (const e of entities) {
    if (e.type === 'point' || e.construction) continue;
    let prim: Prim | null;
    try {
      prim = entityPrim(e, map);
    } catch {
      continue;
    }
    if (!prim) continue;
    const bbox = primBBox(prim);
    if (!bbox.every(Number.isFinite)) continue;
    let pids: [string, string] | null = null;
    if (e.type === 'line' || e.type === 'arc') pids = [e.p1, e.p2];
    else if (e.type === 'spline' && prim.kind === 'poly' && !prim.closed && e.pts.length >= 2)
      pids = [e.pts[0], e.pts[e.pts.length - 1]];
    pre.push({ ent: e.id, prim, pids, bbox });
  }
  if (!pre.length) return [];
  const sbb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of pre) {
    sbb[0] = Math.min(sbb[0], c.bbox[0]);
    sbb[1] = Math.min(sbb[1], c.bbox[1]);
    sbb[2] = Math.max(sbb[2], c.bbox[2]);
    sbb[3] = Math.max(sbb[3], c.bbox[3]);
  }
  const size = Math.hypot(sbb[2] - sbb[0], sbb[3] - sbb[1]) || 1;
  const tol = opts?.tolerance && opts.tolerance > 0 ? opts.tolerance : Math.max(1e-6 * size, 1e-9);
  const areaEps = Math.max(tol * tol, 1e-14 * size * size);
  const O: Vec2 = [(sbb[0] + sbb[2]) / 2, (sbb[1] + sbb[3]) / 2];

  const curves: Curve[] = [];
  for (const c of pre) {
    const p = c.prim;
    if (p.kind === 'seg' && dist(p.a, p.b) <= tol) continue;
    if (p.kind === 'arc' && (p.r <= tol || p.r * p.sweep <= tol)) continue;
    if (p.kind === 'ell' && Math.min(p.rx, p.ry) <= tol) continue;
    if (p.kind === 'poly') {
      if (p.pts.length < (p.closed ? 4 : 2)) continue;
      let L = 0;
      for (let i = 0; i + 1 < p.pts.length; i++) L += dist(p.pts[i], p.pts[i + 1]);
      if (L <= tol) continue;
    }
    const [lo, hi] = primRange(p);
    curves.push({ ent: c.ent, prim: p, closed: primClosed(p), lo, hi, period: hi - lo, bbox: c.bbox, pids: c.pids });
  }
  if (!curves.length) return [];

  // ---- 2. split nodes ------------------------------------------------------
  const nodePos: Vec2[] = [];
  const nodePid: (string | null)[] = [];
  const parent: number[] = [];
  const newNode = (p: Vec2, pid: string | null): number => {
    nodePos.push(p);
    nodePid.push(pid);
    parent.push(parent.length);
    return parent.length - 1;
  };
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const splits: Split[][] = curves.map(() => []);
  const endNodes: number[][] = curves.map(() => []);
  curves.forEach((c, i) => {
    if (!c.pids) return;
    const ends: [number, number] = [c.lo, c.hi];
    c.pids.forEach((pid, k) => {
      let pos: Vec2;
      try {
        pos = pointOf(map, pid);
      } catch {
        pos = primEval(c.prim, ends[k]);
      }
      const n = newNode(pos, pid);
      endNodes[i].push(n);
      splits[i].push({ t: ends[k], node: n, end: true });
    });
  });

  // pairwise intersections
  for (let i = 0; i < curves.length; i++) {
    const A = curves[i];
    for (let j = i + 1; j < curves.length; j++) {
      const B = curves[j];
      if (!bboxOverlap(A.bbox, B.bbox, tol)) continue;
      for (const h of intersectPrims(A.prim, B.prim, tol)) {
        const n = newNode(h.p, null);
        splits[i].push({ t: h.ta, node: n, end: false });
        splits[j].push({ t: h.tb, node: n, end: false });
      }
    }
    if (A.prim.kind === 'poly') {
      for (const h of primSelfHits(A.prim, tol)) {
        const n = newNode(h.p, null);
        splits[i].push({ t: h.ta, node: n, end: false });
        splits[i].push({ t: h.tb, node: n, end: false });
      }
    }
  }

  // end points touching other curves (T-junctions, overlapping collinear pieces)
  for (let i = 0; i < curves.length; i++) {
    for (const n of endNodes[i]) {
      const q = nodePos[n];
      for (let j = 0; j < curves.length; j++) {
        if (j === i || !bboxHas(curves[j].bbox, q, tol)) continue;
        const pr = primProject(curves[j].prim, q);
        if (pr.d <= tol) splits[j].push({ t: pr.t, node: n, end: false });
      }
    }
  }

  // ---- 3. merge split params along each curve --------------------------------
  /** Params t1 <= t2 on curve c whose whole piece in between stays within tol (not just the end points). */
  const closeAlong = (c: Curve, t1: number, t2: number): boolean => {
    const p1 = primEval(c.prim, t1);
    if (dist(p1, primEval(c.prim, t2)) > tol || dist(p1, primEval(c.prim, (t1 + t2) / 2)) > tol) return false;
    if (c.prim.kind === 'poly') {
      for (let k = Math.floor(t1) + 1; k < t2; k++) if (dist(p1, primEval(c.prim, k)) > tol) return false;
    }
    return true;
  };
  const groups: Split[][] = [];
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i];
    const sp = splits[i];
    if (c.prim.kind === 'poly') {
      for (const s of sp) {
        const r = Math.round(s.t);
        if (Math.abs(s.t - r) < 1e-9) s.t = r;
      }
    }
    if (c.closed) {
      for (const s of sp) {
        s.t = c.lo + mod(s.t - c.lo, c.period);
        if (s.t >= c.hi) s.t = c.lo;
      }
    }
    sp.sort((a, b) => a.t - b.t);
    const g: Split[] = [];
    for (const s of sp) {
      const last = g[g.length - 1];
      if (last && !(s.end && last.end && s.t !== last.t) && closeAlong(c, last.t, s.t)) {
        union(last.node, s.node);
        if (s.end && !last.end) {
          last.t = s.t;
          last.end = true;
        }
        continue;
      }
      g.push({ t: s.t, node: s.node, end: s.end });
    }
    if (c.closed) {
      if (g.length > 1 && closeAlong(c, g[g.length - 1].t, g[0].t + c.period)) {
        union(g[0].node, g[g.length - 1].node);
        g.pop();
      }
      if (!g.length) g.push({ t: c.lo, node: newNode(primEval(c.prim, c.lo), null), end: false });
    }
    groups.push(g);
  }

  // ---- 4. vertices: merge nodes by proximity and by shared sketch point ------
  {
    // spatial hash (collisions are harmless: candidates are distance checked)
    const grid = new Map<number, number[]>();
    const cell = tol;
    const hash = (ix: number, iy: number) => ((ix % 1048573) * 1048583 + (iy % 1048573)) | 0;
    for (const g of groups) {
      for (const s of g) {
        const p = nodePos[s.node];
        const ix = Math.floor(p[0] / cell);
        const iy = Math.floor(p[1] / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const arr = grid.get(hash(ix + dx, iy + dy));
            if (arr) for (const m of arr) if (dist(nodePos[m], p) <= tol) union(m, s.node);
          }
        }
        const key = hash(ix, iy);
        const arr = grid.get(key);
        if (arr) arr.push(s.node);
        else grid.set(key, [s.node]);
      }
    }
    const byPid = new Map<string, number>();
    for (let n = 0; n < nodePos.length; n++) {
      const pid = nodePid[n];
      if (!pid) continue;
      const m = byPid.get(pid);
      if (m === undefined) byPid.set(pid, n);
      else union(m, n);
    }
  }
  const vOf = new Map<number, number>();
  const acc: number[][] = [];
  for (let n = 0; n < nodePos.length; n++) {
    const r = find(n);
    let v = vOf.get(r);
    if (v === undefined) {
      v = acc.length;
      vOf.set(r, v);
      acc.push([0, 0, 0, 0, 0, 0]);
    }
    const a = acc[v];
    const p = nodePos[n];
    const o = nodePid[n] ? 3 : 0;
    a[o] += p[0];
    a[o + 1] += p[1];
    a[o + 2]++;
  }
  const vpos: Vec2[] = acc.map((a) => (a[5] > 0 ? [a[3] / a[5], a[4] / a[5]] : [a[0] / a[2], a[1] / a[2]]));
  const V = (n: number): number => vOf.get(find(n)) as number;

  // ---- 5. edges (pieces), deduplicated --------------------------------------
  const edges: Edge[] = [];
  const edgeProbe: Vec2[][] = [];
  const dup = new Map<string, number[]>();
  const addPiece = (ci: number, tA: number, tB: number, n0: number, n1: number) => {
    if (!(tB > tA)) return;
    const c = curves[ci];
    const v0 = V(n0);
    const v1 = V(n1);
    const probe = [0.25, 0.5, 0.75].map((f) => primEval(c.prim, tA + (tB - tA) * f));
    if (v0 === v1) {
      const ext = Math.max(...probe.map((q) => dist(q, vpos[v0])));
      if (ext <= 2 * tol) return; // zero length
    }
    const key = v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`;
    const lst = dup.get(key);
    const dt = 10 * tol;
    if (lst) {
      for (const ei of lst) {
        const q = edgeProbe[ei];
        const same = dist(q[0], probe[0]) <= dt && dist(q[1], probe[1]) <= dt && dist(q[2], probe[2]) <= dt;
        const rev = dist(q[0], probe[2]) <= dt && dist(q[1], probe[1]) <= dt && dist(q[2], probe[0]) <= dt;
        if (same || rev) return;
      }
    }
    const pA = primEval(c.prim, tA);
    const pB = primEval(c.prim, tB);
    const area =
      primArea(c.prim, tA, tB, O) +
      0.5 * cross(sub(vpos[v0], O), sub(pA, O)) +
      0.5 * cross(sub(pB, O), sub(vpos[v1], O));
    edges.push({ ci, tA, tB, v0, v1, area, alive: true });
    edgeProbe.push(probe);
    if (lst) lst.push(edges.length - 1);
    else dup.set(key, [edges.length - 1]);
  };
  groups.forEach((g, ci) => {
    const c = curves[ci];
    for (let i = 0; i + 1 < g.length; i++) addPiece(ci, g[i].t, g[i + 1].t, g[i].node, g[i + 1].node);
    if (c.closed && g.length) addPiece(ci, g[g.length - 1].t, g[0].t + c.period, g[g.length - 1].node, g[0].node);
  });
  const E = edges.length;
  if (!E) return [];

  // ---- 6. half-edge graph -----------------------------------------------------
  const nV = vpos.length;
  const org = (h: number) => (h & 1 ? edges[h >> 1].v1 : edges[h >> 1].v0);
  const dst = (h: number) => (h & 1 ? edges[h >> 1].v0 : edges[h >> 1].v1);
  const heArea = (h: number) => (h & 1 ? -edges[h >> 1].area : edges[h >> 1].area);
  const outAt: number[][] = Array.from({ length: nV }, () => []);
  edges.forEach((e, i) => {
    outAt[e.v0].push(2 * i);
    outAt[e.v1].push(2 * i + 1);
  });
  const heTh = new Float64Array(2 * E);
  const heK = new Float64Array(2 * E);
  edges.forEach((e, i) => {
    const p = curves[e.ci].prim;
    const d0 = primDeriv(p, e.tA, 1);
    heTh[2 * i] = Math.atan2(d0[1], d0[0]);
    heK[2 * i] = primCurvature(p, e.tA, 1);
    const d1 = primDeriv(p, e.tB, -1);
    heTh[2 * i + 1] = Math.atan2(-d1[1], -d1[0]);
    heK[2 * i + 1] = -primCurvature(p, e.tB, -1);
  });

  const prune = () => {
    const deg = new Int32Array(nV);
    for (const e of edges) {
      if (!e.alive) continue;
      deg[e.v0]++;
      deg[e.v1]++;
    }
    const stack: number[] = [];
    for (let v = 0; v < nV; v++) if (deg[v] === 1) stack.push(v);
    while (stack.length) {
      const v = stack.pop() as number;
      if (deg[v] !== 1) continue;
      let h = -1;
      for (const x of outAt[v]) {
        if (edges[x >> 1].alive) {
          h = x;
          break;
        }
      }
      if (h < 0) continue;
      edges[h >> 1].alive = false;
      deg[v]--;
      const w = dst(h);
      deg[w]--;
      if (deg[w] === 1) stack.push(w);
    }
  };

  const rot: number[][] = new Array(nV);
  const posIn = new Int32Array(2 * E);
  const buildRot = () => {
    for (let v = 0; v < nV; v++) {
      const l = outAt[v].filter((h) => edges[h >> 1].alive);
      sortAround(l, heTh, heK);
      rot[v] = l;
      l.forEach((h, k) => (posIn[h] = k));
    }
  };

  const faceOf = new Int32Array(2 * E);
  const trace = (): number[][] => {
    faceOf.fill(-1);
    const cycles: number[][] = [];
    for (let h = 0; h < 2 * E; h++) {
      if (!edges[h >> 1].alive || faceOf[h] >= 0) continue;
      const cyc: number[] = [];
      let cur = h;
      let guard = 0;
      do {
        faceOf[cur] = cycles.length;
        cyc.push(cur);
        const l = rot[dst(cur)];
        cur = l[(posIn[cur ^ 1] - 1 + l.length) % l.length];
      } while (cur !== h && ++guard <= 2 * E);
      cycles.push(cyc);
    }
    return cycles;
  };

  prune();
  buildRot();
  let cycles = trace();
  // bridges (same face on both sides) separate nested parts: remove them and re-trace
  for (let iter = 0; iter < 4; iter++) {
    let removed = false;
    for (let i = 0; i < E; i++) {
      if (edges[i].alive && faceOf[2 * i] === faceOf[2 * i + 1]) {
        edges[i].alive = false;
        removed = true;
      }
    }
    if (!removed) break;
    prune();
    buildRot();
    cycles = trace();
  }

  // ---- 7. components ------------------------------------------------------------
  const cpar = Array.from({ length: nV }, (_v, i) => i);
  const cfind = (x: number): number => {
    while (cpar[x] !== x) {
      cpar[x] = cpar[cpar[x]];
      x = cpar[x];
    }
    return x;
  };
  for (const e of edges) if (e.alive) cpar[cfind(e.v1)] = cfind(e.v0);

  // ---- 8. loops ----------------------------------------------------------------------
  const edgePolys = new Map<number, Vec2[]>();
  const edgePoly = (ei: number): Vec2[] => {
    let pts = edgePolys.get(ei);
    if (!pts) {
      const e = edges[ei];
      pts = primSampleRange(curves[e.ci].prim, e.tA, e.tB, POLY_STEP);
      pts[0] = vpos[e.v0];
      pts[pts.length - 1] = vpos[e.v1];
      edgePolys.set(ei, pts);
    }
    return pts;
  };
  const mkLoop = (hes: number[]): Loop => {
    const poly: Vec2[] = [];
    let area = 0;
    for (const h of hes) {
      area += heArea(h);
      const ep = edgePoly(h >> 1);
      if (h & 1) for (let k = ep.length - 1; k > 0; k--) poly.push(ep[k]);
      else for (let k = 0; k < ep.length - 1; k++) poly.push(ep[k]);
    }
    return { hes, area, poly, bbox: polyBBox(poly) };
  };
  /** Splits a face cycle at repeated vertices (pinch points) into simple loops. */
  const splitCycle = (hes: number[]): number[][] => {
    const out: number[][] = [];
    const stack: number[] = [];
    const at = new Map<number, number>([[org(hes[0]), 0]]);
    for (const h of hes) {
      stack.push(h);
      const v = dst(h);
      const p = at.get(v);
      if (p === undefined) {
        at.set(v, stack.length);
        continue;
      }
      const loop = stack.splice(p);
      for (const lh of loop) if (dst(lh) !== v) at.delete(dst(lh));
      out.push(loop);
    }
    if (stack.length) out.push(stack);
    return out;
  };

  const cycArea = cycles.map((c) => c.reduce((s, h) => s + heArea(h), 0));
  const outerOf = new Map<number, number>();
  cycles.forEach((c, i) => {
    const comp = cfind(org(c[0]));
    const cur = outerOf.get(comp);
    if (cur === undefined || cycArea[i] < cycArea[cur]) outerOf.set(comp, i);
  });

  const faces: Face[] = [];
  const compHoles: { comp: number; loops: Loop[] }[] = [];
  cycles.forEach((c, i) => {
    const comp = cfind(org(c[0]));
    if (outerOf.get(comp) === i) {
      const loops = splitCycle(c)
        .map(mkLoop)
        .filter((l) => l.area < -areaEps);
      if (loops.length) compHoles.push({ comp, loops });
      return;
    }
    if (cycArea[i] <= areaEps) return;
    const loops = splitCycle(c).map(mkLoop);
    let oi = 0;
    for (let k = 1; k < loops.length; k++) if (loops[k].area > loops[oi].area) oi = k;
    faces.push({
      comp,
      outer: loops[oi],
      holes: loops.filter((l, k) => k !== oi && l.area < -areaEps),
    });
  });

  // ---- 9. nesting: outer boundaries of components become holes of the smallest enclosing face
  for (const { comp, loops } of compHoles) {
    const poly = loops[0].poly;
    const tests = [poly[0], poly[Math.floor(poly.length / 3)], poly[Math.floor((2 * poly.length) / 3)]];
    let best: Face | null = null;
    for (const f of faces) {
      if (f.comp === comp || (best && f.outer.area >= best.outer.area)) continue;
      let votes = 0;
      for (const q of tests) if (bboxHas(f.outer.bbox, q, 0) && pointInPolygon(q, f.outer.poly)) votes++;
      if (votes * 2 > tests.length) best = f;
    }
    if (best) for (const l of loops) best.holes.push(l);
  }

  // ---- 10. profile loops ------------------------------------------------------------
  const near = (a: number, b: number, c: Curve) => {
    const d = c.closed ? Math.abs(mod(a - b + c.period / 2, c.period) - c.period / 2) : Math.abs(a - b);
    return d <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  };
  const joinable = (r1: Run, r2: Run): boolean => {
    if (r1.ci !== r2.ci || r1.rev !== r2.rev) return false;
    const c = curves[r1.ci];
    if (c.closed && r1.tB - r1.tA + (r2.tB - r2.tA) > c.period + 1e-9) return false;
    return r1.rev ? near(r2.tB, r1.tA, c) : near(r1.tB, r2.tA, c);
  };
  const loopRuns = (hes: number[]): Run[] => {
    const runs: Run[] = hes.map((h) => {
      const e = edges[h >> 1];
      return { ci: e.ci, tA: e.tA, tB: e.tB, rev: (h & 1) === 1, vs: org(h), ve: dst(h) };
    });
    const n = runs.length;
    if (n < 2) return runs;
    let k = -1;
    for (let i = 0; i < n; i++) {
      if (!joinable(runs[(i - 1 + n) % n], runs[i])) {
        k = i;
        break;
      }
    }
    if (k < 0) {
      const r0 = runs[0];
      const per = curves[r0.ci].period;
      return [
        r0.rev
          ? { ...r0, tA: r0.tB - per, ve: r0.vs }
          : { ...r0, tB: r0.tA + per, ve: r0.vs },
      ];
    }
    const ordered = runs.slice(k).concat(runs.slice(0, k));
    const out: Run[] = [{ ...ordered[0] }];
    for (let i = 1; i < n; i++) {
      const last = out[out.length - 1];
      const r = ordered[i];
      if (joinable(last, r)) {
        if (last.rev) last.tA -= r.tB - r.tA;
        else last.tB += r.tB - r.tA;
        last.ve = r.ve;
      } else out.push({ ...r });
    }
    return out;
  };
  const cp = (v: Vec2): Vec2 => [v[0], v[1]];
  const runCurve = (r: Run, alone: boolean): ProfileCurve => {
    const c = curves[r.ci];
    const p = c.prim;
    const ent = c.ent;
    const full = alone && c.closed && r.tB - r.tA >= c.period - 1e-9;
    const S = vpos[r.vs];
    const T = vpos[r.ve];
    switch (p.kind) {
      case 'seg':
        return { kind: 'line', ent, a: cp(S), b: cp(T) };
      case 'arc':
        if (full) return { kind: 'circle', ent, c: cp(p.c), r: p.r };
        return { kind: 'arc', ent, c: cp(p.c), r: p.r, start: cp(S), end: cp(T), ccw: !r.rev };
      case 'ell':
        if (full) return { kind: 'ellipse', ent, c: cp(p.c), rx: p.rx, ry: p.ry, rot: p.rot };
        return {
          kind: 'ellipseArc',
          ent,
          c: cp(p.c),
          rx: p.rx,
          ry: p.ry,
          rot: p.rot,
          t0: r.rev ? r.tB : r.tA,
          t1: r.rev ? r.tA : r.tB,
          ccw: !r.rev,
          start: cp(S),
          end: cp(T),
        };
      case 'poly': {
        const pts = primSampleRange(p, r.tA, r.tB);
        if (r.rev) pts.reverse();
        pts[0] = cp(S);
        pts[pts.length - 1] = cp(T);
        return { kind: 'spline', ent, pts };
      }
    }
  };
  const profileLoop = (l: Loop): ProfileLoop => {
    const runs = loopRuns(l.hes);
    return { curves: runs.map((r) => runCurve(r, runs.length === 1)), area: l.area };
  };

  // ---- 11. regions -------------------------------------------------------------------
  const regions: SketchRegion[] = [];
  for (const f of faces) {
    const area = f.outer.area + f.holes.reduce((s, h) => s + h.area, 0);
    if (!(area > areaEps)) continue;
    const outer = profileLoop(f.outer);
    const holes = f.holes.map(profileLoop);
    const polygon = f.outer.poly;
    const holePolygons = f.holes.map((h) => h.poly);
    const centroid = polyCentroid([polygon, ...holePolygons]);
    const pt = interiorPoint(polygon, holePolygons, f.outer.bbox) ?? centroid;
    const ents = new Set<string>();
    for (const l of [outer, ...holes]) for (const c of l.curves) ents.add(c.ent);
    regions.push({
      key: { ents: [...ents].sort(), pt },
      outer,
      holes,
      area,
      centroid,
      polygon,
      holePolygons,
    });
  }
  return regions;
}
