// Triad manipulator of an assembly instance (Onshape): the arrows move the instance along an axis, the arcs
// turn it about an axis, the centre ball moves it freely in the view plane. Pure geometry of the handles —
// the graphics and the mouse live in the viewport engine.

import type { Vec3 } from '../core/types';
import type { Placement } from './compose';

export type TriadHandle = { kind: 'arrow' | 'ring'; axis: 0 | 1 | 2 } | { kind: 'center' };

export const TRIAD_AXES: [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Where the triad stands: its centre and its X, Y, Z axes (unit vectors). */
export interface TriadFrame {
  o: Vec3;
  axes: [Vec3, Vec3, Vec3];
}

/** A triad moved onto a mate connector of the instance keeps its place on the part as the part moves. */
export function placedTriad(pl: Placement, local: { R: number[]; o: Vec3 }): TriadFrame {
  const R = pl.R;
  const mul = (v: Vec3): Vec3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  const col = (j: number): Vec3 => [local.R[j], local.R[3 + j], local.R[6 + j]];
  const o = mul(local.o);
  return { o: [o[0] + pl.t[0], o[1] + pl.t[1], o[2] + pl.t[2]], axes: [mul(col(0)), mul(col(1)), mul(col(2))] };
}

/** A value typed at an arrow (a distance along it, mm) or an arc (an angle about its axis, radians). */
export function triadStep(handle: TriadHandle, value: number, frame: TriadFrame): { delta: Vec3; angle: number; axis: Vec3 } {
  if (handle.kind === 'center') return { delta: [0, 0, 0], angle: 0, axis: frame.axes[2] };
  const k = frame.axes[handle.axis];
  return handle.kind === 'arrow' ? { delta: [k[0] * value, k[1] * value, k[2] * value], angle: 0, axis: k } : { delta: [0, 0, 0], angle: value, axis: k };
}

/** Triad layout in its own units (scaled to a constant screen size). */
export const TRIAD = { arrowFrom: 0.18, arrowTo: 1, ring: 0.62, ball: 0.09 };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Parameter t of the point o + t·k of an axis closest to the ray p + s·d (k, d — unit vectors);
 * null when the ray runs along the axis.
 */
export function closestOnAxis(p: Vec3, d: Vec3, o: Vec3, k: Vec3): number | null {
  const w = sub(p, o);
  const b = dot(k, d);
  const den = 1 - b * b;
  if (den < 1e-6) return null;
  return (dot(k, w) - b * dot(d, w)) / den;
}

/** Where the ray p + s·d meets the plane through c perpendicular to k; null when it runs along the plane. */
export function rayPlane(p: Vec3, d: Vec3, c: Vec3, k: Vec3): Vec3 | null {
  const den = dot(d, k);
  if (Math.abs(den) < 1e-9) return null;
  const s = dot(sub(c, p), k) / den;
  return [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
}

/** Signed angle (radians) from u to v about the unit axis k (both seen in the plane perpendicular to k). */
export function angleAbout(k: Vec3, u: Vec3, v: Vec3): number {
  return Math.atan2(dot(k, cross(u, v)), dot(u, v) - dot(u, k) * dot(v, k));
}

/** The angle difference brought into (−π, π] — to accumulate a turn that goes past half a revolution. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
