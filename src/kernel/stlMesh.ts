// An STL file shown as it is (the embedded viewer): its bodies as meshes for the graphics area, without making
// solids of them — a mesh of any size opens in a moment (the Import feature's B-rep of hundreds of thousands of
// triangles would take minutes, if the kernel's memory held it). Flat triangles; the edges drawn are those of the
// shape: where faces meet at an angle, the borders of open bodies and the edges of more than two triangles.

import type { Vec3 } from '../core/types';
import type { EdgeInfo, PartMesh } from './protocol';
import { fail } from './geom';
import { parseStl, stlBodies, weldStl, type StlBody } from './stlImport';
import type { Mesh } from './meshSurfaces';

/** Faces meeting at more than this angle have their edge drawn (30°). */
const CREASE_COS = Math.cos(Math.PI / 6);

/** The bodies of an STL file as meshes (`key` makes their mesh keys: the graphics keep them while it is the same). */
export function stlMeshes(bytes: Uint8Array, key: string): PartMesh[] {
  const tris = parseStl(bytes);
  const mesh = weldStl(tris);
  const bodies = stlBodies(tris, mesh);
  if (!bodies.length) fail('The STL file has no triangles');
  return bodies.map((b, i) => bodyMesh(mesh, b, `stl${i + 1}`, `Part ${i + 1}`, `${key}:${i}`));
}

function bodyMesh(mesh: Mesh, body: StlBody, id: string, name: string, meshKey: string): PartMesh {
  const { pts, faces } = mesh;
  const n = body.faces.length;
  const positions = new Float32Array(n * 9);
  const normals = new Float32Array(n * 9);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const unit: Vec3[] = new Array(n);
  let area = 0;
  body.faces.forEach((fi, k) => {
    const [a, b, c] = faces[fi].map((v) => pts[v]);
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(cr[0], cr[1], cr[2]);
    area += len / 2;
    const nn: Vec3 = len > 0 ? [cr[0] / len, cr[1] / len, cr[2] / len] : [0, 0, 1];
    unit[k] = nn;
    [a, b, c].forEach((p, j) => {
      positions.set(p, k * 9 + j * 3);
      normals.set(nn, k * 9 + j * 3);
      for (let d = 0; d < 3; d++) {
        lo[d] = Math.min(lo[d], p[d]);
        hi[d] = Math.max(hi[d], p[d]);
      }
    });
  });
  const { edgePositions, edgeRanges, edges, corners } = creaseEdges(mesh, body, unit);
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return {
    id,
    name,
    color: '',
    hidden: false,
    ...(body.closed ? {} : { surface: true }),
    positions,
    normals,
    indices: Uint32Array.from({ length: n * 3 }, (_, i) => i),
    // the whole body is one face
    faceRanges: Int32Array.of(0, n * 3),
    edgePositions,
    edgeRanges,
    // the corners of the shape (where its edges meet): points to measure from
    vertices: Float32Array.from(corners.flatMap((v) => pts[v])),
    faces: [{ type: 'MESH', center, area }],
    edges,
    bbox: [lo, hi],
    meshKey,
  };
}

/**
 * The edges of the shape as polylines: segments between welded corners joined where only two of them meet; the
 * corners where the polylines end (other than two segments there).
 */
function creaseEdges(mesh: Mesh, body: StlBody, unit: Vec3[]): { edgePositions: Float32Array; edgeRanges: Int32Array; edges: EdgeInfo[]; corners: number[] } {
  const { pts, faces } = mesh;
  const N = pts.length;
  // the triangles (their index in the body) on each edge
  const onEdge = new Map<number, number[]>();
  body.faces.forEach((fi, k) => {
    const f = faces[fi];
    for (let j = 0; j < 3; j++) {
      const a = f[j];
      const b = f[(j + 1) % 3];
      const e = a < b ? a * N + b : b * N + a;
      const list = onEdge.get(e);
      if (list) list.push(k);
      else onEdge.set(e, [k]);
    }
  });
  const segs: [number, number][] = [];
  for (const [e, list] of onEdge) {
    const [p, q] = list;
    const n1 = unit[p];
    const n2 = q === undefined ? undefined : unit[q];
    const crease = list.length !== 2 || n1[0] * n2![0] + n1[1] * n2![1] + n1[2] * n2![2] < CREASE_COS;
    if (crease) segs.push([Math.floor(e / N), e % N]);
  }
  // segments at each corner
  const at = new Map<number, number[]>();
  segs.forEach(([a, b], i) => {
    for (const v of [a, b]) {
      const l = at.get(v);
      if (l) l.push(i);
      else at.set(v, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines: number[][] = [];
  const walk = (start: number, from: number) => {
    const line = [from];
    let s = start;
    let v = from;
    for (;;) {
      used[s] = 1;
      const [a, b] = segs[s];
      v = a === v ? b : a;
      line.push(v);
      const next = at.get(v)!;
      // a polyline goes on only through a corner of two segments
      if (next.length !== 2) break;
      const ns = next[0] === s ? next[1] : next[0];
      if (used[ns]) break;
      s = ns;
    }
    lines.push(line);
  };
  // from the ends and branchings first, then the closed loops
  for (const [v, list] of at) if (list.length !== 2) for (const s of list) if (!used[s]) walk(s, v);
  segs.forEach(([a], s) => {
    if (!used[s]) walk(s, a);
  });
  const total = lines.reduce((k, l) => k + l.length, 0);
  const edgePositions = new Float32Array(total * 3);
  const edgeRanges = new Int32Array(lines.length * 2);
  const edges: EdgeInfo[] = [];
  let k = 0;
  lines.forEach((l, i) => {
    edgeRanges[i * 2] = k;
    edgeRanges[i * 2 + 1] = l.length;
    let length = 0;
    l.forEach((v, j) => {
      edgePositions.set(pts[v], (k + j) * 3);
      if (j) length += Math.hypot(pts[v][0] - pts[l[j - 1]][0], pts[v][1] - pts[l[j - 1]][1], pts[v][2] - pts[l[j - 1]][2]);
    });
    k += l.length;
    const start = pts[l[0]];
    const end = pts[l[l.length - 1]];
    edges.push({ type: 'MESH', center: pts[l[Math.floor(l.length / 2)]], start, end, length, ...(l[0] === l[l.length - 1] ? { closed: true } : {}) });
  });
  const corners = [...at].filter(([, list]) => list.length !== 2).map(([v]) => v);
  return { edgePositions, edgeRanges, edges, corners };
}
