// Resolution of persistent references (SelRef) against a build state.
// Faces/edges/vertices are matched by geometric signature, so references survive most
// upstream edits (dimension changes, added features) as long as the geometry is similar.

import * as R from 'replicad';
import type { GeomSig, MateInference, PlaneFrame, PlaneRef, SelRef, SkEntity, Vec2, Vec3 } from '../core/types';
import { frameFromNormal, STD_PLANES, toWorld, v3 } from '../core/math';
import { arcAngles, entityMap, pointOf, sampleEntity, splineSamples } from '../sketch/curves';
import type { WorldGeom } from '../sketch/useGeometry';
import { findRegion, type SketchRegion } from '../sketch/regions';
import { textOfPart } from '../sketch/text';
import { gearOfPart } from '../sketch/gear';
import type { EdgeInfo, FaceInfo } from './protocol';
import { relativeTo } from './sigs';
import { bboxDiag, bboxOf, fail, regionToFace } from './geom';
import { topologyOf } from './meshing';
import type { BuildState, PartState, SketchState } from './state';

// ---------------------------------------------------------------------------
// Signature matching
// ---------------------------------------------------------------------------

function sizeScore(a: number, b: number) {
  return Math.abs(Math.log((Math.abs(a) + 1e-9) / (Math.abs(b) + 1e-9)));
}

function dirScore(a?: Vec3, b?: Vec3, unsigned = false) {
  if (!a || !b) return 0;
  const d = v3.dot(a, b);
  return 1 - (unsigned ? Math.abs(d) : d);
}

/** Geometric part of the score: best of absolute and bbox-relative position match. */
function positionScore(sig: GeomSig, center: Vec3, scale: number, bbox: [Vec3, Vec3]) {
  const abs = v3.dist(sig.center, center) / scale;
  if (!sig.rel) return abs;
  const rel = relativeTo(bbox, center)!;
  return Math.min(abs, v3.dist(sig.rel, rel) * 8);
}

function faceScore(sig: GeomSig, f: FaceInfo, scale: number, bbox: [Vec3, Vec3]) {
  let s = positionScore(sig, f.center, scale, bbox);
  if (sig.type !== f.type) s += 5;
  s += dirScore(sig.normal, f.normal) * 2;
  if (sig.radius !== undefined && f.radius !== undefined) s += Math.min(Math.abs(sig.radius - f.radius) / scale, 1);
  s += Math.min(sizeScore(sig.size, f.area) * 0.3, 1);
  return s;
}

function edgeScore(sig: GeomSig, e: EdgeInfo, scale: number, bbox: [Vec3, Vec3]) {
  let s = positionScore(sig, e.center, scale, bbox);
  if (sig.type !== e.type) s += 5;
  s += dirScore(sig.dir, e.dir, true) * 2;
  if (sig.radius !== undefined && e.radius !== undefined) s += Math.min(Math.abs(sig.radius - e.radius) / scale, 1);
  s += Math.min(sizeScore(sig.size, e.length) * 0.3, 1);
  return s;
}

function bestIndex<T>(items: T[], score: (t: T) => number, hint: number): number {
  if (hint >= 0 && hint < items.length && score(items[hint]) < 1e-4) return hint;
  let best = -1;
  let bestScore = Infinity;
  items.forEach((it, i) => {
    const s = score(it);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return bestScore < 4 ? best : -1;
}

// ---------------------------------------------------------------------------
// Topology references
// ---------------------------------------------------------------------------

export function getPart(st: BuildState, partId: string): PartState {
  const p = st.parts.get(partId);
  if (!p) fail('Referenced part no longer exists');
  return p;
}

function partScale(p: PartState) {
  return Math.max(bboxDiag(bboxOf(p.shape)) * 0.05, 1e-3);
}

export function resolveFace(st: BuildState, ref: SelRef) {
  if (ref.kind !== 'face') fail('Expected a face');
  const part = getPart(st, ref.partId);
  const topo = topologyOf(part.shape);
  const scale = partScale(part);
  const bbox = bboxOf(part.shape);
  const idx = bestIndex(topo.faceInfo, (f) => faceScore(ref.sig, f, scale, bbox), ref.index);
  if (idx < 0) fail('Referenced face could not be found');
  return { part, face: topo.faces[idx], index: idx, info: topo.faceInfo[idx] };
}

export function resolveEdge(st: BuildState, ref: SelRef) {
  if (ref.kind !== 'edge') fail('Expected an edge');
  const part = getPart(st, ref.partId);
  const topo = topologyOf(part.shape);
  const scale = partScale(part);
  const bbox = bboxOf(part.shape);
  const idx = bestIndex(topo.edgeInfo, (e) => edgeScore(ref.sig, e, scale, bbox), ref.index);
  if (idx < 0) fail('Referenced edge could not be found');
  return { part, edge: topo.edges[idx], index: idx, info: topo.edgeInfo[idx] };
}

export function resolveVertex(st: BuildState, ref: SelRef): Vec3 {
  if (ref.kind !== 'vertex') fail('Expected a vertex');
  const part = getPart(st, ref.partId);
  const topo = topologyOf(part.shape);
  let best = -1;
  let bd = Infinity;
  const scale = partScale(part);
  const bbox = bboxOf(part.shape);
  topo.vertices.forEach((v, i) => {
    const d = positionScore(ref.sig, v, scale, bbox);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best < 0 || bd > 4) fail('Referenced vertex could not be found');
  return topo.vertices[best];
}

/** Parts referenced directly or through one of their faces/edges/vertices. */
export function resolveParts(st: BuildState, refs: SelRef[]): PartState[] {
  const out = new Map<string, PartState>();
  for (const r of refs) {
    if (r.kind === 'part' || r.kind === 'face' || r.kind === 'edge' || r.kind === 'vertex') {
      const p = st.parts.get(r.partId);
      if (p) out.set(p.id, p);
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Sketch references
// ---------------------------------------------------------------------------

export function getSketch(st: BuildState, id: string): SketchState {
  const s = st.sketches.get(id);
  if (!s) fail('Referenced sketch is missing or comes later in the feature list');
  return s;
}

export function resolveRegion(st: BuildState, ref: SelRef): { sketch: SketchState; region: SketchRegion } {
  if (ref.kind !== 'region') fail('Expected a sketch region');
  const sketch = getSketch(st, ref.sketchId);
  const region = findRegion(sketch.regions, ref.key);
  if (!region) fail('Referenced sketch region could not be found');
  return { sketch, region };
}

export interface ProfileFace {
  face: R.Face;
  frame: PlaneFrame;
}

/** Faces for extrude/revolve/sweep: sketch regions or planar part faces. */
export function resolveProfiles(st: BuildState, refs: SelRef[]): ProfileFace[] {
  const out: ProfileFace[] = [];
  for (const r of refs) {
    if (r.kind === 'region') {
      const { sketch, region } = resolveRegion(st, r);
      out.push({ face: regionToFace(sketch.frame, region), frame: sketch.frame });
    } else if (r.kind === 'face') {
      const { face, info } = resolveFace(st, r);
      if (info.type !== 'PLANE' || !info.normal) fail('Only planar faces can be used as profiles');
      out.push({ face, frame: frameFromNormal(info.center, info.normal) });
    }
  }
  return out;
}

function sketchEntity(st: BuildState, ref: SelRef): { sketch: SketchState; ent: SkEntity; map: Map<string, SkEntity> } {
  if (ref.kind !== 'sketchEntity') fail('Expected a sketch entity');
  const sketch = getSketch(st, ref.sketchId);
  const map = entityMap(sketch.entities);
  const ent = map.get(ref.entityId);
  if (!ent) fail('Referenced sketch entity was deleted');
  return { sketch, ent, map };
}

function sketchEntityEdge(sketch: SketchState, ent: SkEntity, map: Map<string, SkEntity>): R.Edge {
  const f = sketch.frame;
  const W = (p: Vec2) => toWorld(f, p);
  switch (ent.type) {
    case 'line':
      return R.makeLine(W(pointOf(map, ent.p1)), W(pointOf(map, ent.p2)));
    case 'circle':
      return R.makeCircle(ent.r, W(pointOf(map, ent.c)), f.normal);
    case 'arc': {
      const { c, r, a0, a1 } = arcAngles(ent, map);
      const am = (a0 + a1) / 2;
      const p = (a: number): Vec2 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
      return R.makeThreePointArc(W(p(a0)), W(p(am)), W(p(a1)));
    }
    case 'ellipse': {
      const c = pointOf(map, ent.c);
      let major = ent.rx;
      let minor = ent.ry;
      let ang = ent.rot;
      if (minor > major) {
        [major, minor] = [minor, major];
        ang += Math.PI / 2;
      }
      const xd = v3.add(v3.scale(f.xDir, Math.cos(ang)), v3.scale(f.yDir, Math.sin(ang)));
      return R.makeEllipse(major, minor, W(c), f.normal, xd);
    }
    case 'spline': {
      const pts = splineSamples(ent, map, 24);
      return R.makeBSplineApproximation(pts.map(W), { tolerance: 1e-5, degMax: 5 });
    }
    case 'point':
      fail('A point is not a curve');
    case 'text':
      fail('Select the letters of the text, not the text itself');
    case 'gear':
      fail('Select the teeth of the gear, not the gear itself');
  }
}

/** Edge-like geometry: part edges, sketch curves, helix curves. */
export function resolveCurveEdges(st: BuildState, ref: SelRef): R.Edge[] {
  if (ref.kind === 'edge') return [resolveEdge(st, ref).edge];
  if (ref.kind === 'sketchEntity') {
    const curve = st.curves.get(ref.sketchId);
    if (curve) return curve.wire.edges;
    const { sketch, ent, map } = sketchEntity(st, ref);
    // a text: the curves of its letters; a gear: of its teeth
    if (ent.type === 'text' || ent.type === 'gear') {
      const of = ent.type === 'text' ? textOfPart : gearOfPart;
      return sketch.entities.filter((e) => e.type !== 'point' && !e.construction && of(e.id) === ent.id).map((e) => sketchEntityEdge(sketch, e, map));
    }
    return [sketchEntityEdge(sketch, ent, map)];
  }
  fail('Expected an edge or a sketch curve');
}

export function resolvePoint(st: BuildState, ref: SelRef): Vec3 {
  switch (ref.kind) {
    case 'origin':
      return [0, 0, 0];
    case 'vertex':
      return resolveVertex(st, ref);
    case 'sketchEntity': {
      const { sketch, ent, map } = sketchEntity(st, ref);
      if (ent.type === 'point') return toWorld(sketch.frame, [ent.x, ent.y]);
      if (ent.type === 'circle' || ent.type === 'arc' || ent.type === 'ellipse')
        return toWorld(sketch.frame, pointOf(map, ent.c));
      if (ent.type === 'line') {
        const a = pointOf(map, ent.p1);
        const b = pointOf(map, ent.p2);
        return toWorld(sketch.frame, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      }
      fail('Cannot use this sketch entity as a point');
      break;
    }
    case 'edge': {
      const { info } = resolveEdge(st, ref);
      return info.circleCenter ?? info.center;
    }
    case 'face': {
      const { info } = resolveFace(st, ref);
      return info.center;
    }
    case 'plane': {
      // a mate connector is a point too (its origin)
      const m = st.mates.get(ref.planeId);
      if (m) return m.frame.origin;
      break;
    }
  }
  fail('Expected a point or vertex');
}

/** Sketch point with its sketch normal (for holes). */
export function resolveHolePoint(st: BuildState, ref: SelRef): { p: Vec3; n: Vec3 } {
  if (ref.kind === 'sketchEntity') {
    const { sketch } = sketchEntity(st, ref);
    return { p: resolvePoint(st, ref), n: sketch.frame.normal };
  }
  if (ref.kind === 'vertex') return { p: resolveVertex(st, ref), n: [0, 0, 1] };
  if (ref.kind === 'edge') {
    const { info } = resolveEdge(st, ref);
    if (info.circleCenter && info.axis) return { p: info.circleCenter, n: info.axis };
  }
  // a mate connector (Onshape): at its origin, drilled against its Z (flip its primary axis to turn the hole round)
  if (ref.kind === 'plane') {
    const fr = resolvePlaneRef(st, ref);
    return { p: fr.origin, n: fr.normal };
  }
  fail('Select sketch points for hole locations');
}

export interface Axis {
  origin: Vec3;
  dir: Vec3;
}

/** Axis from a linear edge, sketch line, circular edge, cylindrical face or plane normal. */
export function resolveAxis(st: BuildState, ref: SelRef): Axis {
  switch (ref.kind) {
    case 'edge': {
      const { info } = resolveEdge(st, ref);
      if (info.dir) return { origin: info.start, dir: info.dir };
      if (info.circleCenter && info.axis) return { origin: info.circleCenter, dir: info.axis };
      fail('Edge cannot be used as an axis');
      break;
    }
    case 'face': {
      const { info } = resolveFace(st, ref);
      if (info.axis && info.axisPoint) return { origin: info.axisPoint, dir: info.axis };
      if (info.normal) return { origin: info.center, dir: info.normal };
      fail('Face cannot be used as an axis');
      break;
    }
    case 'sketchEntity': {
      const curve = st.curves.get(ref.sketchId);
      if (curve) fail('Curve cannot be used as an axis');
      const { sketch, ent, map } = sketchEntity(st, ref);
      if (ent.type === 'line') {
        const a = toWorld(sketch.frame, pointOf(map, ent.p1));
        const b = toWorld(sketch.frame, pointOf(map, ent.p2));
        return { origin: a, dir: v3.norm(v3.sub(b, a)) };
      }
      if (ent.type === 'circle' || ent.type === 'arc')
        return { origin: toWorld(sketch.frame, pointOf(map, ent.c)), dir: sketch.frame.normal };
      fail('Sketch entity cannot be used as an axis');
      break;
    }
    case 'plane': {
      const f = resolvePlaneId(st, ref.planeId);
      return { origin: f.origin, dir: f.normal };
    }
  }
  fail('Select an axis (line, edge or cylindrical face)');
}

export function resolveDirection(st: BuildState, ref: SelRef): Vec3 {
  return resolveAxis(st, ref).dir;
}

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

export function resolvePlaneId(st: BuildState, planeId: string): PlaneFrame {
  if (planeId === 'top' || planeId === 'front' || planeId === 'right') return STD_PLANES[planeId];
  // plane features and mate connectors (their XY plane; normal = Z axis)
  const frame = st.planes.get(planeId)?.frame ?? st.mates.get(planeId)?.frame;
  if (!frame) fail('Referenced plane or mate connector is missing');
  return frame;
}

/**
 * Frame implied by a mate connector location: origin and Z axis from the entity
 * (Onshape inference: face centroid / normal, edge mid point / direction, circle centre / axis…).
 */
export function locationFrame(
  st: BuildState,
  ref: SelRef,
  inference: MateInference = 'default',
  orientFace?: SelRef,
): { origin: Vec3; z: Vec3; x?: Vec3 } {
  const base = locationPoint(st, ref, inference);
  if (!orientFace) return base;
  // picked on a planar face: parallel to it (Onshape)
  const { info } = resolveFace(st, orientFace);
  return info.normal ? { origin: base.origin, z: info.normal } : base;
}

function locationPoint(st: BuildState, ref: SelRef, inference: MateInference): { origin: Vec3; z: Vec3; x?: Vec3 } {
  switch (ref.kind) {
    case 'origin':
      return { origin: [0, 0, 0], z: [0, 0, 1], x: [1, 0, 0] };
    case 'vertex':
      return { origin: resolveVertex(st, ref), z: [0, 0, 1], x: [1, 0, 0] };
    case 'plane': {
      const f = resolvePlaneId(st, ref.planeId);
      return { origin: f.origin, z: f.normal, x: f.xDir };
    }
    case 'edge': {
      const { info } = resolveEdge(st, ref);
      const along = inference === 'start' ? info.start : inference === 'end' ? info.end : inference === 'mid' ? info.center : null;
      if (info.circleCenter && info.axis) return { origin: along ?? info.circleCenter, z: info.axis };
      return { origin: along ?? info.center, z: info.dir ?? [0, 0, 1] };
    }
    case 'face': {
      const { part, index, info } = resolveFace(st, ref);
      // sphere: its centre
      if (info.type === 'SPHERE' && info.axisPoint) return { origin: info.axisPoint, z: [0, 0, 1], x: [1, 0, 0] };
      if (info.axis && info.axisPoint) {
        // cylinder / cone / torus / revolved surface: a point on the axis at the start / middle / end of the face along it
        const a = info.axis;
        const o = info.axisPoint;
        const topo = topologyOf(part.shape);
        const ts: number[] = [];
        for (const ei of topo.faceInfo[index].edges ?? []) {
          const e = topo.edgeInfo[ei];
          for (const p of [e.start, e.end, e.center]) ts.push(v3.dot(v3.sub(p, o), a));
        }
        const t =
          ts.length && inference !== 'default'
            ? inference === 'start'
              ? Math.min(...ts)
              : inference === 'end'
                ? Math.max(...ts)
                : (Math.min(...ts) + Math.max(...ts)) / 2
            : ts.length
              ? (Math.min(...ts) + Math.max(...ts)) / 2
              : v3.dot(v3.sub(info.center, o), a);
        return { origin: v3.add(o, v3.scale(a, t)), z: a };
      }
      return { origin: info.center, z: info.normal ?? [0, 0, 1] };
    }
    case 'sketchEntity': {
      const { sketch, ent, map } = sketchEntity(st, ref);
      const f = sketch.frame;
      if (ent.type === 'line') {
        const a = toWorld(f, pointOf(map, ent.p1));
        const b = toWorld(f, pointOf(map, ent.p2));
        return { origin: v3.scale(v3.add(a, b), 0.5), z: f.normal, x: v3.norm(v3.sub(b, a)) };
      }
      return { origin: resolvePoint(st, ref), z: f.normal, x: f.xDir };
    }
  }
  fail('Select a vertex, edge, face, sketch entity, plane or the origin');
}

/** Plane frame from a plane, planar face or sketch (its plane). */
export function resolvePlaneRef(st: BuildState, ref: SelRef): PlaneFrame {
  if (ref.kind === 'plane') return resolvePlaneId(st, ref.planeId);
  if (ref.kind === 'face') {
    const { info } = resolveFace(st, ref);
    if (info.type !== 'PLANE' || !info.normal) fail('Select a planar face');
    return frameFromNormal(info.center, info.normal);
  }
  if (ref.kind === 'region') return resolveRegion(st, ref).sketch.frame;
  if (ref.kind === 'sketchEntity') return getSketch(st, ref.sketchId).frame;
  fail('Select a plane or planar face');
}

export function resolveSketchPlane(st: BuildState, plane: PlaneRef): PlaneFrame {
  if (plane.kind === 'std') return STD_PLANES[plane.name];
  if (plane.kind === 'feature') return resolvePlaneId(st, plane.featureId);
  const { info } = resolveFace(st, plane.ref);
  if (info.type !== 'PLANE' || !info.normal) fail('Sketch plane must be planar');
  // Sketch origin: projection of the world origin onto the face plane keeps
  // coordinates stable when the face moves along its normal.
  const n = info.normal;
  const d = v3.dot(info.center, n);
  return frameFromNormal(v3.scale(n, d), n);
}

export function sketchRegionsOf(st: BuildState, sketchId: string) {
  return getSketch(st, sketchId).regions;
}

/** World-space geometry of a referenced edge / vertex / sketch entity (for sketch "Use"). */
export function worldGeometryForRef(st: BuildState, ref: SelRef): WorldGeom {
  if (ref.kind === 'vertex') return { kind: 'point', p: resolveVertex(st, ref) };
  if (ref.kind === 'edge') {
    const { edge, info } = resolveEdge(st, ref);
    if (info.type === 'LINE') return { kind: 'line', a: info.start, b: info.end };
    if (info.type === 'CIRCLE' && info.circleCenter && info.axis && info.radius) {
      if (info.closed) return { kind: 'circle', c: info.circleCenter, r: info.radius, axis: info.axis };
      return { kind: 'arc', c: info.circleCenter, r: info.radius, axis: info.axis, start: info.start, mid: info.center, end: info.end };
    }
    const pts: Vec3[] = [];
    for (let i = 0; i <= 32; i++) {
      const v = edge.pointAt(i / 32);
      pts.push(v.toTuple());
      v.delete();
    }
    return { kind: 'poly', pts };
  }
  if (ref.kind === 'sketchEntity') {
    const { sketch, ent, map } = sketchEntity(st, ref);
    const W = (p: Vec2) => toWorld(sketch.frame, p);
    switch (ent.type) {
      case 'point':
        return { kind: 'point', p: W([ent.x, ent.y]) };
      case 'line':
        return { kind: 'line', a: W(pointOf(map, ent.p1)), b: W(pointOf(map, ent.p2)) };
      case 'circle':
        return { kind: 'circle', c: W(pointOf(map, ent.c)), r: ent.r, axis: sketch.frame.normal };
      case 'arc': {
        const a = arcAngles(ent, map);
        const P = (t: number): Vec2 => [a.c[0] + a.r * Math.cos(t), a.c[1] + a.r * Math.sin(t)];
        return { kind: 'arc', c: W(a.c), r: a.r, axis: sketch.frame.normal, start: W(P(a.a0)), mid: W(P((a.a0 + a.a1) / 2)), end: W(P(a.a1)) };
      }
      default:
        return { kind: 'poly', pts: sampleEntity(ent, map).map(W) };
    }
  }
  if (ref.kind === 'origin') return { kind: 'point', p: [0, 0, 0] };
  fail('Cannot project this reference');
}
