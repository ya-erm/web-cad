// Which feature made each face of a part (Onshape: hovering a face highlights the feature that created it).
//
// After every feature the faces of the parts it changed are matched with the faces before it: a face on the same
// surface (plane, cylinder …) overlapping one of them is that face, trimmed or split — it keeps its feature (the
// top of a block keeps its Extrude when a hole goes through it); the rest are the feature's own.

import * as R from 'replicad';
import type { Vec3 } from '../core/types';
import type { Shape3D } from './geom';
import type { BuildState } from './state';

export interface FaceOrigin {
  /** The surface the face lies on (see `surfaceKey`). */
  key: string;
  box: [Vec3, Vec3];
  /** The feature that made it. */
  feature: string;
}

/** A part's faces (in `shape.faces` order — the meshes' face indices) with their features. */
export interface PartFaceOrigins {
  shape: Shape3D;
  faces: FaceOrigin[];
}

/** Rounded to 10⁻⁵ mm (−0 → 0): the text of equal surfaces is equal. */
const r5 = (x: number) => (Math.round(x * 1e5) / 1e5 + 0).toString();
const txt = (v: Vec3) => v.map(r5).join(',');
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const xyz = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

/** A direction up to its sign: the first component that is not zero is positive. */
function unsigned(d: Vec3): Vec3 {
  const k = Math.abs(d[0]) > 1e-9 ? d[0] : Math.abs(d[1]) > 1e-9 ? d[1] : d[2];
  return k < 0 ? [-d[0], -d[1], -d[2]] : d;
}

/** The point of a line nearest the origin (the line's own point, wherever it was given). */
function linePoint(p: Vec3, a: Vec3): Vec3 {
  const t = dot(p, a);
  return [p[0] - a[0] * t, p[1] - a[1] * t, p[2] - a[2] * t];
}

/** The surface a face lies on, as text: the faces of one plane, cylinder, sphere (or other surface) share it. */
export function surfaceKey(face: R.Face): string {
  const oc = R.getOC();
  const type = face.geomType;
  const ad = new oc.BRepAdaptor_Surface(face.wrapped, false);
  // the OpenCascade values made on the way, freed at the end
  const made: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(o: T): T => (made.push(o), o);
  try {
    if (type === 'PLANE') {
      const pl = own(ad.Plane());
      const n = unsigned(xyz(own(own(pl.Axis()).Direction())));
      return `P ${txt(n)} ${r5(dot(n, xyz(own(pl.Location()))))}`;
    }
    if (type === 'CYLINDRE') {
      const c = own(ad.Cylinder());
      const a = unsigned(xyz(own(own(c.Axis()).Direction())));
      return `C ${txt(a)} ${txt(linePoint(xyz(own(c.Location())), a))} ${r5(c.Radius())}`;
    }
    if (type === 'SPHERE') {
      const s = own(ad.Sphere());
      return `S ${txt(xyz(own(s.Location())))} ${r5(s.Radius())}`;
    }
    // other surfaces (cones, tori, B-splines, swept …): points of the whole surface, not of the face, so trimming
    // keeps them
    const lim = (x: number, other: number) => (Number.isFinite(x) && Math.abs(x) < 1e6 ? x : other);
    const u0 = lim(ad.FirstUParameter(), 0);
    const u1 = lim(ad.LastUParameter(), 1);
    const v0 = lim(ad.FirstVParameter(), 0);
    const v1 = lim(ad.LastVParameter(), 1);
    const pts = [
      [u0, v0],
      [u1, v1],
      [(u0 + u1) / 2, (v0 + v1) / 2],
    ].map(([u, v]) => {
      const p = ad.Value(u, v);
      const out = xyz(p);
      p.delete();
      return txt(out);
    });
    return `${type} ${pts.join(' ')}`;
  } catch {
    return `${type} ?`;
  } finally {
    for (const o of made) o.delete();
    ad.delete();
  }
}

/** A face's box: a quick one from its curves (or its mesh), a little larger than the exact one. */
function boxOf(face: R.Face): [Vec3, Vec3] {
  const b = new R.BoundingBox();
  // (replicad's `boundingBox` is the exact one, about 4 ms a face)
  R.getOC().BRepBndLib.Add(face.wrapped, b.wrapped, true);
  const bounds = b.bounds as [Vec3, Vec3];
  b.delete();
  return bounds;
}

/** Two faces' boxes share an area (not just an edge or a corner). */
function overlaps(a: [Vec3, Vec3], b: [Vec3, Vec3]): boolean {
  let wide = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.min(a[1][k], b[1][k]) - Math.max(a[0][k], b[0][k]);
    if (d < -1e-6) return false;
    if (d > 1e-4) wide++;
  }
  return wide >= 2;
}

/** The faces of a shape with their surfaces and boxes, by the features `feature(i, key, box)` gives. */
function facesOf(shape: Shape3D, feature: (i: number, key: string, box: [Vec3, Vec3]) => string): FaceOrigin[] {
  return shape.faces.map((f, i) => {
    const key = surfaceKey(f);
    const box = boxOf(f);
    return { key, box, feature: feature(i, key, box) };
  });
}

/**
 * The features of the faces of `next`'s parts after feature `featureId` changed `prev` into it: unchanged parts keep
 * theirs, a part only moved (the same topology) keeps them face by face, the rest are matched (see above).
 */
export function trackFaceOrigins(prev: BuildState, next: BuildState, featureId: string): void {
  const origins = new Map<string, PartFaceOrigins>();
  let bySurface: Map<string, FaceOrigin[]> | null = null;
  const earlier = () => {
    if (!bySurface) {
      bySurface = new Map();
      for (const o of prev.faceOrigins.values())
        for (const f of o.faces) {
          const list = bySurface.get(f.key);
          if (list) list.push(f);
          else bySurface.set(f.key, [f]);
        }
    }
    return bySurface;
  };
  for (const [id, p] of next.parts) {
    const old = prev.faceOrigins.get(id);
    if (old?.shape === p.shape) {
      origins.set(id, old);
      continue;
    }
    try {
      if (old && old.shape.wrapped.IsPartner(p.shape.wrapped)) {
        origins.set(id, { shape: p.shape, faces: facesOf(p.shape, (i) => old.faces[i]?.feature ?? featureId) });
        continue;
      }
      const faces = facesOf(p.shape, (_i, key, box) => earlier().get(key)?.find((o) => overlaps(o.box, box))?.feature ?? featureId);
      origins.set(id, { shape: p.shape, faces });
    } catch {
      // no origins for this part: nothing is highlighted for its faces
    }
  }
  next.faceOrigins = origins;
}
