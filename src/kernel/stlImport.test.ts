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

describe('Import feature: STL faces recognized', () => {
  /** A part built here, exported to STL and imported back (into a document of its own). */
  const roundTrip = async (ops: unknown[], params: Record<string, unknown> = {}) => {
    const src = await openHeadless(emptyDocument('Source'), wasm);
    const made = await src.run(ops as never);
    expect(made.error).toBeUndefined();
    const stl = await src.exportStl();
    const s = await openHeadless(emptyDocument('STL import'), wasm);
    const r = await s.run([{ op: 'feature', type: 'import', params: { fileName: 'part.stl', format: 'stl', data: Buffer.from(stl).toString('base64'), ...params } }]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    const kinds = async (type: string) => ((await s.query({ faces: { type } } as never).catch(() => ({ faces: [] }))) as { faces: unknown[] }).faces.length;
    return { source: made.model!.parts[0], part: r.model!.parts[0], kinds, warning: r.model!.features[0].message };
  };
  const plate = [
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
    { op: 'extrude', depth: 10 },
    { op: 'fillet', edges: { dir: 'z' }, radius: 4 },
    { op: 'sketch', name: 'C', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [0, 0] }] },
    { op: 'hole', sketch: 'C', diameter: 8, through: true },
    { op: 'chamfer', edges: { type: 'circle', radius: 4, z: 10, x: [-4, 4] }, distance: 1 },
  ];

  it('builds a part from its STL with its planes, cylinders and cones: as few faces, the same volume', async () => {
    const { source, part, kinds, warning } = await roundTrip(plate);
    // top, bottom, 4 sides; 4 rounded corners and the hole; the hole's chamfer — as the part has
    expect([source.faces, part.faces]).toEqual([12, 12]);
    expect([await kinds('plane'), await kinds('cylinder'), await kinds('cone')]).toEqual([6, 5, 1]);
    expect(part.size).toEqual(source.size);
    // the faces of the part, not of its tessellation: a little more than the triangles hold where they bulge
    expect(Math.abs(part.volume! - source.volume!)).toBeLessThan(0.002 * source.volume!);
    expect(warning).toBeUndefined();
  }, 120000);

  it('builds a ball as one sphere; keeps the triangles when asked to', async () => {
    const ball = [
      { op: 'sketch', name: 'Half', plane: 'front', shapes: [{ type: 'line', from: [0, -5], to: [0, 5] }, { type: 'arc', c: [0, 0], r: 5, start: -90, end: 90 }] },
      { op: 'revolve', sketch: 'Half', axis: { sketch: 'Half', line: 0 } },
    ];
    const { part, kinds } = await roundTrip(ball);
    expect([part.faces, await kinds('sphere')]).toEqual([1, 1]);
    expect(part.volume!).toBeCloseTo((4 / 3) * Math.PI * 125, 0);
    const kept = await roundTrip(plate, { recognize: false });
    expect(kept.part.faces).toBeGreaterThan(100);
  }, 120000);
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
