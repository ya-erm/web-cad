// The feature that made each face (real OpenCascade): trimmed faces keep their feature, new ones get theirs.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { PartStudioTab } from '../core/types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('Face origins', () => {
  it('keeps the block faces of the extrude through a hole and a boss; the hole and boss faces are theirs', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Origins');
    const k = nodeKernel(doc.units);
    const top = { face: { normal: 'z', pick: '+z' } };
    const { studio, report } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'sketch', name: 'Base', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
        { op: 'extrude', name: 'Block', depth: 10 },
        { op: 'sketch', name: 'P', plane: top, shapes: [{ type: 'point', at: [10, 0] }] },
        { op: 'hole', name: 'Drill', sketch: 'P', diameter: 6, through: true },
        { op: 'sketch', name: 'B', plane: top, shapes: [{ type: 'circle', c: [-10, 0], r: 4 }] },
        { op: 'extrude', name: 'Boss', depth: 5, boolean: 'add' },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    const id = (name: string) => studio.features.find((f) => f.name === name)!.id;
    const st = k.builder.current;
    expect(st.parts.size).toBe(1);
    const [part] = [...st.parts.values()];
    const origins = st.faceOrigins.get(part.id)!;
    expect(origins.shape).toBe(part.shape);
    const faces = part.shape.faces;
    expect(origins.faces.length).toBe(faces.length);
    const featureAt = (type: string, z: number, x?: number) => {
      const i = faces.findIndex((f) => {
        if (f.geomType !== type) return false;
        const c = f.center;
        // (a cylinder may come in two halves: their centres off the axis)
        const ok = Math.abs(c.z - z) < 1e-6 && (x === undefined || Math.abs(c.x - x) < 3);
        c.delete();
        return ok;
      });
      expect(i).toBeGreaterThanOrEqual(0);
      return origins.faces[i].feature;
    };
    // the block's top, trimmed by the hole and the boss, and its bottom: the Block extrude
    expect(featureAt('PLANE', 10)).toBe(id('Block'));
    expect(featureAt('PLANE', 0)).toBe(id('Block'));
    // the hole's wall: the hole; the boss's wall and top: the Boss extrude
    expect(featureAt('CYLINDRE', 5, 10)).toBe(id('Drill'));
    expect(featureAt('CYLINDRE', 12.5, -10)).toBe(id('Boss'));
    expect(featureAt('PLANE', 15)).toBe(id('Boss'));
    // and the build sends them with the meshes
    const res = await k.build(studio.features);
    expect(res.parts[0].faceFeatures).toEqual(origins.faces.map((f) => f.feature));
  }, 60000);

  it('gives a fillet its round faces and a part pattern its copies', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Origins 2');
    const k = nodeKernel(doc.units);
    const { studio, report } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
        { op: 'extrude', name: 'Block', depth: 10 },
        { op: 'fillet', name: 'Round', edges: { type: 'line', dir: 'z', near: [20, 15, 5] }, radius: 3 },
        { op: 'linearPattern', name: 'Row', parts: ['Part 1'], direction: 'x', distance: 60, count: 2 },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    const id = (name: string) => studio.features.find((f) => f.name === name)!.id;
    const st = k.builder.current;
    const parts = [...st.parts.values()];
    expect(parts.length).toBe(2);
    const [first, copy] = parts;
    const kinds = (p: (typeof parts)[number]) => {
      const o = st.faceOrigins.get(p.id)!;
      return p.shape.faces.map((f, i) => `${f.geomType} ${o.faces[i].feature}`).sort();
    };
    expect(kinds(first)).toEqual([...Array(6).fill(`PLANE ${id('Block')}`), `CYLINDRE ${id('Round')}`].sort());
    expect(new Set(kinds(copy).map((s) => s.split(' ')[1]))).toEqual(new Set([id('Row')]));
  }, 60000);
});
