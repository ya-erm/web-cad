// Direct edits of a solid's faces (Onshape Delete face, Move face, Replace face). OpenCascade's defeaturing is not
// in this build, so the gaps are closed from the faces around them:
//
// - a set of faces whose boundary runs in closed loops over the faces around it (a hole, a pocket, a boss) is a
//   volume of its own: the set and caps on those faces close it — the hole is filled, the boss cut off;
// - a set with planar faces around it (a fillet, a chamfer) is healed by those planes: within the set's box the
//   solid becomes what the planes bound;
// - a planar face with planar faces around it moves to a new plane: the faces around it extend or shrink to it.

import * as R from 'replicad';
import { v3 } from '../core/math';
import type { Vec3 } from '../core/types';
import { bboxOf, fail, isEmptyShape, prism, simplified, type Shape3D } from './geom';
import { topologyOf } from './meshing';

/** A plane: a point on it and its normal (out of the material, for a face's plane). */
export interface Plane {
  p: Vec3;
  n: Vec3;
}

/** A motion of shapes and the same of points (moves a feature, or a face's plane). */
export interface Motion {
  shape: (s: Shape3D) => Shape3D;
  point: (q: Vec3) => Vec3;
}

const signed = (pl: Plane, q: Vec3) => v3.dot(v3.sub(q, pl.p), pl.n);

/** The faces around a set of faces (indices of the solid's faces) and the edges each shares with the set. */
function around(shape: Shape3D, set: number[]): { face: number; edges: number[] }[] {
  const t = topologyOf(shape);
  const mine = new Set(set.flatMap((i) => t.faceInfo[i].edges ?? []));
  const out: { face: number; edges: number[] }[] = [];
  t.faceInfo.forEach((info, i) => {
    if (set.includes(i)) return;
    const shared = (info.edges ?? []).filter((e) => mine.has(e));
    if (shared.length) out.push({ face: i, edges: shared });
  });
  return out;
}

/** Whether every face around a face runs along `n` (planes parallel to it, cylinders with their axis along it). */
function wallsAlong(shape: Shape3D, face: number, n: Vec3): boolean {
  const t = topologyOf(shape);
  return around(shape, [face]).every(({ face: a }) => {
    const info = t.faceInfo[a];
    if (info.type === 'PLANE' && info.normal) return Math.abs(v3.dot(info.normal, n)) < 1e-7;
    if (info.type === 'CYLINDRE' && info.axis) return Math.abs(v3.dot(v3.norm(info.axis), n)) > 1 - 1e-7;
    return false;
  });
}

/** Whether two faces of the solid lie on one surface (coplanar planes; coaxial cylinders of one radius). */
function sameSurface(shape: Shape3D, a: number, b: number): boolean {
  const t = topologyOf(shape);
  const [fa, fb] = [t.faceInfo[a], t.faceInfo[b]];
  const tol = 1e-6 * Math.max(1, v3.dist(...bboxOf(shape)));
  if (fa.type !== fb.type) return false;
  if (fa.type === 'PLANE' && fa.normal && fb.normal)
    return v3.dot(fa.normal, fb.normal) > 1 - 1e-9 && Math.abs(v3.dot(v3.sub(fb.center, fa.center), fa.normal)) < tol;
  if (fa.type === 'CYLINDRE' && fa.axis && fb.axis && fa.axisPoint && fb.axisPoint && fa.radius !== undefined && fb.radius !== undefined) {
    const d = v3.norm(fa.axis);
    const off = v3.sub(fb.axisPoint, fa.axisPoint);
    return Math.abs(fa.radius - fb.radius) < tol && Math.abs(Math.abs(v3.dot(d, v3.norm(fb.axis))) - 1) < 1e-9 && v3.len(v3.sub(off, v3.scale(d, v3.dot(off, d)))) < tol;
  }
  return false;
}

/** A set of faces with the faces next to it that continue its surfaces (one surface split in pieces by earlier edits). */
export function withPieces(shape: Shape3D, set: number[]): number[] {
  const out = [...set];
  for (let grew = true; grew; ) {
    grew = false;
    for (const { face } of around(shape, out))
      if (out.some((i) => sameSurface(shape, i, face))) {
        out.push(face);
        grew = true;
      }
  }
  return out;
}

/** The plane of a planar face of the solid. */
function planeOf(shape: Shape3D, i: number): Plane | null {
  const info = topologyOf(shape).faceInfo[i];
  return info.type === 'PLANE' && info.normal ? { p: info.center, n: info.normal } : null;
}

/** Edges (indices) in connected chains: those sharing an end go together. */
function chains(shape: Shape3D, edges: number[]): number[][] {
  const info = topologyOf(shape).edgeInfo;
  const tol = 1e-6 * Math.max(1, v3.dist(...bboxOf(shape)));
  const ends = (i: number) => [info[i].start, info[i].end];
  const groups: number[][] = [];
  for (const e of edges) {
    const joined = groups.filter((g) => g.some((o) => ends(o).some((a) => ends(e).some((b) => v3.dist(a, b) < tol))));
    const merged = [e, ...joined.flat()];
    for (const g of joined) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups;
}

/** A face on the surface of `on` bounded by a closed wire. */
function capOn(shape: Shape3D, on: number, wire: R.Wire): R.Face {
  const t = topologyOf(shape);
  if (t.faceInfo[on].type === 'PLANE') return R.makeFace(wire);
  const oc = R.getOC();
  const mk = new oc.BRepBuilderAPI_MakeFace(oc.BRep_Tool.Surface(t.faces[on].wrapped), wire.wrapped, true);
  if (!mk.IsDone()) fail('The faces around the selected ones cannot close the gap');
  const f = R.cast(mk.Face()) as R.Face;
  mk.delete();
  return f;
}

/**
 * The volume a set of faces encloses with caps on the faces around it — when its boundary runs in closed loops over
 * each of them (a hole, a pocket, a boss); none otherwise.
 */
function enclosed(shape: Shape3D, set: number[]): Shape3D | null {
  const t = topologyOf(shape);
  const caps: R.Face[] = [];
  for (const n of around(shape, set)) {
    for (const chain of chains(shape, n.edges)) {
      let wire: R.Wire;
      try {
        wire = R.assembleWire(chain.map((i) => t.edges[i]));
      } catch {
        return null;
      }
      if (!wire.isClosed) return null;
      caps.push(capOn(shape, n.face, wire));
    }
  }
  try {
    const v = R.makeSolid([...set.map((i) => t.faces[i]), ...caps]) as Shape3D;
    return isEmptyShape(v) ? null : v;
  } catch {
    return null;
  }
}

const volumeOf = (s: Shape3D) => {
  const props = R.measureShapeVolumeProperties(s);
  const v = props.volume;
  props.delete();
  return v;
};

/** Whether an enclosed volume is the solid's material (a boss) rather than a void in it (a hole, a pocket). */
function isMaterial(shape: Shape3D, v: Shape3D): boolean {
  return volumeOf(shape.intersect(v)) > 0.5 * volumeOf(v);
}

/** A box solid between two corners (grown by `grow` on every side). */
function box([lo, hi]: [Vec3, Vec3], grow = 0): Shape3D {
  return R.makeBox(
    lo.map((c) => c - grow) as Vec3,
    hi.map((c) => c + grow) as Vec3,
  ) as Shape3D;
}

/** The half-space on the side `n` points to from the plane through `p` (a box of `size`). */
export function halfSpace(p: Vec3, n: Vec3, size: number): Shape3D {
  const u = v3.norm(v3.cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const w = v3.cross(n, u);
  const c = (a: number, b: number) => v3.add(p, v3.add(v3.scale(u, a * size), v3.scale(w, b * size)));
  return prism(R.makePolygon([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)]), n, 0, size);
}

/** `region` cut by a plane: what lies on its material side (`inside`) or the other. */
function clip(region: Shape3D, pl: Plane, inside: boolean, size: number): Shape3D {
  return region.intersect(halfSpace(pl.p, inside ? v3.neg(pl.n) : pl.n, size));
}

/** The box around some faces of the solid. */
function facesBox(shape: Shape3D, set: number[]): [Vec3, Vec3] {
  const t = topologyOf(shape);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of set) {
    const [a, b] = bboxOf(t.faces[i]);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[k]);
      hi[k] = Math.max(hi[k], b[k]);
    }
  }
  return [lo, hi];
}

/** The planes of the faces around a set, each with the side of it the set lies on; none — if one is not planar. */
function aroundPlanes(shape: Shape3D, set: number[]): { pl: Plane; inside: boolean }[] | null {
  const t = topologyOf(shape);
  const n = set.length;
  const center = v3.scale(set.reduce((s, i) => v3.add(s, t.faceInfo[i].center), [0, 0, 0] as Vec3), 1 / n);
  const tol = 1e-7 * Math.max(1, v3.dist(...bboxOf(shape)));
  const out: { pl: Plane; inside: boolean }[] = [];
  for (const a of around(shape, set)) {
    const pl = planeOf(shape, a.face);
    if (!pl) return null;
    out.push({ pl, inside: signed(pl, center) <= tol });
  }
  return out;
}

/**
 * Delete faces of a solid and heal it (Onshape Delete face, Heal): a hole or a pocket is filled, a boss cut off,
 * a fillet or a chamfer between planar faces gives way to the planes it rounded.
 */
export function deleteFaces(shape: Shape3D, selected: number[]): Shape3D {
  const set = withPieces(shape, selected);
  const v = enclosed(shape, set);
  if (v) return simplified(isMaterial(shape, v) ? shape.cut(v) : shape.fuse(v));
  const planes = aroundPlanes(shape, set);
  if (!planes) fail('The faces around the selected ones cannot close the gap: select a whole hole, pocket or boss, or a blend between planar faces');
  const b = facesBox(shape, set);
  const [lo, hi] = b;
  const big = Math.max(1, v3.dist(...bboxOf(shape))) * 4;
  // a flat set (a planar face between others): no volume for the planes to fill
  if (Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) <= 1e-6 * big) fail('These faces cannot be healed: nothing around them closes the gap');
  // within the box the healed solid is what the planes bound: inside those the set lies inside of, and inside at
  // least one of the others (a blend in an inner corner)
  let region = box(b);
  for (const { pl, inside } of planes) if (inside) region = clip(region, pl, true, big);
  const outer = planes.filter((x) => !x.inside);
  if (outer.length) {
    let air = region;
    for (const { pl } of outer) air = clip(air, pl, false, big);
    region = isEmptyShape(air) ? region : region.cut(air);
  }
  return simplified(shape.cut(box(b)).fuse(region));
}

/**
 * Move a planar face to another plane (Onshape Move face / Replace face): the faces around it, all planar, extend or
 * shrink to it. `reach` — how far any point of the face moves (the box the change happens in).
 */
export function movePlanarFace(shape: Shape3D, face: number, to: Plane, reach: number): { add: Shape3D | null; remove: Shape3D | null } {
  const from = planeOf(shape, face);
  if (!from) fail('Only planar faces can be offset or replaced');
  // straight along the normal with walls along it all round (planes, cylinders — a rounded corner): the face's own prism
  if (Math.abs(v3.dot(to.n, from.n)) > 1 - 1e-9 && wallsAlong(shape, face, from.n)) {
    const d = signed(from, to.p);
    if (Math.abs(d) < 1e-9) return { add: null, remove: null };
    const pr = prism(topologyOf(shape).faces[face], from.n, Math.min(0, d), Math.max(0, d));
    return d > 0 ? { add: pr, remove: null } : { add: null, remove: pr };
  }
  const planes = aroundPlanes(shape, [face]);
  if (!planes) fail('The faces around a moved face must be planar');
  const big = Math.max(1, v3.dist(...bboxOf(shape)), reach) * 4;
  // the column the face's neighbours bound, around where it is and where it goes
  let column = box(facesBox(shape, [face]), reach + 1e-6);
  for (const { pl, inside } of planes) column = clip(column, pl, inside, big);
  if (isEmptyShape(column)) return { add: null, remove: null };
  // material behind the new plane and in front of the old one comes; in front of the new and behind the old goes
  const add = clip(clip(column, to, true, big), from, false, big);
  const remove = clip(clip(column, to, false, big), from, true, big);
  return { add: isEmptyShape(add) ? null : add, remove: isEmptyShape(remove) ? null : remove };
}

/** Move faces of a solid that enclose a feature (a hole, a pocket, a boss) — the whole feature moves. */
export function moveFeature(shape: Shape3D, selected: number[], motion: Motion): Shape3D {
  const v = enclosed(shape, withPieces(shape, selected));
  if (!v) fail('Select all the faces of a hole, pocket or boss to move it (or planar faces to offset)');
  const material = isMaterial(shape, v);
  const healed = material ? shape.cut(v) : shape.fuse(v);
  const moved = motion.shape(v);
  return simplified(material ? healed.fuse(moved) : healed.cut(moved));
}

/**
 * A full cylindrical face (a hole's wall, a boss's side — its pieces with it) offset by `d` along its normal (out of
 * the material): its radius changes, between the faces it meets across its axis. A hole narrows (d > 0) or widens.
 */
export function offsetCylinder(shape: Shape3D, face: number, d: number): Shape3D {
  const t = topologyOf(shape);
  const set = withPieces(shape, [face]);
  const info = t.faceInfo[face];
  if (info.type !== 'CYLINDRE' || !info.axis || !info.axisPoint || info.radius === undefined) fail('Only planar and cylindrical faces can be offset');
  const a = v3.norm(info.axis);
  const r = info.radius;
  // where it starts and ends along its axis: its circles, square to the axis
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const e of new Set(set.flatMap((i) => t.faceInfo[i].edges ?? []))) {
    const ei = t.edgeInfo[e];
    if (ei.seam) continue;
    if (ei.type !== 'CIRCLE' || !ei.axis || Math.abs(Math.abs(v3.dot(v3.norm(ei.axis), a)) - 1) > 1e-6)
      fail('A cylindrical face changes its radius between faces square to its axis only');
    for (const q of [ei.start, ei.circleCenter ?? ei.start]) {
      const v = v3.dot(v3.sub(q, info.axisPoint), a);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  }
  const h = v1 - v0;
  if (!(h > 1e-9)) fail('The cylindrical face has no length along its axis');
  // all the way round (a hole, a boss), not a part of it (a fillet)
  const area = set.reduce((s, i) => s + t.faceInfo[i].area, 0);
  if (Math.abs(area - 2 * Math.PI * r * h) > 0.01 * area) fail('Only full cylinders (holes, bosses) change their radius: offset a fillet with Fillet');
  // the face looks away from its axis (a boss) or towards it (a hole)
  const p = t.edgeInfo[(t.faceInfo[face].edges ?? []).find((e) => !t.edgeInfo[e].seam) ?? 0].start;
  const radial = v3.sub(v3.sub(p, info.axisPoint), v3.scale(a, v3.dot(v3.sub(p, info.axisPoint), a)));
  const n = t.faces[face].normalAt(p);
  const out = n.x * radial[0] + n.y * radial[1] + n.z * radial[2] > 0 ? 1 : -1;
  n.delete();
  const r2 = r + out * d;
  if (!(r2 > 1e-9)) fail('The offset would close the hole: a smaller distance');
  const base = v3.add(info.axisPoint, v3.scale(a, v0));
  const ring = (R.makeCylinder(Math.max(r, r2), h, base, a) as Shape3D).cut(R.makeCylinder(Math.min(r, r2), h, base, a) as Shape3D);
  // out of the material: material comes; into it: material goes
  return simplified(d > 0 ? shape.fuse(ring) : shape.cut(ring));
}

/** Whether a set of faces encloses a feature of its own (a whole hole, pocket or boss). */
export function encloses(shape: Shape3D, set: number[]): boolean {
  return !!enclosed(shape, withPieces(shape, set));
}

/** Whether all the faces are planar. */
export function allPlanar(shape: Shape3D, set: number[]): boolean {
  const t = topologyOf(shape);
  return set.every((i) => t.faceInfo[i].type === 'PLANE');
}

/** The plane of a planar face of the solid (its normal out of the material). */
export function facePlane(shape: Shape3D, i: number): Plane {
  const pl = planeOf(shape, i);
  if (!pl) fail('Only planar faces can be offset or replaced');
  return pl;
}

/** How far the points of some faces move at most (the corners of their box). */
export function reachOf(shape: Shape3D, set: number[], point: (q: Vec3) => Vec3): number {
  const [lo, hi] = facesBox(shape, set);
  let d = 0;
  for (const x of [lo[0], hi[0]])
    for (const y of [lo[1], hi[1]])
      for (const z of [lo[2], hi[2]]) {
        const q: Vec3 = [x, y, z];
        d = Math.max(d, v3.dist(q, point(q)));
      }
  return d;
}
