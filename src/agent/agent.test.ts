// Agent API end to end with the real OpenCascade kernel (Node).

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless, type HeadlessSession } from './headless';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

async function session(): Promise<HeadlessSession> {
  return openHeadless(emptyDocument('Agent test'), wasm);
}

describe('agent API', () => {
  it('builds a parametric plate with a hole, fillets and edits a variable', async () => {
    const s = await session();
    const r1 = await s.run([
      { op: 'variable', name: 'w', value: 40 },
      {
        op: 'sketch',
        name: 'Base',
        plane: 'top',
        shapes: [
          { type: 'rect', center: true, w: '#w', h: 30 },
          { type: 'circle', c: [0, 0], d: 10 },
        ],
      },
      { op: 'extrude', depth: 10 },
      { op: 'fillet', edges: { dir: 'z' }, radius: 3 },
    ]);
    expect(r1.error).toBeUndefined();
    expect(r1.ok).toBe(true);
    expect(r1.added).toEqual(['Variable 1', 'Base', 'Extrude 1', 'Fillet 1']);
    const part = r1.model!.parts[0];
    expect(part.size).toEqual([40, 30, 10]);
    // plate - hole - 4 corner fillets (square corner minus quarter circle)
    const corner = (9 - (Math.PI * 9) / 4) * 10;
    expect(part.volume!).toBeCloseTo(40 * 30 * 10 - Math.PI * 25 * 10 - 4 * corner, 3);

    const r2 = await s.run([{ op: 'setVariable', name: 'w', value: 60 }]);
    expect(r2.ok).toBe(true);
    expect(r2.model!.parts[0].size).toEqual([60, 30, 10]);
    expect(r2.model!.features.every((f) => f.status === 'ok')).toBe(true);
  }, 60000);

  it('reports bad queries without changing the document', async () => {
    const s = await session();
    await s.run([{ op: 'sketch', shapes: [{ type: 'rect', w: 20, h: 20 }] }, { op: 'extrude', depth: 5 }]);
    const before = JSON.stringify(s.doc);
    const r = await s.run([{ op: 'fillet', edges: { type: 'circle' }, radius: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No edge matches/);
    expect(JSON.stringify(s.doc)).toBe(before);
  }, 60000);

  it('shells the top face, drills holes from a face sketch and patterns them', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 50, h: 50 }] },
      { op: 'extrude', depth: 20 },
      { op: 'sketch', name: 'Holes', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [15, 15] }] },
      { op: 'hole', sketch: 'Holes', diameter: 4, through: true },
      { op: 'circularPattern', features: ['Hole 1'], axis: 'z', count: 4 },
      { op: 'chamfer', edges: { z: 0, type: 'line' }, distance: 1 },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    const vol = r.model!.parts[0].volume!;
    // 4 through holes and 4 bottom chamfers (each removes ½·1·1·50; mitred corners overlap by ⅓ each)
    expect(vol).toBeCloseTo(50 * 50 * 20 - 4 * Math.PI * 4 * 20 - 4 * 0.5 * 50 + 4 / 3, 2);
    const q = (await s.query({ edges: { type: 'circle', z: 20 } })) as { edges: unknown[] };
    expect(q.edges.length).toBe(4);
  }, 60000);

  it('places a boss on a mate connector and moves a part between connectors', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 40 }] },
      { op: 'extrude', depth: 10 },
      { op: 'mateConnector', name: 'Top', at: { face: { normal: 'z', pick: '+z' } }, offset: [10, 0, 0] },
      { op: 'sketch', name: 'Boss', plane: { mate: 'Top' }, shapes: [{ type: 'circle', d: 8 }] },
      { op: 'extrude', sketch: 'Boss', depth: 5, boolean: 'new' },
      // on Top (owned by Part 1), but owned by the boss: it travels with it
      { op: 'mateConnector', name: 'Tip', at: { mate: 'Top' }, offset: [0, 0, 5], owner: 'Part 2' },
      { op: 'mateConnector', name: 'Below', at: 'origin', flip: true },
      { op: 'transform', parts: 'Part 2', from: 'Top', to: 'Below' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    expect(r.model!.mates.map((m) => [m.name, m.owner])).toEqual([
      ['Top', 'Part 1'],
      ['Tip', 'Part 2'],
      ['Below', undefined],
    ]);
    expect(r.model!.mates[0].origin).toEqual([10, 0, 10]);
    expect(r.model!.mates[1].origin).toEqual([0, 0, -5]);
    const boss = r.model!.parts.find((p) => p.name === 'Part 2')!;
    // the boss stood on the top face at x = 10; now it hangs below the origin
    expect(boss.bboxMin[2]).toBeCloseTo(-5, 4);
    expect(boss.bboxMax[2]).toBeCloseTo(0, 4);
    expect((boss.bboxMin[0] + boss.bboxMax[0]) / 2).toBeCloseTo(0, 4);
  }, 60000);

  it('draws an inscribed hexagon (13 mm across flats)', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'polygon', r: '6.5 mm', sides: 6, inscribed: true }] },
      { op: 'extrude', depth: 5 },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    const nut = r.model!.parts[0];
    // a flat on top (rotation 90°): 13 across flats along Y, 13 / cos 30° across corners along X
    expect(nut.size[1]).toBeCloseTo(13, 3);
    expect(nut.size[0]).toBeCloseTo(13 / Math.cos(Math.PI / 6), 3);
    expect(nut.volume!).toBeCloseTo(2 * Math.sqrt(3) * 6.5 ** 2 * 5, 0);
  }, 60000);

  it('draws an ellipse with driving axis sizes and edits them through a variable', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'variable', name: 'a', value: '20 mm' },
      { op: 'sketch', shapes: [{ type: 'ellipse', rx: '#a', ry: '8 mm' }] },
      { op: 'extrude', depth: 4 },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    expect(r.model!.parts[0].size).toEqual([40, 16, 4]);
    const r2 = await s.run([{ op: 'setVariable', name: 'a', value: '25 mm' }]);
    expect(r2.model!.parts[0].size).toEqual([50, 16, 4]);
  }, 60000);

  it('revolves a profile around the Z axis and exports STEP / STL', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'sketch', plane: 'front', shapes: [{ type: 'rect', x: 5, y: 0, w: 10, h: 20 }] },
      { op: 'revolve', axis: 'z' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.model!.parts[0].volume!).toBeCloseTo(Math.PI * (15 * 15 - 5 * 5) * 20, 2);
    const step = new TextDecoder().decode((await s.exportStep()).slice(0, 20));
    expect(step).toContain('ISO-10303-21');
    expect((await s.exportStl()).byteLength).toBeGreaterThan(84);
  }, 60000);

  it('builds parts, then an assembly: inserts, mates by face queries, reports and exports it', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 10 },
      { op: 'sketch', plane: 'top', shapes: [{ type: 'circle', c: [60, 0], r: 5 }] },
      { op: 'extrude', depth: 20, boolean: 'new' },
      { op: 'part', part: 'Part 1', name: 'Plate' },
      { op: 'part', part: 'Part 2', name: 'Pin' },
      { op: 'assembly', name: 'Rig' },
      { op: 'insert', part: 'Plate', fixed: true },
      { op: 'insert', part: 'Pin' },
      { op: 'insert', part: 'Pin', position: [0, 40, 0] },
      // the pin's bottom rim on the plate's top face: it stands at the face centre, free to turn
      { op: 'mate', type: 'revolute', a: { instance: 'Plate <1>', face: { normal: 'z', pick: '+z' } }, b: { instance: 'Pin <1>', edge: { type: 'circle', pick: '-z' } } },
      { op: 'mate', type: 'slider', a: { instance: 'Plate <1>', face: { normal: 'z', pick: '+z' } }, b: { instance: 'Pin <2>', edge: { type: 'circle', pick: '-z' } }, limits: { zMin: 0, zMax: 30 } },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.added).toEqual(expect.arrayContaining(['Extrude 2', 'Rig', 'Plate <1>', 'Pin <1>', 'Pin <2>', 'Revolute 1', 'Slider 1']));
    // (the box of the faceted mesh: within a hundredth of a millimetre across the axis)
    const pin = r.assembly!.instances.find((i) => i.name === 'Pin <1>')!;
    [-5, -5, 10].forEach((v, i) => expect(pin.bboxMin![i]).toBeCloseTo(v, 1));
    [5, 5, 30].forEach((v, i) => expect(pin.bboxMax![i]).toBeCloseTo(v, 1));
    // the slider's pin stands on the plate too (limits keep it from 0 to 30 mm above the face)
    const pin2 = r.assembly!.instances.find((i) => i.name === 'Pin <2>')!;
    expect(pin2.bboxMin![0]).toBeCloseTo(-5, 3);
    expect(pin2.bboxMin![2]).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(r.assembly!.mates.map((m) => [m.name, m.ok])).toEqual([
      ['Revolute 1', true],
      ['Slider 1', true],
    ]);
    // the assembly to STEP: its product tree
    const step = new TextDecoder().decode(await s.exportStep());
    expect(step).toContain("PRODUCT('Rig'");
    expect(step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)?.length).toBe(3);
    // a bad op changes nothing
    const bad = await s.run([{ op: 'place', instance: 'Nope <1>', position: [0, 0, 0] }]);
    expect(bad.error).toMatch(/op #0 \(place\): No instance "Nope <1>"/);
    expect(bad.applied).toBe(false);
  }, 120000);
});
