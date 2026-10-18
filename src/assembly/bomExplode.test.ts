// Bill of materials and exploded views of an assembly.

import { describe, expect, it } from 'vitest';
import type { AssemblyTab, CadDocument, ExplodedView } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import type { AssemblySources } from './compose';
import { billOfMaterials, BOM_LABELS, bomCsv } from './bom';
import { explodedAssembly } from './explode';

const part = (id: string, name: string) => ({ id, name }) as PartMesh;
const sources: AssemblySources = new Map([['ps', { parts: new Map([['p1', part('p1', 'Plate')], ['p2', part('p2', 'Pin, short')]]), mates: [] }]]);
const doc = {
  tabs: [{ id: 'ps', type: 'partStudio', name: 'Part Studio 1', features: [], rollback: null, parts: { p2: { material: 'Steel', partNumber: 'P-002', description: 'Dowel' } } }],
} as unknown as CadDocument;
const inst = (id: string, partId: string, position: [number, number, number] = [0, 0, 0]) => ({ id, name: id, studioId: 'ps', partId, position, rotation: [0, 0, 0] as [number, number, number] });
const asm: AssemblyTab = { id: 'as', type: 'assembly', name: 'A', instances: [inst('a', 'p1'), inst('b', 'p2', [10, 0, 0]), inst('c', 'p2', [20, 0, 0]), inst('d', 'p2', [30, 0, 0])] };

describe('bill of materials', () => {
  it('one row per part, counted over its instances, with the part properties', () => {
    const rows = billOfMaterials(doc, asm, sources);
    expect(rows.map((r) => [r.item, r.partNumber, r.name, r.description, r.quantity, r.material, r.source])).toEqual([
      ['1', '', 'Plate', '', 1, '', 'Part Studio 1'],
      ['2', 'P-002', 'Pin, short', 'Dowel', 3, 'Steel', 'Part Studio 1'],
    ]);
    expect(rows[1].instances).toEqual(['b', 'c', 'd']);
  });

  it('exports the chosen columns as CSV, quoting cells with commas', () => {
    const csv = bomCsv(billOfMaterials(doc, asm, sources), ['item', 'name', 'quantity', 'material', 'source'], BOM_LABELS);
    expect(csv).toBe('Item,Name,Quantity,Material,Part Studio\n1,Plate,1,,Part Studio 1\n2,"Pin, short",3,Steel,Part Studio 1\n');
    expect(bomCsv(billOfMaterials(doc, asm, sources), ['partNumber', 'description'], BOM_LABELS)).toBe('Part number,Description\n,\nP-002,Dowel\n');
  });
});

describe('exploded views', () => {
  const view: ExplodedView = {
    id: 'v',
    name: 'Exploded view 1',
    steps: [
      { id: 's1', instances: ['b', 'c'], dir: [0, 0, 1], distance: 40 },
      { id: 's2', instances: ['c'], dir: [1, 0, 0], distance: 10 },
    ],
  };

  it('moves the instances of each step; the assembly itself stays', () => {
    const full = explodedAssembly(asm, view, 1);
    expect(full.instances.map((i) => i.position)).toEqual([
      [0, 0, 0],
      [10, 0, 40],
      [30, 0, 40],
      [30, 0, 0],
    ]);
    expect(asm.instances[1].position).toEqual([10, 0, 0]);
  });

  it('a turn step turns the instances about its axis through the pivot', () => {
    const turn: ExplodedView = { id: 't', name: 'T', steps: [{ id: 's', instances: ['b'], dir: [0, 0, 1], distance: 0, angle: 90, pivot: [0, 0, 0] }] };
    const out = explodedAssembly(asm, turn, 1).instances[1];
    // b stood at (10, 0, 0): a quarter turn about Z through the origin puts it at (0, 10, 0), turned by 90°
    expect(out.position.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 10, 0]);
    expect(out.rotation[2]).toBeCloseTo(90, 9);
    // half way: 45°
    expect(explodedAssembly(asm, turn, 0.5).instances[1].rotation[2]).toBeCloseTo(45, 9);
  });

  it('the steps go one after another as the slider moves', () => {
    // halfway: the first step done, the second not started
    expect(explodedAssembly(asm, view, 0.5).instances[2].position).toEqual([20, 0, 40]);
    // a quarter: the first step half done
    expect(explodedAssembly(asm, view, 0.25).instances[1].position).toEqual([10, 0, 20]);
    expect(explodedAssembly(asm, view, 0).instances[2].position).toEqual([20, 0, 0]);
  });
});
