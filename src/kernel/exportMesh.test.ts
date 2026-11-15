// Export meshes are closed: a face the mesher gives up on is not left out of the file.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { stlOf } from './build';
import { exportMesh, meshedForExport } from './meshing';
import type { Shape3D } from './geom';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

beforeAll(async () => {
  const oc = await opencascade({ locateFile: () => wasm } as never);
  R.setOC(oc);
}, 60000);

/**
 * A lid: a shell open at the bottom, its front wall flat between rounded corners (x ±6.6, y −20.4 inside), and a
 * post hanging from its ceiling whose side touches the wall along a line (x 6.5, z 8.1…14.6). The wall's face keeps
 * that line as an INTERNAL edge in a wire of its own, and the mesher gives the face no triangles.
 */
function lidWithPost(): Shape3D {
  const r = 12.5;
  const k = r * Math.SQRT1_2;
  const body = R.draw([6.6, -22])
    .threePointsArcTo([6.6 + r, -22 + r], [6.6 + k, -22 + r - k])
    .lineTo([6.6 + r, 0])
    .lineTo([-6.6 - r, 0])
    .lineTo([-6.6 - r, -22 + r])
    .threePointsArcTo([-6.6, -22], [-6.6 - k, -22 + r - k])
    .close()
    .sketchOnPlane('XY', 1.12)
    .extrude(15.08) as Shape3D;
  const lid = body.shell(1.6, (f) => f.inPlane('XY', 1.12)) as Shape3D;
  // as a feature adds it: the Boolean simplified
  return lid.fuse(R.makeCylinder(7.1, 6.5, [6.5, -13.3, 8.1], [0, 0, 1]) as Shape3D).simplify();
}

type Tri = [number, number, number][];

function stlTriangles(bytes: Uint8Array): Tri[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const out: Tri[] = [];
  for (let i = 0; i < n; i++) {
    const at = 84 + i * 50 + 12;
    const p = (k: number): [number, number, number] => [0, 1, 2].map((c) => dv.getFloat32(at + (k * 3 + c) * 4, true)) as [number, number, number];
    out.push([p(0), p(1), p(2)]);
  }
  return out;
}

function meshTriangles(m: { positions: Float32Array; indices: Uint32Array }): Tri[] {
  const p = (i: number): [number, number, number] => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  const out: Tri[] = [];
  for (let t = 0; t < m.indices.length; t += 3) out.push([p(m.indices[t]), p(m.indices[t + 1]), p(m.indices[t + 2])]);
  return out;
}

/** Edges used by one triangle only (vertices matched to 1e-4) and the signed volume the triangles enclose. */
function check(tris: Tri[]) {
  const key = (v: number[]) => v.map((x) => Math.round(x * 1e4)).join(',');
  const uses = new Map<string, number>();
  let volume = 0;
  for (const [a, b, c] of tris) {
    const k = [key(a), key(b), key(c)];
    if (new Set(k).size < 3) continue;
    for (const [i, j] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const e = k[i] < k[j] ? `${k[i]}|${k[j]}` : `${k[j]}|${k[i]}`;
      uses.set(e, (uses.get(e) ?? 0) + 1);
    }
    volume += (a[0] * (b[1] * c[2] - c[1] * b[2]) - b[0] * (a[1] * c[2] - c[1] * a[2]) + c[0] * (a[1] * b[2] - b[1] * a[2])) / 6;
  }
  return { open: [...uses.values()].filter((n) => n === 1).length, volume };
}

describe('export meshes', () => {
  it('meshes the wall a post touches along a line: the STL and the OBJ / 3MF meshes are closed', async () => {
    const shape = lidWithPost();
    const volume = R.measureVolume(shape);
    // the case itself: replicad's STL of the shape leaves the wall's face out
    const raw = check(stlTriangles(new Uint8Array(await shape.blobSTL({ tolerance: 0.01, angularTolerance: 0.2, binary: true }).arrayBuffer())));
    expect(raw.open).toBeGreaterThan(0);
    expect(raw.volume - volume).toBeGreaterThan(100);

    const stl = check(stlTriangles(await stlOf([{ name: 'Lid', color: '#888888', shape }], 0.01, 0.2, true)));
    expect(stl.open).toBe(0);
    expect(Math.abs(stl.volume - volume)).toBeLessThan(volume * 1e-3);

    const mesh = check(meshTriangles(exportMesh(shape, 0.01, 0.2)));
    expect(mesh.open).toBe(0);
    expect(Math.abs(mesh.volume - volume)).toBeLessThan(volume * 1e-3);
  }, 60000);

  it('leaves a shape whose faces all mesh as it is', () => {
    const box = R.makeBox([0, 0, 0], [10, 20, 30]) as Shape3D;
    expect(meshedForExport(box, 0.01, 0.2)).toBe(box);
  });
});
