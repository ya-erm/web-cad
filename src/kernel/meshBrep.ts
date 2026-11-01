// The faces recognised in a closed mesh (meshRegions) built into a solid, as converters of STL to STEP do. Where two
// faces meet, their common boundary (a chain of mesh edges between corners where three faces meet) becomes one edge:
// the line of two planes, the circle of a plane across the axis of a cylinder, cone or sphere, otherwise a B-spline
// through its points brought onto both surfaces; the corners are moved onto all their faces' surfaces. Each face is
// its surface bounded by the loops of its edges; the faces are sewn into a shell and that into a solid, which must
// hold the mesh's volume — or there is none (the caller keeps the mesh's triangles).

import * as R from 'replicad';
import { perpendicular, v3 } from '../core/math';
import type { Vec3 } from '../core/types';
import type { Shape3D } from './geom';
import { eigen3, surfaceDistance, type FitSurface, type Mesh, type MeshRegion } from './meshSurfaces';

/** The surface's normal at a point on it (planes: as fitted; the others: away from their axis or centre). */
function normalAt(s: FitSurface, p: Vec3): Vec3 {
  if (s.kind === 'plane') return s.normal;
  const d = v3.sub(p, s.origin);
  if (s.kind === 'sphere') return v3.norm(d);
  const radial = v3.norm(v3.sub(d, v3.scale(s.axis, v3.dot(d, s.axis))));
  return s.kind === 'cylinder' ? radial : v3.norm(v3.sub(radial, v3.scale(s.axis, s.slope)));
}

/** The point of the surface nearest to `p` (a cone: by Newton steps). */
function project(s: FitSurface, p: Vec3): Vec3 {
  if (s.kind === 'plane') return v3.sub(p, v3.scale(s.normal, v3.dot(v3.sub(p, s.origin), s.normal)));
  const d = v3.sub(p, s.origin);
  if (s.kind === 'sphere') return v3.add(s.origin, v3.scale(v3.norm(d), s.radius));
  const t = v3.dot(d, s.axis);
  const radial = v3.norm(v3.sub(d, v3.scale(s.axis, t)));
  if (s.kind === 'cylinder') return v3.add(v3.add(s.origin, v3.scale(s.axis, t)), v3.scale(radial, s.radius));
  let q = p;
  for (let i = 0; i < 4; i++) {
    const dq = v3.sub(q, s.origin);
    const tq = v3.dot(dq, s.axis);
    const rho = v3.len(v3.sub(dq, v3.scale(s.axis, tq)));
    const f = rho - (s.radius + s.slope * tq);
    q = v3.sub(q, v3.scale(normalAt(s, q), f / Math.hypot(1, s.slope)));
  }
  return q;
}

/** A point near `p` on all the surfaces (where they cross): least squares on their tangent planes, repeated. */
function onAll(surfaces: FitSurface[], p: Vec3): Vec3 {
  let x = p;
  for (let it = 0; it < 30; it++) {
    // (Σ n nᵀ + λ I) x' = Σ n (n·q) + λ x — λ keeps x' near x along what the planes leave free
    const lambda = 1e-9;
    const m = [lambda, 0, 0, 0, lambda, 0, 0, 0, lambda];
    const b = v3.scale(x, lambda);
    for (const s of surfaces) {
      const q = project(s, x);
      const n = normalAt(s, q);
      const nq = v3.dot(n, q);
      for (let i = 0; i < 3; i++) {
        b[i] += n[i] * nq;
        for (let j = 0; j < 3; j++) m[i * 3 + j] += n[i] * n[j];
      }
    }
    const next = solve3(m, b);
    if (!next) return x;
    const moved = v3.dist(next, x);
    x = next;
    if (moved < 1e-12) break;
  }
  return x;
}

function solve3(m: number[], b: Vec3): Vec3 | null {
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-30) return null;
  const inv = [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3],
  ];
  return [0, 1, 2].map((i) => (inv[i * 3] * b[0] + inv[i * 3 + 1] * b[1] + inv[i * 3 + 2] * b[2]) / det) as Vec3;
}

type Curve = { kind: 'line' } | { kind: 'circle'; centre: Vec3; normal: Vec3; radius: number } | { kind: 'spline'; points: Vec3[] };

/** The circle where a plane crosses a cylinder, cone or sphere square to its axis, if it does. */
function planeCircle(plane: FitSurface & { kind: 'plane' }, s: FitSurface): { centre: Vec3; normal: Vec3; radius: number } | null {
  const n = plane.normal;
  if (s.kind === 'sphere') {
    const d = v3.dot(v3.sub(s.origin, plane.origin), n);
    if (Math.abs(d) >= s.radius) return null;
    return { centre: v3.sub(s.origin, v3.scale(n, d)), normal: n, radius: Math.sqrt(s.radius * s.radius - d * d) };
  }
  if (s.kind === 'plane' || Math.abs(v3.dot(n, s.axis)) < 1 - 1e-9) return null;
  const t = v3.dot(v3.sub(plane.origin, s.origin), n) / v3.dot(s.axis, n);
  const radius = s.kind === 'cylinder' ? s.radius : s.radius + s.slope * t;
  return radius > 0 ? { centre: v3.add(s.origin, v3.scale(s.axis, t)), normal: n, radius } : null;
}

/**
 * The circle where two turned surfaces about one axis (cylinders, cones; spheres centred on it) cross, near the
 * points: where their radii along the axis are equal.
 */
function coaxialCircle(a: FitSurface, b: FitSurface, pts: Vec3[]): { centre: Vec3; normal: Vec3; radius: number } | null {
  if (a.kind === 'plane' || b.kind === 'plane') return null;
  const line = a.kind !== 'sphere' ? { dir: a.axis, point: a.origin } : b.kind !== 'sphere' ? { dir: b.axis, point: b.origin } : null;
  if (!line) return null;
  const off = (p: Vec3) => {
    const d = v3.sub(p, line.point);
    return v3.len(v3.sub(d, v3.scale(line.dir, v3.dot(d, line.dir))));
  };
  const scale = Math.max(1, v3.len(line.point));
  for (const s of [a, b]) {
    if (s.kind !== 'sphere' && Math.abs(v3.dot(s.axis, line.dir)) < 1 - 1e-12) return null;
    if (off(s.origin) > 1e-9 * scale) return null;
  }
  // a surface's radius at `t` along the line (NaN where it has none)
  const radiusAt = (s: FitSurface, t: number) => {
    if (s.kind === 'cylinder') return s.radius;
    if (s.kind === 'cone') return s.radius + s.slope * (v3.dot(v3.sub(line.point, s.origin), s.axis) + t * v3.dot(line.dir, s.axis));
    if (s.kind === 'sphere') {
      const h = t - v3.dot(v3.sub(s.origin, line.point), line.dir);
      return Math.sqrt(s.radius * s.radius - h * h);
    }
    return NaN;
  };
  const g = (t: number) => radiusAt(a, t) - radiusAt(b, t);
  let t = pts.reduce((sum, p) => sum + v3.dot(v3.sub(p, line.point), line.dir), 0) / pts.length;
  for (let i = 0; i < 60; i++) {
    const h = 1e-7 * scale;
    const d = (g(t + h) - g(t - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) return null;
    const step = g(t) / d;
    t -= step;
    if (Math.abs(step) < 1e-14 * scale) break;
  }
  const radius = radiusAt(a, t);
  if (!(radius > 0) || Math.abs(g(t)) > 1e-10 * scale) return null;
  return { centre: v3.add(line.point, v3.scale(line.dir, t)), normal: line.dir, radius };
}

/** The curve along which faces of surfaces `a` and `b` meet, through the points of their common boundary. */
function chainCurve(a: FitSurface, b: FitSurface, pts: Vec3[], closed: boolean, tol: number): Curve {
  if (a.kind === 'plane' && b.kind === 'plane' && !closed) return { kind: 'line' };
  // straight: a plane along a cylinder's axis, a cone's line, two strips of a curved face
  if (!closed) {
    const p0 = pts[0];
    const d = v3.norm(v3.sub(pts[pts.length - 1], p0));
    if (pts.every((p) => v3.len(v3.cross(v3.sub(p, p0), d)) <= tol)) return { kind: 'line' };
  }
  const c = a.kind === 'plane' ? planeCircle(a, b) : b.kind === 'plane' ? planeCircle(b, a) : coaxialCircle(a, b, pts);
  const off = (p: Vec3, k: number) => (c ? Math.abs(v3.dist(p, c.centre) - c.radius) + Math.abs(v3.dot(v3.sub(p, c.centre), c.normal)) : Infinity) > k;
  // its ends (corners, on all their surfaces as near as they cross) exactly on it: OpenCascade takes an arc's vertices
  // within their own tolerance only (and has no way here to widen it) — else the curve through the points
  const exact = 1e-9 * Math.max(1, v3.len(pts[0]));
  if (c && !pts.some((p) => off(p, tol)) && (closed || !(off(pts[0], exact) || off(pts[pts.length - 1], exact)))) return { kind: 'circle', ...c };
  // through its points (on both surfaces within the tolerance; where they meet at a shallow angle their crossing is
  // no better)
  return { kind: 'spline', points: pts };
}

/** A closed, consistently wound mesh's volume. */
function meshVolume(mesh: Mesh, faces: number[]): number {
  let v = 0;
  for (const f of faces) {
    const [p, q, r] = mesh.faces[f].map((i) => mesh.pts[i]);
    v += v3.dot(p, v3.cross(q, r)) / 6;
  }
  return v;
}

/** Tests and manual checks: why faces fail (a logger, off by default). */
export const meshBrepDebug: { log?: (message: string) => void } = {};

interface HalfEdge {
  a: number;
  b: number;
  /** The region it bounds and the one across it. */
  r: number;
  s: number;
}

interface Chain {
  r: number;
  s: number;
  verts: number[];
  closed: boolean;
}

/**
 * The solid of a closed mesh's recognised faces (`regions` of its triangles `faces`), or why there is none (it cannot
 * be built or does not hold the mesh's volume).
 */
export function regionsSolid(mesh: Mesh, faces: number[], regions: MeshRegion[], tol: number): { solid: Shape3D } | { failed: string; shape?: Shape3D; demote?: number[] } {
  const oc = R.getOC();
  const { pts } = mesh;
  const N = pts.length;
  // a ball
  if (regions.length === 1 && regions[0].surface.kind === 'sphere') {
    const s = regions[0].surface;
    return { solid: R.makeSphere(s.radius).translate(s.origin) as Shape3D };
  }
  const regionOf = new Map<number, number>();
  regions.forEach((rg, i) => rg.faces.forEach((f) => regionOf.set(f, i)));
  const byEdge = new Map<number, number[]>();
  const regionsAt = new Map<number, Set<number>>();
  for (const f of faces) {
    const t = mesh.faces[f];
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      const key = a < b ? a * N + b : b * N + a;
      const l = byEdge.get(key);
      if (l) l.push(f);
      else byEdge.set(key, [f]);
      const at = regionsAt.get(a);
      if (at) at.add(regionOf.get(f)!);
      else regionsAt.set(a, new Set([regionOf.get(f)!]));
    }
  }
  // each region's boundary: its triangles' sides across which another region lies, region on their left (outside view)
  const outgoing = regions.map(() => new Map<number, HalfEdge>());
  for (const f of faces) {
    const t = mesh.faces[f];
    const r = regionOf.get(f)!;
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      const others = byEdge.get(a < b ? a * N + b : b * N + a)!.filter((g) => g !== f);
      if (others.length !== 1) return { failed: 'an edge of more than two triangles' };
      const s = regionOf.get(others[0])!;
      if (s === r) continue;
      if (outgoing[r].has(a)) return { failed: 'a face touching itself at a corner', demote: [r] };
      outgoing[r].set(a, { a, b, r, s });
    }
  }
  const corner = (v: number) => (regionsAt.get(v)?.size ?? 0) >= 3;
  // loops of half-edges, cut into chains at corners (and where the region across changes)
  const loops: Chain[][][] = regions.map(() => []);
  for (let r = 0; r < regions.length; r++) {
    const seen = new Set<number>();
    for (const start of outgoing[r].values()) {
      if (seen.has(start.a)) continue;
      const loop: HalfEdge[] = [];
      for (let h: HalfEdge | undefined = start; h && !seen.has(h.a); h = outgoing[r].get(h.b)) {
        seen.add(h.a);
        loop.push(h);
      }
      if (loop[loop.length - 1].b !== start.a) return { failed: 'an open boundary loop', demote: [r] };
      const cut = loop.map((h, i) => corner(h.a) || loop[(i + loop.length - 1) % loop.length].s !== h.s);
      const first = cut.indexOf(true);
      if (first < 0) {
        loops[r].push([{ r, s: loop[0].s, verts: loop.map((h) => h.a), closed: true }]);
        continue;
      }
      const chains: Chain[] = [];
      for (let k = 0; k < loop.length; k++) {
        const i = (first + k) % loop.length;
        if (cut[i]) chains.push({ r, s: loop[i].s, verts: [loop[i].a], closed: false });
        chains[chains.length - 1].verts.push(loop[i].b);
      }
      // a loop through one corner only (a third face touches it there): a closed curve
      if (chains.length === 1) {
        chains[0].closed = true;
        chains[0].verts.pop();
      }
      loops[r].push(chains);
    }
  }

  try {
    const P = (p: Vec3) => new oc.gp_Pnt(p[0], p[1], p[2]);
    const D = (d: Vec3) => new oc.gp_Dir(d[0], d[1], d[2]);
    // the corners, on all their faces' surfaces
    const vertices = new Map<number, { p: Vec3; v: ReturnType<typeof oc.BRepBuilderAPI_MakeVertex.prototype.Vertex> }>();
    const vertexAt = (i: number) => {
      let known = vertices.get(i);
      if (!known) {
        const surfaces = [...regionsAt.get(i)!].map((r) => regions[r].surface);
        // where they cross (surfaces meeting at a shallow angle cross somewhere else: the mesh's corner stays)
        const snapped = onAll(surfaces, pts[i]);
        const p = v3.dist(snapped, pts[i]) <= 2 * tol && surfaces.every((s) => surfaceDistance(s, snapped) <= tol) ? snapped : pts[i];
        if (surfaces.some((s) => surfaceDistance(s, p) > tol)) throw new Error('A corner off its faces');
        known = { p, v: new oc.BRepBuilderAPI_MakeVertex(P(p)).Vertex() };
        vertices.set(i, known);
      }
      return known;
    };
    // the edges, each made once (by the first region along it) and found again by its first mesh edge
    const keyOf = (c: Chain) => {
      let k = Infinity;
      const n = c.verts.length - (c.closed ? 0 : 1);
      for (let i = 0; i < n; i++) {
        const a = c.verts[i];
        const b = c.verts[(i + 1) % c.verts.length];
        k = Math.min(k, a < b ? a * N + b : b * N + a);
      }
      return k;
    };
    // an edge between our vertices: OpenCascade takes them within a hundredth of the tolerance of its curve — only
    // while it is made (its faces' curves on their surfaces are made to OpenCascade's own precision, or they fail)
    const between = (make: () => InstanceType<typeof oc.BRepBuilderAPI_MakeEdge>) => {
      const before = oc.BRepLib.Precision();
      oc.BRepLib.Precision(Math.max(before, tol * 1e-2));
      try {
        return make();
      } finally {
        oc.BRepLib.Precision(before);
      }
    };
    const edges = new Map<number, { edge: ReturnType<typeof oc.BRepBuilderAPI_MakeEdge.prototype.Edge>; verts: number[] }>();
    const edgeOf = (c: Chain) => {
      const key = keyOf(c);
      const known = edges.get(key);
      if (known) {
        // the same way along it, or (as expected) the other
        const j = known.verts.indexOf(c.verts[0]);
        const same = c.closed ? c.verts[1] === known.verts[(j + 1) % known.verts.length] : c.verts[0] === known.verts[0];
        return same ? known.edge : oc.TopoDS.Edge(known.edge.Reversed());
      }
      const A = regions[c.r].surface;
      const B = regions[c.s].surface;
      const ends = c.closed ? [] : [vertexAt(c.verts[0]), vertexAt(c.verts[c.verts.length - 1])];
      const points = c.verts.map((i, k) => (!c.closed && k === 0 ? ends[0].p : !c.closed && k === c.verts.length - 1 ? ends[1].p : pts[i]));
      const curve = chainCurve(A, B, points, c.closed, tol);
      let maker;
      if (curve.kind === 'line') maker = between(() => new oc.BRepBuilderAPI_MakeEdge(ends[0].v, ends[1].v));
      else if (curve.kind === 'circle') {
        // turned the way the chain goes
        const mid = Math.floor(points.length / 2);
        const along = v3.sub(points[Math.min(mid + 1, points.length - 1)], points[Math.max(mid - 1, 0)]);
        const normal = v3.dot(along, v3.cross(curve.normal, v3.sub(points[mid], curve.centre))) < 0 ? v3.neg(curve.normal) : curve.normal;
        const x = v3.sub(points[0], curve.centre);
        const xDir = v3.len(x) > 1e-12 ? v3.norm(v3.sub(x, v3.scale(normal, v3.dot(x, normal)))) : perpendicular(normal);
        const circ = new oc.gp_Circ(new oc.gp_Ax2(P(curve.centre), D(normal), D(xDir)), curve.radius);
        maker = c.closed ? new oc.BRepBuilderAPI_MakeEdge(circ) : between(() => new oc.BRepBuilderAPI_MakeEdge(circ, ends[0].v, ends[1].v));
      } else {
        // through all its points (a closed one: periodic), its ends on our vertices
        const list = curve.points;
        const arr = new oc.NCollection_Array1_gp_Pnt(1, list.length);
        list.forEach((p, i) => arr.SetValue(i + 1, P(p)));
        const fit = new oc.GeomAPI_Interpolate(new oc.NCollection_HArray1_gp_Pnt(arr), c.closed, tol * 1e-3);
        fit.Perform();
        if (!fit.IsDone()) throw new Error('No B-spline through a boundary');
        const spline = fit.Curve();
        maker = c.closed ? new oc.BRepBuilderAPI_MakeEdge(spline) : between(() => new oc.BRepBuilderAPI_MakeEdge(spline, ends[0].v, ends[1].v));
      }
      if (!maker.IsDone()) {
        if (meshBrepDebug.log && curve.kind === 'circle' && !c.closed) {
          const off = (p: Vec3) => Math.abs(v3.dist(p, curve.centre) - curve.radius) + Math.abs(v3.dot(v3.sub(p, curve.centre), curve.normal));
          meshBrepDebug.log(`circle ${A.kind}–${B.kind}: ends off ${off(ends[0].p).toExponential(1)}/${off(ends[1].p).toExponential(1)}, same vertex ${c.verts[0] === c.verts[c.verts.length - 1]}, ${c.verts.length} points, r ${curve.radius.toFixed(4)}`);
        }
        throw new EdgeFailure(`A ${curve.kind} edge could not be made (${A.kind}–${B.kind})`, [c.r, c.s]);
      }
      const edge = maker.Edge();
      edges.set(key, { edge, verts: c.verts });
      return edge;
    };

    const sewing = new oc.BRepBuilderAPI_Sewing(Math.max(tol, 1e-6), true, true, true, false);
    const bad: number[] = [];
    regions.forEach((rg, r) => {
      const wires = loops[r].map((loop) => {
        const mw = new oc.BRepBuilderAPI_MakeWire();
        for (const c of loop) mw.Add(edgeOf(c));
        if (!mw.IsDone()) throw new Error('A loop of edges could not be made');
        return { wire: mw.Wire(), loop };
      });
      const s = rg.surface;
      if (!wires.length) {
        // a whole closed surface (a ball): the sphere bounded by its own seam
        if (s.kind !== 'sphere') throw new Error('A face without edges');
        const ball = new oc.BRepBuilderAPI_MakeFace(new oc.Geom_SphericalSurface(new oc.gp_Ax3(P(s.origin), D([0, 0, 1]), D([1, 0, 0])), s.radius), 1e-7);
        if (!ball.IsDone()) throw new Error('A sphere could not be made');
        sewing.Add(ball.Face());
        return;
      }
      // a plane's outer loop: the widest around its (outward) normal
      if (s.kind === 'plane') {
        const areaOf = (loop: Chain[]) => {
          const vs = loop.flatMap((c) => c.verts.slice(0, -1).concat(c.closed ? c.verts.slice(-1) : []));
          let a: Vec3 = [0, 0, 0];
          for (let i = 0; i < vs.length; i++) a = v3.add(a, v3.cross(pts[vs[i]], pts[vs[(i + 1) % vs.length]]));
          return v3.dot(a, s.normal);
        };
        wires.sort((x, y) => areaOf(y.loop) - areaOf(x.loop));
      }
      // the face of the surface bounded by the wires (turned the other way: wires that go round the surface's own way)
      const faceOf = (make: (w: typeof wires[0]['wire']) => InstanceType<typeof oc.BRepBuilderAPI_MakeFace>, turned: boolean) => {
        const ws = wires.map((w) => (turned ? oc.TopoDS.Wire(w.wire.Reversed()) : w.wire));
        const mf = make(ws[0]);
        for (const w of ws.slice(1)) mf.Add(w);
        if (!mf.IsDone()) throw new Error('A face could not be made');
        // missing curves on the surface, seams of cylinders, wires turned
        const fix = new oc.ShapeFix_Face(mf.Face());
        fix.SetPrecision(tol * 1e-2);
        fix.Perform();
        return fix.Face();
      };
      let face;
      if (s.kind === 'plane') {
        const pln = new oc.gp_Pln(P(s.origin), D(s.normal));
        face = faceOf((w) => new oc.BRepBuilderAPI_MakeFace(pln, w, true), false);
      } else {
        // the surface's seam (and a sphere's poles) away from the face: its parameters turned to put the face's middle
        // opposite the seam (a face around the whole axis gets a seam of its own)
        const corners = [...new Set(rg.faces.flatMap((f) => mesh.faces[f]))];
        const mid = v3.scale(corners.reduce((sum, i) => v3.add(sum, pts[i]), [0, 0, 0] as Vec3), 1 / corners.length);
        const towards = v3.sub(mid, s.origin);
        let ax;
        if (s.kind === 'sphere') {
          // its poles where the face is not: the direction its points (seen from the centre) spread least along
          const m = new Array<number>(9).fill(0);
          for (const i of corners) {
            const d = v3.norm(v3.sub(pts[i], s.origin));
            for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 3 + b] += d[a] * d[b];
          }
          const z = eigen3(m).vectors[0];
          const side = v3.sub(towards, v3.scale(z, v3.dot(towards, z)));
          const x = v3.len(side) > 1e-9 * s.radius ? v3.norm(side) : perpendicular(z);
          ax = new oc.gp_Ax3(P(s.origin), D(z), D(v3.neg(x)));
        } else {
          const radial = v3.sub(towards, v3.scale(s.axis, v3.dot(towards, s.axis)));
          const x = v3.len(radial) > 1e-12 ? v3.norm(radial) : perpendicular(s.axis);
          ax = new oc.gp_Ax3(P(s.origin), D(s.axis), D(v3.neg(x)));
        }
        const surface =
          s.kind === 'cylinder'
            ? new oc.Geom_CylindricalSurface(ax, s.radius)
            : s.kind === 'cone'
              ? new oc.Geom_ConicalSurface(ax, Math.atan(s.slope), s.radius)
              : new oc.Geom_SphericalSurface(ax, s.radius);
        // a surface's face must go round its wires its own way (a negative area otherwise): which way is its own here
        // depends on where its parameters run
        face = faceOf((w) => new oc.BRepBuilderAPI_MakeFace(surface, w, true), false);
        if (R.measureArea(R.cast(face) as R.Face) < 0) face = faceOf((w) => new oc.BRepBuilderAPI_MakeFace(surface, w, true), true);
      }
      // a face OpenCascade cannot take: its region goes back to the mesh's flat pieces
      const check = new oc.BRepCheck_Analyzer(face, true, false, false);
      if (!check.IsValid()) {
        bad.push(r);
        if (meshBrepDebug.log)
          meshBrepDebug.log(
            `invalid ${s.kind} face: ${wires.length} loops ${JSON.stringify(wires.map((w) => w.loop.map((c) => `${c.closed ? 'closed ' : ''}${regions[c.s].surface.kind}×${c.verts.length}:${(R.cast(edgeOf(c)) as R.Edge).geomType}`)))}, area ${R.measureArea(R.cast(face) as R.Face).toFixed(3)}`,
          );
      }
      check.delete();
      sewing.Add(face);
    });
    if (bad.length) return { failed: `${bad.length} invalid faces`, demote: bad };
    sewing.Perform();
    if (sewing.NbFreeEdges() > 0) {
      // the regions at the corners nearest to the edges left free
      const near = new Set<number>();
      for (let i = 1; i <= sewing.NbFreeEdges(); i++) {
        const e = R.cast(sewing.FreeEdge(i)) as R.Edge;
        const m = e.pointAt(0.5);
        const mid: Vec3 = [m.x, m.y, m.z];
        m.delete();
        let best = -1;
        let bestD = Infinity;
        for (const v of regionsAt.keys()) {
          const d = v3.dist(pts[v], mid);
          if (d < bestD) {
            bestD = d;
            best = v;
          }
        }
        for (const r of regionsAt.get(best) ?? []) if (regions[r].surface.kind !== 'plane') near.add(r);
      }
      return { failed: `${sewing.NbFreeEdges()} free edges after sewing`, demote: [...near] };
    }
    const sewn = sewing.SewedShape();
    const ex = new oc.TopExp_Explorer(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const shell = ex.More() ? oc.TopoDS.Shell(ex.Current()) : null;
    ex.Next();
    const one = !ex.More();
    ex.delete();
    if (!shell || !one) return { failed: 'not one shell' };
    const solid = R.cast(new oc.ShapeFix_Solid().SolidFromShell(shell)) as Shape3D;
    const check = new oc.BRepCheck_Analyzer(solid.wrapped, true, false, false);
    const valid = check.IsValid();
    check.delete();
    if (!valid) return { failed: 'an invalid solid', shape: solid };
    // the mesh's volume (a tessellation lies within its faces: a little less where they bulge)
    const want = Math.abs(meshVolume(mesh, faces));
    const got = R.measureVolume(solid);
    return Math.abs(got - want) <= 0.01 * want ? { solid } : { failed: `volume ${got} for ${want}` };
  } catch (e) {
    // an edge that could not be made: the curved faces on either side of it go back to flat pieces
    if (e instanceof EdgeFailure) return { failed: e.message, demote: e.regions.filter((r) => regions[r].surface.kind !== 'plane') };
    return { failed: e instanceof Error ? e.message : 'OpenCascade failed' };
  }
}

class EdgeFailure extends Error {
  regions: number[];
  constructor(message: string, regions: number[]) {
    super(message);
    this.regions = regions;
  }
}
