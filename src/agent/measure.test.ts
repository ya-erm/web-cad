// The measure panel (Onshape Measure) with the real OpenCascade kernel: minimum and maximum distance, centre to
// centre, the angle, totals.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import type { DocumentOp } from './document';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** A 40 × 30 × 10 block centred on the origin, with two through holes ⌀6 at x = ±10. */
async function block() {
  const s = await openHeadless(emptyDocument('Measure'), wasm);
  const r = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
    { op: 'extrude', depth: 10 },
    { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [-10, 0] }, { type: 'point', at: [10, 0] }] },
    { op: 'hole', sketch: 'P', diameter: 6, through: true },
  ] as DocumentOp[]);
  expect(r.failed).toEqual([]);
  return s;
}

const top = { normal: 'z', pick: '+z' } as const;
const bottom = { normal: '-z', pick: '-z' } as const;
const side = { normal: 'x', pick: '+x' } as const;

describe('Measure', () => {
  it('measures two faces: the minimum and maximum distance and the angle', async () => {
    const s = await block();
    const across = Math.hypot(40, 30, 10);
    const ts = await s.measure({ faces: [top, side] });
    expect(ts['Minimum distance']).toBeCloseTo(0, 6);
    expect(ts['Maximum distance']).toBeCloseTo(across, 3);
    expect(ts.Angle).toBeCloseTo(90, 6);
    const tb = await s.measure({ faces: [top, bottom] });
    expect(tb['Minimum distance']).toBeCloseTo(10, 6);
    expect(tb['Maximum distance']).toBeCloseTo(across, 3);
    expect(tb.Angle).toBeCloseTo(0, 6);
  }, 60000);

  it('measures centre to centre: of circular edges and of the axes of cylinders', async () => {
    const s = await block();
    const rims = await s.measure({ edges: [{ type: 'circle', near: [-10, 0, 10] }, { type: 'circle', near: [10, 0, 10] }] });
    expect(rims['Center to center']).toBeCloseTo(20, 6);
    // the rims' nearest points are 14 apart (20 − 2 · 3), their farthest 26
    expect(rims['Minimum distance']).toBeCloseTo(14, 4);
    expect(rims['Maximum distance']).toBeCloseTo(26, 2);
    const bores = await s.measure({ faces: [{ type: 'cylinder', near: [-10, 0, 5] }, { type: 'cylinder', near: [10, 0, 5] }] });
    expect(bores['Center to center']).toBeCloseTo(20, 6);
    expect(bores.Angle).toBeCloseTo(0, 6);
  }, 60000);

  it('measures the angle between an edge and a face, and totals of several', async () => {
    const s = await block();
    const upright = await s.measure({ edges: { type: 'line', dir: 'z', near: [20, 15, 5] }, faces: top });
    expect(upright.Angle).toBeCloseTo(90, 6);
    const flat = await s.measure({ edges: { type: 'line', dir: 'x', near: [0, 15, 10] }, faces: top });
    expect(flat.Angle).toBeCloseTo(0, 6);
    const three = await s.measure({ edges: [{ type: 'line', dir: 'x', near: [0, 15, 10] }, { type: 'line', dir: 'y', near: [20, 0, 10] }, { type: 'line', dir: 'z', near: [20, 15, 5] }] });
    expect(three['Total length']).toBeCloseTo(40 + 30 + 10, 6);
    const two = await s.measure({ faces: [top, side] });
    // (a face's area as the panel shows it: from its mesh, a hair off for the holes' circles)
    expect(two['Total area']).toBeCloseTo(40 * 30 - 2 * Math.PI * 9 + 30 * 10, 0);
  }, 60000);
});
