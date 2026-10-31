// STL import: binary and text files, the bodies of a mesh (parts that touch stay apart, an open one is a surface),
// the Import feature building them with the real OpenCascade kernel; a shape's faces, edges and vertices listed as
// replicad lists them, in linear time.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as R from 'replicad';
import { emptyDocument, initOpenCascade, openHeadless } from '../agent/headless';
import { parseStl, stlBodies } from './stlImport';
import { subShapes } from './geom';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

beforeAll(() => initOpenCascade(wasm), 60000);

type P = [number, number, number];

/** The 12 triangles of a box from `lo` to `hi`, wound outwards. */
function box(lo: P, hi: P): P[][] {
  const c = (i: number): P => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return quads.flatMap(([a, b, d, e]) => [
    [c(a), c(b), c(d)],
    [c(a), c(d), c(e)],
  ]);
}

function binary(tris: P[][]): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((x, c) => v.setFloat32(84 + i * 50 + 12 + k * 12 + c * 4, x, true))));
  return out;
}

const text = (tris: P[][]) =>
  new TextEncoder().encode(`solid test\n${tris.map((t) => `facet normal 0 0 0\n outer loop\n${t.map((p) => `  vertex ${p.join(' ')}\n`).join('')} endloop\nendfacet\n`).join('')}endsolid test\n`);

const lower = box([0, 0, 0], [10, 10, 5]);
const upper = box([0, 0, 5], [10, 10, 10]);

describe('STL files', () => {
  it('reads binary and text STL alike', () => {
    const a = parseStl(binary(lower));
    expect(a.length).toBe(12 * 9);
    expect([...parseStl(text(lower))]).toEqual([...a]);
    expect(() => parseStl(new TextEncoder().encode('not a mesh'))).toThrow('Not an STL file');
  });

  it('splits a mesh into its bodies: parts touching face to face apart, an open one, no zero-area triangles', () => {
    // two boxes stacked: their touching faces' edges have four triangles each
    const stacked = stlBodies(parseStl(binary([...lower, ...upper])));
    expect(stacked.map((b) => [b.triangles.length, b.closed])).toEqual([
      [12, true],
      [12, true],
    ]);
    expect(stacked[1].triangles).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    // a box without one triangle: open; a sliver triangle (two corners in one point) is left out
    const open = stlBodies(parseStl(binary([...lower.slice(1), [[0, 0, 0], [0, 0, 0], [3, 3, 3]]])));
    expect(open.map((b) => [b.triangles.length, b.closed])).toEqual([[11, false]]);
  });
});

describe('Import feature: STL', () => {
  const run = async (bytes: Uint8Array) => {
    const s = await openHeadless(emptyDocument('STL import'), wasm);
    return s.run([{ op: 'feature', type: 'import', params: { fileName: 'test.stl', format: 'stl', data: Buffer.from(bytes).toString('base64') } }]);
  };

  it('makes each closed body a part: two parts of boxes stacked, their coplanar triangles one face', async () => {
    const r = await run(binary([...lower, ...upper]));
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    expect(r.model!.parts.map((p) => [p.size, p.volume, p.faces, p.surface ?? false])).toEqual([
      [[10, 10, 5], 500, 6, false],
      [[10, 10, 5], 500, 6, false],
    ]);
    expect(r.model!.parts[1].bboxMin).toEqual([0, 0, 5]);
  }, 60000);

  it('reads a text STL; an open mesh becomes a surface', async () => {
    const solid = await run(text(box([0, 0, 0], [20, 20, 20])));
    expect(solid.model!.parts.map((p) => [p.volume, p.faces])).toEqual([[8000, 6]]);
    const sheet = await run(binary(lower.slice(2)));
    expect(sheet.failed).toEqual([]);
    expect(sheet.model!.parts.map((p) => [p.surface, p.faces])).toEqual([[true, 5]]);
  }, 60000);
});

describe('sub-shapes', () => {
  it('lists the faces, edges and vertices of a shape as replicad does', () => {
    const shape = R.makeBaseBox(10, 20, 30).fillet(2, (e) => e.inDirection('Z')) as R.Solid;
    for (const kind of ['face', 'edge', 'vertex'] as const) {
      const theirs = kind === 'face' ? shape.faces : kind === 'edge' ? shape.edges : [...R.iterTopo(shape.wrapped, 'vertex')].map((v) => R.cast(v));
      const ours = subShapes(shape, kind);
      expect(ours.length).toBe(theirs.length);
      expect(ours.every((x, i) => x.wrapped.IsSame(theirs[i].wrapped))).toBe(true);
    }
  });
});
