// Geometric signatures for persistent references (no OpenCascade dependency, used on both threads).

import type { GeomSig, Vec3 } from '../core/types';
import type { EdgeInfo, FaceInfo } from './protocol';

/** Position of p inside the box, 0..1 per axis (0.5 on degenerate axes). */
export function relativeTo(bbox: [Vec3, Vec3] | undefined, p: Vec3): Vec3 | undefined {
  if (!bbox) return undefined;
  const [lo, hi] = bbox;
  return [0, 1, 2].map((i) => {
    const d = hi[i] - lo[i];
    return d > 1e-9 ? (p[i] - lo[i]) / d : 0.5;
  }) as Vec3;
}

export function faceSig(f: FaceInfo, bbox?: [Vec3, Vec3]): GeomSig {
  return { type: f.type, center: f.center, normal: f.normal, size: f.area, radius: f.radius, rel: relativeTo(bbox, f.center) };
}

export function edgeSig(e: EdgeInfo, bbox?: [Vec3, Vec3]): GeomSig {
  return { type: e.type, center: e.center, dir: e.dir, size: e.length, radius: e.radius, rel: relativeTo(bbox, e.center) };
}

export function vertexSig(p: Vec3, bbox?: [Vec3, Vec3]): GeomSig {
  return { type: 'VERTEX', center: p, size: 0, rel: relativeTo(bbox, p) };
}
