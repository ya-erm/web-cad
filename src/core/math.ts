import type { PlaneFrame, StdPlane, Vec2, Vec3 } from './types';

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  neg: (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]],
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/** Any unit vector perpendicular to n. */
export function perpendicular(n: Vec3): Vec3 {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return v3.norm(v3.cross(n, a));
}

// Onshape conventions: Top = XY (normal +Z), Front = XZ (normal -Y, sketch y = +Z),
// Right = YZ (normal +X, sketch x = +Y, sketch y = +Z).
export const STD_PLANES: Record<StdPlane, PlaneFrame> = {
  top: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  front: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
  right: { origin: [0, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] },
};

export function frameFromNormal(origin: Vec3, normal: Vec3, xHint?: Vec3): PlaneFrame {
  const n = v3.norm(normal);
  let x: Vec3;
  if (xHint && Math.abs(v3.dot(v3.norm(xHint), n)) < 0.999) {
    x = v3.norm(v3.sub(xHint, v3.scale(n, v3.dot(xHint, n))));
  } else {
    // Deterministic choice: prefer world X, then world Y projected into the plane.
    const cand: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    let best = cand[0];
    let bestDot = 2;
    for (const c of cand) {
      const d = Math.abs(v3.dot(c, n));
      if (d < bestDot - 1e-9) {
        bestDot = d;
        best = c;
      }
    }
    x = v3.norm(v3.sub(best, v3.scale(n, v3.dot(best, n))));
  }
  const y = v3.cross(n, x);
  return { origin, xDir: x, yDir: y, normal: n };
}

export function toWorld(f: PlaneFrame, p: Vec2): Vec3 {
  return [
    f.origin[0] + f.xDir[0] * p[0] + f.yDir[0] * p[1],
    f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1],
    f.origin[2] + f.xDir[2] * p[0] + f.yDir[2] * p[1],
  ];
}

export function toLocal(f: PlaneFrame, p: Vec3): Vec2 {
  const d = v3.sub(p, f.origin);
  return [v3.dot(d, f.xDir), v3.dot(d, f.yDir)];
}

export function projectToPlane(f: PlaneFrame, p: Vec3): Vec3 {
  const d = v3.dot(v3.sub(p, f.origin), f.normal);
  return v3.sub(p, v3.scale(f.normal, d));
}

export function signedDistanceToPlane(f: PlaneFrame, p: Vec3) {
  return v3.dot(v3.sub(p, f.origin), f.normal);
}

export function offsetFrame(f: PlaneFrame, d: number): PlaneFrame {
  return { ...f, origin: v3.add(f.origin, v3.scale(f.normal, d)) };
}

export function flipFrame(f: PlaneFrame): PlaneFrame {
  return { origin: f.origin, xDir: v3.neg(f.xDir), yDir: f.yDir, normal: v3.neg(f.normal) };
}

/** Rotate vector v around unit axis k by angle a (Rodrigues). */
export function rotateVec(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = v3.cross(k, v);
  const kd = v3.dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

export function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}
