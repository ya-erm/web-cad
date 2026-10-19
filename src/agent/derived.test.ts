// Derived (Onshape) end to end with the real OpenCascade kernel: a mount designed in a second Part Studio on the
// geometry of a motor from the first one follows the motor's changes.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless, type HeadlessSession } from './headless';
import type { CadDocument, PartStudioTab } from '../core/types';
import type { ModelSummary } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** Part Studio 1: a 40×40×30 motor with four Ø4 holes; Part Studio "Mount": the motor derived, a plate on top of it. */
async function motorAndMount(): Promise<HeadlessSession> {
  const s = await openHeadless(emptyDocument('Derived test'), wasm);
  const r1 = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 40 }, ...[-15, 15].flatMap((x) => [-15, 15].map((y) => ({ type: 'circle' as const, c: [x, y] as [number, number], d: 4 })))] },
    { op: 'extrude', depth: 30 },
    { op: 'part', part: 'Part 1', name: 'Motor' },
  ]);
  expect(r1.ok).toBe(true);
  const r2 = await s.run([
    { op: 'studio', name: 'Mount' },
    { op: 'derived', studio: 'Part Studio 1', parts: ['Motor'] },
    // on the motor's top face: a 60×60 plate around the projected holes
    { op: 'sketch', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'rect', center: true, w: 60, h: 60 }], use: { type: 'circle', z: 30 } },
    { op: 'extrude', depth: 5 },
  ]);
  expect(r2.error).toBeUndefined();
  expect(r2.ok).toBe(true);
  return s;
}

const parts = async (s: HeadlessSession) => ((await s.state()) as ModelSummary).parts;
const studio = (doc: CadDocument, name: string) => doc.tabs.find((t) => t.name === name) as PartStudioTab;

describe('Derived', () => {
  it('brings a part of another Part Studio where it stands, to build a new part on its geometry', async () => {
    const s = await motorAndMount();
    const [motor, plate] = await parts(s);
    expect(motor.name).toBe('Motor');
    expect(motor.bboxMin).toEqual([-20, -20, 0]);
    expect(motor.size).toEqual([40, 40, 30]);
    // the plate lies on the motor with the motor's four holes, projected and linked
    expect(plate.bboxMin).toEqual([-30, -30, 30]);
    expect(plate.size).toEqual([60, 60, 5]);
    expect(plate.volume!).toBeCloseTo(60 * 60 * 5 - 4 * Math.PI * 4 * 5, 2);
    // the derived part is a link, not a copy: its feature stores the source and the part, nothing of the geometry
    const f = studio(s.doc, 'Mount').features[0];
    expect(f.type).toBe('derived');
    expect(f.params).toEqual({ studioId: studio(s.doc, 'Part Studio 1').id, parts: [expect.stringMatching(/\.0$/)], placeTo: [] });
  }, 90000);

  it('follows the source: a taller motor lifts the plate, its projected holes stay linked', async () => {
    const s = await motorAndMount();
    const source = studio(s.doc, 'Part Studio 1');
    // a change in the first Part Studio (through its own ops)
    const r = await s.run([
      { op: 'studio', name: 'Part Studio 1' },
      { op: 'set', feature: 'Extrude 1', params: { depth: '50 mm' } },
    ]);
    expect(r.ok).toBe(true);
    expect(studio(s.doc, 'Part Studio 1').id).toBe(source.id);
    await s.run([{ op: 'studio', name: 'Mount' }]);
    const [motor, plate] = await parts(s);
    expect(motor.size).toEqual([40, 40, 50]);
    expect(plate.bboxMin).toEqual([-30, -30, 50]);
    expect(plate.volume!).toBeCloseTo(60 * 60 * 5 - 4 * Math.PI * 4 * 5, 2);
    const model = (await s.state()) as ModelSummary;
    expect(model.features.every((x) => x.status === 'ok')).toBe(true);
  }, 90000);

  it('refuses cycles, reports a missing source and keeps the link through save and load', async () => {
    const s = await motorAndMount();
    // the first Part Studio cannot derive from the second one, which uses it
    const cycle = await s.run([{ op: 'studio', name: 'Part Studio 1' }, { op: 'derived', studio: 'Mount' }]);
    expect(cycle.ok).toBe(false);
    expect(cycle.error).toMatch(/circular reference/);
    // saved and opened again: the same model
    const saved = JSON.parse(JSON.stringify(s.doc)) as CadDocument;
    const again = await openHeadless({ ...saved, activeTab: studio(saved, 'Mount').id }, wasm);
    const [motor, plate] = await parts(again);
    expect(motor.size).toEqual([40, 40, 30]);
    expect(plate.size).toEqual([60, 60, 5]);
    // the source deleted: the Derived feature fails with a clear message, the rest of the document stays
    const gone = await openHeadless({ ...saved, tabs: saved.tabs.filter((t) => t.name !== 'Part Studio 1'), activeTab: studio(saved, 'Mount').id }, wasm);
    const model = (await gone.state()) as ModelSummary;
    expect(model.features[0]).toMatchObject({ type: 'derived', status: 'error', message: 'The source Part Studio no longer exists' });
    expect(model.parts).toEqual([]);
  }, 90000);

  it('takes a configuration of the source of its own; without one, follows the source', async () => {
    const s = await openHeadless(emptyDocument('Derived configuration'), wasm);
    const r1 = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 20, h: 20 }] },
      { op: 'extrude', depth: 10 },
      { op: 'part', part: 'Part 1', name: 'Block' },
      { op: 'configuration', name: 'Size', options: ['Small', 'Large'], params: [{ feature: 'Extrude 1', param: 'depth' }], values: { Large: [40] } },
    ]);
    expect(r1.error).toBeUndefined();
    const r2 = await s.run([
      { op: 'studio', name: 'Use' },
      { op: 'derived', studio: 'Part Studio 1', configuration: { Size: 'Large' } },
      { op: 'derived', studio: 'Part Studio 1' },
    ]);
    expect(r2.error).toBeUndefined();
    const [large, own] = await parts(s);
    expect(large.size).toEqual([20, 20, 40]);
    expect(own.size).toEqual([20, 20, 10]);
    const f = studio(s.doc, 'Use').features[0];
    expect(f.type === 'derived' && Object.keys(f.params.configuration ?? {}).length).toBe(1);
    // the source's own choice changes: only the feature without a configuration of its own follows it
    await s.run([{ op: 'studio', name: 'Part Studio 1' }, { op: 'configure', values: { Size: 'Large' } }]);
    await s.run([{ op: 'studio', name: 'Use' }]);
    expect((await parts(s)).map((p) => p.size)).toEqual([
      [20, 20, 40],
      [20, 20, 40],
    ]);
    const bad = await s.run([{ op: 'derived', studio: 'Part Studio 1', configuration: { Size: 'Huge' } }]);
    expect(bad.error).toMatch(/No option "Huge"/);
  }, 90000);

  it('puts the parts at a mate connector: the source origin there, or a mate connector of the source', async () => {
    const s = await openHeadless(emptyDocument('Derived location'), wasm);
    const r1 = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 20, h: 20 }] },
      { op: 'extrude', depth: 10 },
      // the centre of its top face
      { op: 'mateConnector', name: 'Top', at: { face: { normal: 'z', pick: '+z' } } },
    ]);
    expect(r1.error).toBeUndefined();
    const r2 = await s.run([
      { op: 'studio', name: 'Use' },
      { op: 'mateConnector', name: 'Here', at: 'origin', offset: [50, 0, 0] },
      { op: 'derived', studio: 'Part Studio 1', at: 'Here' },
      { op: 'derived', studio: 'Part Studio 1', at: 'Here', from: 'Top' },
    ]);
    expect(r2.error).toBeUndefined();
    const [origin, top] = await parts(s);
    expect([origin.bboxMin, origin.size]).toEqual([
      [40, -10, 0],
      [20, 20, 10],
    ]);
    // the block's top hangs from the connector
    expect([top.bboxMin, top.size]).toEqual([
      [40, -10, -10],
      [20, 20, 10],
    ]);
    const bad = await s.run([{ op: 'derived', studio: 'Part Studio 1', at: 'Here', from: 'Nowhere' }]);
    expect(bad.error).toMatch(/No mate connector "Nowhere"/);
  }, 90000);

  it('brings sketches of the source: placed with it, their regions extruded here', async () => {
    const s = await openHeadless(emptyDocument('Derived sketches'), wasm);
    // a layout: a Ø10 circle at x = 20, and a block (a part) on a second sketch
    const r1 = await s.run([
      { op: 'sketch', name: 'Layout', shapes: [{ type: 'circle', c: [20, 0], d: 10 }] },
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 8, h: 8 }] },
      { op: 'extrude', depth: 4 },
    ]);
    expect(r1.error).toBeUndefined();
    const r2 = await s.run([
      { op: 'studio', name: 'Use' },
      { op: 'mateConnector', name: 'Here', at: 'origin', offset: [0, 0, 5] },
      // only the sketch, no parts
      { op: 'derived', name: 'From layout', studio: 'Part Studio 1', parts: [], sketches: ['Layout'], at: 'Here' },
      { op: 'extrude', sketch: 'From layout / Layout', depth: 10 },
    ]);
    expect(r2.error).toBeUndefined();
    const summary = (await s.state()) as ModelSummary;
    // the circle's disc, raised with the sketch to the connector
    expect(summary.parts.map((p) => [p.bboxMin, p.size])).toEqual([
      [
        [15, -5, 5],
        [10, 10, 10],
      ],
    ]);
    expect(summary.sketches.find((x) => x.name === 'From layout / Layout')).toMatchObject({ origin: [0, 0, 5], regions: 1 });
    const f = studio(s.doc, 'Use').features.find((x) => x.type === 'derived')!;
    const layout = studio(s.doc, 'Part Studio 1').features[0];
    expect(f.params).toMatchObject({ parts: [], noParts: true, sketches: [layout.id] });
    // the sketch gone from the source: the feature fails
    const r3 = await s.run([
      { op: 'studio', name: 'Part Studio 1' },
      { op: 'suppress', feature: 'Layout' },
      { op: 'studio', name: 'Use' },
    ]);
    expect(r3.error).toBeUndefined();
    const after = (await s.state()) as ModelSummary;
    expect(after.features.find((x) => x.name === 'From layout')).toMatchObject({ status: 'error', message: 'The selected parts and sketches no longer exist in the source Part Studio' });
    const bad = await s.run([{ op: 'derived', studio: 'Part Studio 1', sketches: ['Nothing'] }]);
    expect(bad.error).toMatch(/No sketch "Nothing"/);
  }, 90000);

  it('derives from a saved version: it stays as it was saved, its own Derived features inside it', async () => {
    // V1: a 20×20×10 block and "Mount" — the block derived, a plate on it
    const s1 = await openHeadless(emptyDocument('Versioned'), wasm);
    const r1 = await s1.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 20, h: 20 }] },
      { op: 'extrude', depth: 10 },
      { op: 'studio', name: 'Mount' },
      { op: 'derived', studio: 'Part Studio 1' },
      { op: 'sketch', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'rect', center: true, w: 30, h: 30 }] },
      { op: 'extrude', depth: 2 },
    ]);
    expect(r1.error).toBeUndefined();
    const v1 = { id: 'vr-derived-test', name: 'V1', created: 1, units: s1.doc.units, tabs: structuredClone(s1.doc.tabs), activeTab: s1.doc.activeTab };
    // the workspace goes on: the block is 40 tall now
    const s = await openHeadless({ ...structuredClone(s1.doc), versions: [v1] } as CadDocument, wasm);
    const r2 = await s.run([
      { op: 'studio', name: 'Part Studio 1' },
      { op: 'set', feature: 'Extrude 1', params: { depth: '40 mm' } },
      { op: 'studio', name: 'Use' },
      { op: 'derived', name: 'Old block', studio: 'Part Studio 1', version: 'V1' },
      { op: 'derived', name: 'Old mount', studio: 'Mount', version: 'v1' },
      { op: 'derived', name: 'New block', studio: 'Part Studio 1' },
    ]);
    expect(r2.error).toBeUndefined();
    const all = await parts(s);
    expect(all.map((p) => [p.bboxMin, p.size])).toEqual([
      // the block as V1 has it
      [
        [-10, -10, 0],
        [20, 20, 10],
      ],
      // Mount of V1: the plate on V1's block (not on the 40 tall one)
      [
        [-10, -10, 0],
        [20, 20, 10],
      ],
      [
        [-15, -15, 10],
        [30, 30, 2],
      ],
      // the workspace's block
      [
        [-10, -10, 0],
        [20, 20, 40],
      ],
    ]);
    const old = studio(s.doc, 'Use').features.find((f) => f.name === 'Old block')!;
    expect(old.params).toMatchObject({ studioId: `${studio(s.doc, 'Part Studio 1').id}@vr-derived-test` });
    const bad = await s.run([{ op: 'derived', studio: 'Part Studio 1', version: 'V9' }]);
    expect(bad.error).toMatch(/No version "V9"\. Versions: V1/);
    // a version that is not there (deleted, or in another browser): the feature fails, the rest builds
    const doc = structuredClone(s.doc);
    const f = studio(doc, 'Use').features.find((x) => x.name === 'Old block')!;
    if (f.type === 'derived') f.params.studioId = `${studio(doc, 'Part Studio 1').id}@vr-nowhere`;
    const s3 = await openHeadless(doc, wasm);
    const summary = (await s3.state()) as ModelSummary;
    expect(summary.features.find((f) => f.name === 'Old block')).toMatchObject({ status: 'error', message: expect.stringMatching(/source version is not available/) });
    expect(summary.parts).toHaveLength(3);
  }, 90000);
});
