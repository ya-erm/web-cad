// Drawing views of assemblies: the instances' parts placed as one builder's — projected, with their holes, anchored
// dimensions (real OpenCascade); and which parts an assembly shows (sub-assemblies unfolded).

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { AssemblyInstance, AssemblyTab, PartStudioTab } from '../core/types';
import { VIEW_AXES } from '../core/drawingViews';
import { StudioBuilder } from '../kernel/build';
import type { PlacedPart } from '../kernel/protocol';
import { shownParts } from '../assembly/expand';
import { storedBom } from '../assembly/bom';
import { balloonPrims, balloonShelf, bomTablePrims, bomTableRect, type BomTableRow } from './sheet';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('Assembly views on drawings', () => {
  it('projects the instances where the assembly places them, each with its holes', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Assembly views');
    const k = nodeKernel(doc.units);
    // a plate 20 × 10 × 5 with a hole ⌀4 at (5, 0)
    const { report } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 20, h: 10 }] },
        { op: 'extrude', depth: 5 },
        { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [5, 0] }] },
        { op: 'hole', sketch: 'P', diameter: 4, through: true },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    const [partId] = k.builder.current.parts.keys();
    // A at the origin, B turned 90° about Z and moved to x = 30
    const placed = (bx: number): PlacedPart[] => [
      { id: 'A', studioKey: 'ps', partId, name: 'Plate <1>', position: [0, 0, 0], rotation: [0, 0, 0] },
      { id: 'B', studioKey: 'ps', partId, name: 'Plate <2>', position: [bx, 0, 0], rotation: [0, 0, 90] },
    ];
    const asm = new StudioBuilder();
    const sources = (key: string) => (key === 'ps' ? k.builder : undefined);
    asm.place(placed(30), sources);
    expect(asm.shapesFor([]).map((s) => [s.id, s.name])).toEqual([
      ['A', 'Plate <1>'],
      ['B', 'Plate <2>'],
    ]);
    const top = asm.projection([], 'top', false);
    expect(top.bounds?.[0].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-10, -10]);
    expect(top.bounds?.[1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([35, 10]);
    // each instance's hole, turned with it; counted apart
    const holes = ((top as { holes?: { c: number[]; count: number }[] }).holes ?? []).map((h) => ({ c: h.c.map((v) => Math.round(v * 1e6) / 1e6 + 0), count: h.count }));
    expect(holes.sort((a, b) => a.c[0] - b.c[0])).toEqual([
      { c: [5, 0], count: 1 },
      { c: [30, 5], count: 1 },
    ]);
    // a dimension's point on B's corner follows B when the assembly moves it
    const corner = asm.viewAnchor([], VIEW_AXES.top, [35, 10]);
    expect(corner).toMatchObject({ kind: 'vertex', partId: 'B' });
    asm.place(placed(50), sources);
    const [c] = asm.viewRefs(VIEW_AXES.top, [corner!]);
    expect(c?.p[0]).toBeCloseTo(55, 6);
    expect(c?.p[1]).toBeCloseTo(10, 6);
    // the part a point of the view shows (an item number's dot): on its top face, seen from above
    const a = asm.viewPart([], VIEW_AXES.top, [-5, 2], 0.1);
    expect(a?.id).toBe('A');
    expect(a?.at.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([-5, 2, 5]);
    expect(asm.viewPart([], VIEW_AXES.top, [50, -8], 0.1)?.id).toBe('B');
    // in B's hole (⌀4 at (50, 5)): nothing there — but a click beside an edge, within the tolerance, finds the part
    expect(asm.viewPart([], VIEW_AXES.top, [50, 5], 0.1)).toBeNull();
    expect(asm.viewPart([], VIEW_AXES.top, [-10.5, 0], 1)?.id).toBe('A');
  }, 60000);

  it('counts the parts for the BOM table and item numbers, as the document stores the assembly', () => {
    const doc = emptyDocument('BOM');
    const ps = doc.tabs[0] as PartStudioTab;
    ps.parts = { p1: { name: 'Plate', partNumber: 'АБВ.001', material: 'Steel' }, p2: {} } as never;
    const inst = (id: string, rest: Partial<AssemblyInstance> = {}): AssemblyInstance => ({ id, name: `Plate <${id}>`, studioId: ps.id, partId: 'p1', position: [0, 0, 0], rotation: [0, 0, 0], ...rest });
    const sub: AssemblyTab = { id: 'sub', type: 'assembly', name: 'Sub', instances: [inst('s1', { partId: 'p2', name: 'Part 2 <1>' })] };
    const top: AssemblyTab = { id: 'top', type: 'assembly', name: 'Top', instances: [inst('a'), inst('b'), inst('s', { name: 'Sub <1>', studioId: 'sub', partId: '', assemblyId: 'sub' })] };
    doc.tabs.push(sub, top);
    const rows = storedBom(doc, top).map((r) => ({ item: r.item, name: r.name, partNumber: r.partNumber, quantity: r.quantity, instances: r.instances }));
    expect(rows).toEqual([
      { item: '1', name: 'Plate', partNumber: 'АБВ.001', quantity: 2, instances: ['a', 'b'] },
      // a part of the sub-assembly: named without it
      { item: '2', name: 'Part 2', partNumber: '', quantity: 1, instances: ['s/s1'] },
    ]);
  });

  it('draws the BOM table above where it stands and the item number on its shelf', () => {
    const rows: BomTableRow[] = [
      { item: '1', partNumber: 'АБВ.001', name: 'Plate', quantity: 2, material: 'Steel' },
      { item: '2', partNumber: '', name: 'Pin', quantity: 4, material: '' },
    ];
    const at = { x: 415, y: 60 };
    expect(bomTableRect(at, rows.length)).toEqual({ x0: 230, y0: 60, x1: 415, y1: 86 });
    const texts = bomTablePrims(at, rows, (k) => k).filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p.text : ''));
    expect(texts).toEqual(['Item', '1', '2', 'Part number', 'АБВ.001', 'Part name', 'Plate', 'Pin', 'Qty.', '2', '4', 'Material', 'Steel']);
    // the shelf goes away from the dot; the number above it
    const [a, b] = balloonShelf([100, 100], [120, 110], '12');
    expect(a).toEqual([120, 110]);
    expect(b[0]).toBeGreaterThan(120);
    expect(balloonShelf([100, 100], [80, 110], '3')[1][0]).toBeLessThan(80);
    const text = balloonPrims([100, 100], [120, 110], '12').find((p) => p.t === 'text');
    expect(text?.t === 'text' && text.p[1]).toBeGreaterThan(110);
  });

  it('shows the visible instances with sub-assemblies unfolded, where they are stored', () => {
    const inst = (id: string, rest: Partial<AssemblyInstance> = {}): AssemblyInstance => ({ id, name: `${id} <1>`, studioId: 'ps', partId: 'p1', position: [0, 0, 0], rotation: [0, 0, 0], ...rest });
    const sub: AssemblyTab = { id: 'sub', type: 'assembly', name: 'Sub', instances: [inst('i1', { position: [0, 10, 0] }), inst('i2', { hidden: true })] };
    const top: AssemblyTab = {
      id: 'top',
      type: 'assembly',
      name: 'Top',
      instances: [inst('s', { name: 'Sub <1>', studioId: 'sub', partId: '', assemblyId: 'sub', position: [100, 0, 0], rotation: [0, 0, 90] }), inst('a'), inst('h', { hidden: true })],
    };
    const parts = shownParts([top, sub], top);
    expect(parts.map((p) => p.id)).toEqual(['s/i1', 'a']);
    expect(parts[0].name).toBe('Sub <1> / i1 <1>');
    // (0, 10, 0) in the sub-assembly, turned 90° about Z and moved to x = 100
    expect(parts[0].position.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([90, 0, 0]);
    expect(parts[0].rotation.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 0, 90]);
  });
});
