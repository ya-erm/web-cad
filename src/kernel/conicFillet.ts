// Conic fillets (Onshape Fillet → Cross section: Conic): OpenCascade's fillets are round only, so a conic one is built
// from its cross section — the corner between the two faces and a conic arc touching them where a round fillet of the
// same radius would (r / tan(θ/2) from the corner), as full as `rho` says (a rational quadratic Bézier, weight
// rho / (1 − rho): 0.5 — a parabola, ≈0.414 at a right angle — a circle). The section runs along straight edges
// between planar faces (a prism) and round circular edges between a plane and a cylinder (a revolution); the pieces
// are cut from a convex edge or added in a concave one.

import * as R from 'replicad';
import { v3 } from '../core/math';
import type { Vec3 } from '../core/types';
import { fail, fuseAll, prism, type Shape3D } from './geom';

const tuple = (v: R.Vector): Vec3 => {
  const t = v.toTuple() as Vec3;
  v.delete();
  return t;
};

/** Of `d` and −`d`, the one going from `p` onto `face` (a hair along it lies on the face). */
function into(face: R.Face, p: Vec3, d: Vec3, eps: number): Vec3 {
  const at = (s: number) => {
    const v = R.makeVertex(v3.add(p, v3.scale(d, s * eps)));
    const dist = R.measureDistanceBetween(v, face);
    v.delete();
    return dist;
  };
  return at(1) <= at(-1) ? d : v3.neg(d);
}

/** The cross section at the corner `c` between the face directions u1, u2: its region (a face). */
function section(c: Vec3, u1: Vec3, u2: Vec3, r: number, rho: number): R.Face {
  const theta = Math.acos(Math.max(-1, Math.min(1, v3.dot(u1, u2))));
  if (theta < 1e-3 || theta > Math.PI - 1e-3) fail('A conic fillet needs faces meeting at an angle');
  const s = r / Math.tan(theta / 2);
  const p0 = v3.add(c, v3.scale(u1, s));
  const p2 = v3.add(c, v3.scale(u2, s));
  const oc = R.getOC();
  const poles = new oc.NCollection_Array1_gp_Pnt(1, 3);
  const weights = new oc.NCollection_Array1_double(1, 3);
  [p0, c, p2].forEach((q, i) => poles.SetValue(i + 1, new oc.gp_Pnt(...q)));
  [1, rho / (1 - rho), 1].forEach((w, i) => weights.SetValue(i + 1, w));
  const curve = new oc.Geom_BezierCurve(poles, weights);
  const mk = new oc.BRepBuilderAPI_MakeEdge(curve);
  const conic = new R.Edge(mk.Edge());
  mk.delete();
  poles.delete();
  weights.delete();
  return R.makeFace(R.assembleWire([R.makeLine(c, p0), conic, R.makeLine(p2, c)]));
}

interface Piece {
  tool: Shape3D;
  convex: boolean;
}

/** One edge's piece; `free` — its start / end is not shared with another edge of the fillet (the piece runs on past it). */
function piece(shape: Shape3D, edge: R.Edge, r: number, rho: number, free: [boolean, boolean]): Piece {
  const faces = shape.faces.filter((f) => f.edges.some((e) => e.isSame(edge)));
  if (faces.length !== 2) fail('Select edges between two faces for a conic fillet');
  const a = tuple(edge.startPoint);
  const b = tuple(edge.endPoint);
  const eps = Math.max(1e-4, r * 0.01);
  const normal = (f: R.Face, q: Vec3) => {
    const p = new R.Vector(q);
    const n = tuple(f.normalAt(p));
    p.delete();
    return n;
  };
  if (edge.geomType === 'LINE' && faces.every((f) => f.geomType === 'PLANE')) {
    const L = v3.dist(a, b);
    const t = v3.norm(v3.sub(b, a));
    const mid = v3.scale(v3.add(a, b), 0.5);
    const [u1, u2] = faces.map((f) => into(f, mid, v3.norm(v3.cross(t, normal(f, mid))), eps));
    const convex = v3.dot(u2, normal(faces[0], mid)) < 0;
    // past a free end a cut runs on (through the face there), an addition stops at it
    const m = convex ? 3 * r + eps : 0;
    const tool = prism(section(a, u1, u2, r, rho), t, free[0] ? -m : 0, L + (free[1] ? m : 0));
    return { tool, convex };
  }
  const plane = faces.find((f) => f.geomType === 'PLANE');
  const cyl = faces.find((f) => f.geomType === 'CYLINDRE');
  if (edge.geomType === 'CIRCLE' && plane && cyl) {
    const oc = R.getOC();
    const ad = new oc.BRepAdaptor_Curve(edge.wrapped);
    const circ = ad.Circle();
    const loc = circ.Location();
    const ax = circ.Axis().Direction();
    const A: Vec3 = [loc.X(), loc.Y(), loc.Z()];
    const axis = v3.norm([ax.X(), ax.Y(), ax.Z()]);
    const R0 = circ.Radius();
    ad.delete();
    // in the half plane through the axis and the edge's start: along the plane face (radially) and the cylinder (axially)
    const radial = v3.norm(v3.sub(v3.sub(a, A), v3.scale(axis, v3.dot(v3.sub(a, A), axis))));
    const u1 = into(plane, a, radial, eps);
    const u2 = into(cyl, a, axis, eps);
    const convex = v3.dot(u2, normal(plane, a)) < 0;
    const full = edge.isClosed || v3.dist(a, b) < 1e-7;
    let sweep = full ? 360 : (edge.length / R0) * (180 / Math.PI);
    // the way the edge runs round its axis
    const t0 = tuple(edge.tangentAt(0));
    let dir = v3.dot(v3.cross(axis, radial), t0) >= 0 ? axis : v3.neg(axis);
    let face = section(a, u1, u2, r, rho);
    if (!full) {
      const m = convex ? ((3 * r + eps) / R0) * (180 / Math.PI) : 0;
      if (free[0] && m) face = R.cast(R.rotate(face.wrapped, -m, A, dir)) as R.Face;
      sweep += (free[0] ? m : 0) + (free[1] ? m : 0);
      if (sweep >= 360) {
        sweep = 360;
        dir = axis;
      }
    }
    return { tool: R.revolution(face, A, dir, sweep), convex };
  }
  fail('A conic fillet takes straight edges between planar faces and circular edges between a plane and a cylinder');
}

/** The part with the conic fillet of `edges` (a tangent chain counts as one: its pieces meet at the shared ends). */
export function conicFillet(shape: Shape3D, edges: R.Edge[], r: number, rho: number): Shape3D {
  if (!(rho > 0 && rho < 1)) fail('Rho is between 0 and 1');
  const ends = edges.map((e) => [tuple(e.startPoint), tuple(e.endPoint)]);
  const shared = (q: Vec3, i: number) => ends.some((pair, j) => j !== i && pair.some((x) => v3.dist(x, q) < 1e-6 * Math.max(1, v3.len(q))));
  const pieces = edges.map((e, i) => piece(shape, e, r, rho, [!shared(ends[i][0], i), !shared(ends[i][1], i)]));
  let out = shape;
  const cut = pieces.filter((p) => p.convex).map((p) => p.tool);
  const add = pieces.filter((p) => !p.convex).map((p) => p.tool);
  if (cut.length) out = out.cut(cut.length === 1 ? cut[0] : fuseAll(cut));
  if (add.length) out = out.fuse(add.length === 1 ? add[0] : fuseAll(add));
  try {
    return out.simplify();
  } catch {
    return out;
  }
}
