// Projected (Use) geometry follows its source when the sketch is opened again (real OpenCascade): the document keeps
// the coordinates of the moment it was projected, the rebuild re-projects — editing starts from the rebuild's.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { FeatureOf, PartStudioTab, SkEntity } from '../core/types';
import { solveSketch } from './solver';
import { withBuiltUse } from './useGeometry';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** The x extent of a sketch's points. */
const xs = (ents: SkEntity[]) => {
  const p = ents.filter((e) => e.type === 'point') as { x: number }[];
  return [Math.min(...p.map((e) => e.x)), Math.max(...p.map((e) => e.x))].map((v) => Math.round(v * 1e6) / 1e6);
};

describe('projected (Use) geometry in a sketch opened again', () => {
  it('is where its source is now, with the fixations holding it there', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Use');
    const k = nodeKernel(doc.units);
    const { studio } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'variable', name: 'w', value: 40 },
        { op: 'sketch', name: 'Base', shapes: [{ type: 'rect', center: true, w: '#w', h: 30 }] },
        { op: 'extrude', sketch: 'Base', depth: 10 },
        // the top face's rim projected onto it
        { op: 'sketch', name: 'Proj', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [], use: { z: 10 } },
      ] as never,
      k,
    );
    const build = async (s: PartStudioTab) => (await k.builder.build({ type: 'build', reqId: 1, units: doc.units, features: s.features, partMeta: {}, upTo: s.features.length })).sketches;
    const proj = studio.features.find((f) => f.name === 'Proj') as FeatureOf<'sketch'>;
    expect(proj.params.entities.filter((e) => e.use).length).toBe(4);
    // as it is: nothing to bring up to date
    const same = (await build(studio)).find((s) => s.featureId === proj.id)!;
    expect(withBuiltUse(proj.params, same.entities)).toBe(proj.params);
    // the block wider (w 40 → 60): the rebuild re-projects, the document still has the old rim
    const wider = structuredClone(studio);
    (wider.features[0] as FeatureOf<'variable'>).params.value = '60';
    const built = (await build(wider)).find((s) => s.featureId === proj.id)!;
    expect(xs(built.entities)).toEqual([-30, 30]);
    expect(xs(proj.params.entities)).toEqual([-20, 20]);
    // opened again: the rim where the block is now, and solving keeps it there (its fixations hold the new values)
    const fresh = withBuiltUse(proj.params, built.entities);
    expect(xs(fresh.entities)).toEqual([-30, 30]);
    expect(xs(solveSketch(fresh.entities, fresh.constraints, {}).entities)).toEqual([-30, 30]);
    // (with the old fixations the rim would be pulled back to where it was projected)
    expect(xs(solveSketch(fresh.entities, proj.params.constraints, {}).entities)).toEqual([-20, 20]);
  }, 60000);
});
