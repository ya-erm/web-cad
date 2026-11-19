import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import type { BoolOp, Vec3 } from '../core/types';
import { applyBodyOp, applyFeature } from './features';
import { bboxOf, compoundOf, fuseAll, simplified, solidsOf, type Shape3D } from './geom';
import { meshPart } from './meshing';
import { resolveEdge, resolveFace } from './refs';
import { edgeSig, faceSig } from './sigs';
import { emptyState, setPart } from './state';

beforeAll(async () => {
  const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  R.setOC(await opencascade({ locateFile: () => wasm } as never));
}, 60000);

const box = (lo: Vec3, hi: Vec3) => R.makeBox(lo, hi) as Shape3D;
const base = () => box([0, 0, 0], [10, 10, 10]);
const meta = { name: 'Test', color: '#abcdef', hidden: false };
const scope = { mergeAll: true, parts: [] };
const volume = (shape: Shape3D) => {
  const p = R.measureShapeVolumeProperties(shape);
  try { return p.volume; } finally { p.delete(); }
};

function expectCompatible(shape: Shape3D, legacy: Shape3D) {
  const expected = meshPart('part', legacy, meta);
  const actual = meshPart('part', shape, meta);
  expect(actual.bbox).toEqual(expected.bbox);
  expect(actual.faces).toEqual(expected.faces);
  expect(actual.edges).toEqual(expected.edges);
  expect(volume(shape)).toBeCloseTo(volume(legacy), 7);
  const st = emptyState();
  setPart(st, 'part', shape);
  expected.faces.forEach((face, index) => {
    expect(resolveFace(st, { kind: 'face', partId: 'part', index, sig: faceSig(face, expected.bbox) }).index).toBe(index);
  });
  expected.edges.forEach((edge, index) => {
    expect(resolveEdge(st, { kind: 'edge', partId: 'part', index, sig: edgeSig(edge, expected.bbox) }).index).toBe(index);
  });
}

describe('Boolean results without a second unification pass', () => {
  const cases: { name: string; op: Exclude<BoolOp, 'new'>; tool: () => Shape3D; expectedVolume: number }[] = [
    { name: 'coplanar union', op: 'add', tool: () => box([10, 0, 0], [20, 10, 10]), expectedVolume: 2000 },
    { name: 'curved through hole', op: 'remove', tool: () => R.makeCylinder(2, 12, [5, 5, -1]), expectedVolume: 1000 - 40 * Math.PI },
    { name: 'internal pocket', op: 'remove', tool: () => box([2, 2, 2], [8, 8, 8]), expectedVolume: 784 },
    { name: 'part split', op: 'remove', tool: () => box([4, -1, -1], [6, 11, 11]), expectedVolume: 800 },
    { name: 'intersection', op: 'intersect', tool: () => box([5, 5, -1], [15, 15, 11]), expectedVolume: 250 },
  ];
  it.each(cases)('preserves geometry and saved topology for $name', ({ op, tool, expectedVolume }) => {
    const source = base();
    const originalBounds = bboxOf(source);
    const st = emptyState();
    setPart(st, 'part', source);
    applyBodyOp(st, 'operation', tool(), op, scope);
    const reference = base();
    const cutter = tool();
    const result = op === 'add' ? reference.fuse(cutter) : op === 'remove' ? reference.cut(cutter) : reference.intersect(cutter);
    const legacy = solidsOf(simplified(result));
    const parts = [...st.parts.values()];
    expect(parts.length).toBe(legacy.length);
    parts.forEach((p, i) => expectCompatible(p.shape, legacy[i]));
    expect(parts.reduce((sum, p) => sum + volume(p.shape), 0)).toBeCloseTo(expectedVolume, 6);
    expect(volume(source)).toBeCloseTo(1000, 7);
    expect(bboxOf(source)).toEqual(originalBounds);
  });

  it('still merges all coplanar faces of two adjacent cubes', () => {
    const st = emptyState();
    setPart(st, 'part', base());
    applyBodyOp(st, 'add', box([10, 0, 0], [20, 10, 10]), 'add', scope);
    const [part] = [...st.parts.values()];
    expect(part.shape.faces.length).toBe(6);
    expect(part.shape.edges.length).toBe(12);
  });

  it('keeps the topology of connected and separate groups in a multi-tool union', () => {
    const tools = () => [base(), box([10, 0, 0], [20, 10, 10]), box([15, 0, 0], [25, 10, 10]), box([40, 0, 0], [50, 10, 10])];
    const [a, b, c, apart] = tools();
    const legacy = compoundOf([simplified(a.fuse(b).fuse(c)), apart]);
    expectCompatible(fuseAll(tools()), legacy);
  });

  it('keeps Boolean tool retention and old references through a subtract and intersect', async () => {
    const st = emptyState();
    setPart(st, 'part', base());
    setPart(st, 'drill', R.makeCylinder(2, 12, [5, 5, -1]));
    setPart(st, 'limit', box([0, 0, 0], [5, 10, 10]));
    const ec = { vars: {}, lengthUnit: 'mm' as const, angleUnit: 'deg' as const };
    const refs = (id: string) => [{ kind: 'part' as const, partId: id }];
    await applyFeature(st, { id: 'hole', type: 'boolean', name: 'Hole', params: { op: 'subtract', tools: refs('drill'), targets: refs('part'), keepTools: true } }, ec);
    const legacyHole = simplified(base().cut(R.makeCylinder(2, 12, [5, 5, -1])));
    expectCompatible(st.parts.get('part')!.shape, solidsOf(legacyHole)[0]);
    expect(st.parts.has('drill')).toBe(true);
    await applyFeature(st, { id: 'trim', type: 'boolean', name: 'Trim', params: { op: 'intersect', tools: refs('limit'), targets: refs('part'), keepTools: true } }, ec);
    expectCompatible(st.parts.get('part')!.shape, solidsOf(simplified(legacyHole.intersect(box([0, 0, 0], [5, 10, 10]))))[0]);
    expect(st.parts.has('limit')).toBe(true);
  });
});
