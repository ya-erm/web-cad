// Sketch text (Onshape Text): glyph outlines of the bundled fonts as regions, extruded — with the real OpenCascade
// kernel and the font files read from disk.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, openHeadless } from './headless';
import type { DocumentOp } from './document';
import type { SketchData } from '../core/types';
import { addRectangle, addText } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';
import { expandTexts, isTextCounter, textAspect } from '../sketch/text';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function build(ops: unknown[]) {
  const s = await openHeadless(emptyDocument('Text'), wasm);
  const r = await s.run(ops as DocumentOp[]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return r.model!;
}

describe('Sketch text', () => {
  it('preserves the triangular counter of A in every font', async () => {
    await initOpenCascade(wasm);
    for (const font of ['sans', 'sansBold', 'mono'] as const) {
      const d: SketchData = { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] };
      addText(d, [0, 0], [0, 10], 'A', font);
      const regions = computeRegions(expandTexts(d.entities));
      expect(regions, font).toHaveLength(2);
      expect(regions.filter((r) => isTextCounter(r, regions)), font).toHaveLength(1);
      expect(regions.filter((r) => !isTextCounter(r, regions))[0].holes, font).toHaveLength(1);
    }
  }, 60000);

  it('keeps Latin and Cyrillic counters after font contour preparation', async () => {
    await initOpenCascade(wasm);
    for (const font of ['sans', 'sansBold', 'mono'] as const) {
      const d: SketchData = { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] };
      addText(d, [0, 0], [0, 10], 'ABDOАВОР', font);
      const regions = computeRegions(expandTexts(d.entities));
      const letters = regions.filter((r) => !isTextCounter(r, regions));
      expect(letters, font).toHaveLength(8);
      expect(letters.reduce((n, r) => n + r.holes.length, 0), font).toBe(10);
      expect(regions.filter((r) => isTextCounter(r, regions)), font).toHaveLength(10);
    }
  }, 60000);

  it('extrudes A as one solid with an open counter, including when added to the help plate', async () => {
    const letter = await build([
      { op: 'sketch', name: 'A', shapes: [{ type: 'text', text: 'A', height: 10, font: 'sansBold' }] },
      { op: 'extrude', depth: 1.5 },
    ]);
    const filled = await build([
      { op: 'sketch', name: 'A', shapes: [{ type: 'text', text: 'A', height: 10, font: 'sansBold' }] },
      { op: 'extrude', regions: 'all', depth: 1.5, boolean: 'add' },
    ]);
    expect(letter.parts).toHaveLength(1);
    expect(filled.parts).toHaveLength(1);
    const counterVolume = filled.parts[0].volume! - letter.parts[0].volume!;
    expect(counterVolume).toBeGreaterThan(5);
    const plate = await build([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 70, h: 22 }] },
      { op: 'extrude', depth: 3 },
      { op: 'sketch', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'text', text: 'A', height: 10, font: 'sansBold' }] },
      { op: 'extrude', depth: 1.5, boolean: 'add' },
    ]);
    expect(plate.parts).toHaveLength(1);
    expect(plate.parts[0].volume!).toBeCloseTo(70 * 22 * 3 + letter.parts[0].volume!, 4);
  }, 60000);

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

  it('sizes the text by the width of its box, centred on `at`', async () => {
    const model = await build([
      { op: 'sketch', name: 'W', shapes: [{ type: 'text', text: 'HI', at: [0, 0], width: '40 mm', align: 'center' }] },
      { op: 'extrude', sketch: 'W', depth: 1 },
    ]);
    // capitals as tall as the width gives them, the letters inside the box from −20 to 20
    const top = Math.max(...model.parts.map((p) => p.bboxMin[1] + p.size[1]));
    expect(top).toBeCloseTo(40 / textAspect('HI', 'sans'), 3);
    const lo = Math.min(...model.parts.map((p) => p.bboxMin[0]));
    const hi = Math.max(...model.parts.map((p) => p.bboxMin[0] + p.size[0]));
    expect(lo).toBeGreaterThan(-20);
    expect(hi).toBeLessThan(20);
    expect(Math.abs(lo + hi)).toBeLessThan(2);
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
