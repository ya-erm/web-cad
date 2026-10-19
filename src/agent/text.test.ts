// Sketch text (Onshape Text): glyph outlines of the bundled fonts as regions, extruded — with the real OpenCascade
// kernel and the font files read from disk.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, openHeadless } from './headless';
import type { DocumentOp } from './document';
import type { SketchData } from '../core/types';
import { addRectangle, addText } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';
import { expandTexts, isTextCounter } from '../sketch/text';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function build(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Text'), wasm);
  const r = await s.run(ops as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return r.model!;
}

describe('Sketch text', () => {
  it('extrudes the letters: capitals as tall as the height, each letter a part', async () => {
    const model = await build([
      { op: 'sketch', name: 'Label', shapes: [{ type: 'text', text: 'HI', at: [5, 2], height: 10 }] },
      { op: 'extrude', sketch: 'Label', depth: 2 },
    ]);
    expect(model.parts).toHaveLength(2);
    const lo = Math.min(...model.parts.map((p) => p.bboxMin[1]));
    const hi = Math.max(...model.parts.map((p) => p.bboxMin[1] + p.size[1]));
    expect(lo).toBeCloseTo(2, 3);
    expect(hi).toBeCloseTo(12, 3);
    expect(Math.min(...model.parts.map((p) => p.bboxMin[0]))).toBeGreaterThan(5);
    for (const p of model.parts) expect(p.size[2]).toBeCloseTo(2, 6);
  }, 60000);

  it('keeps the counter of "O" open with automatic regions, fills it with all of them', async () => {
    const ring = await build([
      { op: 'sketch', name: 'O', shapes: [{ type: 'text', text: 'O', height: 20 }] },
      { op: 'extrude', sketch: 'O', depth: 1 },
    ]);
    const all = await build([
      { op: 'sketch', name: 'O', shapes: [{ type: 'text', text: 'O', height: 20 }] },
      { op: 'extrude', sketch: 'O', regions: 'all', depth: 1, boolean: 'new' },
    ]);
    expect(ring.parts).toHaveLength(1);
    const v = ring.parts[0].volume!;
    const filled = all.parts.reduce((s, p) => s + p.volume!, 0);
    // the counter is a region of its own: with it the letter is a solid disc-like shape
    expect(filled).toBeGreaterThan(v * 1.5);
    expect(ring.parts[0].faces).toBeGreaterThan(4);
  }, 60000);

  it('sets Cyrillic in every font', async () => {
    for (const font of ['sans', 'sansBold', 'mono']) {
      const model = await build([
        { op: 'sketch', name: 'Ж', shapes: [{ type: 'text', text: 'Ж', height: 10, font }] },
        { op: 'extrude', sketch: 'Ж', depth: 1 },
      ]);
      expect(model.parts.length).toBeGreaterThanOrEqual(1);
      expect(Math.max(...model.parts.map((p) => p.size[1]))).toBeCloseTo(10, 2);
    }
  }, 60000);

  it('cuts letters through a plate around them (automatic regions)', async () => {
    const model = await build([
      {
        op: 'sketch',
        name: 'Plate',
        shapes: [
          { type: 'rect', x: 0, y: 0, w: 60, h: 20 },
          { type: 'text', text: 'CAD', at: [5, 5], height: 10 },
        ],
      },
      { op: 'extrude', sketch: 'Plate', depth: 3 },
    ]);
    expect(model.parts).toHaveLength(1);
    const plate = model.parts[0];
    expect(plate.size[0]).toBeCloseTo(60, 6);
    expect(plate.volume!).toBeLessThan(60 * 20 * 3 - 30);
    expect(plate.volume!).toBeGreaterThan(60 * 20 * 3 * 0.7);
  }, 60000);

  it('tells the counters of letters from the letters (picking a whole sketch leaves them out)', async () => {
    await initOpenCascade(wasm);
    const d: SketchData = { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] };
    addRectangle(d, [-5, -5], [40, 20]);
    addText(d, [0, 0], [0, 10], 'OI');
    const regions = computeRegions(expandTexts(d.entities));
    const counters = regions.filter((r) => isTextCounter(r, regions));
    // the plate with letter-shaped holes, the ring of "O", its counter, the "I"
    expect(regions).toHaveLength(4);
    expect(counters).toHaveLength(1);
    expect(counters[0].holes).toHaveLength(0);
  }, 60000);

  it('turns the text with its rotation', async () => {
    const model = await build([
      { op: 'sketch', name: 'Up', shapes: [{ type: 'text', text: 'I', height: 10, rotation: 90 }] },
      { op: 'extrude', sketch: 'Up', depth: 1 },
    ]);
    // the "I" lies along X, to the left of the origin (its baseline goes up the Y axis)
    expect(model.parts[0].size[0]).toBeCloseTo(10, 3);
    expect(model.parts[0].bboxMin[0]).toBeCloseTo(-10, 3);
  }, 60000);
});
