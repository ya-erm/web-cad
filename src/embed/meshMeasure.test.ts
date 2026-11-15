// Measuring STL meshes in the embedded viewer: a hole's rim is a circle (its diameter as the solid had it), the
// distances between corners, edges and bodies, the angle between edges, a body's area and volume, the model's
// overall size. The STL of a plate with holes is made by the real kernel, as a CAD would export it.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from '../agent/headless';
import type { SelRef, Vec3 } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import { stlMeshes } from '../kernel/stlMesh';
import { fitCircle, measureMesh, overallSize, pointTriangle, segmentSegment } from './meshMeasure';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

type P = [number, number, number];
function box(lo: P, hi: P): P[][] {
  const c = (i: number): P => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  return [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ].flatMap(([a, b, d, e]) => [
    [c(a), c(b), c(d)],
    [c(a), c(d), c(e)],
  ]);
}
function binaryStl(tris: P[][]): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((x, c) => v.setFloat32(84 + i * 50 + 12 + k * 12 + c * 4, x, true))));
  return out;
}

const ref = (p: PartMesh, kind: 'face' | 'edge' | 'vertex', index: number): SelRef => ({ kind, partId: p.id, index, sig: {} as never });
const value = (r: ReturnType<typeof measureMesh>, label: string) => r.items.find((i) => i.label === label)?.value;
const at = (p: PartMesh, i: number): Vec3 => [p.vertices[i * 3], p.vertices[i * 3 + 1], p.vertices[i * 3 + 2]];

describe('geometry', () => {
  it('fits a circle to a polygon on it, not to a line or points off it', () => {
    const ring = Array.from({ length: 33 }, (_, i): Vec3 => [5 + 3 * Math.cos((i / 32) * 2 * Math.PI), 2, 1 + 3 * Math.sin((i / 32) * 2 * Math.PI)]);
    const c = fitCircle(ring, 1e-6)!;
    expect(c.radius).toBeCloseTo(3, 9);
    expect(c.center.map((v) => +v.toFixed(9))).toEqual([5, 2, 1]);
    expect(Math.abs(c.normal[1])).toBeCloseTo(1, 9);
    // an arc of a quarter turn is a circle too
    expect(fitCircle(ring.slice(0, 9), 1e-6)?.radius).toBeCloseTo(3, 9);
    expect(fitCircle(Array.from({ length: 8 }, (_, i): Vec3 => [i, 2 * i, 0]), 1e-6)).toBeNull();
    expect(fitCircle(ring.map((p, i): Vec3 => (i === 5 ? [p[0] + 0.5, p[1], p[2]] : p)), 1e-6)).toBeNull();
    expect(fitCircle(ring.slice(0, 4), 1e-6)).toBeNull();
  });

  it('finds the nearest points of segments and of a point and a triangle', () => {
    const [a, b] = segmentSegment([0, 0, 0], [10, 0, 0], [5, -5, 3], [5, 5, 3]);
    expect([a, b]).toEqual([
      [5, 0, 0],
      [5, 0, 3],
    ]);
    expect(pointTriangle([1, 1, 5], [0, 0, 0], [4, 0, 0], [0, 4, 0])).toEqual([1, 1, 0]);
    expect(pointTriangle([9, 9, 0], [0, 0, 0], [4, 0, 0], [0, 4, 0])).toEqual([2, 2, 0]);
    expect(pointTriangle([-3, -1, 0], [0, 0, 0], [4, 0, 0], [0, 4, 0])).toEqual([0, 0, 0]);
  });
});

describe('two boxes', () => {
  // 20 × 10 × 5 at the origin, 10 × 10 × 10 at x = 30
  const [a, b] = stlMeshes(binaryStl([...box([0, 0, 0], [20, 10, 5]), ...box([30, 0, 0], [40, 10, 10])]), 'k');

  it('a body: its area and volume; a corner: its point; an edge: its length', () => {
    const body = measureMesh([ref(a, 'face', 0)], [a, b]);
    expect(value(body, 'Area')).toBeCloseTo(2 * (200 + 100 + 50), 6);
    expect(value(body, 'Volume')).toBeCloseTo(1000, 6);
    expect(a.vertices.length / 3).toBe(8);
    const corner = measureMesh([ref(a, 'vertex', 0)], [a, b]);
    expect([value(corner, 'X'), value(corner, 'Y'), value(corner, 'Z')]).toEqual(at(a, 0));
    const lengths = a.edges.map((_, i) => value(measureMesh([ref(a, 'edge', i)], [a, b]), 'Length')!);
    expect(lengths.map(Math.round).sort((x, y) => x - y)).toEqual([5, 5, 5, 5, 10, 10, 10, 10, 20, 20, 20, 20]);
  });

  it('two bodies: the gap between them, the farthest corners, the line drawn', () => {
    const r = measureMesh([ref(a, 'face', 0), ref(b, 'face', 0)], [a, b]);
    expect(value(r, 'Minimum distance')).toBeCloseTo(10, 6);
    expect(value(r, 'ΔX')).toBeCloseTo(10, 6);
    expect(value(r, 'ΔY')).toBeCloseTo(0, 6);
    expect(value(r, 'Maximum distance')).toBeCloseTo(Math.hypot(40, 10, 10), 6);
    expect(r.lines?.map((l) => l.key)).toEqual(['min', 'max']);
  });

  it('corners and edges: distances between them, the angle between straight edges', () => {
    const ci = (p: PartMesh, q: Vec3) => Array.from({ length: p.vertices.length / 3 }, (_, i) => i).find((i) => at(p, i).every((v, k) => v === q[k]))!;
    const r = measureMesh([ref(a, 'vertex', ci(a, [0, 0, 0])), ref(b, 'vertex', ci(b, [40, 10, 10]))], [a, b]);
    expect(value(r, 'Minimum distance')).toBeCloseTo(Math.hypot(40, 10, 10), 6);
    expect(value(r, 'Center to center')).toBeUndefined();
    // an edge along X and one along Z: a right angle; an edge and a body: from the edge to the nearest triangle
    const along = (p: PartMesh, axis: number) => p.edges.findIndex((e) => Math.abs(e.end[axis] - e.start[axis]) > 1 && [0, 1, 2].every((k) => k === axis || e.end[k] === e.start[k]));
    const ang = measureMesh([ref(a, 'edge', along(a, 0)), ref(b, 'edge', along(b, 2))], [a, b]);
    expect(value(ang, 'Angle')).toBeCloseTo(Math.PI / 2, 9);
    const toBody = measureMesh([ref(b, 'face', 0), ref(a, 'edge', along(a, 2))], [a, b]);
    expect(value(toBody, 'Minimum distance')).toBeGreaterThanOrEqual(10 - 1e-9);
  });

  it('nothing selected: the overall size of what is shown', () => {
    expect(overallSize([a, b]).items.map((i) => [i.label, i.value])).toEqual([
      ['ΔX', 40],
      ['ΔY', 10],
      ['ΔZ', 10],
    ]);
    expect(overallSize([{ ...b, hidden: true }, a]).items.map((i) => i.value)).toEqual([20, 10, 5]);
  });
});

describe('a plate with holes, exported to STL by the kernel', () => {
  let plate: PartMesh;
  beforeAll(async () => {
    const s = await openHeadless(emptyDocument('Plate'), wasm);
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 60, h: 30 }, { type: 'circle', c: [-15, 0], r: 4 }, { type: 'circle', c: [15, 0], r: 6.5 }] },
      { op: 'extrude', depth: 5 },
    ]);
    expect(r.error).toBeUndefined();
    [plate] = stlMeshes(await s.exportStl(true), 'k');
  }, 120000);

  it("a hole's rim: its diameter and centre as the solid had them", () => {
    const rims = plate.edges.map((_, i) => measureMesh([ref(plate, 'edge', i)], [plate])).filter((r) => value(r, 'Diameter') !== undefined);
    // two rims of each hole (top and bottom)
    expect(rims.map((r) => +value(r, 'Diameter')!.toFixed(4)).sort((x, y) => x - y)).toEqual([8, 8, 13, 13]);
    // the plate's outline is no circle
    expect(plate.edges.length).toBeGreaterThan(4);
  });

  it('centre to centre of the two holes, the distance between their rims', () => {
    const rim = (d: number) => plate.edges.findIndex((_, i) => Math.abs((value(measureMesh([ref(plate, 'edge', i)], [plate]), 'Diameter') ?? 0) - d) < 1e-3);
    const r = measureMesh([ref(plate, 'edge', rim(8)), ref(plate, 'edge', rim(13))], [plate]);
    expect(value(r, 'Center to center')).toBeCloseTo(30, 3);
    // between the rims: 30 − 4 − 6.5 (the polygons' sides are a little inside the circles)
    expect(value(r, 'Minimum distance')).toBeGreaterThan(19.5 - 1e-6);
    expect(value(r, 'Minimum distance')).toBeLessThan(19.7);
    expect(value(r, 'Angle')).toBeCloseTo(0, 6);
  });

  it('the body: its volume and area close to the solid', () => {
    const r = measureMesh([ref(plate, 'face', 0)], [plate]);
    const solid = 5 * (60 * 30 - Math.PI * (16 + 42.25));
    expect(Math.abs(value(r, 'Volume')! - solid) / solid).toBeLessThan(0.01);
  });
});
