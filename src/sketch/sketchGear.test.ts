// A spur gear in a sketch: its teeth — one involute tooth arrayed around the centre — close into one region the size
// its parameters say; the parameters are expressions (`#z` teeth follow the variable); impossible gears say why.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SketchData } from '../core/types';
import { makeEvalContext } from '../core/features';
import { gearCircles, gearProblem } from '../core/gear';
import { addGear, DEFAULT_GEAR } from './sketchOps';
import { expandGears, gearOfPart, gearSizeOf, isGearPart } from './gear';
import { computeRegions } from './regions';

const sketch = (params = DEFAULT_GEAR) => {
  let id = '';
  const d = produce({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] } as SketchData, (s) => {
    id = addGear(s, [10, 5], params).id;
  });
  return { d, id };
};
const ctx = (vars: Record<string, number>) =>
  makeEvalContext({ units: { length: 'mm', angle: 'deg' } }, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, { v, len: 0, ang: 0 }])) as never);

describe('spur gear in a sketch', () => {
  it('closes into one region between the root and tip circles', () => {
    for (const [teeth, size] of [
      ['12', '12 mm'],
      ['24', '12 mm'],
      ['50', '52 mm'],
    ]) {
      const { d, id } = sketch({ ...DEFAULT_GEAR, teeth, sizeBy: 'outerDiameter', size });
      const all = expandGears(d.entities);
      const parts = all.filter((e) => isGearPart(e.id));
      expect(parts.every((e) => gearOfPart(e.id) === id)).toBe(true);
      // one tip arc per tooth
      const z = Number(teeth);
      expect(parts.filter((e) => e.type === 'arc' && e.id.endsWith('tip')).length).toBe(z);
      const regions = computeRegions(all);
      expect(regions.length).toBe(1);
      // between the root and tip circles (about the centre), the outer diameter as given
      const m = Number.parseFloat(size) / (z + 2);
      const { ra, rf } = gearCircles({ z, m, alpha: (20 * Math.PI) / 180 });
      const dist = regions[0].polygon.map(([x, y]) => Math.hypot(x - 10, y - 5));
      expect(Math.max(...dist)).toBeCloseTo(ra, 3);
      expect(Math.min(...dist)).toBeGreaterThan(rf - 1e-6);
      expect(regions[0].area).toBeGreaterThan(Math.PI * rf * rf);
      expect(regions[0].area).toBeLessThan(Math.PI * ra * ra);
    }
  });

  it('follows its expressions: #z teeth', () => {
    const { d, id } = sketch({ ...DEFAULT_GEAR, teeth: '#z', sizeBy: 'outerDiameter', size: '12 mm' });
    const g = d.entities.find((e) => e.id === id)!;
    const tips = (vars: Record<string, number>) => expandGears(d.entities, ctx(vars)).filter((e) => e.type === 'arc' && e.id.endsWith('tip')).length;
    expect(tips({ z: 12 })).toBe(12);
    expect(tips({ z: 20 })).toBe(20);
    // without the variable: no teeth, and why
    expect(tips({})).toBe(0);
    expect(g.type === 'gear' && gearSizeOf(g)).toMatchObject({ error: expect.any(String) });
  });

  it('says why a gear cannot be made', () => {
    const a20 = (20 * Math.PI) / 180;
    expect(gearProblem({ z: 5, m: 1, alpha: a20 })).toBe('A gear needs 6 to 400 teeth');
    expect(gearProblem({ z: 12, m: 0, alpha: a20 })).toBe('The module must be positive');
    expect(gearProblem({ z: 12, m: 1, alpha: (40 * Math.PI) / 180 })).toBe('The pressure angle must be between 10° and 35°');
    expect(gearProblem({ z: 6, m: 1, alpha: (35 * Math.PI) / 180 })).toBe('The teeth come to a point: more teeth or a smaller pressure angle');
    expect(gearProblem({ z: 12, m: 1, alpha: a20 })).toBeNull();
  });
});
