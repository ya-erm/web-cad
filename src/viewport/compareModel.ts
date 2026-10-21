// Comparing a model with a version of it (Onshape: Compare): the faces each has that the other has not — matched by
// their geometry (type, centre, area, normal), not by the features that made them, so a face moved by a changed
// sketch dimension counts too.

import type { FaceInfo } from '../kernel/protocol';

interface PartFaces {
  id: string;
  faces: FaceInfo[];
}

/** How near two faces must be to be the same (mm; the area relative). */
const AT = 1e-4;

const key = (f: FaceInfo) => `${f.type}|${f.center.map((v) => Math.round(v / 0.01)).join(',')}`;

function same(a: FaceInfo, b: FaceInfo): boolean {
  if (a.type !== b.type) return false;
  if (Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]) > AT * 10) return false;
  if (Math.abs(a.area - b.area) > AT * Math.max(1, Math.abs(a.area))) return false;
  if (a.normal && b.normal) return a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2] > 1 - 1e-6;
  if ((a.radius ?? 0) !== 0 || (b.radius ?? 0) !== 0) return Math.abs((a.radius ?? 0) - (b.radius ?? 0)) <= AT;
  return true;
}

/**
 * The faces of the model now (`current`) that the version (`before`) has not got — new or changed — and the
 * version's faces the model has no longer: by part id, face indices.
 */
export function diffFaces(current: PartFaces[], before: PartFaces[]): { changed: Record<string, number[]>; removed: Record<string, number[]> } {
  // the faces of one side by their rounded centre (and the neighbouring cells: a centre near a cell's border)
  const index = (parts: PartFaces[]) => {
    const m = new Map<string, FaceInfo[]>();
    for (const p of parts) for (const f of p.faces) m.set(key(f), [...(m.get(key(f)) ?? []), f]);
    return m;
  };
  const near = (m: Map<string, FaceInfo[]>, f: FaceInfo) => {
    const c = f.center.map((v) => Math.round(v / 0.01));
    const out: FaceInfo[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) out.push(...(m.get(`${f.type}|${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []));
    return out;
  };
  const unmatched = (parts: PartFaces[], other: Map<string, FaceInfo[]>) => {
    const out: Record<string, number[]> = {};
    for (const p of parts) {
      const idx = p.faces.flatMap((f, i) => (near(other, f).some((g) => same(f, g)) ? [] : [i]));
      if (idx.length) out[p.id] = idx;
    }
    return out;
  };
  return { changed: unmatched(current, index(before)), removed: unmatched(before, index(current)) };
}
