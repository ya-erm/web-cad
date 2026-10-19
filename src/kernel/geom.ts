// Thin helpers over replicad / OpenCascade used by the feature builders.
// IMPORTANT: replicad's Shape.translate/rotate/mirror/scale delete their receiver.
// Shapes are shared between cached build states, so we only use the free functions here.

import * as R from 'replicad';
import type { PlaneFrame, Vec2, Vec3 } from '../core/types';
import { toWorld, v3 } from '../core/math';
import type { ProfileCurve, ProfileLoop, SketchRegion } from '../sketch/regions';

export type Shape3D = R.Shape3D;

export class FeatureError extends Error {}

export function fail(msg: string): never {
  throw new FeatureError(msg);
}

export function frameToPlane(f: PlaneFrame): R.Plane {
  return new R.Plane(f.origin, f.xDir, f.normal);
}

export function translated<T extends R.AnyShape>(s: T, v: Vec3): Shape3D {
  return R.cast(R.translate(s.wrapped, v)) as Shape3D;
}

/** angle in degrees */
export function rotated<T extends R.AnyShape>(s: T, angleDeg: number, origin: Vec3, axis: Vec3): Shape3D {
  return R.cast(R.rotate(s.wrapped, angleDeg, origin, axis)) as Shape3D;
}

export function mirrored<T extends R.AnyShape>(s: T, origin: Vec3, normal: Vec3): Shape3D {
  return R.cast(R.mirror(s.wrapped, normal, origin)) as Shape3D;
}

export function scaled<T extends R.AnyShape>(s: T, factor: number, center: Vec3): Shape3D {
  return R.cast(R.scale(s.wrapped, center, factor)) as Shape3D;
}

export function solidsOf(s: R.AnyShape): R.Solid[] {
  if (s instanceof R.Solid) return [s];
  return [...R.iterTopo(s.wrapped, 'solid')].map((x) => R.cast(x) as R.Solid);
}

/** A surface body (Onshape surfaces): faces with no solid — open shells, sheets. */
export function isSurface(s: R.AnyShape): boolean {
  return solidsOf(s).length === 0 && [...R.iterTopo(s.wrapped, 'face')].length > 0;
}

/** Faces sewn together into one shell (or the face itself) — a surface body. */
export function sewFaces(faces: R.Face[]): Shape3D {
  if (faces.length === 1) return faces[0].clone() as unknown as Shape3D;
  const oc = R.getOC();
  const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  for (const f of faces) sew.Add(f.wrapped);
  sew.Perform(new oc.Message_ProgressRange());
  const out = R.cast(sew.SewedShape()) as Shape3D;
  sew.delete();
  return out;
}

export function compoundOf(shapes: R.AnyShape[]): Shape3D {
  if (shapes.length === 1) return shapes[0] as Shape3D;
  // makeCompound deletes its inputs' wrappers, so pass clones.
  return R.makeCompound(shapes.map((s) => s.clone())) as Shape3D;
}

export function fuseAll(shapes: Shape3D[]): Shape3D {
  if (shapes.length === 0) fail('Nothing to fuse');
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) acc = acc.fuse(shapes[i]);
  if (shapes.length > 1) {
    try {
      acc = acc.simplify();
    } catch {
      /* keep unsimplified */
    }
  }
  return acc;
}

/** The shape with coplanar / co-surface faces merged (as it is when that fails). */
export function simplified(s: Shape3D): Shape3D {
  try {
    return s.simplify();
  } catch {
    return s;
  }
}

export function isEmptyShape(s: R.AnyShape | null | undefined): boolean {
  if (!s) return true;
  try {
    return solidsOf(s).length === 0;
  } catch {
    return true;
  }
}

export function bboxOf(s: R.AnyShape): [Vec3, Vec3] {
  const [a, b] = s.boundingBox.bounds;
  return [a as Vec3, b as Vec3];
}

export function bboxDiag(b: [Vec3, Vec3]) {
  return v3.dist(b[0], b[1]);
}

/** Distance between shapes (0 when touching/intersecting). */
export function shapesTouch(a: R.AnyShape, b: R.AnyShape, tol = 1e-6): boolean {
  const [a0, a1] = bboxOf(a);
  const [b0, b1] = bboxOf(b);
  for (let i = 0; i < 3; i++) {
    if (a1[i] < b0[i] - tol * 10 || b1[i] < a0[i] - tol * 10) return false;
  }
  const d = new R.DistanceTool();
  try {
    return d.distanceBetween(a, b) <= tol * 10;
  } finally {
    d.delete();
  }
}

// ---------------------------------------------------------------------------
// Profiles from sketch regions
// ---------------------------------------------------------------------------

function arcMid(c: Vec2, r: number, start: Vec2, end: Vec2, ccw: boolean): Vec2 {
  const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
  let a1 = Math.atan2(end[1] - c[1], end[0] - c[0]);
  if (ccw) {
    while (a1 <= a0 + 1e-12) a1 += Math.PI * 2;
  } else {
    while (a1 >= a0 - 1e-12) a1 -= Math.PI * 2;
  }
  const am = (a0 + a1) / 2;
  return [c[0] + r * Math.cos(am), c[1] + r * Math.sin(am)];
}

function ellipseEdge(
  f: PlaneFrame,
  c: Vec2,
  rx: number,
  ry: number,
  rot: number,
  reversed: boolean,
  t0?: number,
  t1?: number,
): R.Edge {
  // makeEllipse requires major >= minor: swap axes if needed (rotate by 90°).
  let major = rx;
  let minor = ry;
  let ang = rot;
  let shift = 0;
  if (ry > rx) {
    major = ry;
    minor = rx;
    ang = rot + Math.PI / 2;
    shift = -Math.PI / 2;
  }
  const xd: Vec3 = v3.add(v3.scale(f.xDir, Math.cos(ang)), v3.scale(f.yDir, Math.sin(ang)));
  const n = reversed ? v3.neg(f.normal) : f.normal;
  const center = toWorld(f, c);
  if (t0 === undefined || t1 === undefined) return R.makeEllipse(major, minor, center, n, xd);
  // Parameters measured CCW around +normal; with reversed normal the sense flips.
  let s0 = t0 + shift;
  let s1 = t1 + shift;
  if (reversed) {
    s0 = -s0;
    s1 = -s1;
  }
  return R.makeEllipseArc(major, minor, s0, s1, center, n, xd);
}

function curveEdge(f: PlaneFrame, c: ProfileCurve, reverseClosed: boolean): R.Edge {
  const W = (p: Vec2) => toWorld(f, p);
  switch (c.kind) {
    case 'line':
      return R.makeLine(W(c.a), W(c.b));
    case 'arc': {
      const mid = arcMid(c.c, c.r, c.start, c.end, c.ccw);
      return R.makeThreePointArc(W(c.start), W(mid), W(c.end));
    }
    case 'circle':
      return R.makeCircle(c.r, W(c.c), reverseClosed ? v3.neg(f.normal) : f.normal);
    case 'ellipse':
      return ellipseEdge(f, c.c, c.rx, c.ry, c.rot, reverseClosed);
    case 'ellipseArc': {
      // Build via three points for robustness (ellipse arcs are rare).
      const pts = sampleEllipseArc(c.c, c.rx, c.ry, c.rot, c.t0, c.t1, c.ccw, 24);
      return R.makeBSplineApproximation(pts.map(W), { tolerance: 1e-5 });
    }
    case 'spline':
      if (c.pts.length === 2) return R.makeLine(W(c.pts[0]), W(c.pts[1]));
      return R.makeBSplineApproximation(c.pts.map(W), { tolerance: 1e-5, degMax: 5 });
  }
}

function sampleEllipseArc(c: Vec2, rx: number, ry: number, rot: number, t0: number, t1: number, ccw: boolean, n: number): Vec2[] {
  let a = t0;
  let b = t1;
  if (ccw) while (b <= a) b += Math.PI * 2;
  else while (b >= a) b -= Math.PI * 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push([c[0] + x * cr - y * sr, c[1] + x * sr + y * cr]);
  }
  return out;
}

/** Wire following the loop orientation (outer CCW, holes CW in the sketch frame). */
export function loopToWire(f: PlaneFrame, loop: ProfileLoop): R.Wire {
  const cw = loop.area < 0;
  const edges = loop.curves.map((c) => curveEdge(f, c, cw));
  return R.assembleWire(edges);
}

export function regionToFace(f: PlaneFrame, region: SketchRegion): R.Face {
  const outer = loopToWire(f, region.outer);
  const holes = region.holes.map((h) => loopToWire(f, h));
  return R.makeFace(outer, holes);
}

/** Extrude a planar face along vector `dir * dist` starting at offset `start` along dir. */
export function prism(face: R.Face, dir: Vec3, start: number, end: number): Shape3D {
  if (Math.abs(end - start) < 1e-9) fail('Depth must be non-zero');
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let base: R.Face = face;
  if (Math.abs(lo) > 1e-12) base = R.cast(R.translate(face.wrapped, v3.scale(dir, lo))) as R.Face;
  return R.basicFaceExtrusion(base, new R.Vector(v3.scale(dir, hi - lo)));
}

export function sweepFace(face: R.Face, spine: R.Wire, keepOrientation: boolean): Shape3D {
  const outer = R.cast(R.getOC().BRepTools.OuterWire(face.wrapped)) as R.Wire;
  const cfg = { frenet: !keepOrientation, transitionMode: 'round' as const };
  let solid = R.genericSweep(outer, spine, cfg);
  const holes = face.wires.filter((w) => !w.isSame(outer));
  for (const h of holes) {
    const hs = R.genericSweep(h, spine, cfg);
    solid = solid.cut(hs);
  }
  return solid;
}

export function sketchFrameBasis(f: PlaneFrame) {
  return { o: f.origin, x: f.xDir, y: f.yDir, n: f.normal };
}
