// Part materials (Onshape Assign material): the library's densities, one's own, the mass in the model's summary.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';
import { findMaterial, massKg, partDensity } from '../core/materials';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('Materials', () => {
  it('finds library materials by id or name, and gives a part without one the density of steel', () => {
    expect(findMaterial('aluminum')?.density).toBe(2.7);
    expect(findMaterial('PLA')?.density).toBe(1.24);
    expect(findMaterial('Алюминий', (s) => (s === 'Aluminum' ? 'Алюминий' : s))?.id).toBe('aluminum');
    expect(partDensity(undefined)).toBe(7.85);
    expect(partDensity({ material: 'Oak', density: 0.75 })).toBe(0.75);
    // 2 cm³ of steel: 15.7 g
    expect(massKg(2000, 7.85)).toBeCloseTo(0.0157, 9);
  });

  it('weighs a part by its material', async () => {
    const s = await openHeadless(emptyDocument('Materials'), wasm);
    const block = [
      { op: 'sketch', shapes: [{ type: 'rect', w: 20, h: 10 }] },
      { op: 'extrude', depth: 10 },
    ];
    const mass = async (ops: unknown[]) => {
      const r = await s.run(ops as DocumentOp[]);
      expect(r.failed).toEqual([]);
      expect(r.error).toBeUndefined();
      return r.model!.parts[0];
    };
    // 20 × 10 × 10 mm = 2 cm³
    expect((await mass(block)).mass).toBeCloseTo(0.0157, 6);
    const al = await mass([{ op: 'part', part: 'Part 1', material: 'aluminum' }]);
    expect(al).toMatchObject({ material: 'Aluminum' });
    expect(al.mass).toBeCloseTo(0.0054, 6);
    expect((await mass([{ op: 'part', part: 'Part 1', material: 'PLA' }])).mass).toBeCloseTo(0.00248, 6);
    const oak = await mass([{ op: 'part', part: 'Part 1', material: 'Oak', density: 0.75 }]);
    expect(oak).toMatchObject({ material: 'Oak' });
    expect(oak.mass).toBeCloseTo(0.0015, 6);
    const bad = await s.run([{ op: 'part', part: 'Part 1', material: 'Unobtainium' }] as DocumentOp[]);
    expect(bad.error).toMatch(/not in the library/);
    const none = await mass([{ op: 'part', part: 'Part 1', material: null }]);
    expect(none.material).toBeUndefined();
    expect(none.mass).toBeCloseTo(0.0157, 6);
  }, 60000);
});
