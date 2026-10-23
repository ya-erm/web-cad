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

  it('unions the targets with the tools and reports the parts by the names given to them', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'sketch', name: 'Plate', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', sketch: 'Plate', depth: 5 },
      { op: 'sketch', name: 'Boss', shapes: [{ type: 'circle', c: [0, 0], d: 10 }] },
      { op: 'extrude', sketch: 'Boss', depth: 15, boolean: 'new' },
      { op: 'boolean', type: 'union', targets: 'Part 1', tools: 'Part 2' },
      { op: 'part', part: 'Part 1', name: 'Base' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    expect(r.model!.parts.map((p) => [p.name, p.size])).toEqual([['Base', [40, 30, 15]]]);
  }, 60000);

  it('hides a sketch and a curve in the graphics area and shows them again', async () => {
    const s = await session();
    const r1 = await s.run([
      { op: 'feature', type: 'helix', name: 'Coil', params: { axis: { $axis: 'z' }, pitch: '5 mm', turns: '3', radius: '10 mm', leftHanded: false } },
      { op: 'sketch', name: 'Wire', plane: 'front', shapes: [{ type: 'circle', c: [10, 0], d: 2 }] },
      { op: 'sweep', sketch: 'Wire', path: { curve: 'Coil' } },
      { op: 'hide', feature: 'Coil' },
      { op: 'hide', feature: 'Wire' },
    ]);
    expect(r1.error).toBeUndefined();
    const hidden = (r: typeof r1) => r.model!.features.filter((f) => f.hidden).map((f) => f.name);
    expect(hidden(r1)).toEqual(['Coil', 'Wire']);
    expect(hidden(await s.run([{ op: 'hide', feature: 'Wire', value: false }]))).toEqual(['Coil']);
    // a solid feature has nothing of its own to hide
    expect((await s.run([{ op: 'hide', feature: 'Sweep 1' }])).error).toMatch(/nothing of its own to hide/);
  }, 60000);

  it('makes variants of a plate with a configuration and switches between them', async () => {
    const s = await session();
    const r1 = await s.run([
      { op: 'variable', name: 'w', value: 40 },
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: '#w', h: 30 }] },
      { op: 'extrude', depth: 10 },
      { op: 'fillet', edges: { dir: 'z' }, radius: 3 },
      {
        op: 'configuration',
        name: 'Size',
        options: ['Small', 'Large'],
        params: [{ variable: 'w' }, { feature: 'Extrude 1', param: 'depth' }, { feature: 'Fillet 1' }],
        // Small keeps the features' own values; Large: wider, thicker, no fillet
        values: { Small: [null, null, null], Large: [80, '25 mm', true] },
      },
    ]);
    expect(r1.ok).toBe(true);
    expect(r1.model!.configuration).toEqual([{ name: 'Size', options: ['Small', 'Large'], chosen: 'Small', params: ['#w', 'Extrude 1.depth', 'Fillet 1.suppressed'] }]);
    expect(r1.model!.parts[0].size).toEqual([40, 30, 10]);
    const r2 = await s.run([{ op: 'configure', values: { Size: 'Large' } }]);
    expect(r2.ok).toBe(true);
    expect(r2.model!.parts[0].size).toEqual([80, 30, 25]);
    expect(r2.model!.parts[0].volume).toBeCloseTo(80 * 30 * 25, 3);
    expect(r2.model!.features.find((f) => f.name === 'Fillet 1')?.status).toBe('suppressed');
    expect(r2.model!.variables.w).toBe('80 mm');
    // setVariable in the Large configuration changes its cell, not the variable's own value
    const r3 = await s.run([{ op: 'setVariable', name: 'w', value: 70 }, { op: 'configure', values: { Size: 'Small' } }]);
    expect(r3.model!.parts[0].size).toEqual([40, 30, 10]);
    const r4 = await s.run([{ op: 'configure', values: { Size: 'Large' } }]);
    expect(r4.model!.parts[0].size).toEqual([70, 30, 25]);
    // unknown names are reported
    const bad = await s.run([{ op: 'configure', values: { Size: 'Huge' } }]);
    expect(bad.error).toMatch(/No option "Huge" in "Size"/);
  }, 60000);

  it('configures sketch dimensions and a checkbox, and gives assembly instances variants of their own', async () => {
    const s = await session();
    const r1 = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: '40 mm', h: '30 mm' }] },
      { op: 'extrude', depth: 10 },
      { op: 'fillet', edges: { dir: 'z' }, radius: 3 },
      { op: 'part', part: 'Part 1', name: 'Plate' },
      // a list: the sketch's width (its first dimension); a checkbox: rounded corners
      { op: 'configuration', name: 'Size', options: ['Small', 'Large'], params: [{ feature: 'Sketch 1', dimension: 1 }], values: { Large: ['80 mm'] } },
      { op: 'configuration', name: 'Sharp', checkbox: true, params: [{ feature: 'Fillet 1' }], values: { Off: [false], On: [true] } },
    ]);
    expect(r1.error).toBeUndefined();
    expect(r1.model!.configuration!.map((c) => [c.name, c.options, c.params])).toEqual([
      ['Size', ['Small', 'Large'], ['Sketch 1.dimension 1']],
      ['Sharp', ['Off', 'On'], ['Fillet 1.suppressed']],
    ]);
    const r2 = await s.run([{ op: 'configure', values: { Size: 'Large', Sharp: true } }]);
    expect(r2.model!.parts[0].size).toEqual([80, 30, 10]);
    expect(r2.model!.parts[0].volume).toBeCloseTo(80 * 30 * 10, 3);
    await s.run([{ op: 'configure', values: { Size: 'Small', Sharp: false } }]);
    // two instances: the Part Studio's own choice, and the large one
    const r3 = await s.run([
      { op: 'assembly', name: 'Rig' },
      { op: 'insert', part: 'Plate', name: 'A', position: [0, 0, 0], fixed: true },
      { op: 'insert', part: 'Plate', name: 'B', position: [0, 100, 0], configuration: { Size: 'Large' } },
    ]);
    expect(r3.error).toBeUndefined();
    const [a, b] = r3.assembly!.instances;
    expect([a.bboxMin, a.bboxMax]).toEqual([
      [-20, -15, 0],
      [20, 15, 10],
    ]);
    expect(b.configuration).toEqual({ Size: 'Large' });
    expect([b.bboxMin, b.bboxMax]).toEqual([
      [-40, 85, 0],
      [40, 115, 10],
    ]);
    // back to the Part Studio's choice
    const r4 = await s.run([{ op: 'place', instance: 'B', configuration: {} }]);
    expect(r4.assembly!.instances[1].configuration).toBeUndefined();
    expect(r4.assembly!.instances[1].bboxMax).toEqual([20, 115, 10]);
  }, 90000);

  it('a variable input: any value, in the Part Studio and for each assembly instance', async () => {
    const s = await session();
    const r1 = await s.run([
      // the variable first: the sketch uses it
      { op: 'configuration', name: 'len', variable: { value: 40 } },
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: '#len', h: 20 }] },
      { op: 'extrude', depth: 5 },
      { op: 'part', part: 'Part 1', name: 'Bar' },
    ]);
    expect(r1.error).toBeUndefined();
    expect(r1.model!.configuration).toEqual([{ name: 'len', options: [], chosen: '40 mm', params: ['#len'], variable: true }]);
    expect(r1.model!.features[0]).toMatchObject({ type: 'variable' });
    expect(r1.model!.parts[0].size).toEqual([40, 20, 5]);
    expect((await s.run([{ op: 'configure', values: { len: 65 } }])).model!.parts[0].size).toEqual([65, 20, 5]);
    // "" — the variable's own value again
    expect((await s.run([{ op: 'configure', values: { '#len': '' } }])).model!.parts[0].size).toEqual([40, 20, 5]);
    const r2 = await s.run([
      { op: 'assembly', name: 'Rack' },
      { op: 'insert', part: 'Bar', name: 'A', position: [0, 0, 0], fixed: true },
      { op: 'insert', part: 'Bar', name: 'B', position: [0, 50, 0], configuration: { len: 90 } },
    ]);
    expect(r2.error).toBeUndefined();
    const [a, b] = r2.assembly!.instances;
    expect(a.bboxMax![0] - a.bboxMin![0]).toBeCloseTo(40, 6);
    expect(b.configuration).toEqual({ len: '90 mm' });
    expect(b.bboxMax![0] - b.bboxMin![0]).toBeCloseTo(90, 6);
  }, 90000);

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

  it('draws a spur gear in a sketch whose teeth follow a variable, and extrudes it', async () => {
    const s = await session();
    const r = await s.run([
      { op: 'variable', name: 'z', value: 12, type: 'number' },
      { op: 'variable', name: 'w', value: 6 },
      { op: 'sketch', name: 'Gear', shapes: [{ type: 'gear', teeth: '#z', outerDiameter: 12 }] },
      { op: 'extrude', sketch: 'Gear', depth: '#w' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    const p12 = r.model!.parts[0];
    // Ø12 (tip to tip across the centre: the box at a tooth tip is the tip circle), 6 wide
    p12.size.slice(0, 2).forEach((v) => expect(v).toBeGreaterThan(11.6));
    p12.size.slice(0, 2).forEach((v) => expect(v).toBeLessThanOrEqual(12 + 1e-6));
    expect(p12.size[2]).toBeCloseTo(6, 6);
    // 20 teeth: the same outer diameter, other teeth (faces: per tooth flanks, tip, root…)
    const r20 = await s.run([{ op: 'setVariable', name: 'z', value: 20 }]);
    expect(r20.ok).toBe(true);
    const p20 = r20.model!.parts[0];
    expect(p20.size[0]).toBeGreaterThan(11.6);
    expect(p20.faces).toBeGreaterThan(p12.faces);
    expect(p20.volume).not.toBeCloseTo(p12.volume!, 1);
    // an impossible gear says why
    const bad = await s.run([{ op: 'sketch', shapes: [{ type: 'gear', teeth: 4, module: 1 }] }]);
    expect(bad.error).toMatch(/6 to 400 teeth/);
  }, 120000);

  it('draws a pair of meshing gears with backlash: two parts that do not touch', async () => {
    const s = await session();
    const r = await s.run([
      {
        op: 'sketch',
        name: 'Pair',
        shapes: [
          { type: 'gear', teeth: 12, module: 1, backlash: 0.2 },
          { type: 'gear', teeth: 20, module: 1, backlash: 0.2, c: [16, 0], mesh: true },
        ],
      },
      { op: 'extrude', sketch: 'Pair', depth: 5 },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.model!.parts.length).toBe(2);
    // the second gear meshes with the first
    const tab = s.doc.tabs.find((t) => 'features' in t) as { features: { name: string; params: unknown }[] };
    const sketch = tab.features.find((f) => f.name === 'Pair')!.params as { entities: { type: string; id: string; meshWith?: string }[] };
    const [g1, g2] = sketch.entities.filter((e) => e.type === 'gear');
    expect(g2.meshWith).toBe(g1.id);
    const bad = await s.run([{ op: 'sketch', shapes: [{ type: 'gear', teeth: 20, module: 1, mesh: true }] }]);
    expect(bad.error).toMatch(/"mesh" needs a gear/);
  }, 120000);

  it('makes exploded views of an assembly and animates its mates as a query', async () => {
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
      { op: 'mate', type: 'revolute', a: { instance: 'Plate <1>', face: { normal: 'z', pick: '+z' } }, b: { instance: 'Pin <1>', edge: { type: 'circle', pick: '-z' } } },
      { op: 'mate', type: 'slider', a: { instance: 'Plate <1>', face: { normal: 'z', pick: '+z' } }, b: { instance: 'Pin <2>', edge: { type: 'circle', pick: '-z' } }, limits: { zMin: 0, zMax: 30 } },
      // the first pin up by 50; the second 30 along X and laid down (a quarter turn about X through its centre)
      {
        op: 'explodedView',
        name: 'Apart',
        steps: [
          { instances: ['Pin <1>'], dir: '+z', distance: 50 },
          { instances: ['Pin <2>'], dir: [1, 0, 0], distance: 30, angle: 90 },
        ],
      },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.added).toContain('Apart');
    const ev = r.assembly!.explodedViews![0];
    expect([ev.name, ev.steps]).toEqual(['Apart', 2]);
    const box = (name: string) => ev.moved.find((m) => m.name === name)!;
    expect(box('Pin <1>').bboxMin[2]).toBeCloseTo(60, 1);
    expect(box('Pin <1>').bboxMax[2]).toBeCloseTo(80, 1);
    const pin2 = r.assembly!.instances.find((i) => i.name === 'Pin <2>')!;
    // laid down: 20 long along Y, 10 high, 30 further along X
    expect(box('Pin <2>').bboxMax[1] - box('Pin <2>').bboxMin[1]).toBeCloseTo(20, 1);
    expect(box('Pin <2>').bboxMax[2] - box('Pin <2>').bboxMin[2]).toBeCloseTo(10, 1);
    expect(box('Pin <2>').bboxMin[0]).toBeCloseTo(pin2.bboxMin![0] + 30, 1);
    // shown only: the pins stand where the mates put them
    expect(r.assembly!.instances.find((i) => i.name === 'Pin <1>')!.bboxMin![2]).toBeCloseTo(10, 1);
    // more steps after its own; mistakes
    const more = await s.run([{ op: 'explodedView', name: 'apart', add: true, steps: [{ instances: ['Plate <1>'], dir: '-z', distance: 10 }] }]);
    expect(more.changed).toContain('Apart');
    expect(more.assembly!.explodedViews![0].steps).toBe(3);
    expect((await s.run([{ op: 'explodedView', steps: [{ instances: ['Pin <1>'], dir: '+q' as never, distance: 5 }] }])).error).toMatch(/Invalid step direction "\+q"/);
    expect((await s.run([{ op: 'explodedView', steps: [{ instances: ['Pin <1>'], dir: 'z' }] }])).error).toMatch(/moves nothing/);
    // the slider's pin through its range, in frames: up from the plate's face
    const slide = await s.animate({ mate: 'Slider 1', from: 0, to: 30, frames: 4 });
    expect([slide.mate, slide.motion, slide.frames.map((f) => f.value)]).toEqual(['Slider 1', 'slide', [0, 10, 20, 30]]);
    expect(slide.frames.map((f) => f.instances.map((i) => i.name))).toEqual([['Pin <2>'], ['Pin <2>'], ['Pin <2>'], ['Pin <2>']]);
    const lows = slide.frames.map((f) => f.instances[0].bboxMin![2]);
    lows.forEach((z, i) => expect(z - lows[0]).toBeCloseTo(10 * i, 3));
    // the revolute's pin turns a quarter about Z
    const turn = await s.animate({ mate: 'Revolute 1', from: 0, to: 90, frames: 2 });
    expect(turn.motion).toBe('turn');
    const [a0, a1] = turn.frames.map((f) => f.instances[0].rotation[2]);
    expect((((a1 - a0) % 360) + 360) % 360).toBeCloseTo(90, 3);
    await expect(s.animate({ mate: 'Nope' })).rejects.toThrow(/No mate "Nope"/);
    // nothing changed by animating; the view deleted
    const gone = await s.run([{ op: 'deleteExplodedView', name: 'Apart' }]);
    expect(gone.removed).toEqual(['Apart']);
    expect(gone.assembly!.explodedViews).toBeUndefined();
    expect(gone.assembly!.instances.find((i) => i.name === 'Pin <2>')!.position).toEqual(pin2.position);
  }, 120000);
});
