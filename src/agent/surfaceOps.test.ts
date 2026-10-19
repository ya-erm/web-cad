// Surfaces made by revolving and sweeping curves, split by planes and surfaces, trimmed against each other and sewn
// (Onshape Revolve / Sweep → Surface, Split, Boolean of surfaces) — with the real OpenCascade kernel.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function build(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Surface ops'), wasm);
  const r = await s.run(ops as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return r.model!;
}

const named = (model: Awaited<ReturnType<typeof build>>) => model.parts.map((p) => [p.name, p.surface ?? false]);

/** A flat surface at height z over x, y ∈ [-30, 30]: a line of the Front plane extruded both ways. */
const sheetAt = (name: string, z: number) => [
  { op: 'sketch', name: `${name} line`, plane: 'front', shapes: [{ type: 'line', from: [-30, z], to: [30, z] }] },
  { op: 'extrude', name, sketch: `${name} line`, surface: true, depth: 60, end: 'symmetric' },
];

describe('Surface operations', () => {
  it('revolves open curves into a surface, skipping the curves on the axis', async () => {
    const model = await build([
      // a side and a top over the axis line (Z): a cup turned upside down
      {
        op: 'sketch',
        name: 'Cup',
        plane: 'front',
        shapes: [
          { type: 'line', from: [0, 0], to: [0, 20] },
          { type: 'line', from: [0, 20], to: [10, 20] },
          { type: 'line', from: [10, 20], to: [10, 0] },
        ],
      },
      { op: 'revolve', sketch: 'Cup', surface: true, axis: 'z' },
    ]);
    expect(named(model)).toEqual([['Surface 1', true]]);
    const s = model.parts[0];
    expect(s.faces).toBe(2);
    expect(s.area).toBeCloseTo(2 * Math.PI * 10 * 20 + Math.PI * 10 * 10, 2);
    expect(s.volume).toBeUndefined();
  }, 60000);

  it('revolves a curve part way round', async () => {
    const model = await build([
      { op: 'sketch', name: 'Side', plane: 'front', shapes: [{ type: 'line', from: [10, 0], to: [10, 20] }] },
      { op: 'revolve', sketch: 'Side', surface: true, axis: 'z', angle: 90 },
    ]);
    expect(model.parts[0].area).toBeCloseTo((2 * Math.PI * 10 * 20) / 4, 2);
  }, 60000);

  it('sweeps a closed curve into a tube surface, not a solid', async () => {
    const model = await build([
      { op: 'sketch', name: 'Ring', shapes: [{ type: 'circle', c: [0, 0], r: 5 }] },
      { op: 'sketch', name: 'Path', plane: 'front', shapes: [{ type: 'line', from: [0, 0], to: [0, 15] }] },
      { op: 'sweep', sketch: 'Ring', surface: true, path: { sketch: 'Path' } },
    ]);
    expect(named(model)).toEqual([['Surface 1', true]]);
    expect(model.parts[0].area).toBeCloseTo(2 * Math.PI * 5 * 15, 2);
    expect(model.parts[0].size[2]).toBeCloseTo(15, 4);
  }, 60000);

  it('still sweeps regions into a solid', async () => {
    const model = await build([
      { op: 'sketch', name: 'Ring', shapes: [{ type: 'circle', c: [0, 0], r: 5 }] },
      { op: 'sketch', name: 'Path', plane: 'front', shapes: [{ type: 'line', from: [0, 0], to: [0, 15] }] },
      { op: 'sweep', sketch: 'Ring', path: { sketch: 'Path' } },
    ]);
    expect(named(model)).toEqual([['Part 1', false]]);
    expect(model.parts[0].volume).toBeCloseTo(Math.PI * 25 * 15, 2);
  }, 60000);

  it('splits a surface with a plane: the side the normal points to keeps the name', async () => {
    const model = await build([...sheetAt('Sheet', 5), { op: 'split', parts: 'Surface 1', tool: 'right' }]);
    expect(named(model)).toEqual([
      ['Surface 1', true],
      ['Surface 2', true],
    ]);
    const [a, b] = model.parts;
    expect(a.area).toBeCloseTo(30 * 60, 3);
    expect(b.area).toBeCloseTo(30 * 60, 3);
    expect(a.bboxMin[0]).toBeCloseTo(0, 5);
    expect(b.bboxMin[0]).toBeCloseTo(-30, 5);
  }, 60000);

  it('splits a part with a surface, which is used up unless kept', async () => {
    const block = [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 10 },
      ...sheetAt('Sheet', 4),
    ];
    const used = await build([...block, { op: 'split', parts: 'Part 1', tool: { surface: 'Surface 1' } }]);
    expect(named(used)).toEqual([
      ['Part 1', false],
      ['Part 2', false],
    ]);
    expect(used.parts.map((p) => p.volume).sort()).toEqual([40 * 30 * 4, 40 * 30 * 6].map((v) => expect.closeTo(v, 2)));
    const kept = await build([...block, { op: 'split', parts: 'Part 1', tool: { surface: 'Surface 1' }, keepTools: true }]);
    expect(named(kept)).toEqual([
      ['Part 1', false],
      ['Surface 1', true],
      ['Part 2', false],
    ]);
  }, 60000);

  it('trims two crossing surfaces against each other and sews what is left', async () => {
    const model = await build([
      ...sheetAt('Floor', 0),
      // a wall: x = 0, z from -10 to 20
      { op: 'sketch', name: 'Wall line', plane: 'front', shapes: [{ type: 'line', from: [0, -10], to: [0, 20] }] },
      { op: 'extrude', name: 'Wall', sketch: 'Wall line', surface: true, depth: 60, end: 'symmetric' },
      { op: 'split', parts: 'Surface 1', tool: { surface: 'Surface 2' }, keepTools: true },
      { op: 'split', parts: 'Surface 2', tool: { surface: 'Surface 1' }, keepTools: true },
    ]);
    // the floor: x > 0 (Surface 1) and x < 0 (Surface 3); the wall: below and above the floor
    expect(model.parts).toHaveLength(4);
    const area = (n: string) => model.parts.find((p) => p.name === n)!.area!;
    expect(area('Surface 1') + area('Surface 3')).toBeCloseTo(60 * 60, 3);
    expect(area('Surface 2') + area('Surface 4')).toBeCloseTo(30 * 60, 3);
    const wallUp = model.parts.find((p) => p.surface && p.size[2] > 1 && p.bboxMin[2] > -1)!;
    const wallDown = model.parts.find((p) => p.surface && p.size[2] > 1 && p.bboxMin[2] < -1)!;
    const floorRight = model.parts.find((p) => p.size[2] < 1 && p.bboxMin[0] > -1)!;
    expect(wallUp.area).toBeCloseTo(20 * 60, 3);
    // an L of the right half of the floor and the upper wall, sewn along the line where they meet
    const s = await openHeadless(emptyDocument('Trim'), wasm);
    const r = await s.run([
      ...sheetAt('Floor', 0),
      { op: 'sketch', name: 'Wall line', plane: 'front', shapes: [{ type: 'line', from: [0, -10], to: [0, 20] }] },
      { op: 'extrude', name: 'Wall', sketch: 'Wall line', surface: true, depth: 60, end: 'symmetric' },
      { op: 'split', parts: 'Surface 1', tool: { surface: 'Surface 2' }, keepTools: true },
      { op: 'split', parts: 'Surface 2', tool: { surface: 'Surface 1' }, keepTools: true },
      { op: 'deletePart', parts: [model.parts.indexOf(wallDown), model.parts.indexOf(model.parts.find((p) => p.size[2] < 1 && p !== floorRight)!)] },
    ] as DocumentOp[]);
    expect(r.failed).toEqual([]);
    const left = r.model!.parts;
    expect(left).toHaveLength(2);
    const sewn = await s.run([{ op: 'boolean', type: 'union', tools: left.map((p) => p.name), targets: [] }] as DocumentOp[]);
    expect(sewn.failed).toEqual([]);
    expect(sewn.model!.parts).toHaveLength(1);
    expect(sewn.model!.parts[0].surface).toBe(true);
    expect(sewn.model!.parts[0].faces).toBe(2);
    expect(sewn.model!.parts[0].area).toBeCloseTo(30 * 60 + 20 * 60, 3);
  }, 60000);

  it('subtracts a part from a surface: the surface keeps what lies outside it', async () => {
    const model = await build([
      ...sheetAt('Sheet', 5),
      { op: 'sketch', name: 'Post', shapes: [{ type: 'circle', c: [0, 0], r: 10 }] },
      { op: 'extrude', sketch: 'Post', depth: 10 },
      { op: 'boolean', type: 'subtract', targets: 'Surface 1', tools: 'Part 1' },
    ]);
    expect(named(model)).toEqual([['Surface 1', true]]);
    expect(model.parts[0].area).toBeCloseTo(60 * 60 - Math.PI * 100, 2);
  }, 60000);
});
