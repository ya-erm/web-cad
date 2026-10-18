// Sub-assemblies: an assembly inserted into another one moves as a whole, and mates reach its parts.

import { describe, expect, it } from 'vitest';
import type { AssemblyTab, CadDocument, Vec3 } from '../core/types';
import { billOfMaterials } from './bom';
import type { PartMesh } from '../kernel/protocol';
import { applyPoint, composeAssembly, placementOf, type AssemblySources } from './compose';
import { containsAssembly, expandAssembly, findInstance, topInstance, unitOf } from './expand';
import { applySolve, applySolveLed, draggedAssembly, editPlacement, nearestFlip } from './mates';

const mesh = (id: string, faces: PartMesh['faces']) =>
  ({
    id,
    name: id,
    color: '#ccc',
    hidden: false,
    positions: new Float32Array(),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    faceRanges: new Int32Array(),
    edgePositions: new Float32Array(),
    edgeRanges: new Int32Array(),
    vertices: new Float32Array(),
    faces,
    edges: [],
    bbox: [
      [0, 0, 0],
      [1, 1, 1],
    ],
  }) as PartMesh;

// plate: top face at z = 10 (+Z); pin: bottom face at z = 0 (−Z)
const plate = mesh('plate', [{ type: 'PLANE', center: [0, 0, 10], normal: [0, 0, 1], area: 1 }]);
const pin = mesh('pin', [{ type: 'PLANE', center: [0, 0, 0], normal: [0, 0, -1], area: 1 }]);
const inst = (id: string, partId: string, position: Vec3, rotation: Vec3 = [0, 0, 0], extra = {}) => ({ id, name: id, studioId: 'ps', partId, position, rotation, ...extra });

// sub-assembly S: a pin standing on a plate
const S: AssemblyTab = { id: 'S', type: 'assembly', name: 'Pin on plate', instances: [inst('P', 'plate', [0, 0, 0]), inst('N', 'pin', [0, 0, 10])] };
const sources: AssemblySources = new Map([
  ['ps', { parts: new Map([['plate', plate], ['pin', pin]]), mates: [] }],
  ['S', { parts: new Map(), mates: [], assembly: S }],
]);
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

function parent(): AssemblyTab {
  return {
    id: 'A',
    type: 'assembly',
    name: 'Top',
    instances: [inst('G', 'plate', [0, 0, 0], [0, 0, 0], { fixed: true }), { id: 'X', name: 'Sub <1>', studioId: 'S', partId: '', assemblyId: 'S', position: [50, 0, 0], rotation: [0, 0, 90] }],
  };
}

describe('sub-assemblies', () => {
  it('unfold into their parts, placed by the sub-assembly instance and held together', () => {
    const flat = expandAssembly(parent(), sources);
    expect(flat.instances.map((i) => i.id)).toEqual(['G', 'X/P', 'X/N']);
    near(applyPoint(placementOf(flat.instances[2]), [0, 0, 0]), [50, 0, 10]);
    expect(flat.instances[1].name).toBe('Sub <1> / P');
    expect(flat.groups?.find((g) => g.id === 'sub:X')?.members.map((m) => m.instance)).toEqual(['X/P', 'X/N']);
    expect(composeAssembly(parent(), sources).build.parts.map((p) => p.id)).toEqual(['G', 'X/P', 'X/N']);
    expect(topInstance('X/N')).toBe('X');
    near(applyPoint(placementOf(findInstance(parent(), sources, 'X/N')!), [0, 0, 0]), [50, 0, 10]);
  });

  it('a mate to a part inside moves the whole sub-assembly', () => {
    const tab = parent();
    const a = { instance: 'G', connector: { kind: 'face' as const, index: 0 } };
    const b = { instance: 'X/N', connector: { kind: 'face' as const, index: 0 } };
    tab.mates = [{ id: 'm', name: 'F', type: 'fastened', a, b, flip: nearestFlip(sources, tab, a, b) }];
    expect(applySolve(tab, sources)).toEqual([]);
    // the pin of the sub-assembly sits on the fixed plate; the sub-assembly's own plate came along under it
    const flat = expandAssembly(tab, sources);
    near(applyPoint(placementOf(flat.instances[2]), [0, 0, 0]), [0, 0, 10]);
    near(applyPoint(placementOf(flat.instances[1]), [0, 0, 0]), [0, 0, 0]);
    // the parent stores only the sub-assembly's placement
    expect(tab.instances.map((i) => i.id)).toEqual(['G', 'X']);
  });

  it('the bill of materials counts the parts of sub-assemblies (flattened)', () => {
    const doc = { tabs: [{ id: 'ps', type: 'partStudio', name: 'PS', features: [], rollback: null, parts: {} }, S] } as unknown as CadDocument;
    expect(billOfMaterials(doc, parent(), sources).map((r) => [r.name, r.quantity])).toEqual([
      ['plate', 2],
      ['pin', 1],
    ]);
  });

  it('knows when inserting would make an assembly contain itself', () => {
    const tabs = [parent(), S, { id: 'B', type: 'assembly', instances: [{ id: 'y', name: 'y', studioId: 'A', partId: '', assemblyId: 'A', position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 }] }];
    expect(containsAssembly(tabs, 'A', 'S')).toBe(true);
    expect(containsAssembly(tabs, 'B', 'S')).toBe(true);
    expect(containsAssembly(tabs, 'S', 'A')).toBe(false);
    expect(containsAssembly(tabs, 'S', 'S')).toBe(true);
  });
});

describe('flexible sub-assemblies', () => {
  // sub-assembly F: a pin that slides on a fixed plate (planar mate)
  const a = { instance: 'P', connector: { kind: 'face' as const, index: 0 } };
  const b = { instance: 'N', connector: { kind: 'face' as const, index: 0 } };
  const F: AssemblyTab = {
    id: 'F',
    type: 'assembly',
    name: 'Slider',
    instances: [inst('P', 'plate', [0, 0, 0], [0, 0, 0], { fixed: true }), inst('N', 'pin', [0, 0, 10])],
    mates: [{ id: 'm', name: 'Planar 1', type: 'planar', a, b, flip: true }],
  };
  const src: AssemblySources = new Map([...sources, ['F', { parts: new Map(), mates: [], assembly: F }]]);
  const top = (flexible: boolean): AssemblyTab => ({
    id: 'A',
    type: 'assembly',
    name: 'Top',
    instances: [{ id: 'X', name: 'Slider <1>', studioId: 'F', partId: '', assemblyId: 'F', position: [50, 0, 0], rotation: [0, 0, 90], fixed: true, ...(flexible ? { flexible } : {}) }],
  });
  const world = (tab: AssemblyTab, id: string) => applyPoint(placementOf(findInstance(tab, src, id)!), [0, 0, 0]);

  it('bring their own mates and hold only their fixed parts together', () => {
    const flat = expandAssembly(top(true), src);
    expect(flat.mates?.map((m) => [m.id, m.a.instance, m.b.instance])).toEqual([['X/m', 'X/P', 'X/N']]);
    expect(flat.groups?.some((g) => g.id === 'sub:X')).toBe(false);
    expect(flat.instances.map((i) => !!i.fixed)).toEqual([true, false]);
    // rigid: one group, all fixed with it
    const rigid = expandAssembly(top(false), src);
    expect(rigid.mates).toEqual([]);
    expect(rigid.instances.map((i) => !!i.fixed)).toEqual([true, true]);
  });

  it('a part dragged in the parent moves as the sub-assembly mates allow; the sub-assembly stays', () => {
    let tab = draggedAssembly(top(true), src, 'X/N', [0, 7, 0], 0, [0, 0, 1], [50, 0, 10]);
    near(world(tab, 'X/N'), [50, 7, 10]);
    expect(tab.instances[0].position).toEqual([50, 0, 0]);
    // kept in the sub-assembly's coordinates (turned 90° about Z)
    near(tab.instances[0].flex!.N.position, [7, 0, 10]);
    // the planar mate keeps the pin on the plate
    tab = draggedAssembly(tab, src, 'X/N', [0, 0, 5], 0, [0, 0, 1], [50, 7, 10]);
    near(world(tab, 'X/N'), [50, 7, 10]);
    expect(applySolve(tab, src)).toEqual([]);
    // the sub-assembly itself is unchanged
    expect(F.instances[1].position).toEqual([0, 0, 10]);
    // made rigid again, its parts go back to where it places them
    near(world({ ...tab, instances: [{ ...tab.instances[0], flexible: undefined }] }, 'X/N'), [50, 0, 10]);
    // a rigid sub-assembly's part does not move on its own
    near(world(draggedAssembly(top(false), src, 'X/N', [0, 7, 0], 0, [0, 0, 1], [50, 0, 10]), 'X/N'), [50, 0, 10]);
  });

  it('picking a part picks it in a flexible sub-assembly, the whole one otherwise; typed placements go to flex', () => {
    expect(unitOf(top(true), 'X/N')).toBe('X/N');
    expect(unitOf(top(false), 'X/N')).toBe('X');
    expect(unitOf(top(false), 'X')).toBe('X');
    // typed: 7 mm along Y of the parent (the planar mate keeps it on the plate when Z is typed)
    const tab = top(true);
    expect(editPlacement(tab, src, 'X/N', (i) => void (i.position = [50, 7, 30]))).toBe(true);
    expect(applySolveLed(tab, src, 'X/N')).toEqual([]);
    near(world(tab, 'X/N'), [50, 7, 10]);
    expect(editPlacement(top(false), src, 'X/N', () => {})).toBe(false);
  });

  it('its mates that fail here are reported by name', () => {
    // the parent holds the pin 40 mm above the plate it must slide on
    const tab = top(true);
    tab.instances.push(inst('G', 'plate', [50, 0, 40], [0, 0, 0], { fixed: true }));
    const ga = { instance: 'G', connector: { kind: 'face' as const, index: 0 } };
    const nb = { instance: 'X/N', connector: { kind: 'face' as const, index: 0 } };
    tab.mates = [{ id: 'f', name: 'Fastened 1', type: 'fastened', a: ga, b: nb, flip: true }];
    const failed = applySolve(tab, src);
    expect(failed).toContain('X/m');
    expect(expandAssembly(tab, src).mates?.find((m) => m.id === 'X/m')?.name).toBe('Slider <1> / Planar 1');
  });

  it('fixed with nothing fixed inside it, its first part holds it', () => {
    const loose: AssemblyTab = { ...F, id: 'L', instances: F.instances.map((i) => ({ ...i, fixed: false })) };
    const s = new Map([...src, ['L', { parts: new Map(), mates: [], assembly: loose }]]);
    const tab = top(true);
    tab.instances[0].assemblyId = 'L';
    expect(expandAssembly(tab, s).instances.map((i) => !!i.fixed)).toEqual([true, false]);
  });
});

describe('structured bill of materials', () => {
  const doc = { tabs: [{ id: 'ps', type: 'partStudio', name: 'PS', features: [], rollback: null, parts: { pin: { partNumber: 'N-1' } } }, S] } as unknown as CadDocument;
  const sub = (id: string, assemblyId: string, x: number) => ({ id, name: id, studioId: assemblyId, partId: '', assemblyId, position: [x, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 });
  const tab = (): AssemblyTab => ({ ...parent(), instances: [...parent().instances, sub('Y', 'S', 80)] });

  it('lists sub-assemblies with their parts by levels, the quantity per parent', () => {
    const rows = billOfMaterials(doc, tab(), sources, 'structured');
    expect(rows.map((r) => [r.item, r.level, r.kind, r.name, r.quantity, r.partNumber])).toEqual([
      ['1', 1, 'part', 'plate', 1, ''],
      ['2', 1, 'assembly', 'Pin on plate', 2, ''],
      ['2.1', 2, 'part', 'plate', 1, ''],
      ['2.2', 2, 'part', 'pin', 1, 'N-1'],
    ]);
    expect(rows[1].instances).toEqual(['X', 'Y']);
    expect(rows[3].instances).toEqual(['X/N', 'Y/N']);
    expect(billOfMaterials(doc, tab(), sources, 'topLevel').map((r) => [r.item, r.name, r.quantity])).toEqual([
      ['1', 'plate', 1],
      ['2', 'Pin on plate', 2],
    ]);
    expect(billOfMaterials(doc, tab(), sources, 'flattened').map((r) => [r.item, r.name, r.quantity])).toEqual([
      ['1', 'plate', 3],
      ['2', 'pin', 2],
    ]);
  });

  it('numbers nested sub-assemblies by levels', () => {
    // T holds two S; the parent holds one T
    const T: AssemblyTab = { id: 'T', type: 'assembly', name: 'Two', instances: [sub('s1', 'S', 0), sub('s2', 'S', 30)] };
    const s = new Map([...sources, ['T', { parts: new Map(), mates: [], assembly: T }]]);
    const asm: AssemblyTab = { id: 'A', type: 'assembly', name: 'Top', instances: [sub('t', 'T', 0)] };
    expect(billOfMaterials(doc, asm, s, 'structured').map((r) => [r.item, r.name, r.quantity, r.instances.length])).toEqual([
      ['1', 'Two', 1, 1],
      ['1.1', 'Pin on plate', 2, 2],
      ['1.1.1', 'plate', 1, 2],
      ['1.1.2', 'pin', 1, 2],
    ]);
  });
});
