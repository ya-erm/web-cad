// Surface bodies (Onshape surfaces): Offset surface, Delete face without Heal, Thicken of a surface — with the real
// OpenCascade kernel.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function block(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Surfaces'), wasm);
  const r = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
    { op: 'extrude', depth: 10 },
    ...(ops as DocumentOp[]),
  ] as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return { s, model: r.model! };
}

describe('Surfaces', () => {
  it('offsets faces into a surface body of its own, counted apart from the parts', async () => {
    const { model } = await block([
      { op: 'offsetSurface', faces: { normal: 'z', pick: '+z' }, distance: 5 },
      // a solid after it: "Part 2", merging with the block only
      { op: 'sketch', name: 'S', shapes: [{ type: 'rect', center: true, x: 60, w: 10, h: 10 }] },
      { op: 'extrude', sketch: 'S', depth: 4 },
    ]);
    expect(model.parts.map((p) => [p.name, p.surface ?? false])).toEqual([
      ['Part 1', false],
      ['Surface 1', true],
      ['Part 2', false],
    ]);
    const surface = model.parts[1];
    expect(surface.bboxMin).toEqual([-20, -15, 15]);
    expect(surface.size).toEqual([40, 30, 0]);
    expect(surface.volume).toBeUndefined();
    expect(surface.area).toBeCloseTo(1200, 3);
  }, 60000);

  it('copies faces (distance 0) and thickens a surface into a solid', async () => {
    const { model } = await block([
      { op: 'offsetSurface', faces: [{ normal: 'z', pick: '+z' }, { normal: 'x', pick: '+x' }], distance: 0 },
      { op: 'thicken', surfaces: 'Surface 1', thickness: 2 },
    ]);
    const copy = model.parts.find((p) => p.name === 'Surface 1')!;
    expect(copy.faces).toBe(2);
    expect(copy.area).toBeCloseTo(1200 + 300, 3);
    // the two faces thickened together: a 2 mm L round the block's top and side, its outer corner sharp
    const shell = model.parts.find((p) => p.name === 'Part 2')!;
    expect(shell.volume).toBeCloseTo(1200 * 2 + 300 * 2 + 2 * 2 * 30, 2);
    expect(model.parts).toHaveLength(3);
  }, 60000);

  it('deletes faces without healing: the part becomes a surface', async () => {
    const { model } = await block([{ op: 'deleteFace', faces: { normal: 'z', pick: '+z' }, heal: false }]);
    expect(model.parts[0].surface).toBe(true);
    expect(model.parts[0].faces).toBe(5);
    expect(model.parts[0].volume).toBeUndefined();
  }, 60000);
});
