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
    expect(f.params).toEqual({ studioId: studio(s.doc, 'Part Studio 1').id, parts: [expect.stringMatching(/\.0$/)] });
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
});
