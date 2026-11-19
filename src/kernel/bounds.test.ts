import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { bboxOf, broadBoxOf, rotated, shapesTouch, type Shape3D } from './geom';
import { applyFeature } from './features';
import { emptyState, setPart } from './state';
import { defaultParams } from '../core/features';
import type { Feature, SketchData } from '../core/types';
import { addCircle, addLine } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';

beforeAll(async () => {
  const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  R.setOC(await opencascade({ locateFile: () => wasm } as never));
}, 60000);

const ec = { vars: {}, lengthUnit: 'mm' as const, angleUnit: 'deg' as const };

describe('conservative build bounds', () => {
  it('encloses curved and rotated solids without replacing their exact measurement bounds', () => {
    const solid = rotated(R.makeCylinder(6, 15, [100, 200, 300], [0, 0, 1]), 37, [0, 0, 0], [1, 1, 0]);
    const broad = broadBoxOf(solid);
    const exact = bboxOf(solid);
    for (let k = 0; k < 3; k++) {
      expect(broad[0][k]).toBeLessThanOrEqual(exact[0][k] + 1e-7);
      expect(broad[1][k]).toBeGreaterThanOrEqual(exact[1][k] - 1e-7);
    }
    const cylinder = R.makeCylinder(6, 15, [100, 200, 300], [0, 0, 1]);
    broadBoxOf(cylinder);
    const measured = bboxOf(cylinder);
    expect(measured[0][0]).toBeCloseTo(94, 7);
    expect(measured[1][2]).toBeCloseTo(315, 7);
    const bounds = broadBoxOf(cylinder);
    bounds[0][0] = -999;
    expect(broadBoxOf(cylinder)[0][0]).toBeCloseTo(94, 7);
  });

  it('still checks exact distance for overlapping boxes and preserves the contact tolerance', () => {
    const a = R.makeCylinder(1, 10);
    expect(shapesTouch(a, R.makeCylinder(1, 10, [1.5, 1.5, 0]))).toBe(false);
    expect(shapesTouch(a, R.makeCylinder(1, 10, [1.5, 0, 0]))).toBe(true);
    expect(shapesTouch(a, R.makeCylinder(1, 10, [2, 0, 0]))).toBe(true);
    expect(shapesTouch(a, R.makeCylinder(1, 10, [2.000005, 0, 0]))).toBe(true);
    expect(shapesTouch(a, R.makeCylinder(1, 10, [20, 0, 0]))).toBe(false);
  });

  it('cuts through all distant parts in both directions from the sketch', async () => {
    const st = emptyState();
    for (const z of [-700, 500]) setPart(st, `box${z}`, R.makeBox([-10, -10, z], [10, 10, z + 40]) as Shape3D);
    const data: SketchData = { ...defaultParams('sketch'), entities: [], constraints: [] };
    addCircle(data, [0, 0], 3);
    await applyFeature(st, { id: 's', type: 'sketch', name: 'Hole', params: data }, ec);
    const cut: Feature = {
      id: 'cut', type: 'extrude', name: 'Through both',
      params: { ...defaultParams('extrude'), op: 'remove', profiles: computeRegions(data.entities).map((r) => ({ kind: 'region', sketchId: 's', key: r.key })), endType: 'throughAll', secondEnd: true, endType2: 'throughAll' },
    };
    await applyFeature(st, cut, ec);
    expect(st.parts.size).toBe(2);
    for (const p of st.parts.values()) {
      const props = R.measureShapeVolumeProperties(p.shape);
      expect(props.volume).toBeCloseTo((400 - Math.PI * 9) * 40, 5);
      props.delete();
    }
  });

  it('extends a surface through the entire distant scene in both directions', async () => {
    const st = emptyState();
    for (const z of [-700, 500]) setPart(st, `box${z}`, R.makeBox([-10, -10, z], [10, 10, z + 40]) as Shape3D);
    const data: SketchData = { ...defaultParams('sketch'), entities: [], constraints: [] };
    const line = addLine(data, [-2, 0], [2, 0]);
    await applyFeature(st, { id: 's', type: 'sketch', name: 'Line', params: data }, ec);
    await applyFeature(st, {
      id: 'surface', type: 'extrude', name: 'Through surface',
      params: { ...defaultParams('extrude'), bodyType: 'surface', curves: [{ kind: 'sketchEntity', sketchId: 's', entityId: line.id }], endType: 'throughAll', secondEnd: true, endType2: 'throughAll' },
    }, ec);
    const [id] = st.surfaceOrder;
    expect(id).toBeDefined();
    const bounds = bboxOf(st.parts.get(id)!.shape);
    expect(bounds[0][2]).toBeLessThan(-700);
    expect(bounds[1][2]).toBeGreaterThan(540);
  });
});
