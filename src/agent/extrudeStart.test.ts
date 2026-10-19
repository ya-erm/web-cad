// Extrude's starting offset (Onshape Starting offset) with the real OpenCascade kernel: by a distance (either way),
// from a plane, with an up-to-face end and a symmetric one.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';
import type { PartSummary } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function parts(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Extrude start'), wasm);
  const r = await s.run(ops as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return r.model!.parts;
}

const z = (p: PartSummary) => [+p.bboxMin[2].toFixed(6), +(p.bboxMin[2] + p.size[2]).toFixed(6)];
const rect = { op: 'sketch', name: 'R', shapes: [{ type: 'rect', center: true, w: 20, h: 10 }] };

describe('Extrude start', () => {
  it('starts a distance away from the sketch plane, either way', async () => {
    expect(z((await parts([rect, { op: 'extrude', sketch: 'R', depth: 5, start: 3 }]))[0])).toEqual([3, 8]);
    expect(z((await parts([rect, { op: 'extrude', sketch: 'R', depth: 5, start: -2 }]))[0])).toEqual([-2, 3]);
    // symmetric about the moved start
    expect(z((await parts([rect, { op: 'extrude', sketch: 'R', depth: 4, end: 'symmetric', start: 10 }]))[0])).toEqual([8, 12]);
  }, 60000);

  it('starts at a plane, and still ends at the face it goes up to', async () => {
    expect(z((await parts([rect, { op: 'plane', name: 'Above', from: 'top', offset: 10 }, { op: 'extrude', sketch: 'R', depth: 5, start: { from: { plane: 'Above' } } }]))[0])).toEqual([10, 15]);
    const ps = await parts([
      { op: 'plane', name: 'High', from: 'top', offset: 25 },
      { op: 'sketch', name: 'Roof', plane: { plane: 'High' }, shapes: [{ type: 'rect', center: true, w: 40, h: 40 }] },
      { op: 'extrude', sketch: 'Roof', depth: 5 },
      rect,
      { op: 'extrude', sketch: 'R', end: { upToFace: { normal: '-z', pick: '-z' } }, start: 5, boolean: 'new' },
    ]);
    // the post: from 5 (its start) up to the roof's underside at 25
    const post = ps.find((p) => p.size[0] < 30)!;
    expect(z(post)).toEqual([5, 25]);
  }, 60000);
});
