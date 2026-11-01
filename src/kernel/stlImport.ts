// STL import (Onshape Import of a mesh): the triangles of a binary or text STL, welded where their corners meet and
// split into the bodies they bound — a closed one a solid part, an open one a surface; coplanar triangles one face.
import * as R from 'replicad';
import { perpendicular, v3 } from '../core/math';
import type { Vec3 } from '../core/types';
import { fail, type Shape3D } from './geom';
import { regionsSolid } from './meshBrep';
import { meshRegions, type Mesh, type Tri } from './meshSurfaces';

/** The triangles of an STL file, 9 coordinates each: binary (by its size) or text ("vertex x y z", three a facet). */
export function parseStl(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(84 + i * 50 + 12 + k * 4, true);
      return out;
    }
  }
  const nums: number[] = [];
  for (const m of new TextDecoder().decode(bytes).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!nums.length || nums.length % 9 || nums.some((v) => !Number.isFinite(v))) fail('Not an STL file');
  return Float32Array.from(nums);
}

export interface StlBody {
  /** Its triangles (their indices in the file). */
  triangles: number[];
  /** The same in the welded mesh (`weldStl`). */
  faces: number[];
  /** Every edge of it between two of its triangles: it bounds a volume. */
  closed: boolean;
}

/** An STL's triangles with their corners welded, the model's size (diagonal); triangles of zero area left out. */
export function weldStl(tris: Float32Array): Mesh & { source: number[]; size: number } {
  const n = tris.length / 9;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], tris[i]);
    hi[i % 3] = Math.max(hi[i % 3], tris[i]);
  }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  // corners nearer than a ten-millionth of the model's size are one point
  const q = Math.max(size * 1e-7, 1e-9);
  const ids = new Map<string, number>();
  const pts: Vec3[] = [];
  const corner = (o: number) => {
    const key = `${Math.round(tris[o] / q)},${Math.round(tris[o + 1] / q)},${Math.round(tris[o + 2] / q)}`;
    let id = ids.get(key);
    if (id === undefined) {
      ids.set(key, (id = ids.size));
      pts.push([tris[o], tris[o + 1], tris[o + 2]]);
    }
    return id;
  };
  const faces: Tri[] = [];
  const source: number[] = [];
  for (let i = 0; i < n; i++) {
    const f: Tri = [corner(i * 9), corner(i * 9 + 3), corner(i * 9 + 6)];
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue;
    faces.push(f);
    source.push(i);
  }
  return { pts, faces, source, size };
}

/**
 * The bodies of a mesh: its triangles joined across the edges they share. On an edge of more triangles (parts that
 * touch there) each is joined with its neighbour around the edge across the solid between them — by their winding
 * (outward normals).
 */
export function stlBodies(tris: Float32Array, mesh = weldStl(tris)): StlBody[] {
  const { pts, faces, source } = mesh;
  const N = pts.length;
  const edgeKey = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  const onEdge = new Map<number, number[]>();
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const e = edgeKey(f[k], f[(k + 1) % 3]);
      const list = onEdge.get(e);
      if (list) list.push(i);
      else onEdge.set(e, [i]);
    }
  });
  /**
   * The triangles on edge a–b that bound one solid, in pairs. About the axis a → b, a triangle wound a → b has its
   * outward normal counter-clockwise (its solid on the clockwise side), one wound b → a the other way: each of the
   * second kind is joined with the next triangle counter-clockwise (at the same angle the one closing a solid first).
   */
  const aroundEdge = (a: number, b: number, list: number[]): [number, number][] => {
    const A = pts[a];
    const u = v3.norm(v3.sub(pts[b], A));
    const e1 = perpendicular(u);
    const e2 = v3.cross(u, e1);
    const around = list.map((i) => {
      const f = faces[i];
      const c = f.find((x) => x !== a && x !== b)!;
      const w = v3.sub(pts[c], A);
      const angle = Math.atan2(v3.dot(w, e2), v3.dot(w, e1));
      return { i, s: f[(f.indexOf(a) + 1) % 3] === b ? 1 : -1, angle: angle > Math.PI - 1e-9 ? angle - 2 * Math.PI : angle };
    });
    around.sort((x, y) => (Math.abs(x.angle - y.angle) > 1e-9 ? x.angle - y.angle : y.s - x.s));
    const pairs: [number, number][] = [];
    around.forEach((x, k) => {
      const next = around[(k + 1) % around.length];
      if (x.s < 0 && next.s > 0) pairs.push([x.i, next.i]);
    });
    return pairs;
  };
  const parent = faces.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (const [e, list] of onEdge) {
    if (list.length === 2) parent[find(list[1])] = find(list[0]);
    else if (list.length > 2) for (const [i, j] of aroundEdge(Math.floor(e / N), e % N, list)) parent[find(j)] = find(i);
  }
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()].map((g) => {
    const uses = new Map<number, number>();
    for (const i of g) for (let k = 0; k < 3; k++) {
      const e = edgeKey(faces[i][k], faces[i][(k + 1) % 3]);
      uses.set(e, (uses.get(e) ?? 0) + 1);
    }
    return { triangles: g.map((i) => source[i]), faces: g, closed: [...uses.values()].every((u) => u === 2) };
  });
}

/**
 * A binary STL of some of the triangles. Its header is of bytes past ASCII: OpenCascade takes a file whose first 134
 * bytes are all ASCII for a text one (a small part at round coordinates after a blank header would be).
 */
function binaryStl(tris: Float32Array, list: number[]): Uint8Array {
  const out = new Uint8Array(84 + list.length * 50);
  out.fill(0xff, 0, 80);
  const v = new DataView(out.buffer);
  v.setUint32(80, list.length, true);
  list.forEach((i, j) => {
    for (let k = 0; k < 9; k++) v.setFloat32(84 + j * 50 + 12 + k * 4, tris[i * 9 + k], true);
  });
  return out;
}

let fileCount = 0;

/** One body's triangles as a shape: sewn into a shell, coplanar ones merged; a solid of it when it is closed. */
function bodyShape(data: Uint8Array, closed: boolean): Shape3D {
  const oc = R.getOC();
  const name = `stl-import-${++fileCount}.stl`;
  oc.FS.writeFile(`/${name}`, data);
  const reader = new oc.StlAPI_Reader();
  const faces = new oc.TopoDS_Shape();
  let read = false;
  try {
    read = reader.Read(faces, name);
  } finally {
    oc.FS.unlink(`/${name}`);
    reader.delete();
  }
  if (!read) fail('The STL file could not be read');
  // the triangles (faces of their own, sharing their edges): one shell
  const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  sewing.Add(faces);
  sewing.Perform();
  const sewn = sewing.SewedShape();
  sewing.delete();
  faces.delete();
  const unify = new oc.ShapeUpgrade_UnifySameDomain(sewn, true, true, false);
  unify.Build();
  const merged = unify.Shape();
  unify.delete();
  sewn.delete();
  if (closed) {
    const ex = new oc.TopExp_Explorer(merged, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const shell = ex.More() ? oc.TopoDS.Shell(ex.Current()) : null;
    ex.delete();
    if (shell) {
      // turned so that it holds its volume, not the space around it
      const fix = new oc.ShapeFix_Solid();
      const solid = fix.SolidFromShell(shell);
      fix.delete();
      merged.delete();
      return R.cast(solid) as Shape3D;
    }
  }
  return R.cast(merged) as Shape3D;
}

/** The most triangles of a body whose faces are recognised, and the most faces recognised it is built of. */
const MAX_RECOGNIZED = 30000;
const MAX_FACES = 2000;

/**
 * A closed body's faces recognised (meshRegions) and built into a solid; the regions OpenCascade cannot take (a face
 * it finds invalid, an edge left free) go back to the mesh's flat pieces, a few times over. Null: none could be built.
 */
export function recognizedSolid(mesh: Mesh, faces: number[], tol: number): { solid: Shape3D; tries: number } | null {
  // a mesh this fine is a freeform shape's (a thread, a loft): kept as it is, not searched for minutes
  if (faces.length > MAX_RECOGNIZED) return null;
  let regions = meshRegions(mesh, faces, tol, true, MAX_FACES);
  // little recognised: the mesh's own faces are as good (and quicker)
  if (!regions || regions.length > MAX_FACES) return null;
  for (let tries = 1; tries <= 5; tries++) {
    const built = regionsSolid(mesh, faces, regions, tol);
    if ('solid' in built) return { solid: built.solid, tries };
    if (!built.demote?.length) return null;
    const out = new Set(built.demote);
    const back = [...out].flatMap((r) => regions![r].faces);
    regions = [...regions.filter((_, i) => !out.has(i)), ...(meshRegions(mesh, back, tol, false) ?? [])];
  }
  return null;
}

/**
 * The bodies of an STL file as shapes: a closed one a solid, an open one a surface (in the file's order). With
 * `recognize` a closed body's faces are recognised (planes, cylinders, cones, spheres — see meshSurfaces) and built
 * as such; a body that cannot be keeps its triangles.
 */
export function importStl(bytes: Uint8Array, recognize = true): { shape: Shape3D; closed: boolean; recognized: boolean }[] {
  const tris = parseStl(bytes);
  const mesh = weldStl(tris);
  const bodies = stlBodies(tris, mesh);
  if (!bodies.length) fail('The STL file has no triangles');
  // corners lie on their faces to a ten-thousandth of the model's size
  const tol = Math.max(mesh.size * 1e-4, 1e-6);
  return bodies.map((b) => {
    if (recognize && b.closed) {
      const built = recognizedSolid(mesh, b.faces, tol);
      if (built) return { shape: built.solid, closed: true, recognized: true };
    }
    return { shape: bodyShape(binaryStl(tris, b.triangles), b.closed), closed: b.closed, recognized: false };
  });
}
