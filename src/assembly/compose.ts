// Assemblies: instances of Part Studio parts placed by a rigid transform. The graphics area shows an
// assembly as an ordinary build result whose "parts" are the instances (meshes moved into place),
// so selection, highlighting and the camera work as in a Part Studio.

import type { AssemblyInstance, AssemblyTab, Vec3 } from '../core/types';
import type { BuildResult, EdgeInfo, FaceInfo, MateResult, PartMesh } from '../kernel/protocol';
import { expandAssembly } from './expand';

/** Rigid placement: p' = R·p + t (R row-major 3×3). */
export interface Placement {
  R: number[];
  t: Vec3;
}

const DEG = Math.PI / 180;

/** Rotation about X, then Y, then Z (world axes, degrees): R = Rz·Ry·Rx. */
export function rotationMatrix([ax, ay, az]: Vec3): number[] {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax * DEG), Math.sin(ax * DEG), Math.cos(ay * DEG), Math.sin(ay * DEG), Math.cos(az * DEG), Math.sin(az * DEG)];
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** Rotation angles (X, then Y, then Z; degrees) of a rotation matrix — the inverse of rotationMatrix. */
export function rotationAngles(R: number[]): Vec3 {
  const sy = -R[6];
  const ay = Math.asin(Math.max(-1, Math.min(1, sy)));
  let ax: number;
  let az: number;
  if (Math.abs(sy) < 1 - 1e-9) {
    ax = Math.atan2(R[7], R[8]);
    az = Math.atan2(R[3], R[0]);
  } else {
    // gimbal lock: only ax - az (or ax + az) is defined; put it all in ax
    az = 0;
    ax = Math.atan2(-R[5], R[4]);
  }
  const clean = (v: number) => Math.round((v / DEG) * 1e9) / 1e9 + 0;
  return [clean(ax), clean(ay), clean(az)];
}

export function placementOf(inst: Pick<AssemblyInstance, 'position' | 'rotation'>): Placement {
  return { R: rotationMatrix(inst.rotation), t: inst.position };
}

export const applyPoint = ({ R, t }: Placement, p: Vec3): Vec3 => [
  R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0],
  R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1],
  R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2],
];

export const applyDir = ({ R }: Placement, d: Vec3): Vec3 => [
  R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
  R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
  R[6] * d[0] + R[7] * d[1] + R[8] * d[2],
];

function mapArray(src: Float32Array, f: (p: Vec3) => Vec3): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i + 2 < src.length; i += 3) {
    const q = f([src[i], src[i + 1], src[i + 2]]);
    out[i] = q[0];
    out[i + 1] = q[1];
    out[i + 2] = q[2];
  }
  return out;
}

function boxOf(positions: Float32Array): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]);
      hi[k] = Math.max(hi[k], positions[i + k]);
    }
  return positions.length ? [lo, hi] : [[0, 0, 0], [0, 0, 0]];
}

/** A part mesh moved by a placement, as the part `id` (geometry info moved too). */
export function placeMesh(mesh: PartMesh, pl: Placement, id: string, name: string): PartMesh {
  const P = (p: Vec3) => applyPoint(pl, p);
  const D = (d: Vec3) => applyDir(pl, d);
  const opt = <T,>(v: T | undefined, f: (v: T) => T) => (v === undefined ? undefined : f(v));
  const faces: FaceInfo[] = mesh.faces.map((f) => ({
    ...f,
    center: P(f.center),
    normal: opt(f.normal, D),
    axis: opt(f.axis, D),
    axisPoint: opt(f.axisPoint, P),
  }));
  const edges: EdgeInfo[] = mesh.edges.map((e) => ({
    ...e,
    center: P(e.center),
    start: P(e.start),
    end: P(e.end),
    dir: opt(e.dir, D),
    circleCenter: opt(e.circleCenter, P),
    axis: opt(e.axis, D),
  }));
  const positions = mapArray(mesh.positions, P);
  return {
    ...mesh,
    id,
    name,
    positions,
    normals: mapArray(mesh.normals, D),
    edgePositions: mapArray(mesh.edgePositions, P),
    vertices: mapArray(mesh.vertices, P),
    indices: mesh.indices.slice(),
    faceRanges: mesh.faceRanges.slice(),
    edgeRanges: mesh.edgeRanges.slice(),
    faces,
    edges,
    bbox: boxOf(positions),
  };
}

/**
 * A Part Studio as used by assemblies: its part meshes and its mate connectors (with their owner parts). An
 * assembly used as a sub-assembly: `assembly` — it as solved (no parts of its own).
 */
export interface StudioData {
  parts: Map<string, PartMesh>;
  mates: MateResult[];
  assembly?: AssemblyTab;
}

/** Source Part Studios by id. */
export type AssemblySources = Map<string, StudioData>;

export const sourceMesh = (sources: AssemblySources, inst: Pick<AssemblyInstance, 'studioId' | 'partId'>) => sources.get(inst.studioId)?.parts.get(inst.partId);

/** Pick id of an instance's mate connector triad ({ kind: 'plane', planeId }). */
export const instanceConnectorId = (instance: string, featureId: string) => `${instance}|${featureId}`;
export function parseInstanceConnector(planeId: string): { instance: string; featureId: string } | null {
  const i = planeId.indexOf('|');
  return i > 0 ? { instance: planeId.slice(0, i), featureId: planeId.slice(i + 1) } : null;
}

/** The instances of an assembly as a build result (missing sources are skipped and reported). */
export function composeAssembly(tab: AssemblyTab, sources: AssemblySources): { build: BuildResult; missing: string[] } {
  const parts: PartMesh[] = [];
  const mates: MateResult[] = [];
  // sub-assemblies show as their parts (`X/inner`); one whose assembly is gone is missing
  const missing: string[] = tab.instances.filter((i) => i.assemblyId && !sources.get(i.assemblyId)?.assembly).map((i) => i.id);
  for (const inst of expandAssembly(tab, sources).instances) {
    const src = sourceMesh(sources, inst);
    if (!src) {
      missing.push(inst.id);
      continue;
    }
    const pl = placementOf(inst);
    const m = placeMesh(src, pl, inst.id, inst.name);
    m.hidden = !!inst.hidden;
    parts.push(m);
    if (inst.hidden) continue;
    // the part's own mate connectors travel with the instance
    for (const mc of sources.get(inst.studioId)?.mates ?? []) {
      if (mc.owner !== inst.partId) continue;
      const f = mc.frame;
      mates.push({
        featureId: instanceConnectorId(inst.id, mc.featureId),
        name: mc.name,
        frame: { origin: applyPoint(pl, f.origin), xDir: applyDir(pl, f.xDir), yDir: applyDir(pl, f.yDir), normal: applyDir(pl, f.normal) },
        owner: inst.id,
      });
    }
  }
  return {
    build: { type: 'build', reqId: 0, parts, sketches: [], planes: [], mates, curves: [], statuses: {}, partOrder: parts.map((p) => p.id), timeMs: 0 },
    missing,
  };
}

/** Name for a new instance of `partName`: "Part 1 <1>", "Part 1 <2>"… (Onshape style). */
export function instanceName(tab: AssemblyTab, partName: string): string {
  let n = 1;
  const names = new Set(tab.instances.map((i) => i.name));
  while (names.has(`${partName} <${n}>`)) n++;
  return `${partName} <${n}>`;
}

/**
 * Where a new instance goes: at the part's own place for its first instance, otherwise shifted along X
 * past the instances already in the assembly so that it does not overlap them.
 */
export function insertPosition(tab: AssemblyTab, sources: AssemblySources, mesh: PartMesh): Vec3 {
  if (!tab.instances.length) return [0, 0, 0];
  let maxX = -Infinity;
  // sub-assemblies take the room of their parts
  for (const inst of expandAssembly(tab, sources).instances) {
    const src = sourceMesh(sources, inst);
    if (!src) continue;
    const box = boxOf(placeMesh(src, placementOf(inst), inst.id, inst.name).positions);
    maxX = Math.max(maxX, box[1][0]);
  }
  if (!Number.isFinite(maxX)) return [0, 0, 0];
  const [lo, hi] = mesh.bbox;
  const gap = Math.max(5, 0.2 * (hi[0] - lo[0]));
  return [Math.round(maxX + gap - lo[0]), 0, 0];
}
