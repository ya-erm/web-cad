// Curve patterns and ribs (Onshape Curve pattern, Rib) with the real OpenCascade kernel.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';
import type { PartSummary } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function model(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Patterns'), wasm);
  const r = await s.run(ops as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return r.model!;
}

const center = (p: PartSummary) => p.bboxMin.map((v, i) => +(v + p.size[i] / 2).toFixed(3));

describe('Curve pattern', () => {
  /** A 4 mm cube at (50, 0) and a quarter circle r = 50 from it round the origin. */
  const cubeOnArc = [
    { op: 'sketch', shapes: [{ type: 'rect', center: true, x: 50, y: 0, w: 4, h: 4 }] },
    { op: 'extrude', depth: 4 },
    { op: 'sketch', name: 'Path', shapes: [{ type: 'arc', c: [0, 0], r: 50, start: 0, end: 90 }] },
  ];

  it('spreads copies over the path, turning with it', async () => {
    const m = await model([...cubeOnArc, { op: 'curvePattern', parts: 'all', path: { sketch: 'Path' }, count: 3 }]);
    expect(m.parts).toHaveLength(3);
    const c = 50 * Math.SQRT1_2;
    expect(m.parts.map(center)).toEqual([
      [50, 0, 2],
      [+c.toFixed(3), +c.toFixed(3), 2],
      [0, 50, 2],
    ]);
    // the middle copy turned 45° with the arc: its box is the diagonal wide
    expect(m.parts[1].size[0]).toBeCloseTo(4 * Math.SQRT2, 3);
  }, 60000);

  it('only moves them (no turn), or puts them a distance apart along a line', async () => {
    const m = await model([...cubeOnArc, { op: 'curvePattern', parts: 'all', path: { sketch: 'Path' }, count: 3, orient: false }]);
    expect(m.parts[1].size).toEqual([4, 4, 4]);
    const line = await model([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 4, h: 4 }] },
      { op: 'extrude', depth: 4 },
      { op: 'sketch', name: 'Path', shapes: [{ type: 'line', from: [0, 0], to: [100, 0] }] },
      { op: 'curvePattern', parts: 'all', path: { sketch: 'Path' }, count: 3, distance: 20 },
    ]);
    expect(line.parts.map((p) => center(p)[0])).toEqual([0, 20, 40]);
  }, 60000);
});

describe('Rib', () => {
  it('fills the inner corner of an L bracket from a sketch line, symmetric about the sketch plane', async () => {
    const bracket = [
      { op: 'sketch', shapes: [{ type: 'rect', x: -20, y: -15, w: 40, h: 30 }] },
      { op: 'extrude', depth: 5 },
      { op: 'sketch', shapes: [{ type: 'rect', x: -20, y: -15, w: 5, h: 30 }] },
      { op: 'extrude', depth: 30, boolean: 'add' },
    ];
    const plain = await model(bracket);
    const m = await model([...bracket, { op: 'sketch', name: 'Rib', plane: 'front', shapes: [{ type: 'line', from: [-15, 20], to: [10, 5] }] }, { op: 'rib', sketch: 'Rib', thickness: 4 }]);
    expect(m.parts).toHaveLength(1);
    // a triangle 25 × 15 in the corner, 4 thick
    expect(m.parts[0].volume! - plain.parts[0].volume!).toBeCloseTo(0.5 * 25 * 15 * 4, 2);
  }, 60000);

  it('runs a short line on to the parts it points at', async () => {
    const bracket = [
      { op: 'sketch', shapes: [{ type: 'rect', x: -20, y: -15, w: 40, h: 30 }] },
      { op: 'extrude', depth: 5 },
      { op: 'sketch', shapes: [{ type: 'rect', x: -20, y: -15, w: 5, h: 30 }] },
      { op: 'extrude', depth: 30, boolean: 'add' },
    ];
    const plain = await model(bracket);
    // the line of the gusset, a tenth short at both ends
    const m = await model([...bracket, { op: 'sketch', name: 'Rib', plane: 'front', shapes: [{ type: 'line', from: [-12.5, 18.5], to: [7.5, 6.5] }] }, { op: 'rib', sketch: 'Rib', thickness: 4 }]);
    expect(m.parts[0].volume! - plain.parts[0].volume!).toBeCloseTo(0.5 * 25 * 15 * 4, 2);
  }, 60000);

  it('grows along the sketch normal down to a plate', async () => {
    const m = await model([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 5 },
      { op: 'plane', name: 'Above', from: 'top', offset: 15 },
      { op: 'sketch', name: 'Rib', plane: { plane: 'Above' }, shapes: [{ type: 'line', from: [-10, 0], to: [10, 0] }] },
      { op: 'rib', sketch: 'Rib', thickness: 2, normal: true },
    ]);
    expect(m.parts[0].volume).toBeCloseTo(40 * 30 * 5 + 20 * 2 * 10, 2);
    expect(m.parts[0].size).toEqual([40, 30, 15]);
  }, 60000);

  it('drafts the sides: wider towards the part, or narrower the other way', async () => {
    const ops = (draftFlip: boolean) => [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 5 },
      { op: 'plane', name: 'Above', from: 'top', offset: 15 },
      { op: 'sketch', name: 'Rib', plane: { plane: 'Above' }, shapes: [{ type: 'line', from: [-10, 0], to: [10, 0] }] },
      { op: 'rib', sketch: 'Rib', thickness: 2, normal: true, draft: 5, draftFlip },
    ];
    // 2 thick at the sketch, 10 down to the plate: each side leans out by 10 · tan 5° (the ends stay square)
    const k = 100 * Math.tan((5 * Math.PI) / 180);
    expect((await model(ops(false))).parts[0].volume).toBeCloseTo(40 * 30 * 5 + 20 * (2 * 10 + k), 2);
    expect((await model(ops(true))).parts[0].volume).toBeCloseTo(40 * 30 * 5 + 20 * (2 * 10 - k), 2);
  }, 60000);

  it('drafts a gusset within the sketch plane: thicker towards the corner', async () => {
    const bracket = [
      { op: 'sketch', shapes: [{ type: 'rect', x: -20, y: -15, w: 40, h: 30 }] },
      { op: 'extrude', depth: 5 },
      { op: 'sketch', shapes: [{ type: 'rect', x: -20, y: -15, w: 5, h: 30 }] },
      { op: 'extrude', depth: 30, boolean: 'add' },
    ];
    const plain = await model(bracket);
    const m = await model([...bracket, { op: 'sketch', name: 'Rib', plane: 'front', shapes: [{ type: 'line', from: [-15, 20], to: [10, 5] }] }, { op: 'rib', sketch: 'Rib', thickness: 4, draft: 3 }]);
    // thickness 4 + 2 s tan 3° at the distance s from the line, over the triangle (base L, height H from the line)
    const L = Math.hypot(25, 15);
    const H = (25 * 15) / L;
    expect(m.parts[0].volume! - plain.parts[0].volume!).toBeCloseTo(4 * 187.5 + 2 * Math.tan((3 * Math.PI) / 180) * ((L * H * H) / 6), 1);
  }, 60000);

  it('runs an arc on along its tangents up to the part', async () => {
    // a plate with a wall at its left end; a C-shaped arc above the plate, its ends pointing at the wall
    const base = [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 60, h: 40 }] },
      { op: 'extrude', depth: 5 },
      { op: 'sketch', shapes: [{ type: 'rect', x: -30, y: -20, w: 5, h: 40 }] },
      { op: 'extrude', depth: 20, boolean: 'add' },
      { op: 'plane', name: 'Above', from: 'top', offset: 15 },
      { op: 'sketch', name: 'Rib', plane: { plane: 'Above' }, shapes: [{ type: 'arc', c: [0, 0], r: 10, start: 270, end: 90 }] },
    ];
    const plain = (await model(base.slice(0, 4))).parts[0].volume!;
    const short = await model([...base, { op: 'rib', sketch: 'Rib', thickness: 2, normal: true, extend: false }]);
    const long = await model([...base, { op: 'rib', sketch: 'Rib', thickness: 2, normal: true }]);
    // the half ring 2 wide, 10 tall; extended: two straight legs 25 long to the wall
    expect(short.parts[0].volume! - plain).toBeCloseTo(Math.PI * 10 * 2 * 10, 1);
    expect(long.parts[0].volume! - plain).toBeCloseTo(Math.PI * 10 * 2 * 10 + 2 * 25 * 2 * 10, 1);
    // drafted, arc and legs together
    const drafted = await model([...base, { op: 'rib', sketch: 'Rib', thickness: 2, normal: true, draft: 2 }]);
    expect(drafted.parts).toHaveLength(1);
    expect(drafted.parts[0].volume!).toBeGreaterThan(long.parts[0].volume! + 20);
  }, 60000);
});

describe('Wrap', () => {
  /** A shaft r = 20, 40 tall on Top; a plane touching it at y = −20 (Front moved 20 out); a sketch there. */
  const shaft = (shapes: unknown[]) => [
    { op: 'sketch', shapes: [{ type: 'circle', c: [0, 0], d: 40 }] },
    { op: 'extrude', depth: 40 },
    { op: 'plane', name: 'Touching', from: 'front', offset: 20 },
    { op: 'sketch', name: 'Label', plane: { plane: 'Touching' }, shapes },
  ];
  const SHAFT = Math.PI * 400 * 40;
  // a region of area A rolled onto r = 20 and raised by t: A t (1 + t / 2r); sunk: A t (1 − t / 2r)
  const shell = (area: number, t: number) => area * t * (1 + t / 40);

  it('raises a rectangle out of a cylinder, or sinks it in, keeping its size on the surface', async () => {
    const up = await model([...shaft([{ type: 'rect', x: -5, y: 10, w: 10, h: 20 }]), { op: 'wrap', sketch: 'Label', onto: { type: 'cylinder' }, depth: 2 }]);
    expect(up.parts[0].volume! - SHAFT).toBeCloseTo(shell(200, 2), 1);
    // the band stands 2 mm proud, 10 mm round the surface (half a radian) and 20 tall
    expect(up.parts[0].size[1]).toBeCloseTo(42, 3);
    const down = await model([...shaft([{ type: 'rect', x: -5, y: 10, w: 10, h: 20 }]), { op: 'wrap', sketch: 'Label', onto: { type: 'cylinder' }, depth: 2, boolean: 'remove' }]);
    expect(SHAFT - down.parts[0].volume!).toBeCloseTo(200 * 2 * (1 - 2 / 40), 1);
  }, 60000);

  it('keeps the holes of a region (a ring round a circle)', async () => {
    const m = await model([
      ...shaft([
        { type: 'rect', x: -5, y: 10, w: 10, h: 20 },
        { type: 'circle', c: [0, 20], r: 3 },
      ]),
      { op: 'wrap', sketch: 'Label', onto: { type: 'cylinder' }, depth: 2, regions: [[4, 12]] },
    ]);
    expect(m.parts[0].volume! - SHAFT).toBeCloseTo(shell(200 - Math.PI * 9, 2), 1);
  }, 60000);

  it('wraps across the seam of the cylinder: the same band on every side', async () => {
    for (const [from, offset] of [
      ['right', 20],
      ['right', -20],
      ['front', 20],
      ['front', -20],
    ] as const) {
      const m = await model([
        { op: 'sketch', shapes: [{ type: 'circle', c: [0, 0], d: 40 }] },
        { op: 'extrude', depth: 40 },
        { op: 'plane', name: 'Touching', from, offset },
        { op: 'sketch', name: 'Label', plane: { plane: 'Touching' }, shapes: [{ type: 'rect', center: true, x: 0, y: 20, w: 10, h: 20 }] },
        { op: 'wrap', sketch: 'Label', onto: { type: 'cylinder' }, depth: 2 },
      ]);
      expect(m.parts, `${from} ${offset}`).toHaveLength(1);
      expect(m.parts[0].volume! - SHAFT, `${from} ${offset}`).toBeCloseTo(shell(200, 2), 1);
    }
  }, 60000);
});
