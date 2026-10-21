// Comparing a model with its version by geometry (real OpenCascade): a taller block — its top and sides changed, its
// bottom the same; a hole added — its wall new; a fillet gone — its face removed.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { PartStudioTab } from '../core/types';
import { diffFaces } from './compareModel';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('compare a model with its version', () => {
  it('finds the faces changed, added and removed by their geometry', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Compare');
    const k = nodeKernel(doc.units);
    const { studio: v1 } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'variable', name: 'h', value: 10 },
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 20 }] },
        { op: 'extrude', depth: '#h' },
        { op: 'fillet', edges: { parallel: 'z' }, radius: 2 },
      ] as never,
      k,
    );
    const req = (s: PartStudioTab) => ({ type: 'build' as const, reqId: 1, units: doc.units, features: s.features, partMeta: {}, upTo: s.features.length });
    const before = (await k.builder.build(req(v1))).parts;
    // now: taller (h 10 → 15), a blind hole from the top
    const now = structuredClone(v1);
    (now.features[0] as { params: { value: string } }).params.value = '15';
    const { studio: withHole } = await runOps(
      now,
      doc.units,
      [
        { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [10, 0] }] },
        { op: 'hole', sketch: 'P', diameter: 5, depth: 6 },
      ] as never,
      k,
    );
    const current = (await k.builder.build(req(withHole))).parts;
    const d = diffFaces(current, before);
    // the faces of a part: low (by the bottom: as they were) and high (taller now, or the hole)
    const split = (p: (typeof current)[number]) => ({
      low: p.faces.flatMap((f, i) => (f.center[2] < 2 ? [i] : [])),
      high: p.faces.flatMap((f, i) => (f.center[2] >= 2 ? [i] : [])),
    });
    const cur = split(current[0]);
    const was = split(before[0]);
    expect(cur.low.length).toBeGreaterThan(3);
    // the bottom and its rounded edges and corners: the same
    for (const i of cur.low) expect(d.changed[current[0].id]).not.toContain(i);
    for (const i of was.low) expect(d.removed[before[0].id]).not.toContain(i);
    // everything higher: changed now (the hole's wall and tip among them), gone from the version
    expect([...d.changed[current[0].id]].sort((a, b) => a - b)).toEqual(cur.high);
    expect([...d.removed[before[0].id]].sort((a, b) => a - b)).toEqual(was.high);
    expect(current[0].faces.filter((f, i) => d.changed[current[0].id].includes(i) && f.type === 'CONE').length).toBe(1);
    // the same model: nothing
    expect(diffFaces(before, before)).toEqual({ changed: {}, removed: {} });
  }, 60000);
});
