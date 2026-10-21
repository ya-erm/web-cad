// Mesh keys: a part not changed by a build keeps its key (the graphics keep its buffers), a changed one gets
// another; an assembly instance's key depends on where it stands (real OpenCascade).

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { PartStudioTab } from '../core/types';
import { placeMesh, placementOf } from '../assembly/compose';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('mesh keys', () => {
  it('stay while a part is unchanged, change with it', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Keys');
    const k = nodeKernel(doc.units);
    // two separate blocks
    const { report, studio } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 10, h: 10 }] },
        { op: 'extrude', name: 'A', depth: 5 },
        { op: 'sketch', name: 'S2', shapes: [{ type: 'rect', x: 30, y: 0, w: 10, h: 10, center: true }] },
        { op: 'extrude', name: 'B', sketch: 'S2', depth: 5, newPart: true },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    const req = (s: PartStudioTab) => ({ type: 'build' as const, reqId: 1, units: doc.units, features: s.features, partMeta: {}, upTo: s.features.length });
    const first = await k.builder.build(req(studio));
    expect(first.parts.length).toBe(2);
    const keys = new Map(first.parts.map((p) => [p.id, p.meshKey]));
    // the same again: the same keys
    const again = await k.builder.build(req(studio));
    for (const p of again.parts) expect(p.meshKey).toBe(keys.get(p.id));
    // block B taller: only its key changes
    const edited = structuredClone(studio);
    const b = edited.features.find((f) => f.name === 'B') as { params: { depth: string } };
    b.params.depth = '8 mm';
    const after = await k.builder.build(req(edited));
    const changed = after.parts.filter((p) => p.meshKey !== keys.get(p.id)).map((p) => p.id);
    expect(changed.length).toBe(1);
    expect(after.parts.find((p) => p.id === changed[0])!.bbox[1][2]).toBeCloseTo(8, 6);
    // an assembly instance: the key with where it stands
    const part = after.parts[0];
    const at = (x: number) => placeMesh(part, placementOf({ position: [x, 0, 0], rotation: [0, 0, 0] }), 'i1', 'Part <1>').meshKey;
    expect(at(10)).toBe(at(10));
    expect(at(10)).not.toBe(at(20));
    expect(at(10)).not.toBe(part.meshKey);
  }, 60000);
});
