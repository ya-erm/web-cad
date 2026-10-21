// Tessellation and topology metadata (faces/edges/vertices) for display, picking and
// persistent references. Results are cached per shape object.

import * as R from 'replicad';
import type { Vec3 } from '../core/types';
import { v3 } from '../core/math';
import type { EdgeInfo, FaceInfo, PartMesh } from './protocol';
import { bboxDiag, bboxOf, type Shape3D } from './geom';

export interface Topology {
  faces: R.Face[];
  edges: R.Edge[];
  vertices: Vec3[];
  faceInfo: FaceInfo[];
  edgeInfo: EdgeInfo[];
}

interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceRanges: Int32Array;
  edgePositions: Float32Array;
  edgeRanges: Int32Array;
  quality: number;
}

const topoCache = new WeakMap<object, Topology>();
const meshCache = new WeakMap<object, MeshData>();

const tuple = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

function faceInfoOf(face: R.Face): FaceInfo {
  const oc = R.getOC();
  const props = new oc.GProp_GProps();
  let area = 0;
  let center: Vec3 = [0, 0, 0];
  try {
    oc.BRepGProp.SurfaceProperties(face.wrapped, props, false, true);
    area = props.Mass();
    const c = props.CentreOfMass();
    center = tuple(c);
    c.delete();
    if (!(area > 0)) {
      oc.BRepGProp.SurfaceProperties(face.wrapped, props, 1e-6, false);
      area = props.Mass();
      const c2 = props.CentreOfMass();
      center = tuple(c2);
      c2.delete();
    }
  } finally {
    props.delete();
  }
  const type = face.geomType;
  const info: FaceInfo = { type, center, area };
  try {
    if (type === 'PLANE') {
      const n = face.normalAt(center);
      info.normal = n.toTuple();
      n.delete();
    } else if (type === 'CYLINDRE') {
      const ad = new oc.BRepAdaptor_Surface(face.wrapped, false);
      const cyl = ad.Cylinder();
      const ax = cyl.Axis();
      const d = ax.Direction();
      const l = ax.Location();
      info.axis = [d.X(), d.Y(), d.Z()];
      info.axisPoint = [l.X(), l.Y(), l.Z()];
      info.radius = cyl.Radius();
      // Centre of mass of a full cylinder lies on its axis; keep it but also record normal at centre
      ad.delete();
    } else if (type === 'CONE' || type === 'REVOLUTION_SURFACE' || type === 'TORUS' || type === 'SPHERE') {
      const ad = new oc.BRepAdaptor_Surface(face.wrapped, false);
      if (type === 'SPHERE') {
        const s = ad.Sphere();
        info.radius = s.Radius();
        const l = s.Location();
        info.axisPoint = [l.X(), l.Y(), l.Z()];
      } else if (type === 'CONE') {
        // axis, half-angle and apex: the radius stays unset so face signatures of existing documents do not change
        Object.assign(info, coneAxis(face));
      } else if (type === 'TORUS') {
        Object.assign(info, torusTube(face));
      } else if (type === 'REVOLUTION_SURFACE') {
        const ax = ad.AxeOfRevolution();
        const d = ax.Direction();
        const l = ax.Location();
        info.axis = [d.X(), d.Y(), d.Z()];
        info.axisPoint = [l.X(), l.Y(), l.Z()];
      }
      ad.delete();
    }
  } catch {
    /* metadata is best effort */
  }
  return info;
}

type Axis = { axis: Vec3; axisPoint: Vec3 };
type OcXYZ = { X(): number; Y(): number; Z(): number };
type OcPnt = OcXYZ & { Transformed(t: unknown): OcXYZ };

/**
 * Axis of a conical face (the adaptor has no Cone() binding: read the underlying Geom surface), with its half-angle
 * and apex when the binding has them — the axis then points from the apex into the cone.
 */
function coneAxis(face: R.Face): (Axis & { semiAngle?: number; apex?: Vec3 }) | undefined {
  const oc = R.getOC();
  const surf = oc.BRep_Tool.Surface(face.wrapped) as unknown as {
    Axis?(): { Location(): OcPnt; Direction(): OcXYZ };
    SemiAngle?(): number;
    Apex?(): OcPnt;
  };
  if (typeof surf.Axis !== 'function') return undefined;
  const ax = surf.Axis();
  const trsf = face.wrapped.Location().Transformation();
  const o = ax.Location();
  const d = ax.Direction();
  const p0 = tuple(o.Transformed(trsf));
  const p1 = tuple(new oc.gp_Pnt(o.X() + d.X(), o.Y() + d.Y(), o.Z() + d.Z()).Transformed(trsf));
  let axis = v3.norm(v3.sub(p1, p0));
  const out: Axis & { semiAngle?: number; apex?: Vec3 } = { axis, axisPoint: p0 };
  if (typeof surf.SemiAngle === 'function' && typeof surf.Apex === 'function') {
    const a = surf.SemiAngle();
    // a negative half-angle narrows the cone along the axis: turn the axis round so it always widens
    if (a < 0) axis = v3.scale(axis, -1);
    Object.assign(out, { axis, semiAngle: Math.abs(a), apex: tuple(surf.Apex().Transformed(trsf)) });
  }
  return out;
}

/**
 * The tube of a toroidal face (the binding has no Torus()): the normals at two points of one meridian meet at
 * the centre of the tube — that point and the tube radius. The major radius follows once the axis is known.
 */
function torusTube(face: R.Face): { minorRadius: number; tubePoint: Vec3 } | undefined {
  const at = [0.25, 0.75].map((v) => {
    const p = face.pointOnSurface(0.5, v);
    const n = face.normalAt(p);
    const r = { p: p.toTuple() as Vec3, n: v3.norm(n.toTuple() as Vec3) };
    p.delete();
    n.delete();
    return r;
  });
  // closest points of the two normal lines p + s·n
  const [a, b] = at;
  const w = v3.sub(a.p, b.p);
  const k = v3.dot(a.n, b.n);
  const den = 1 - k * k;
  if (den < 1e-9) return undefined;
  const s = (k * v3.dot(b.n, w) - v3.dot(a.n, w)) / den;
  const t = (v3.dot(b.n, w) - k * v3.dot(a.n, w)) / den;
  const qa = v3.add(a.p, v3.scale(a.n, s));
  const qb = v3.add(b.p, v3.scale(b.n, t));
  if (v3.dist(qa, qb) > 1e-4 * (1 + Math.abs(s))) return undefined;
  const q = v3.scale(v3.add(qa, qb), 0.5);
  return { minorRadius: v3.dist(a.p, q), tubePoint: q };
}

function edgeInfoOf(edge: R.Edge): EdgeInfo {
  const type = edge.geomType;
  const s = edge.startPoint;
  const e = edge.endPoint;
  const m = edge.pointAt(0.5);
  const info: EdgeInfo = {
    type,
    start: s.toTuple(),
    end: e.toTuple(),
    center: m.toTuple(),
    length: 0,
  };
  s.delete();
  e.delete();
  m.delete();
  try {
    info.length = edge.length;
  } catch {
    info.length = v3.dist(info.start, info.end);
  }
  try {
    info.closed = edge.isClosed;
  } catch {
    /* ignore */
  }
  if (type === 'LINE') {
    info.dir = v3.norm(v3.sub(info.end, info.start));
  } else if (type === 'CIRCLE') {
    const oc = R.getOC();
    const ad = new oc.BRepAdaptor_Curve(edge.wrapped);
    try {
      const c = ad.Circle();
      const loc = c.Location();
      const ax = c.Axis().Direction();
      info.radius = c.Radius();
      info.circleCenter = [loc.X(), loc.Y(), loc.Z()];
      info.axis = [ax.X(), ax.Y(), ax.Z()];
    } finally {
      ad.delete();
    }
  }
  return info;
}

export function topologyOf(shape: Shape3D): Topology {
  let t = topoCache.get(shape);
  if (t) return t;
  const faces = shape.faces;
  const edges = shape.edges;
  const vertices: Vec3[] = [];
  for (const v of R.iterTopo(shape.wrapped, 'vertex')) {
    const vx = R.cast(v) as R.Vertex;
    vertices.push(vx.asTuple());
  }
  // Mesh first so that SurfaceProperties can use the triangulation.
  ensureMesh(shape, 1);
  t = {
    faces,
    edges,
    vertices,
    faceInfo: faces.map(faceInfoOf),
    edgeInfo: edges.map(edgeInfoOf),
  };
  markSeams(t);
  topoCache.set(shape, t);
  return t;
}

/**
 * Face → edge adjacency (FaceInfo.edges, for "Use" of a face). Edges bounded by a single face
 * (periodic seams) are flagged so the UI can hide them.
 */
function markSeams(t: Topology) {
  const buckets = new Map<number, number[]>();
  t.edges.forEach((e, i) => {
    const h = e.hashCode;
    const b = buckets.get(h);
    if (b) b.push(i);
    else buckets.set(h, [i]);
  });
  const faceSets: Set<number>[] = t.edges.map(() => new Set());
  t.faces.forEach((f, fi) => {
    const own = new Set<number>();
    for (const fe of f.edges) {
      const cand = buckets.get(fe.hashCode) ?? [];
      for (const i of cand) {
        if (t.edges[i].isSame(fe)) {
          faceSets[i].add(fi);
          own.add(i);
          break;
        }
      }
    }
    t.faceInfo[fi].edges = [...own];
  });
  faceSets.forEach((set, i) => {
    if (set.size === 1) t.edgeInfo[i].seam = true;
  });
  // torus (no binding for its axis): the axis of a circular boundary edge, seams excluded
  for (const info of t.faceInfo) {
    if (info.type !== 'TORUS' || info.axis) continue;
    const rim = (info.edges ?? []).map((i) => t.edgeInfo[i]).find((e) => !e.seam && e.type === 'CIRCLE' && e.axis && e.circleCenter);
    if (rim) {
      info.axis = rim.axis;
      info.axisPoint = rim.circleCenter;
      // the tube's centre circle: its radius is the distance of the tube's centre from the axis
      if (info.tubePoint && rim.axis && rim.circleCenter) {
        const v = v3.sub(info.tubePoint, rim.circleCenter);
        info.majorRadius = v3.len(v3.sub(v, v3.scale(rim.axis, v3.dot(v, rim.axis))));
      }
    }
  }
}

function ensureMesh(shape: Shape3D, quality: number): MeshData {
  const cached = meshCache.get(shape);
  if (cached && cached.quality === quality) return cached;
  const diag = Math.max(bboxDiag(bboxOf(shape)), 1e-3);
  const tolerance = Math.max((diag * 6e-4) / quality, 1e-4);
  const angularTolerance = 0.3 / Math.sqrt(quality);
  const m = shape.mesh({ tolerance, angularTolerance });
  const faceRanges = new Int32Array(m.faceGroups.length * 2);
  m.faceGroups.forEach((g, i) => {
    faceRanges[i * 2] = g.start;
    faceRanges[i * 2 + 1] = g.count;
  });
  const em = shape.meshEdges({ tolerance, angularTolerance });
  const edgeRanges = new Int32Array(em.edgeGroups.length * 2);
  em.edgeGroups.forEach((g, i) => {
    edgeRanges[i * 2] = g.start;
    edgeRanges[i * 2 + 1] = g.count;
  });
  const data: MeshData = {
    positions: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    faceRanges,
    edgePositions: new Float32Array(em.lines),
    edgeRanges,
    quality,
  };
  meshCache.set(shape, data);
  return data;
}

/** Mesh for display; arrays are copied so that they can be transferred to the UI thread. */
/** Shapes' numbers for their meshes' keys (a shape is not changed in place: the same number, the same mesh). */
const shapeNumbers = new WeakMap<object, number>();
let lastShapeNumber = 0;

export function meshPart(
  id: string,
  shape: Shape3D,
  meta: { name: string; color: string; hidden: boolean },
  quality = 1,
): PartMesh {
  const topo = topologyOf(shape);
  const m = ensureMesh(shape, quality);
  const verts = new Float32Array(topo.vertices.length * 3);
  topo.vertices.forEach((p, i) => verts.set(p, i * 3));
  let n = shapeNumbers.get(shape);
  if (n === undefined) shapeNumbers.set(shape, (n = ++lastShapeNumber));
  return {
    id,
    meshKey: `${n}@${quality}`,
    name: meta.name,
    color: meta.color,
    hidden: meta.hidden,
    positions: m.positions.slice(),
    normals: m.normals.slice(),
    indices: m.indices.slice(),
    faceRanges: m.faceRanges.slice(),
    edgePositions: m.edgePositions.slice(),
    edgeRanges: m.edgeRanges.slice(),
    vertices: verts,
    faces: topo.faceInfo,
    edges: topo.edgeInfo,
    bbox: bboxOf(shape),
  };
}

export function transferablesOf(p: PartMesh): ArrayBuffer[] {
  return [
    p.positions.buffer,
    p.normals.buffer,
    p.indices.buffer,
    p.faceRanges.buffer,
    p.edgePositions.buffer,
    p.edgeRanges.buffer,
    p.vertices.buffer,
  ] as ArrayBuffer[];
}

/** Plain mesh at a requested resolution (for STL/OBJ/3MF export). */
export function exportMesh(shape: Shape3D, tolerance: number, angularTolerance: number) {
  const m = shape.mesh({ tolerance, angularTolerance });
  return {
    positions: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
  };
}
