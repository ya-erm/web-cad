// A helix picked in the graphics area is referenced like a sketch curve
// ({ kind: 'sketchEntity', sketchId: <helix feature>, entityId: 'curve' }) — e.g. a sweep path.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { produce } from 'immer';
import { StudioBuilder } from './build';
import type { Feature, SketchData } from '../core/types';
import { defaultParams } from '../core/features';
import { addCircle } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

beforeAll(async () => {
  const oc = await opencascade({ locateFile: () => wasm } as never);
  setOC(oc);
}, 60000);

const units = { length: 'mm' as const, angle: 'deg' as const };

async function build(features: Feature[]) {
  const b = new StudioBuilder();
  return b.build({ type: 'build', reqId: 1, units, features, partMeta: {}, upTo: features.length });
}

describe('helix', () => {
  it('serves as a sweep path (a spring)', async () => {
    const helix: Feature = {
      id: 'h1',
      type: 'helix',
      name: 'Helix 1',
      params: { ...defaultParams('helix'), axis: [{ kind: 'plane', planeId: 'top' }], radius: '10 mm', pitch: '5 mm', turns: '3' },
    };
    const r0 = await build([helix]);
    expect(r0.statuses.h1).toEqual({ ok: true });
    const pts = r0.curves[0].points;
    const start = [pts[0], pts[1], pts[2]];
    // the wire starts on the Front plane (y = 0): put the round profile there
    expect(start[1]).toBeCloseTo(0, 6);
    const s1: Feature = {
      id: 's1',
      type: 'sketch',
      name: 'Profile',
      params: produce({ plane: { kind: 'std', name: 'front' }, entities: [], constraints: [] } as SketchData, (d) => {
        addCircle(d, [start[0], start[2]], 1);
      }),
    };
    const regions = computeRegions((s1.params as SketchData).entities).map((r) => ({ kind: 'region' as const, sketchId: 's1', key: r.key }));
    const sweep: Feature = {
      id: 'sw',
      type: 'sweep',
      name: 'Spring',
      params: { ...defaultParams('sweep'), profiles: regions, path: [{ kind: 'sketchEntity', sketchId: 'h1', entityId: 'curve' }] },
    };
    const r = await build([helix, s1, sweep]);
    expect(r.statuses.sw).toEqual({ ok: true });
    expect(r.parts.length).toBe(1);
    const [lo, hi] = r.parts[0].bbox;
    // 3 turns of pitch 5 around a radius of 10, wire thickness 2
    expect(hi[2] - lo[2]).toBeGreaterThan(14);
    expect(hi[0] - lo[0]).toBeCloseTo(22, 0);
  }, 60000);
});
