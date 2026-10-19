// Direct edits of faces (Onshape Delete face / Move face / Replace face) with the real OpenCascade kernel.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** A 40×30×10 block (centred, on Top) and the ops after it; the model after all of them. */
async function block(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Faces'), wasm);
  const r = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
    { op: 'extrude', depth: 10 },
    ...(ops as DocumentOp[]),
  ] as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return { s, model: r.model! };
}

const BLOCK = 40 * 30 * 10;
const topSketch = (shapes: unknown[], name = 'S') => ({ op: 'sketch', name, plane: { face: { normal: 'z', pick: '+z' } }, shapes });

describe('Delete face', () => {
  it('fills a hole and a pocket, cuts off a boss, takes back a fillet', async () => {
    const hole = await block([
      topSketch([{ type: 'point', at: [8, 0] }]),
      { op: 'hole', sketch: 'S', diameter: 6, through: true },
      { op: 'deleteFace', faces: { type: 'cylinder' } },
    ]);
    expect(hole.model.parts[0].volume).toBeCloseTo(BLOCK, 3);
    expect(hole.model.parts[0].faces).toBe(6);

    const pocket = await block([
      topSketch([{ type: 'rect', center: true, w: 10, h: 8 }]),
      { op: 'extrude', sketch: 'S', depth: 4, flip: true, boolean: 'remove' },
      { op: 'deleteFace', faces: [{ normal: 'z', z: [5, 7] }, { normal: 'x', z: [5, 9.9] }, { normal: '-x', z: [5, 9.9] }, { normal: 'y', z: [5, 9.9] }, { normal: '-y', z: [5, 9.9] }] },
    ]);
    expect(pocket.model.parts[0].volume).toBeCloseTo(BLOCK, 3);

    const boss = await block([
      topSketch([{ type: 'circle', c: [0, 0], d: 8 }]),
      { op: 'extrude', sketch: 'S', depth: 5, boolean: 'add' },
      { op: 'deleteFace', faces: [{ type: 'cylinder' }, { normal: 'z', pick: '+z' }] },
    ]);
    expect(boss.model.parts[0].volume).toBeCloseTo(BLOCK, 3);

    const fillet = await block([
      { op: 'fillet', edges: { type: 'line', dir: 'z', near: [20, 15, 5] }, radius: 3 },
      { op: 'deleteFace', faces: { type: 'cylinder' } },
    ]);
    expect(fillet.model.parts[0].volume).toBeCloseTo(BLOCK, 3);
    expect(fillet.model.parts[0].faces).toBe(6);

    // a fillet in an inner corner (it added material): deleting it takes that away
    const step = [topSketch([{ type: 'rect', x: 0, y: -15, w: 20, h: 30 }]), { op: 'extrude', sketch: 'S', depth: 6, boolean: 'add' }];
    const plain = await block(step);
    const inner = await block([...step, { op: 'fillet', edges: { type: 'line', dir: 'y', near: [0, 0, 10] }, radius: 2 }, { op: 'deleteFace', faces: { type: 'cylinder' } }]);
    expect(inner.model.parts[0].volume).toBeCloseTo(plain.model.parts[0].volume!, 3);
  }, 120000);

  it('refuses faces nothing around can close', async () => {
    const s = await openHeadless(emptyDocument('Faces'), wasm);
    await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 10 },
    ]);
    const r = await s.run([{ op: 'deleteFace', faces: { normal: 'z', pick: '+z' } }]);
    expect(r.failed[0]?.error).toMatch(/cannot be healed|cannot close/);
  }, 60000);
});

describe('Move face', () => {
  it('offsets planar faces: the faces around follow', async () => {
    const up = await block([{ op: 'moveFace', faces: { normal: 'z', pick: '+z' }, offset: 5 }]);
    expect(up.model.parts[0].size).toEqual([40, 30, 15]);
    const down = await block([{ op: 'moveFace', faces: [{ normal: 'z', pick: '+z' }, { normal: 'x', pick: '+x' }], offset: -3 }]);
    expect(down.model.parts[0].size).toEqual([37, 30, 7]);
    expect(down.model.parts[0].volume).toBeCloseTo(37 * 30 * 7, 3);
    // a top face with a rounded corner next to it (a vertical cylinder): the rounded wall grows with it
    const rounded = await block([
      { op: 'fillet', edges: { type: 'line', dir: 'z', near: [20, 15, 5] }, radius: 4 },
      { op: 'moveFace', faces: { normal: 'z', pick: '+z' }, offset: 6 },
    ]);
    expect(rounded.model.parts[0].size).toEqual([40, 30, 16]);
    expect(rounded.model.parts[0].volume).toBeCloseTo((BLOCK / 10 - 16 * (1 - Math.PI / 4)) * 16, 2);
    // the rounded wall is two faces now (one cylinder): deleting one piece takes the whole round off
    const sharp = await rounded.s.run([{ op: 'deleteFace', faces: { type: 'cylinder', pick: '+z' } }]);
    expect(sharp.failed).toEqual([]);
    expect(sharp.model!.parts[0].volume).toBeCloseTo(40 * 30 * 16, 2);
  }, 60000);

  it('moves a whole hole or boss; tilts a planar face', async () => {
    const hole = await block([
      topSketch([{ type: 'point', at: [8, 0] }]),
      { op: 'hole', sketch: 'S', diameter: 6, through: true },
      { op: 'moveFace', faces: { type: 'cylinder' }, translate: { direction: 'x', distance: -12 } },
    ]);
    expect(hole.model.parts[0].volume).toBeCloseTo(BLOCK - Math.PI * 9 * 10, 2);
    const q = (await hole.s.query({ faces: { type: 'cylinder' } })) as { faces: { center: number[] }[] };
    expect(q.faces[0].center[0]).toBeCloseTo(-4, 3);
    // the top face tilted 45° about the top edge at x = 20: the block becomes a wedge rising to the left
    const tilt = await block([{ op: 'moveFace', faces: { normal: 'z', pick: '+z' }, rotate: { axis: { edge: { type: 'line', dir: 'y', near: [20, 0, 10] } }, angle: 10 } }]);
    const h = 40 * Math.tan((10 * Math.PI) / 180);
    expect(Math.abs(tilt.model.parts[0].volume! - BLOCK) / 30).toBeCloseTo((40 * h) / 2, 1);
  }, 60000);
});

describe('Replace face', () => {
  it('puts planar faces on a plane, offset from it', async () => {
    const r = await block([{ op: 'replaceFace', faces: { normal: 'z', pick: '+z' }, with: 'top', offset: 12 }]);
    expect(r.model.parts[0].size).toEqual([40, 30, 12]);
    const r2 = await block([{ op: 'replaceFace', faces: { normal: 'x', pick: '+x' }, with: 'right', offset: 5 }]);
    expect(r2.model.parts[0].size).toEqual([25, 30, 10]);
  }, 60000);
});
