// Assembly mates (Onshape): each mate ties a mate connector of one instance to a mate connector of another
// and leaves only the degrees of freedom of its type. The solver walks the mates from the fixed instances
// and moves every other instance to the nearest placement that satisfies its mates — the free degrees of
// freedom keep their current values.

import type { AssemblyGroup, AssemblyInstance, AssemblyMate, AssemblyMateType, AssemblyTab, MateConnectorRef, MateEnd, MateRelation, MateRelationType, Vec3 } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import { frameFromNormal, rotateVec } from '../core/math';
import { placementOf, rotationAngles, sourceKey, sourceMesh, type AssemblySources, type Placement } from './compose';
import { expandAssembly, findInstance, foldPlacements, hasSubassemblies, topInstance, usedTabs, type Moved } from './expand';

/** Degrees of freedom each mate type leaves (Onshape). */
export const MATE_DOF: Record<AssemblyMateType, string> = {
  fastened: '0',
  revolute: '1 R',
  slider: '1 T',
  cylindrical: '1 R + 1 T',
  planar: '2 T + 1 R',
  ball: '3 R',
  parallel: '3 T + 1 R',
  pinSlot: '1 R + 1 T',
  tangent: '3–5',
  width: '2 T + 1 R',
};

/** Mates between faces (not mate connectors): their ends are faces of known shape. */
export const FACE_MATES: AssemblyMateType[] = ['tangent', 'width'];

/**
 * A face's surface in its part's coordinates. Cone: `p` — the apex, `d` — the axis widening from it, `a` — the
 * half-angle; torus: `p` — its centre, `d` — the axis, `R` — radius of the tube's centre circle, `r` — of the tube.
 */
export type Surf =
  | { kind: 'plane'; p: Vec3; n: Vec3 }
  | { kind: 'cylinder'; p: Vec3; d: Vec3; r: number }
  | { kind: 'sphere'; p: Vec3; r: number }
  | { kind: 'cone'; p: Vec3; d: Vec3; a: number }
  | { kind: 'torus'; p: Vec3; d: Vec3; R: number; r: number };

export function surfaceOf(mesh: PartMesh, index: number): Surf | null {
  const f = mesh.faces[index];
  if (!f) return null;
  if (f.type === 'PLANE' && f.normal) return { kind: 'plane', p: f.center, n: f.normal };
  if (f.type === 'CONE' && f.apex && f.axis && f.semiAngle) return { kind: 'cone', p: f.apex, d: f.axis, a: f.semiAngle };
  if (f.type === 'TORUS' && f.axis && f.axisPoint && f.tubePoint && f.majorRadius && f.minorRadius) {
    const k = dot(sub(f.tubePoint, f.axisPoint), f.axis);
    return { kind: 'torus', p: add(f.axisPoint, f.axis.map((c) => c * k) as Vec3), d: f.axis, R: f.majorRadius, r: f.minorRadius };
  }
  if (f.type === 'CYLINDRE' && f.axis && f.axisPoint && f.radius) {
    // the point of the axis level with the face's centre (the middle of the cylinder), not the kernel's origin
    const v = sub(f.center, f.axisPoint);
    const k = v[0] * f.axis[0] + v[1] * f.axis[1] + v[2] * f.axis[2];
    return { kind: 'cylinder', p: add(f.axisPoint, f.axis.map((c) => c * k) as Vec3), d: f.axis, r: f.radius };
  }
  if (f.type === 'SPHERE' && f.axisPoint && f.radius) return { kind: 'sphere', p: f.axisPoint, r: f.radius };
  return null;
}

/** Midplane between two parallel planar faces (a width mate's pair). */
function midplane(a: Surf | null, b: Surf | null): Surf | null {
  if (a?.kind !== 'plane' || b?.kind !== 'plane') return null;
  const c = cross(a.n, b.n);
  if (len(c) > 1e-3) return null;
  return { kind: 'plane', p: a.p.map((v, i) => (v + b.p[i]) / 2) as Vec3, n: a.n };
}

const placeSurf = (w: Frame, s: Surf): Surf => {
  const p = add(mulVec(w.R, s.p), w.o);
  if (s.kind === 'plane') return { kind: 'plane', p, n: mulVec(w.R, s.n) };
  if (s.kind === 'sphere') return { kind: 'sphere', p, r: s.r };
  return { ...s, p, d: mulVec(w.R, s.d) };
};

/** Pairs of faces a tangent mate handles: a plane with anything; cylinders and spheres with each other. */
export function tangentPair(a: Surf, b: Surf): boolean {
  const round = (s: Surf) => s.kind === 'cylinder' || s.kind === 'sphere';
  return a.kind === 'plane' || b.kind === 'plane' || (round(a) && round(b));
}

/** A torus lies flat on a plane (axis along its normal) rather than standing on its rim like a wheel. */
const lyingFlat = (t: Extract<Surf, { kind: 'torus' }>, n: Vec3) => Math.abs(dot(t.d, n)) >= Math.SQRT1_2;

/** A point inside the solid behind the face, to tell its side of a plane. */
const insidePoint = (s: Surf): Vec3 => (s.kind === 'cone' ? add(s.p, s.d) : s.p);

/** Distance from point q to the axis line (p, d). */
const toAxis = (q: Vec3, p: Vec3, d: Vec3): Vec3 => {
  const v = sub(q, p);
  return sub(v, d.map((c) => c * dot(v, d)) as Vec3);
};

type Round = Extract<Surf, { kind: 'cylinder' | 'sphere' }>;

/**
 * How far a tangent or width mate is from holding (`wa`, `wb` — the instances' placements): six numbers (mm,
 * directions × `scale`), zeros when it holds. Tangent with a plane: a plane — faces against each other; a
 * cylinder — its axis parallel to the plane at the radius; a sphere — at the radius; a cone — lying on it along
 * a generator (apex on the plane, axis tilted by the half-angle); a torus — lying flat (axis along the normal,
 * tube radius) or standing on its rim (axis in the plane, both radii). Cylinders and spheres with each other:
 * axes parallel, at the sum of the radii — or their difference inside (`flip`). Width: the midplanes of the two
 * pairs of faces coincide.
 */
function faceResidual(type: AssemblyMateType, flip: boolean, ga: Surf, gb: Surf, wa: Frame, wb: Frame, scale: number): number[] {
  const A = placeSurf(wa, ga);
  const B = placeSurf(wb, gb);
  const out = (...v: number[]) => [...v, 0, 0, 0, 0, 0, 0].slice(0, 6);
  const side = flip ? -1 : 1;
  if (A.kind === 'plane' && B.kind === 'plane') {
    // width: midplanes coincide either way round; tangent: faces against each other (or the same way, flipped)
    const nd = type === 'width' ? cross(A.n, B.n) : add(A.n, B.n.map((c) => c * side) as Vec3);
    return out(dot(sub(B.p, A.p), A.n), nd[0] * scale, nd[1] * scale, nd[2] * scale);
  }
  if (A.kind === 'plane' || B.kind === 'plane') {
    const pl = (A.kind === 'plane' ? A : B) as Extract<Surf, { kind: 'plane' }>;
    const o = (A.kind === 'plane' ? B : A) as Exclude<Surf, { kind: 'plane' }>;
    const h = dot(sub(o.p, pl.p), pl.n);
    switch (o.kind) {
      case 'sphere':
        return out(h - side * o.r);
      case 'cylinder':
        return out(h - side * o.r, dot(o.d, pl.n) * scale);
      case 'cone':
        return out(h, (dot(o.d, pl.n) - side * Math.sin(o.a)) * scale);
      case 'torus': {
        if (!lyingFlat(o, pl.n)) return out(h - side * (o.R + o.r), dot(o.d, pl.n) * scale);
        const c = cross(o.d, pl.n);
        return out(h - side * o.r, c[0] * scale, c[1] * scale, c[2] * scale);
      }
    }
  }
  const a = A as Round;
  const b = B as Round;
  const gap = flip ? Math.abs(a.r - b.r) : a.r + b.r;
  if (a.kind === 'sphere' && b.kind === 'sphere') return out(len(sub(b.p, a.p)) - gap);
  if (a.kind === 'cylinder' && b.kind === 'cylinder') {
    const c = cross(a.d, b.d);
    return out(len(toAxis(b.p, a.p, a.d)) - gap, c[0] * scale, c[1] * scale, c[2] * scale);
  }
  const cyl = (a.kind === 'cylinder' ? a : b) as Extract<Surf, { kind: 'cylinder' }>;
  const sph = a.kind === 'sphere' ? a : b;
  return out(len(toAxis(sph.p, cyl.p, cyl.d)) - gap);
}

/** Tangent mate: which way round the faces touch now (back of a plane; inside a cylinder / sphere). */
function nearestSide(ga: Surf, gb: Surf, wa: Frame, wb: Frame): boolean {
  const A = placeSurf(wa, ga);
  const B = placeSurf(wb, gb);
  if (A.kind === 'plane' && B.kind === 'plane') return dot(A.n, B.n) > 0;
  if (A.kind === 'plane' || B.kind === 'plane') {
    const pl = (A.kind === 'plane' ? A : B) as Extract<Surf, { kind: 'plane' }>;
    return dot(sub(insidePoint(A.kind === 'plane' ? B : A), pl.p), pl.n) < 0;
  }
  if (!tangentPair(A, B)) return false;
  const a = A as Round;
  const b = B as Round;
  const d = a.kind === 'cylinder' ? len(toAxis(b.p, a.p, a.d)) : b.kind === 'cylinder' ? len(toAxis(a.p, b.p, b.d)) : len(sub(b.p, a.p));
  return d < Math.max(a.r, b.r);
}

/** An orthonormal frame: rotation R (row-major, columns = X, Y, Z axes) and origin o. */
export interface Frame {
  R: number[];
  o: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** 3×3 row-major matrix product. */
export function mul(A: number[], B: number[]): number[] {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
}
export const transpose = (A: number[]) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export const mulVec = (A: number[], v: Vec3): Vec3 => [
  A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
  A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
  A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
];
const fromAxes = (x: Vec3, y: Vec3, z: Vec3) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
const column = (R: number[], j: number): Vec3 => [R[j], R[3 + j], R[6 + j]];
const rotZ = (t: number) => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
/** Z flipped: a half turn about X. */
const FLIP = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const frameOf = (o: Vec3, z: Vec3, x?: Vec3): Frame => {
  const f = frameFromNormal(o, z);
  if (x) {
    const zn = f.normal;
    const xp = sub(x, zn.map((c) => c * (x[0] * zn[0] + x[1] * zn[1] + x[2] * zn[2])) as Vec3);
    const l = len(xp);
    if (l > 1e-9) {
      const xn = xp.map((c) => c / l) as Vec3;
      const yn: Vec3 = [zn[1] * xn[2] - zn[2] * xn[1], zn[2] * xn[0] - zn[0] * xn[2], zn[0] * xn[1] - zn[1] * xn[0]];
      return { R: fromAxes(xn, yn, zn), o };
    }
  }
  return { R: fromAxes(f.xDir, f.yDir, f.normal), o };
};

/**
 * A mate connector in the coordinates of its part: an explicit one (a Part Studio mate connector owned by
 * the part) or an implicit one on the picked geometry (Onshape's implicit mate connectors): a planar face —
 * its centroid, Z = normal; a cylinder / cone — the middle of its axis; a sphere — its centre; a circular
 * edge — its centre and axis; a straight edge — its middle, Z along it; a vertex — the point.
 */
export function connectorFrame(sources: AssemblySources, inst: AssemblyInstance, ref: MateConnectorRef): Frame | null {
  const mesh = sourceMesh(sources, inst);
  if (ref.kind === 'connector') {
    const mc = sources.get(sourceKey(inst))?.mates.find((m) => m.featureId === ref.featureId);
    return mc ? { R: fromAxes(mc.frame.xDir, mc.frame.yDir, mc.frame.normal), o: mc.frame.origin } : null;
  }
  if (!mesh) return null;
  return implicitFrame(mesh, ref);
}

export function implicitFrame(mesh: PartMesh, ref: { kind: 'face' | 'edge' | 'vertex'; index: number }): Frame | null {
  if (ref.kind === 'vertex') {
    const v = mesh.vertices;
    if (ref.index * 3 + 2 >= v.length) return null;
    return frameOf([v[ref.index * 3], v[ref.index * 3 + 1], v[ref.index * 3 + 2]], [0, 0, 1]);
  }
  if (ref.kind === 'edge') {
    const e = mesh.edges[ref.index];
    if (!e) return null;
    if (e.circleCenter && e.axis) return frameOf(e.circleCenter, e.axis);
    return frameOf(e.center, e.dir ?? [0, 0, 1]);
  }
  const f = mesh.faces[ref.index];
  if (!f) return null;
  if (f.type === 'PLANE' && f.normal) return frameOf(f.center, f.normal);
  if (f.type === 'SPHERE' && f.axisPoint) return frameOf(f.axisPoint, [0, 0, 1]);
  if (f.axis && f.axisPoint) {
    // the middle of the face along its axis
    const ts = (f.edges ?? []).flatMap((i) => {
      const e = mesh.edges[i];
      return e ? [e.start, e.end, e.center].map((p) => sub(p, f.axisPoint!).reduce((s, c, k) => s + c * f.axis![k], 0)) : [];
    });
    const t = ts.length ? (Math.min(...ts) + Math.max(...ts)) / 2 : sub(f.center, f.axisPoint).reduce((s, c, k) => s + c * f.axis![k], 0);
    return frameOf(add(f.axisPoint, f.axis.map((c) => c * t) as Vec3), f.axis);
  }
  return frameOf(f.center, f.normal ?? [0, 0, 1]);
}

/** A part-local frame placed in the assembly. */
export const worldFrame = (pl: Placement, f: Frame): Frame => ({ R: mul(pl.R, f.R), o: add(mulVec(pl.R, f.o), pl.t) });

/** What the solver needs of a mate; `rigid` — a fixed relation instead of the type's (members of a group). */
export type MateSpec = Pick<AssemblyMate, 'type' | 'flip' | 'angle' | 'offset' | 'limits'> & { rigid?: Frame };

const clampTo = (v: number, lo?: number, hi?: number) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
const DEG = Math.PI / 180;

/** The second frame seen from the first. */
const relative = (wa: Frame, wb: Frame): Frame => {
  const RaT = transpose(wa.R);
  return { R: mul(RaT, wb.R), o: mulVec(RaT, sub(wb.o, wa.o)) };
};

/**
 * The relation the mate imposes on the second connector relative to the first (in the first's frame): the
 * nearest one to their current relative placement `rel` — the free degrees of freedom keep their values,
 * within the mate's limits; the offset moves the second connector along the first one's Z.
 */
export function constrainRelative(m: MateSpec, rel: Frame): Frame {
  if (m.rigid) return m.rigid;
  const F = m.flip ? FLIP : I3;
  // turn about Z of the current relative orientation
  const M = mul(rel.R, F);
  const turn = Math.atan2(M[3], M[0]);
  const lim = m.limits;
  const theta = clampTo(turn, lim?.aMin !== undefined ? lim.aMin * DEG : undefined, lim?.aMax !== undefined ? lim.aMax * DEG : undefined);
  const z = clampTo(rel.o[2], lim?.zMin, lim?.zMax);
  const fixedTurn = (m.angle ?? 0) * DEG;
  const off = m.offset ?? 0;
  switch (m.type) {
    case 'fastened':
      return { R: mul(rotZ(fixedTurn), F), o: [0, 0, off] };
    case 'revolute':
      return { R: mul(rotZ(theta), F), o: [0, 0, off] };
    case 'slider':
      return { R: mul(rotZ(fixedTurn), F), o: [0, 0, z] };
    case 'cylindrical':
      return { R: mul(rotZ(theta), F), o: [0, 0, z] };
    case 'planar':
      return { R: mul(rotZ(turn), F), o: [rel.o[0], rel.o[1], off] };
    case 'ball':
      return { R: rel.R, o: [0, 0, off] };
    case 'parallel':
      // Z axes parallel; free to move anywhere and to turn about Z
      return { R: mul(rotZ(turn), F), o: rel.o };
    case 'pinSlot': {
      // the pin (second connector's origin) turns about Z and slides along the slot — the first connector's X
      // axis, turned by the mate angle
      const d: Vec3 = [Math.cos(fixedTurn), Math.sin(fixedTurn), 0];
      const s = rel.o[0] * d[0] + rel.o[1] * d[1];
      return { R: mul(rotZ(turn), F), o: [s * d[0], s * d[1], off] };
    }
    case 'tangent':
    case 'width':
      // mates between faces are solved on the faces' shapes (faceResidual), not on connector frames
      return rel;
  }
}

/** Instance placement that puts its connector `f` (part-local) at the world frame `w`: w = pl ∘ f. */
function placeConnector(w: Frame, f: Frame): Placement {
  const R = mul(w.R, transpose(f.R));
  return { R, t: sub(w.o, mulVec(R, f.o)) };
}

/** Placement of the second end's instance so that its connector `fm` satisfies the mate against the world frame `wa`. */
export function solveMate(m: MateSpec, wa: Frame, movingPl: Placement, fm: Frame): Placement {
  const c = constrainRelative(m, relative(wa, worldFrame(movingPl, fm)));
  return placeConnector({ R: mul(wa.R, c.R), o: add(wa.o, mulVec(wa.R, c.o)) }, fm);
}

/** Placement of the first end's instance (connector `fm`) against the world frame `wb` of the second: wa = wb ∘ c⁻¹. */
export function solveFirst(m: MateSpec, wb: Frame, movingPl: Placement, fm: Frame): Placement {
  const c = constrainRelative(m, relative(worldFrame(movingPl, fm), wb));
  const R = mul(wb.R, transpose(c.R));
  return placeConnector({ R, o: sub(wb.o, mulVec(R, c.o)) }, fm);
}

/** Rotation vector (axis × angle) of a rotation matrix. */
function rotationVector(R: number[]): Vec3 {
  const th = Math.acos(clampTo((R[0] + R[4] + R[8] - 1) / 2, -1, 1));
  if (th > Math.PI - 1e-3) {
    // near a half turn the skew part vanishes: the axis comes from the diagonal
    const d = [R[0], R[4], R[8]];
    const i = d.indexOf(Math.max(...d));
    const ax = d.map((v) => Math.sqrt(Math.max(0, (v + 1) / 2)));
    for (let j = 0; j < 3; j++) if (j !== i && R[i * 3 + j] + R[j * 3 + i] < 0) ax[j] = -ax[j];
    return ax.map((v) => v * th) as Vec3;
  }
  const v: Vec3 = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  const s = Math.sin(th);
  const k = s < 1e-9 ? 0.5 : th / (2 * s);
  return [v[0] * k, v[1] * k, v[2] * k];
}

/** Rotation matrix of a rotation vector. */
function rotationOf(w: Vec3): number[] {
  const a = len(w);
  if (a < 1e-15) return I3;
  const k = w.map((c) => c / a) as Vec3;
  return fromAxes(rotateVec([1, 0, 0], k, a), rotateVec([0, 1, 0], k, a), rotateVec([0, 0, 1], k, a));
}

/** How far a mate is from satisfied: translation (mm) and rotation (radians × `scale`, mm) away from its relation. */
function mateResidual(m: MateSpec, wa: Frame, wb: Frame, scale: number): number[] {
  const rel = relative(wa, wb);
  const c = constrainRelative(m, rel);
  const d = sub(rel.o, c.o);
  const w = rotationVector(mul(transpose(c.R), rel.R));
  return [d[0], d[1], d[2], w[0] * scale, w[1] * scale, w[2] * scale];
}

/** Solve A·x = b (Gaussian elimination with partial pivoting); null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Largest mate residual allowed (mm, rotations scaled to mm). */
const MATE_TOL = 1e-4;

/** Which motion of each of its mates a relation ties: the turn about Z or the travel along Z. */
export const RELATION_MOTIONS: Record<MateRelationType, ['turn' | 'slide', 'turn' | 'slide']> = {
  gear: ['turn', 'turn'],
  rackPinion: ['turn', 'slide'],
  screw: ['turn', 'slide'],
};
/** Mate types each end of a relation accepts. */
export const RELATION_MATES: Record<MateRelationType, [AssemblyMateType[], AssemblyMateType[]]> = {
  gear: [
    ['revolute', 'cylindrical'],
    ['revolute', 'cylindrical'],
  ],
  rackPinion: [
    ['revolute', 'cylindrical'],
    ['slider', 'cylindrical'],
  ],
  screw: [['cylindrical'], ['cylindrical']],
};

/** How far the second motion goes per unit of the first: Δb = k · Δa. */
export function relationFactor(r: Pick<MateRelation, 'type' | 'value' | 'reverse'>): number {
  const s = r.reverse ? -1 : 1;
  switch (r.type) {
    case 'gear':
      return -s * r.value; // external gears turn opposite ways
    case 'rackPinion':
      return (-s * r.value) / 2; // travel = pitch radius × angle
    case 'screw':
      return (s * r.value) / (2 * Math.PI);
  }
}

/** A mate's motion in a placement: turn about Z (radians, −π…π) or travel along Z (mm). */
function motionOf(l: ValidLink, at: (id: string) => Placement, kind: 'turn' | 'slide'): number {
  const rel = relative(worldFrame(at(l.a), l.fa), worldFrame(at(l.b), l.fb));
  if (kind === 'slide') return rel.o[2];
  const M = mul(rel.R, l.spec.flip ? FLIP : I3);
  return Math.atan2(M[3], M[0]);
}

/** The angle `a` plus whole turns, nearest to `ref`: turns keep counting past ±180°. */
const unwrapNear = (a: number, ref: number) => a + 2 * Math.PI * Math.round((ref - a) / (2 * Math.PI));

interface RelationTie {
  r: MateRelation;
  la: ValidLink;
  lb: ValidLink;
}

function relationMotions(t: RelationTie, at: (id: string) => Placement): [number, number] {
  const [ka, kb] = RELATION_MOTIONS[t.r.type];
  const ma = motionOf(t.la, at, ka);
  const mb = motionOf(t.lb, at, kb);
  return [ka === 'turn' ? unwrapNear(ma, t.r.last[0]) : ma, kb === 'turn' ? unwrapNear(mb, t.r.last[1]) : mb];
}

/** How far a relation is from holding (mm; angles × `scale`). */
function relationResidual(t: RelationTie, at: (id: string) => Placement, scale: number): number {
  const [ma, mb] = relationMotions(t, at);
  const res = mb - t.r.zero[1] - relationFactor(t.r) * (ma - t.r.zero[0]);
  return RELATION_MOTIONS[t.r.type][1] === 'turn' ? res * scale : res;
}

/** How strongly a lead instance (moved by hand) keeps its place while loops and relations close around it. */
const LEAD_WEIGHT = 30;

/**
 * Closed loops (several mates reaching an instance from different sides) and mate relations: adjust all the free
 * instances at once — Levenberg–Marquardt on their placements, starting where the walk from the fixed instances
 * left them — until every mate and relation holds. A `lead` instance (dragged or typed) is held back so that the
 * others move rather than pulling it away. Returns the new placements, or null if they cannot all hold.
 */
function closeLoops(all: ValidLink[], ties: RelationTie[], pl: Map<string, Placement>, fixed: Set<string>, ctx: SettleContext, lead?: string): Map<string, Placement> | null {
  const first = settle(all, ties, pl, fixed, ctx, lead);
  if (!lead || !first || first.ok) return first?.ok ? first.result : null;
  // the lead held back leaves the mates a little off: let everything settle exactly from there
  const start = new Map([...pl, ...first.result]);
  const second = settle(all, ties, start, fixed, ctx);
  return second?.ok ? new Map([...first.result, ...second.result]) : null;
}

/** `scale` — mm per radian; `centers` — each instance's part centre (in the part), the point it turns about. */
interface SettleContext {
  scale: number;
  centers: Map<string, Vec3>;
}

function settle(
  all: ValidLink[],
  ties: RelationTie[],
  pl: Map<string, Placement>,
  fixed: Set<string>,
  { scale, centers }: SettleContext,
  lead?: string,
): { result: Map<string, Placement>; ok: boolean } | null {
  // a mate between two fixed instances is what it is: it does not hold the others back
  const links = all.filter((l) => !fixed.has(l.a) || !fixed.has(l.b));
  const ids = [...new Set([...links, ...ties.flatMap((t) => [t.la, t.lb])].flatMap((l) => [l.a, l.b]))].filter((id) => !fixed.has(id) && pl.has(id));
  if (!ids.length) return null;
  const idx = new Map(ids.map((id, i) => [id, i] as const));
  // variables per instance: translation (mm) and rotation vector × scale (mm) about the part's centre, applied to
  // the start placement — so the smallest change is the smallest visible motion of the part
  const at = (x: number[], id: string): Placement => {
    const p = pl.get(id)!;
    const i = idx.get(id);
    if (i === undefined) return p;
    const o = 6 * i;
    const c = centers.get(id) ?? [0, 0, 0];
    const R = mul(rotationOf([x[o + 3] / scale, x[o + 4] / scale, x[o + 5] / scale]), p.R);
    // the centre moves by the translation only: R·c + t = p.R·c + p.t + Δ
    const t = sub(add(add(mulVec(p.R, c), p.t), [x[o], x[o + 1], x[o + 2]]), mulVec(R, c));
    return { R, t };
  };
  const li = lead !== undefined ? idx.get(lead) : undefined;
  const residual = (x: number[]) => [
    ...links.flatMap((l) => linkResidual(l, worldFrame(at(x, l.a), l.fa), worldFrame(at(x, l.b), l.fb), scale)),
    ...ties.map((t) => relationResidual(t, (id) => at(x, id), scale)),
    ...(li !== undefined ? x.slice(6 * li, 6 * li + 6).map((v) => v * LEAD_WEIGHT) : []),
  ];
  const sq = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  const n = 6 * ids.length;
  let x = new Array(n).fill(0);
  let r = residual(x);
  let cost = sq(r);
  let lambda = 1e-3;
  for (let it = 0; it < 200 && cost > MATE_TOL * MATE_TOL * 1e-4; it++) {
    // numeric Jacobian, column by column
    const h = 1e-6;
    const J: number[][] = [];
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] += h;
      const rp = residual(xp);
      J.push(rp.map((v, k) => (v - r[k]) / h));
    }
    const JtJ = J.map((a) => J.map((b) => a.reduce((s, v, k) => s + v * b[k], 0)));
    const g = J.map((a) => a.reduce((s, v, k) => s + v * r[k], 0));
    // Levenberg damping (the same for every variable — all in mm): the smallest motion that fixes the mates, so
    // a screw advances rather than turns back. (Marquardt's per-variable scaling would share the fix out evenly.)
    const dmax = Math.max(1e-9, ...JtJ.map((row, i) => row[i]));
    let improved = false;
    while (!improved && lambda < 1e12) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * dmax + 1e-12 : v)));
      const step = solveLinear(A, g.map((v) => -v));
      if (!step) {
        lambda *= 10;
        continue;
      }
      const xn = x.map((v, i) => v + step[i]);
      const rn = residual(xn);
      const cn = sq(rn);
      if (cn < cost) {
        [x, r, cost] = [xn, rn, cn];
        lambda = Math.max(lambda / 3, 1e-12);
        improved = true;
      } else lambda *= 4;
    }
    if (!improved) break;
  }
  // every mate and relation must hold, else keep the walk's result
  let ok = true;
  for (let k = 0; k < 6 * links.length; k += 6) if (Math.hypot(r[k], r[k + 1], r[k + 2], r[k + 3], r[k + 4], r[k + 5]) > MATE_TOL) ok = false;
  for (let k = 0; k < ties.length; k++) if (Math.abs(r[6 * links.length + k]) > MATE_TOL) ok = false;
  return { result: new Map(ids.map((id) => [id, at(x, id)] as const)), ok };
}

/** Current placement of every instance (as stored). */
const placements = (tab: AssemblyTab) => new Map(tab.instances.map((i) => [i.id, placementOf(i)] as const));

export interface SolveResult {
  /** New position / rotation of the instances the mates moved (a flexible sub-assembly: where its parts stand). */
  moved: Map<string, Moved>;
  /** Mates that cannot be satisfied (both instances already placed by other mates or fixed). */
  failed: string[];
  /** The mate that placed each moved instance. */
  placedBy: Map<string, string>;
  /** The motions each mate relation ties, as solved (whole turns counted). */
  relations: Map<string, [number, number]>;
}

/** Whether the mate's natural direction is to move `b` (otherwise `a`, e.g. when `b` is fixed). */
/**
 * A tie between two instances as the solver sees it: a mate (its connectors' frames in the parts), or a group
 * member held to the group's first member (instance origins, a rigid relation). `id` — the mate or group.
 */
export interface Link {
  id: string;
  a: string;
  b: string;
  fa: Frame | null;
  fb: Frame | null;
  spec: MateSpec;
  /** Mates between faces: the faces' surfaces in the parts (then `fa`, `fb` are the instance origins). */
  geom?: { a: Surf; b: Surf };
}

/** How far a link is from holding (six numbers, see mateResidual / faceResidual). */
function linkResidual(l: Link, wa: Frame, wb: Frame, scale: number): number[] {
  return l.geom ? faceResidual(l.spec.type, l.spec.flip, l.geom.a, l.geom.b, wa, wb, scale) : mateResidual(l.spec, wa, wb, scale);
}

const ORIGIN: Frame = { R: I3, o: [0, 0, 0] };

/** The active mates and groups of an assembly as links. */
export function linksOf(tab: AssemblyTab, sources: AssemblySources): Link[] {
  const byId = new Map(tab.instances.map((i) => [i.id, i] as const));
  const frame = (end: MateEnd) => {
    const inst = byId.get(end.instance);
    return inst ? connectorFrame(sources, inst, end.connector) : null;
  };
  const surface = (end: MateEnd | undefined) => {
    const inst = end && byId.get(end.instance);
    const mesh = inst && sourceMesh(sources, inst);
    return mesh && end.connector.kind === 'face' ? surfaceOf(mesh, end.connector.index) : null;
  };
  const links: Link[] = (tab.mates ?? [])
    .filter((m) => !m.suppressed)
    .map((m) => {
      if (m.type === 'pinSlot' && m.a2) {
        // the slot runs along an edge: its direction in the first connector's XY plane, plus the mate's own turn
        const fa = frame(m.a);
        const inst = byId.get(m.a.instance);
        const e = m.a2.instance === m.a.instance && m.a2.connector.kind === 'edge' && inst ? sourceMesh(sources, inst)?.edges[m.a2.connector.index] : undefined;
        const dir = e?.type === 'LINE' ? (e.dir ?? sub(e.end, e.start)) : undefined;
        const turn = fa && dir ? Math.atan2(dot(column(fa.R, 1), dir), dot(column(fa.R, 0), dir)) / DEG : undefined;
        return { id: m.id, a: m.a.instance, b: m.b.instance, fa: turn === undefined ? null : fa, fb: frame(m.b), spec: { ...m, angle: (m.angle ?? 0) + (turn ?? 0) } };
      }
      if (!FACE_MATES.includes(m.type)) return { id: m.id, a: m.a.instance, b: m.b.instance, fa: frame(m.a), fb: frame(m.b), spec: m };
      // between faces: the surfaces (width: the midplanes of the two pairs)
      const ga = m.type === 'width' ? midplane(surface(m.a), surface(m.a2)) : surface(m.a);
      const gb = m.type === 'width' ? midplane(surface(m.b), surface(m.b2)) : surface(m.b);
      const ok =
        !!ga && !!gb && (m.type === 'width' ? m.a2?.instance === m.a.instance && m.b2?.instance === m.b.instance : tangentPair(ga, gb));
      return { id: m.id, a: m.a.instance, b: m.b.instance, fa: ok ? ORIGIN : null, fb: ok ? ORIGIN : null, spec: m, ...(ok ? { geom: { a: ga!, b: gb! } } : {}) };
    });
  for (const g of tab.groups ?? []) {
    if (g.suppressed) continue;
    const [first, ...rest] = g.members;
    // each member relative to the first: P₀⁻¹ ∘ P (the first one's is usually zero)
    const p0 = placementOf(first);
    const R0T = transpose(p0.R);
    for (const mem of rest) {
      const pm = placementOf(mem);
      links.push({
        id: g.id,
        a: first.instance,
        b: mem.instance,
        fa: byId.has(first.instance) ? ORIGIN : null,
        fb: byId.has(mem.instance) ? ORIGIN : null,
        spec: { type: 'fastened', flip: false, rigid: { R: mul(R0T, pm.R), o: mulVec(R0T, sub(pm.t, p0.t)) } },
      });
    }
  }
  return links;
}

function mover(l: Link, placed: Set<string>): 'a' | 'b' | null {
  if (placed.has(l.a) && !placed.has(l.b)) return 'b';
  if (placed.has(l.b) && !placed.has(l.a)) return 'a';
  return null;
}

/**
 * Place the instances to satisfy the mates and groups: fixed instances stay; then, from the placed ones
 * outwards, every link moves its not yet placed instance; then closed loops are reconciled. Instances that no
 * mate reaches keep their placement.
 */
export function solveAssembly(tab: AssemblyTab, sources: AssemblySources, lead?: string, held: string[] = []): SolveResult {
  /** `held` instances (parts of flexible sub-assemblies too) stay where they are, as if fixed. */
  const holding = (t: AssemblyTab) => (held.length ? { ...t, instances: t.instances.map((i) => (held.includes(i.id) ? { ...i, fixed: true } : i)) } : t);
  if (!hasSubassemblies(tab)) return solveFlat(holding(tab), sources, lead);
  // sub-assemblies: solve their parts (a rigid one held as one, a flexible one by its own mates), then fold
  const flat = holding(expandAssembly(holding(tab), sources));
  const leadLeaf = lead && (flat.instances.find((i) => i.id === lead) ?? flat.instances.find((i) => topInstance(i.id) === lead))?.id;
  const res = solveFlat(flat, sources, leadLeaf);
  const placedBy = new Map(res.placedBy);
  for (const [id, by] of res.placedBy) if (!placedBy.has(topInstance(id))) placedBy.set(topInstance(id), by);
  return {
    moved: foldPlacements(tab, sources, res.moved),
    // the rigid hold of a sub-assembly is not a mate; the mates of flexible ones (`X/…`) are reported with them
    failed: res.failed.filter((id) => !id.startsWith('sub:')),
    placedBy,
    relations: res.relations,
  };
}

function solveFlat(tab: AssemblyTab, sources: AssemblySources, lead?: string): SolveResult {
  /** Length that turns rotations into comparable distances (mm per radian). */
  const scale = 50;
  const centers = new Map<string, Vec3>();
  for (const inst of tab.instances) {
    const box = sourceMesh(sources, inst)?.bbox;
    if (box) centers.set(inst.id, [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2]);
  }
  const ctx: SettleContext = { scale, centers };
  const links = linksOf(tab, sources);
  const pl = placements(tab);
  const placed = new Set(tab.instances.filter((i) => i.fixed).map((i) => i.id));
  /** Instances that stay where they are: the fixed ones, and the first one of each group with nothing fixed. */
  const anchors = new Set(placed);
  const moved = new Map<string, { position: Vec3; rotation: Vec3 }>();
  const failed: string[] = [];
  const fail = (id: string) => void (failed.includes(id) || failed.push(id));
  const placedBy = new Map<string, string>();
  const done = new Set<Link>();
  // grow from the fixed instances; with nothing fixed, the first end of the first mate stays where it is
  for (;;) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const l of links) {
        if (done.has(l)) continue;
        const side = mover(l, placed);
        if (!side) continue;
        done.add(l);
        if (!l.fa || !l.fb || l.a === l.b) {
          fail(l.id);
          continue;
        }
        const id = side === 'b' ? l.b : l.a;
        if (l.geom) {
          // between faces: the smallest motion of the instance that makes the faces touch / line up
          const keep = new Set([side === 'b' ? l.a : l.b]);
          let near = settle([l as ValidLink], [], pl, keep, ctx);
          for (const w of [[0.05, 0, 0], [0, 0.05, 0]] as Vec3[]) {
            if (near?.ok) break;
            // a start at a dead point (a cylinder standing upright on the plane it should lie on): nudge it
            const p0 = pl.get(id)!;
            near = settle([l as ValidLink], [], new Map(pl).set(id, { R: mul(rotationOf(w), p0.R), t: p0.t }), keep, ctx) ?? near;
          }
          if (near) pl.set(id, near.result.get(id)!);
        } else if (side === 'b') pl.set(l.b, solveMate(l.spec, worldFrame(pl.get(l.a)!, l.fa), pl.get(l.b)!, l.fb));
        // moving the first end (the second one is fixed or placed already)
        else pl.set(l.a, solveFirst(l.spec, worldFrame(pl.get(l.b)!, l.fb), pl.get(l.a)!, l.fa));
        placed.add(id);
        moved.set(id, toStored(pl.get(id)!));
        placedBy.set(id, l.id);
        progress = true;
      }
    }
    const next = links.find((l) => !done.has(l) && !placed.has(l.a) && !placed.has(l.b));
    if (!next) break;
    placed.add(next.a);
    anchors.add(next.a);
  }
  // links the walk did not use close loops (or tie two fixed instances): check them, and if some do not hold,
  // adjust all the free instances at once
  const valid: ValidLink[] = [];
  for (const l of links) {
    if (l.fa && l.fb && pl.has(l.a) && pl.has(l.b) && l.a !== l.b) valid.push(l as ValidLink);
    else fail(l.id);
  }
  const broken = (p: Map<string, Placement>) => valid.filter((l) => len6(linkResidual(l, worldFrame(p.get(l.a)!, l.fa), worldFrame(p.get(l.b)!, l.fb), scale)) > MATE_TOL);
  // mate relations: their mates must be active and of the kinds they tie
  const linkOf = new Map(valid.map((l) => [l.id, l] as const));
  const ties: RelationTie[] = [];
  for (const r of tab.relations ?? []) {
    if (r.suppressed) continue;
    const la = linkOf.get(r.a);
    const lb = linkOf.get(r.b);
    const [ta, tb] = RELATION_MATES[r.type];
    if (la && lb && ta.includes(la.spec.type) && tb.includes(lb.spec.type)) ties.push({ r, la, lb });
    else fail(r.id);
  }
  const get = (id: string) => pl.get(id)!;
  const brokenTies = () => ties.filter((t) => Math.abs(relationResidual(t, get, scale)) > MATE_TOL);
  if (broken(pl).length || brokenTies().length) {
    const closed = closeLoops(valid, ties, pl, anchors, ctx, lead);
    if (closed)
      for (const [id, p] of closed) {
        pl.set(id, p);
        moved.set(id, toStored(p));
      }
    for (const l of broken(pl)) fail(l.id);
    for (const t of brokenTies()) fail(t.r.id);
  }
  const relations = new Map(ties.map((t) => [t.r.id, relationMotions(t, get)] as const));
  return { moved, failed, placedBy, relations };
}

type ValidLink = Link & { fa: Frame; fb: Frame };

const len6 = (r: number[]) => Math.hypot(...r);

const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
function toStored(p: Placement): { position: Vec3; rotation: Vec3 } {
  return { position: p.t.map(round) as Vec3, rotation: rotationAngles(p.R) };
}

/** Write the solved placements into an assembly (inside an immer draft or a plain object). */
export function applySolve(tab: AssemblyTab, sources: AssemblySources, lead?: string, held?: string[]): string[] {
  const { moved, failed, relations } = solveAssembly(tab, sources, lead, held);
  for (const inst of tab.instances) {
    const p = moved.get(inst.id);
    if (!p) continue;
    inst.position = p.position;
    inst.rotation = p.rotation;
    if (p.flex) inst.flex = p.flex;
  }
  for (const r of tab.relations ?? []) {
    const m = relations.get(r.id);
    if (m) r.last = m;
  }
  return failed;
}

/**
 * Solve after instance `id` was moved by hand (dragged or typed): it leads. With nothing fixed holding its mates
 * and groups, it stays where it was put and the rest follow; held by a fixed instance, it goes as far as its own
 * mates allow, and loops and relations close around it.
 */
export function applySolveLed(tab: AssemblyTab, sources: AssemblySources, id: string): string[] {
  if (!findInstance(tab, sources, id)) return applySolve(tab, sources);
  return tiedToFixed(tab, sources, id) ? applySolve(tab, sources, id) : applySolve(tab, sources, undefined, [id]);
}

/**
 * Change the placement of instance `id` by hand — a top-level one, or a part of a flexible sub-assembly (stored
 * in its `flex`); `fn` gets it as placed now. False if it cannot move on its own (a part of a rigid one).
 */
export function editPlacement(tab: AssemblyTab, sources: AssemblySources, id: string, fn: (i: AssemblyInstance) => void): boolean {
  const part = movable(tab, sources, id);
  if (!part) return false;
  const inst = part.get();
  fn(inst);
  part.put(inst);
  return true;
}

/** A mate relation made now: its zero is the current placement (nothing moves). */
export function makeRelation(tab: AssemblyTab, sources: AssemblySources, r: Omit<MateRelation, 'zero' | 'last'>): MateRelation {
  const flat = expandAssembly(tab, sources);
  const links = new Map(linksOf(flat, sources).map((l) => [l.id, l] as const));
  const la = links.get(r.a);
  const lb = links.get(r.b);
  const pl = placements(flat);
  const zero: [number, number] =
    la?.fa && la.fb && lb?.fa && lb.fb ? relationMotions({ r: { ...r, zero: [0, 0], last: [0, 0] }, la: la as ValidLink, lb: lb as ValidLink }, (id) => pl.get(id)!) : [0, 0];
  return { ...r, zero, last: [...zero] };
}

/** Default relation name: "Gear 1", "Rack and pinion 1", "Screw 1". */
export function relationName(tab: AssemblyTab, type: MateRelationType): string {
  const base = { gear: 'Gear', rackPinion: 'Rack and pinion', screw: 'Screw' }[type];
  const names = new Set((tab.relations ?? []).map((r) => r.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Initial flip: the Z axes are made to point the way they point now (Onshape snaps to the nearest). */
export function nearestFlip(sources: AssemblySources, tab: AssemblyTab, a: MateEnd, b: MateEnd, type?: AssemblyMateType): boolean {
  const ia = findInstance(tab, sources, a.instance);
  const ib = findInstance(tab, sources, b.instance);
  if (!ia || !ib) return true;
  if (type === 'width') return false;
  if (type === 'tangent') {
    // touching the way round they are now
    const ma = sourceMesh(sources, ia);
    const mb = sourceMesh(sources, ib);
    const ga = ma && a.connector.kind === 'face' ? surfaceOf(ma, a.connector.index) : null;
    const gb = mb && b.connector.kind === 'face' ? surfaceOf(mb, b.connector.index) : null;
    const frameOfPl = (p: Placement): Frame => ({ R: p.R, o: p.t });
    return ga && gb ? nearestSide(ga, gb, frameOfPl(placementOf(ia)), frameOfPl(placementOf(ib))) : false;
  }
  const fa = connectorFrame(sources, ia, a.connector);
  const fb = connectorFrame(sources, ib, b.connector);
  if (!fa || !fb) return true;
  const za = column(worldFrame(placementOf(ia), fa).R, 2);
  const zb = column(worldFrame(placementOf(ib), fb).R, 2);
  return za[0] * zb[0] + za[1] * zb[1] + za[2] * zb[2] < 0;
}

/** Add the sub-assemblies `asm` uses (recursively, solved — the deepest first) to its sources of Part Studios. */
export function addSubassemblies(tabs: { id: string; type: string }[], asm: AssemblyTab, sources: AssemblySources): AssemblySources {
  for (const sub of usedTabs(tabs, asm).subs) {
    const solved = structuredClone(sub) as AssemblyTab;
    applySolve(solved, sources);
    sources.set(sub.id, { parts: new Map(), mates: [], assembly: solved });
  }
  return sources;
}

/** Instances the active mates and groups connect to `id` (including it); `exact` — by part ids (an unfolded assembly). */
export function matedGroup(tab: AssemblyTab, id: string, exact = false): Set<string> {
  const group = new Set([id]);
  // a mate to a part of a sub-assembly ties the sub-assembly
  const key = exact ? (s: string) => s : topInstance;
  const pairs = [
    ...(tab.mates ?? []).filter((m) => !m.suppressed).map((m) => [key(m.a.instance), key(m.b.instance)]),
    ...(tab.groups ?? []).filter((g) => !g.suppressed).flatMap((g) => g.members.slice(1).map((m) => [g.members[0].instance, m.instance])),
  ];
  for (let grown = true; grown; ) {
    grown = false;
    for (const [a, b] of pairs)
      if (group.has(a) !== group.has(b)) {
        group.add(a);
        group.add(b);
        grown = true;
      }
  }
  return group;
}

/** A group of instances held as they stand now (Onshape Group): members' placements relative to the first. */
export function makeGroup(tab: AssemblyTab, ids: string[], id: string, name: string): AssemblyGroup {
  const insts = ids.map((i) => tab.instances.find((x) => x.id === i)).filter((x): x is AssemblyInstance => !!x);
  const p0 = placementOf(insts[0]);
  const RT = transpose(p0.R);
  return {
    id,
    name,
    members: insts.map((inst) => {
      const p = placementOf(inst);
      return { instance: inst.id, position: mulVec(RT, sub(p.t, p0.t)).map(round) as Vec3, rotation: rotationAngles(mul(RT, p.R)) };
    }),
  };
}

/** Default group name: "Group 1"… */
export function groupName(tab: AssemblyTab): string {
  const names = new Set((tab.groups ?? []).map((g) => g.name));
  let n = 1;
  while (names.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Turn an instance by `angle` (radians) about the axis `k` (unit) through `p`. */
function turnInstance(inst: AssemblyInstance, k: Vec3, angle: number, p: Vec3) {
  if (!angle) return;
  const pl = placementOf(inst);
  const rot = (v: Vec3) => rotateVec(v, k, angle);
  const R = fromAxes(rot(column(pl.R, 0)), rot(column(pl.R, 1)), rot(column(pl.R, 2)));
  inst.position = add(rot(sub(pl.t, p)), p);
  inst.rotation = rotationAngles(R);
}

/** Mates whose free rotation follows the mouse when the instance is dragged: about the mate axis or the centre. */
const DRAG_TURN: Partial<Record<AssemblyMateType, 'axis' | 'center'>> = { revolute: 'axis', cylindrical: 'axis', ball: 'center' };

/**
 * The assembly with instance `id` dragged (Onshape): moved by `delta`, turned by `angle` (radians) about
 * `axis` through the grabbed point `anchor`, then re-solved. An instance whose mates do not tie it to a fixed
 * one leads its mated group; one held by a fixed instance only moves along the degrees of freedom its mates
 * leave — a revolute / cylindrical / ball mate turns it so that the grabbed point follows the mouse.
 */
export function draggedAssembly(
  base: AssemblyTab,
  sources: AssemblySources,
  id: string,
  delta: Vec3,
  angle: number,
  axis: Vec3,
  anchor: Vec3,
  held: string[] = [],
): AssemblyTab {
  const tab = structuredClone(base) as AssemblyTab;
  const part = movable(tab, sources, id);
  if (!part) return tab;
  const inst = part.get();
  const pl0 = placementOf(inst);
  const grabbed = mulVec(transpose(pl0.R), sub(anchor, pl0.t)); // the grabbed point on the part
  const target = add(anchor, delta);
  turnInstance(inst, axis, angle, anchor);
  inst.position = add(inst.position, delta);
  part.put(inst);
  if (!tiedToFixed(tab, sources, id, held)) {
    // lead the group: solve with the dragged instance held where the mouse put it
    applySolve(tab, sources, undefined, [...held, id]);
    return tab;
  }
  // the dragged instance leads: loops and relations close around it
  const { placedBy } = solveAssembly(tab, sources, undefined, held);
  applySolve(tab, sources, id, held);
  const m = (id.includes('/') ? expandAssembly(tab, sources) : tab).mates?.find((x) => x.id === placedBy.get(id));
  const turn = m && !angle ? DRAG_TURN[m.type] : undefined;
  const end = m && (m.a.instance === id ? m.a : m.b);
  const now = part.get();
  const f = end && connectorFrame(sources, now, end.connector);
  if (!turn || !f) return tab;
  const pl = placementOf(now);
  const w = worldFrame(pl, f);
  let u = sub(add(mulVec(pl.R, grabbed), pl.t), w.o);
  let v = sub(target, w.o);
  if (turn === 'axis') {
    const z = column(w.R, 2);
    u = sub(u, z.map((c) => c * dot(u, z)) as Vec3);
    v = sub(v, z.map((c) => c * dot(v, z)) as Vec3);
    if (len(u) < 1e-6 || len(v) < 1e-6) return tab;
    turnInstance(now, z, Math.atan2(dot(z, cross(u, v)), dot(u, v)), w.o);
  } else {
    const k = cross(u, v);
    if (len(k) < 1e-9 || len(u) < 1e-6) return tab;
    turnInstance(now, k.map((c) => c / len(k)) as Vec3, Math.atan2(len(k), dot(u, v)), w.o);
  }
  part.put(now);
  applySolve(tab, sources, id, held);
  return tab;
}

/**
 * An instance that moves on its own: a top-level one, or a part of a flexible sub-assembly (`X/inner`, placed
 * through X's `flex`). `get` — it as placed now (a copy for a part), `put` — store its new placement.
 */
function movable(tab: AssemblyTab, sources: AssemblySources, id: string) {
  const top = tab.instances.find((i) => i.id === topInstance(id));
  if (!top) return null;
  if (top.id === id) return { get: () => top, put: () => {} };
  if (!top.flexible || !findInstance(tab, sources, id)) return null;
  return {
    get: () => findInstance(tab, sources, id)!,
    put: (p: AssemblyInstance) => {
      // in the sub-assembly's coordinates: P⁻¹ ∘ W
      const P = placementOf(top);
      const W = placementOf(p);
      const RT = transpose(P.R);
      top.flex = { ...top.flex, [id.slice(top.id.length + 1)]: toStored({ R: mul(RT, W.R), t: mulVec(RT, sub(W.t, P.t)) }) };
    },
  };
}

/** Whether the active mates and groups tie instance `id` (a part of a flexible sub-assembly too) to a fixed or `held` one. */
function tiedToFixed(tab: AssemblyTab, sources: AssemblySources, id: string, held: string[] = []): boolean {
  const part = id.includes('/');
  const t = part ? expandAssembly(tab, sources) : tab;
  return [...matedGroup(t, id, part)].some((g) => held.includes(g) || t.instances.find((i) => i.id === g)?.fixed);
}

/** Current values of a mate's free motions: travel along Z (mm) and turn about Z (degrees, −180…180). */
export function mateValues(sources: AssemblySources, tab: AssemblyTab, m: AssemblyMate): { z: number; angle: number } | null {
  const ia = findInstance(tab, sources, m.a.instance);
  const ib = findInstance(tab, sources, m.b.instance);
  const fa = ia && connectorFrame(sources, ia, m.a.connector);
  const fb = ib && connectorFrame(sources, ib, m.b.connector);
  if (!ia || !ib || !fa || !fb) return null;
  const rel = relative(worldFrame(placementOf(ia), fa), worldFrame(placementOf(ib), fb));
  const M = mul(rel.R, m.flip ? FLIP : I3);
  return { z: rel.o[2], angle: Math.atan2(M[3], M[0]) / DEG };
}

/** Free motions of a mate that can be animated (Onshape Animate): its turn about Z and / or its travel along Z. */
export function animatableMotions(type: AssemblyMateType): ('turn' | 'slide')[] {
  if (type === 'revolute' || type === 'pinSlot') return ['turn'];
  if (type === 'slider') return ['slide'];
  if (type === 'cylindrical') return ['turn', 'slide'];
  return [];
}

/**
 * The assembly with a mate's free motion set to `value` (degrees for the turn, mm for the travel along Z),
 * counted from `base`: the second instance turns about / slides along the first connector's Z axis (the first
 * instance, if the second is fixed) and leads — related and looped instances follow it. With nothing fixed
 * holding the mate, the first instance stays where it is.
 */
export function animatedAssembly(base: AssemblyTab, sources: AssemblySources, mateId: string, motion: 'turn' | 'slide', value: number): AssemblyTab {
  const start = structuredClone(base) as AssemblyTab;
  const m = start.mates?.find((x) => x.id === mateId);
  const cur = m && mateValues(sources, start, m);
  // the instances that move: top-level ones (a rigid sub-assembly moves as a whole) or parts of flexible ones
  const unit = (id: string) => (movable(start, sources, id) ? findInstance(start, sources, id) : findInstance(start, sources, topInstance(id)));
  const ia = m && unit(m.a.instance);
  const ib = m && unit(m.b.instance);
  const la = m && findInstance(start, sources, m.a.instance);
  const fa = m && la && connectorFrame(sources, la, m.a.connector);
  if (!m || !cur || !ia || !ib || !la || !fa || (ia.fixed && ib.fixed)) return start;
  const wa = worldFrame(placementOf(la), fa);
  const axis = column(wa.R, 2);
  // moving the first instance the other way gives the same relative motion
  const mover = ib.fixed ? ia : ib;
  const sign = ib.fixed ? -1 : 1;
  // with nothing fixed holding them, the first instance stays where it is
  const held = tiedToFixed(start, sources, mover.id) ? [] : [ia.id];
  return motion === 'turn'
    ? draggedAssembly(start, sources, mover.id, [0, 0, 0], sign * (value - cur.angle) * DEG, axis, wa.o, held)
    : draggedAssembly(start, sources, mover.id, axis.map((c) => c * sign * (value - cur.z)) as Vec3, 0, axis, wa.o, held);
}

/** Mate types with an offset along Z, with limits along Z and with limits about Z (Onshape). */
export const MATE_OFFSET: AssemblyMateType[] = ['fastened', 'revolute', 'planar', 'ball', 'pinSlot'];
export const MATE_Z_LIMITS: AssemblyMateType[] = ['slider', 'cylindrical'];
export const MATE_ANGLE_LIMITS: AssemblyMateType[] = ['revolute', 'cylindrical'];

/** Default mate name: "Fastened 1", "Revolute 2"… */
export function mateName(tab: AssemblyTab, type: AssemblyMateType): string {
  const base = type[0].toUpperCase() + type.slice(1);
  let n = 1;
  const names = new Set((tab.mates ?? []).map((m) => m.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
