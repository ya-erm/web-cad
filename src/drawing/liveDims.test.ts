// Drawing dimensions that follow the model: their points anchored to model vertices and circles (real OpenCascade).

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { PartStudioTab } from '../core/types';
import { VIEW_AXES } from '../core/drawingViews';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('Anchored drawing dimensions', () => {
  it('finds the vertex and the circle behind view points, and where they are after the model changes', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Live dimensions');
    const studio = doc.tabs[0] as PartStudioTab;
    const k = nodeKernel(doc.units);
    // a 40 × 30 block, #h high, a through hole ⌀10 at (10, 0)
    const { report, studio: built } = await runOps(
      studio,
      doc.units,
      [
        { op: 'variable', name: 'h', value: 20 },
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
        { op: 'extrude', depth: '#h' },
        { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [10, 0] }] },
        { op: 'hole', sketch: 'P', diameter: 10, through: true },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    // the Front view: x → X, y → Z; its top right corner (20, 20)
    const front = VIEW_AXES.front;
    const corner = k.builder.viewAnchor([], front, [20, 20]);
    expect(corner?.kind).toBe('vertex');
    // nothing there
    expect(k.builder.viewAnchor([], front, [5, 5])).toBeNull();
    // the Top view: the hole's circle seen end-on at (10, 0), ⌀10
    const top = VIEW_AXES.top;
    const hole = k.builder.viewAnchor([], top, [10, 0], { r: 5 });
    expect(hole?.kind).toBe('edge');
    // the block taller: the corner goes up with it, the hole stays
    const taller = await runOps(built, doc.units, [{ op: 'setVariable', name: 'h', value: 35 }] as never, k);
    expect(taller.report.failed).toEqual([]);
    const [c] = k.builder.viewRefs(front, [corner!]);
    expect(c?.p[0]).toBeCloseTo(20, 6);
    expect(c?.p[1]).toBeCloseTo(35, 6);
    const [h] = k.builder.viewRefs(top, [hole!]);
    expect(h?.p[0]).toBeCloseTo(10, 6);
    expect(h?.r).toBeCloseTo(5, 6);
  }, 60000);
});
