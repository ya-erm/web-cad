// A spur gear in a sketch: its teeth — one involute tooth arrayed around the centre — close into one region the size
// its parameters say; the parameters are expressions (`#z` teeth follow the variable); impossible gears say why.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { SkGear, SketchData } from '../core/types';
import { makeEvalContext } from '../core/features';
import { gearCircles, gearProblem, toothHalfAngle, type GearSize } from '../core/gear';
import { addGear, copyEntities, DEFAULT_GEAR } from './sketchOps';
import { expandGears, gearOfPart, gearRotation, gearSizeOf, isGearPart } from './gear';
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
    expect(gearProblem({ z: 12, m: 1, alpha: a20, backlash: -0.1 })).toBe('The backlash cannot be negative');
    expect(gearProblem({ z: 12, m: 1, alpha: a20, backlash: 1.5 })).toBe('The teeth come to a point: less backlash');
  });

  it('thins the teeth by half the backlash at the pitch circle', () => {
    const a20 = (20 * Math.PI) / 180;
    for (const backlash of [0, 0.2]) {
      const g = { z: 20, m: 1, alpha: a20, backlash };
      const { r } = gearCircles(g);
      const tooth = 2 * toothHalfAngle(g, r) * r;
      expect(tooth).toBeCloseTo(Math.PI / 2 - backlash / 2, 9);
      // the gap: as much wider
      expect((2 * Math.PI) / g.z * r - tooth).toBeCloseTo(Math.PI / 2 + backlash / 2, 9);
    }
  });
});

/**
 * How deep (mm) two gears cut into each other at worst: points along each one's flanks and tip inside the other (the
 * exact involute teeth). 0 — they only touch, or not even that.
 */
function penetration(gears: { size: GearSize; rotation: number; c: [number, number] }[]): number {
  const inside = (g: (typeof gears)[0], x: number, y: number) => {
    const { ra, rf } = gearCircles(g.size);
    const rho = Math.hypot(x - g.c[0], y - g.c[1]);
    if (rho >= ra) return 0;
    const p = (2 * Math.PI) / g.size.z;
    let a = Math.atan2(y - g.c[1], x - g.c[0]) - g.rotation;
    a = ((((a % p) + p + p / 2) % p) + p) % p - p / 2;
    return rho < rf ? Infinity : (toothHalfAngle(g.size, rho) - Math.abs(a)) * rho;
  };
  let worst = 0;
  for (const [g, other] of [gears, [gears[1], gears[0]]]) {
    const { ra, rb, rf } = gearCircles(g.size);
    for (let k = 0; k < g.size.z; k++) {
      const at = g.rotation + (2 * Math.PI * k) / g.size.z;
      for (let i = 0; i <= 200; i++) {
        const rho = Math.max(rb, rf) + ((ra - Math.max(rb, rf)) * i) / 200;
        const h = toothHalfAngle(g.size, rho);
        for (const a of [at - h, at + h, at - (h * i) / 200])
          worst = Math.max(worst, inside(other, g.c[0] + rho * Math.cos(a), g.c[1] + rho * Math.sin(a)));
      }
    }
  }
  return worst;
}

describe('a pair of gears', () => {
  const a20 = (20 * Math.PI) / 180;
  /** Gear 1 (12 teeth, turned by `rot1`) at the origin, gear 2 (20 teeth) meshing with it at `c2`; module 1. */
  const pair = (c2: [number, number], rot1 = '0 deg', backlash?: string) => {
    let ids: string[] = [];
    const d = produce({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] } as SketchData, (s) => {
      const g1 = addGear(s, [0, 0], { ...DEFAULT_GEAR, teeth: '12', rotation: rot1, backlash });
      const g2 = addGear(s, c2, { ...DEFAULT_GEAR, teeth: '20', backlash, meshWith: g1.id });
      ids = [g1.id, g2.id];
    });
    const map = new Map(d.entities.map((e) => [e.id, e]));
    const g = ids.map((id) => map.get(id) as SkGear);
    return { d, map, g, rotation: (i: number) => gearRotation(g[i], map)! };
  };
  /** The two gears rolled together: gear 1 turned by δ, gear 2 back by δ · 12 / 20 (and turned by `extra` more). */
  const rolled = (p: ReturnType<typeof pair>, c2: [number, number], delta: number, extra = 0, backlash = 0) => [
    { size: { z: 12, m: 1, alpha: a20, backlash }, rotation: p.rotation(0) + delta, c: [0, 0] as [number, number] },
    { size: { z: 20, m: 1, alpha: a20, backlash }, rotation: p.rotation(1) - (delta * 12) / 20 + extra, c: c2 },
  ];
  const pitch1 = (2 * Math.PI) / 12;
  // the tip of the 20-tooth gear grazes the 12-tooth one's flank below its base circle by about a micron (a pinion of
  // fewer than ~17 teeth: made by a cutter, it would be undercut there; its flank goes radially here)
  const GRAZE = 0.002;

  it('meshes the second gear with the first: its teeth in the gaps, rolling without cutting in', () => {
    for (const [c2, rot1] of [
      [[16, 0], '0 deg'],
      [[16 * Math.cos(0.5), 16 * Math.sin(0.5)], '7 deg'],
    ] as [[number, number], string][]) {
      const p = pair(c2, rot1);
      // on the X axis: 180° + 180° / 20
      if (c2[1] === 0) expect(((p.rotation(1) * 180) / Math.PI) % 18).toBeCloseTo(9, 9);
      for (let i = 0; i < 24; i++) expect(penetration(rolled(p, c2, (pitch1 * i) / 24))).toBeLessThan(GRAZE);
      // no backlash: turned the least bit (0.03 mm at its pitch circle), it cuts in
      expect(penetration(rolled(p, c2, 0, 0.003))).toBeGreaterThan(0.02);
      expect(penetration(rolled(p, c2, 0, -0.003))).toBeGreaterThan(0.02);
    }
  });

  it('with the backlash, turns as much freely: the pair backlash at the pitch circle', () => {
    const p = pair([16, 0], '0 deg', '0.2 mm');
    // ±0.1 mm at the pitch circle of gear 2 (r 10): ±0.01 rad
    for (const extra of [-0.009, 0, 0.009])
      for (let i = 0; i < 12; i++) expect(penetration(rolled(p, [16, 0], (pitch1 * i) / 12, extra, 0.2))).toBeLessThan(GRAZE);
    expect(penetration(rolled(p, [16, 0], 0, 0.012, 0.2))).toBeGreaterThan(0.01);
    expect(penetration(rolled(p, [16, 0], 0, -0.012, 0.2))).toBeGreaterThan(0.01);
  });

  it('follows the first gear and where the centres are; its own rotation does not count', () => {
    const p = pair([16, 0]);
    const before = p.rotation(1);
    // the first one turned by a tooth of its own: the second by 12 / 20 of it back — the same teeth, other ones
    const turned = produce(p.d, (s) => {
      const g = s.entities.find((e) => e.id === p.g[0].id) as SkGear;
      g.rotation = '10 deg';
    });
    const map = new Map(turned.entities.map((e) => [e.id, e]));
    expect(gearRotation(map.get(p.g[1].id) as SkGear, map)).toBeCloseTo(before - ((10 * Math.PI) / 180) * (12 / 20), 9);
    const own = produce(p.d, (s) => {
      (s.entities.find((e) => e.id === p.g[1].id) as SkGear).rotation = '33 deg';
    });
    const ownMap = new Map(own.entities.map((e) => [e.id, e]));
    expect(gearRotation(ownMap.get(p.g[1].id) as SkGear, ownMap)).toBeCloseTo(before, 9);
    // without its pair (deleted): its own rotation
    const alone = p.d.entities.filter((e) => e.id !== p.g[0].id);
    const aloneMap = new Map(alone.map((e) => [e.id, e]));
    expect(gearRotation(aloneMap.get(p.g[1].id) as SkGear, aloneMap)).toBe(0);
  });

  it('a pair copied stays a pair; a gear copied alone meshes with the same gear', () => {
    const p = pair([16, 0]);
    const both = produce(p.d, (s) => void copyEntities(s, [p.g[0].id, p.g[1].id], ([x, y]) => [x, y + 40]));
    const copies = both.entities.filter((e): e is SkGear => e.type === 'gear').slice(2);
    expect(copies[1].meshWith).toBe(copies[0].id);
    const one = produce(p.d, (s) => void copyEntities(s, [p.g[1].id], ([x, y]) => [-x, y]));
    expect((one.entities.filter((e) => e.type === 'gear')[2] as SkGear).meshWith).toBe(p.g[0].id);
  });
});
