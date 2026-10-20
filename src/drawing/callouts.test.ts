// Hole callouts of drawings: the holes the kernel sees end-on in a view (real OpenCascade) and the callout's lines.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { PartStudioTab } from '../core/types';
import type { ProjectedHole } from '../kernel/protocol';
import { calloutLines, calloutText, dimPrims, dimText, scaleLabel, sheetNumber, type ProjectionData } from './sheet';
import { t } from '../i18n';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
const en = (k: string) => k;

describe('Hole callout lines', () => {
  const hole = (callout: ProjectedHole['callout'], count = 1): ProjectedHole => ({ c: [0, 0], r: 1, callout, count });

  it('writes a blind tapped hole, a counterbore, a countersink, a through hole', () => {
    expect(calloutText(calloutLines(hole({ diameter: 6.8, depth: 20, thread: { designation: 'M8', depth: 16 } }), 1, en))).toBe('M8 ↧16\nØ6.8 ↧20');
    expect(calloutText(calloutLines(hole({ diameter: 9, cbore: { diameter: 15, depth: 8.6 } }, 4), 1, en))).toBe('4× Ø9 THRU\n⌴ Ø15 ↧8.6');
    expect(calloutText(calloutLines(hole({ diameter: 6.6, csink: { diameter: 13, angle: 90 } }), 1, en))).toBe('Ø6.6 THRU\n⌵ Ø13 × 90°');
    // in inches
    expect(calloutText(calloutLines(hole({ diameter: 25.4, depth: 12.7 }), 25.4, en))).toBe('Ø1 ↧0.5');
  });

  it('writes the decimal comma when the drawing asks for it (ГОСТ 2.307), in callouts, dimensions and scales', () => {
    expect(calloutText(calloutLines(hole({ diameter: 6.8, depth: 20, thread: { designation: 'M8', depth: 16 } }), 1, t, true))).toBe('M8 ↧16\nØ6,8 ↧20');
    expect(calloutText(calloutLines(hole({ diameter: 9, cbore: { diameter: 15, depth: 8.6 } }, 4), 1, t, true))).toBe('4× Ø9 насквозь\n⌴ Ø15 ↧8,6');
    // the language does not choose it: Russian words, the point
    expect(calloutText(calloutLines(hole({ diameter: 6.8, depth: 20 }), 1, t))).toBe('Ø6.8 ↧20');
    const d = { id: 'd', viewId: 'v', kind: 'diameter' as const, a: [0, 0] as [number, number], b: [3.25, 0] as [number, number], offset: 0 };
    expect(dimText(d, 1, true)).toBe('Ø6,5');
    expect(dimText(d, 1)).toBe('Ø6.5');
    expect(scaleLabel(1 / 2.5, true)).toBe('1:2,5');
    expect(scaleLabel(2.5)).toBe('2.5:1');
    expect(sheetNumber(12, 2, true)).toBe('12');
  });

  it('draws the symbols as lines (no font has them all)', () => {
    const bored = { ...hole({ diameter: 9, depth: 10, cbore: { diameter: 15, depth: 5 } }), r: 7.5 };
    const proj: ProjectionData = { type: 'projection', reqId: 0, key: 'k', edges: [], bounds: [[-10, -10], [10, 10]], holes: [bored] };
    const view = { id: 'v', studioId: 's', partIds: [], orientation: 'top' as const, x: 100, y: 100, scale: 1, showHidden: false };
    const prims = dimPrims({ id: 'd', viewId: 'v', kind: 'hole', a: [0, 0], offset: 0, textPos: [120, 120] }, view, proj, 1, en);
    const texts = prims.filter((p) => p.t === 'text').map((p) => (p.t === 'text' ? p.text : ''));
    expect(texts.join('|')).toBe('Ø9|10|Ø15|5');
    expect(texts.join('')).not.toMatch(/[↧⌴⌵]/);
    // the leader's arrow on the counterbore's circle (radius 7.5)
    const arrow = prims.find((p) => p.t === 'arrow');
    if (arrow?.t !== 'arrow') throw new Error('an arrow');
    expect(Math.hypot(arrow.tip[0] - 100, arrow.tip[1] - 100)).toBeCloseTo(7.5, 9);
  });
});

describe('Holes in projections (OpenCascade)', () => {
  it('sees the Hole features end-on with their sizes, counted by feature', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Callouts');
    const k = nodeKernel(doc.units);
    const top = { face: { normal: 'z', pick: '+z' } };
    const { report } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 80, h: 40 }] },
        { op: 'extrude', depth: 25 },
        { op: 'sketch', name: 'T', plane: top, shapes: [{ type: 'point', at: [-25, 0] }] },
        { op: 'hole', name: 'Tapped', sketch: 'T', iso: { size: 'M8', type: 'tapped', tapDepth: 16 }, depth: 20 },
        { op: 'sketch', name: 'C', plane: top, shapes: [{ type: 'point', at: [5, 0] }] },
        { op: 'hole', name: 'Bored', sketch: 'C', diameter: 9, through: true, style: 'counterbore', cboreDiameter: 15, cboreDepth: 8.6 },
        { op: 'linearPattern', features: ['Bored'], direction: 'x', distance: 20, count: 2 },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    const top2 = k.builder.projection([], 'top', false);
    const holes = (top2.holes ?? []).map((h) => ({ c: h.c.map((v) => Math.round(v * 1e6) / 1e6 + 0), text: calloutText(calloutLines(h, 1, en)) }));
    expect(holes.sort((a, b) => a.c[0] - b.c[0])).toEqual([
      { c: [-25, 0], text: 'M8 ↧16\nØ6.8 ↧20' },
      { c: [5, 0], text: '2× Ø9 THRU\n⌴ Ø15 ↧8.6' },
      { c: [25, 0], text: '2× Ø9 THRU\n⌴ Ø15 ↧8.6' },
    ]);
    // seen from the side: none
    expect(k.builder.projection([], 'front', false).holes).toBeUndefined();
  }, 60000);
});
