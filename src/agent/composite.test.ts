// Composite part (Onshape) with the real OpenCascade kernel: parts acting as one — open (they stay parts of their own)
// or closed (consumed); a feature adding to a closed one leaves it one part; dissolved, its bodies come back; exported,
// it is its bodies.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless, type HeadlessSession } from './headless';
import type { ModelSummary } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** Two blocks apart: Part 1 (10 × 10 × 10 at the origin), Part 2 (20 × 10 × 10 at x 30). */
async function twoBlocks(): Promise<HeadlessSession> {
  const s = await openHeadless(emptyDocument('Composite test'), wasm);
  const r = await s.run([
    { op: 'sketch', name: 'Blocks', shapes: [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }, { type: 'rect', x: 30, y: 0, w: 20, h: 10 }] },
    { op: 'extrude', sketch: 'Blocks', depth: 10 },
  ]);
  expect(r.error).toBeUndefined();
  return s;
}

const byName = (m: ModelSummary | undefined) => Object.fromEntries((m?.parts ?? []).map((p) => [p.name, p]));

describe('composite part', () => {
  it('open: the parts stay, and the composite is them as one — following them', async () => {
    const s = await twoBlocks();
    const r = await s.run([{ op: 'composite', parts: ['Part 1', 'Part 2'] }]);
    expect(r.error).toBeUndefined();
    const parts = byName(r.model);
    expect(Object.keys(parts)).toEqual(['Part 1', 'Part 2', 'Composite part 1']);
    const c = parts['Composite part 1'];
    expect(c.composite).toEqual({ closed: false, members: ['Part 1', 'Part 2'] });
    expect(c.volume).toBeCloseTo(1000 + 2000, 3);
    expect(c.faces).toBe(12);
    // Part 1 moved up later: the composite goes with it
    const moved = await s.run([{ op: 'feature', type: 'transform', params: { mode: 'translateXYZ', parts: { $parts: 'Part 1' }, dz: '50' } }]);
    expect(moved.error).toBeUndefined();
    expect(byName(moved.model)['Composite part 1'].bboxMax[2]).toBeCloseTo(60, 6);
    // deleted: the composite goes, its parts stay
    const gone = await s.run([{ op: 'deletePart', parts: 'Composite part 1' }]);
    expect(gone.error).toBeUndefined();
    expect(Object.keys(byName(gone.model))).toEqual(['Part 1', 'Part 2']);
  }, 120000);

  it('closed: the parts are consumed; it stays one part when added to; dissolved, they come back', async () => {
    const s = await twoBlocks();
    const r = await s.run([{ op: 'composite', parts: ['Part 1', 'Part 2'], closed: true }]);
    expect(r.error).toBeUndefined();
    expect(Object.keys(byName(r.model))).toEqual(['Composite part 1']);
    const c = byName(r.model)['Composite part 1'];
    expect(c.composite).toEqual({ closed: true, members: ['Part 1', 'Part 2'] });
    expect(c.volume).toBeCloseTo(3000, 3);
    // a block added on top of the first body (Add to all parts): still one part, the composite
    const added = await s.run([
      { op: 'sketch', name: 'Top', plane: { face: { normal: 'z', x: [0, 10] } }, shapes: [{ type: 'rect', center: true, w: 4, h: 4 }] },
      { op: 'extrude', sketch: 'Top', depth: 5, boolean: 'add' },
    ]);
    expect(added.error).toBeUndefined();
    expect(Object.keys(byName(added.model))).toEqual(['Composite part 1']);
    expect(byName(added.model)['Composite part 1'].volume).toBeCloseTo(3000 + 80, 3);
    // exported: its bodies, under the names they had
    const step = new TextDecoder().decode(await s.exportStep());
    expect(step).toContain("'Part 1'");
    expect(step).toContain("'Part 2'");
    expect(step.match(/MANIFOLD_SOLID_BREP/g)?.length).toBe(2);
    // dissolved: the parts again
    const back = await s.run([{ op: 'deletePart', parts: 'Composite part 1', dissolve: true }]);
    expect(back.error).toBeUndefined();
    const parts = byName(back.model);
    expect(Object.keys(parts)).toEqual(['Part 1', 'Part 2']);
    expect(parts['Part 1'].volume).toBeCloseTo(1080, 3);
    expect(parts['Part 2'].volume).toBeCloseTo(2000, 3);
  }, 120000);

  it('goes into an assembly as one instance, open or closed', async () => {
    const s = await twoBlocks();
    // both blocks, open: one instance of the two
    const both = await s.run([
      { op: 'composite', parts: ['Part 1', 'Part 2'] },
      { op: 'assembly', name: 'Both' },
      { op: 'insert', part: 'Composite part 1', fixed: true },
    ]);
    expect(both.error).toBeUndefined();
    expect([both.assembly!.instances[0].bboxMin, both.assembly!.instances[0].bboxMax]).toEqual([
      [0, 0, 0],
      [50, 10, 10],
    ]);
  }, 120000);

  it('an open composite loses a part a closed one consumes; each goes into an assembly as one instance', async () => {
    const s = await twoBlocks();
    const r = await s.run([
      { op: 'composite', parts: ['Part 1', 'Part 2'] },
      { op: 'composite', parts: 'Part 2', closed: true },
      { op: 'assembly', name: 'Rig' },
      { op: 'insert', part: 'Composite part 1', name: 'Open', fixed: true },
      { op: 'insert', part: 'Composite part 2', name: 'Closed', position: [0, 100, 0] },
    ]);
    expect(r.error).toBeUndefined();
    const [open, closed] = r.assembly!.instances;
    // the open one: Part 1 only now (Part 2 is consumed by the closed one)
    expect([open.bboxMin, open.bboxMax]).toEqual([
      [0, 0, 0],
      [10, 10, 10],
    ]);
    expect([closed.bboxMin, closed.bboxMax]).toEqual([
      [30, 100, 0],
      [50, 110, 10],
    ]);
  }, 120000);

  it('says what is wrong', async () => {
    const s = await twoBlocks();
    const none = await s.run([{ op: 'feature', type: 'compositePart', params: { parts: [], closed: false } }]);
    expect(none.failed[0]?.error).toMatch(/Select parts for the composite part/);
    const plain = await s.run([{ op: 'deletePart', parts: 'Part 1', dissolve: true }]);
    expect(plain.failed[0]?.error).toMatch(/Select composite parts to dissolve/);
  }, 120000);
});
