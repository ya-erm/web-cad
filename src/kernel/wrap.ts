// Wrap (Onshape): sketch regions rolled onto a cylindrical face without stretching — a point of the sketch plane
// (which runs along the cylinder's axis) goes round the cylinder by its distance across the axis and along it by its
// distance along the axis. In the face's own (angle, height) parameters that is an affine map, so the regions are
// drawn there (arcs as Bézier curves) and the face is built on the cylinder itself, then thickened out or in.

import * as R from 'replicad';
import { v3 } from '../core/math';
import type { PlaneFrame, Vec2, Vec3 } from '../core/types';
import type { ProfileCurve, ProfileLoop, SketchRegion } from '../sketch/regions';
import { fail, type Shape3D } from './geom';

/** The cylinder to wrap onto: its axis, radius and the face. */
export interface WrapTarget {
  face: R.Face;
  axisPoint: Vec3;
  axis: Vec3;
  radius: number;
}

type Affine = (q: Vec2) => Vec2;

/** Sketch coordinates → the cylinder face's (angle, height) parameters. */
function wrapMap(frame: PlaneFrame, t: WrapTarget, region: SketchRegion): Affine {
  const a = v3.norm(t.axis);
  if (Math.abs(v3.dot(frame.normal, a)) > 1e-6) fail('The sketch plane must run along the cylinder axis (parallel to it)');
  // from the axis towards the sketch plane, and across the axis within the plane
  const side = v3.dot(v3.sub(frame.origin, t.axisPoint), frame.normal) >= 0 ? 1 : -1;
  const c = v3.scale(frame.normal, side);
  const w = v3.cross(a, c);
  const R0 = t.radius;
  const A = t.axisPoint;
  // (u, v): across and along the axis
  const uv = (q: Vec2): Vec2 => {
    const p = v3.add(frame.origin, v3.add(v3.scale(frame.xDir, q[0]), v3.scale(frame.yDir, q[1])));
    const r = v3.sub(p, A);
    return [v3.dot(r, w), v3.dot(r, a)];
  };
  // the face's parameters of the point the plane touches, and which way they go
  const at = (theta: number, v: number): Vec3 => v3.add(A, v3.add(v3.scale(c, R0 * Math.cos(theta)), v3.add(v3.scale(w, R0 * Math.sin(theta)), v3.scale(a, v))));
  const [U0, V0] = t.face.uvCoordinates(at(0, 0));
  const dU = t.face.uvCoordinates(at(1e-3, 0))[0] - U0;
  const sigma = Math.sign(Math.abs(dU) > Math.PI ? -dU : dU) || 1;
  const tau = Math.sign(t.face.uvCoordinates(at(0, 1))[1] - V0) || 1;
  // the region's angles kept within the face's (seam to seam)
  const us = [...region.polygon, ...region.holePolygons.flat()].map((q) => uv(q)[0] / R0);
  const lo = Math.min(...us);
  const hi = Math.max(...us);
  if (hi - lo >= 2 * Math.PI - 1e-9) fail('The region is longer than the cylinder is round');
  const { uMin, uMax } = t.face.UVBounds;
  let shift = 0;
  const fits = (s: number) => {
    const a1 = U0 + s + sigma * lo;
    const a2 = U0 + s + sigma * hi;
    return Math.min(a1, a2) >= uMin - 1e-9 && Math.max(a1, a2) <= uMax + 1e-9;
  };
  const k = [0, 2 * Math.PI, -2 * Math.PI].find(fits);
  if (k === undefined) fail('The region does not fit on the cylindrical face (it crosses its seam or edge)');
  shift = k;
  return (q) => {
    const [u, v] = uv(q);
    return [U0 + shift + (sigma * u) / R0, V0 + tau * v];
  };
}

/** A curve of a loop drawn with the pen through the map (arcs and ellipses as cubic Béziers — the map keeps those). */
function drawCurve(pen: R.DrawingPen, c: ProfileCurve, m: Affine) {
  const bez = (cx: Vec2, rx: number, ry: number, rot: number, t0: number, t1: number) => {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const P = (t: number): Vec2 => [cx[0] + rx * Math.cos(t) * cr - ry * Math.sin(t) * sr, cx[1] + rx * Math.cos(t) * sr + ry * Math.sin(t) * cr];
    const D = (t: number): Vec2 => [-rx * Math.sin(t) * cr - ry * Math.cos(t) * sr, -rx * Math.sin(t) * sr + ry * Math.cos(t) * cr];
    const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 2) - 1e-9));
    for (let i = 0; i < n; i++) {
      const a = t0 + ((t1 - t0) * i) / n;
      const b = t0 + ((t1 - t0) * (i + 1)) / n;
      const k = (4 / 3) * Math.tan((b - a) / 4);
      const p0 = P(a);
      const p3 = P(b);
      const p1: Vec2 = [p0[0] + k * D(a)[0], p0[1] + k * D(a)[1]];
      const p2: Vec2 = [p3[0] - k * D(b)[0], p3[1] - k * D(b)[1]];
      pen.cubicBezierCurveTo(m(p3), m(p1), m(p2));
    }
  };
  switch (c.kind) {
    case 'line':
      pen.lineTo(m(c.b));
      return;
    case 'arc': {
      const t0 = Math.atan2(c.start[1] - c.c[1], c.start[0] - c.c[0]);
      let t1 = Math.atan2(c.end[1] - c.c[1], c.end[0] - c.c[0]);
      if (c.ccw) while (t1 <= t0) t1 += 2 * Math.PI;
      else while (t1 >= t0) t1 -= 2 * Math.PI;
      bez(c.c, c.r, c.r, 0, t0, t1);
      return;
    }
    case 'circle':
      bez(c.c, c.r, c.r, 0, 0, 2 * Math.PI);
      return;
    case 'ellipse':
      bez(c.c, c.rx, c.ry, c.rot, 0, 2 * Math.PI);
      return;
    case 'ellipseArc': {
      let t1 = c.t1;
      if (c.ccw) while (t1 <= c.t0) t1 += 2 * Math.PI;
      else while (t1 >= c.t0) t1 -= 2 * Math.PI;
      bez(c.c, c.rx, c.ry, c.rot, c.t0, t1);
      return;
    }
    case 'spline':
      for (const q of c.pts.slice(1)) pen.lineTo(m(q));
  }
}

/** Where a loop's first curve starts. */
function loopStart(c: ProfileCurve): Vec2 {
  switch (c.kind) {
    case 'line':
      return c.a;
    case 'arc':
    case 'ellipseArc':
      return c.start;
    case 'circle':
      return [c.c[0] + c.r, c.c[1]];
    case 'ellipse':
      return [c.c[0] + c.rx * Math.cos(c.rot), c.c[1] + c.rx * Math.sin(c.rot)];
    case 'spline':
      return c.pts[0];
  }
}

function loopDrawing(loop: ProfileLoop, m: Affine): R.Drawing {
  const pen = R.draw(m(loopStart(loop.curves[0])));
  for (const c of loop.curves) drawCurve(pen, c, m);
  return pen.close();
}

/** A sketch region on the cylinder, thickened by `depth` (+ out of it, − into it). */
export function wrapRegion(frame: PlaneFrame, region: SketchRegion, t: WrapTarget, depth: number): Shape3D {
  const m = wrapMap(frame, t, region);
  let drawing = loopDrawing(region.outer, m);
  for (const h of region.holes) drawing = drawing.cut(loopDrawing(h, m));
  const sketch = drawing.sketchOnFace(t.face, 'native') as unknown as { face?(): R.Face; sketches?: { face(): R.Face }[] };
  const faces = sketch.face ? [sketch.face()] : (sketch.sketches ?? []).map((s) => s.face());
  const solids = faces.map((f) => thickened(f, t.face, depth));
  return solids.length === 1 ? solids[0] : solids.slice(1).reduce((acc, s) => acc.fuse(s), solids[0]);
}

/** A face on the target thickened out of the material (`depth` > 0) or into it. */
function thickened(face: R.Face, target: R.Face, depth: number): Shape3D {
  // the offset goes the way the face looks; out of the material is the way the target face looks
  const c = face.center;
  const along = face.normalAt(c).dot(target.normalAt(c)) > 0 ? 1 : -1;
  const oc = R.getOC();
  const b = new oc.BRepOffsetAPI_MakeThickSolid();
  b.MakeThickSolidBySimple(face.wrapped, along * depth);
  b.Build(new oc.Message_ProgressRange());
  if (!b.IsDone()) fail('The wrapped region could not be thickened');
  let solid = R.cast(b.Shape()) as Shape3D;
  b.delete();
  // turned inside out (a negative volume) — the right way round
  const props = R.measureShapeVolumeProperties(solid);
  if (props.volume < 0) solid = R.cast(solid.wrapped.Reversed()) as Shape3D;
  props.delete();
  return solid;
}
