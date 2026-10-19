// Standard (ISO) holes and their cosmetic threads, end to end with the real OpenCascade kernel.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import { isoHole } from '../core/holes';
import { threadLines, VIEW_AXES } from '../kernel/build';
import type { ModelSummary } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

describe('ISO hole sizes', () => {
  it('gives tap drills, clearance holes, counterbores and countersinks', () => {
    expect(isoHole({ holeType: 'tapped', size: 'M6' })).toMatchObject({ diameter: 5, thread: { designation: 'M6', major: 6, pitch: 1 } });
    // a fine pitch: major − pitch
    expect(isoHole({ holeType: 'tapped', size: 'M8', pitch: '1' })).toMatchObject({ diameter: 7, thread: { designation: 'M8×1', pitch: 1 } });
    expect(isoHole({ holeType: 'clearance', size: 'M6' })).toMatchObject({ diameter: 6.6, cboreDiameter: 11, cboreDepth: 6.6, csinkAngle: 90 });
    expect(isoHole({ holeType: 'clearance', size: 'M6', fit: 'close' })).toMatchObject({ diameter: 6.4 });
    expect(isoHole({ holeType: 'clearance', size: 'M10', fit: 'loose' })).toMatchObject({ diameter: 12, cboreDiameter: 18 });
    expect(isoHole({ holeType: 'tapped', size: 'M6', pitch: '0.5' })).toBe('M6 has no 0.5 mm pitch');
    expect(isoHole({ holeType: 'tapped', size: 'M7' })).toBe('Unknown ISO size "M7"');
  });
});

describe('Cosmetic threads in drawings', () => {
  const thread = { origin: [0, 0, 20] as [number, number, number], dir: [0, 0, -1] as [number, number, number], major: 6, length: 12 };
  it('end-on from the hole mouth: a thin three-quarter circle of the major diameter', () => {
    const [arc, ...rest] = threadLines([thread], VIEW_AXES.top.n, VIEW_AXES.top.x, true);
    expect(rest).toEqual([]);
    expect(arc).toMatchObject({ hidden: false, thin: true });
    for (const p of arc.pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(3, 6);
    // open at the upper right: nothing there
    expect(arc.pts.some((p) => p[0] > 0.5 && p[1] > 0.5)).toBe(false);
    expect(arc.pts.length).toBeGreaterThan(50);
  });
  it('from the side: hidden thin lines along the thread and across its end; from below — nothing', () => {
    const lines = threadLines([thread], VIEW_AXES.front.n, VIEW_AXES.front.x, true);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.hidden && l.thin)).toBe(true);
    expect(lines.map((l) => l.pts)).toContainEqual([
      [3, 20],
      [3, 8],
    ]);
    expect(threadLines([thread], VIEW_AXES.front.n, VIEW_AXES.front.x, false)).toEqual([]);
    expect(threadLines([thread], VIEW_AXES.bottom.n, VIEW_AXES.bottom.x, true)).toEqual([]);
  });
});

describe('Standard holes', () => {
  it('drills tapped and clearance holes by ISO, with cosmetic threads that follow patterns and moves', async () => {
    const s = await openHeadless(emptyDocument('ISO holes'), wasm);
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 60, h: 40 }] },
      { op: 'extrude', depth: 20 },
      { op: 'sketch', name: 'Tapped', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [-20, 0] }] },
      { op: 'hole', sketch: 'Tapped', iso: { size: 'M6', type: 'tapped' } },
      { op: 'sketch', name: 'Through', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [0, 0] }] },
      { op: 'hole', sketch: 'Through', through: true, style: 'counterbore', iso: { size: 'm8', type: 'tapped', pitch: 1 } },
      { op: 'sketch', name: 'Clear', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [20, 0] }] },
      { op: 'hole', sketch: 'Clear', through: true, iso: { size: 'M6' } },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.failed).toEqual([]);
    const m = r.model!;
    // a blind M6: the 5 mm tap drill 15 deep (2 d + 3 P) with a 118° tip, threaded 12 deep from the top face;
    // a through M8×1 under an ISO 4762 counterbore (Ø15 × 8.6): threaded from the counterbore's floor to the bottom;
    // a through Ø6.6 clearance hole: no thread
    expect(m.threads).toEqual([
      { designation: 'M6', origin: [-20, 0, 20], dir: [0, 0, -1], length: 12, part: 'Part 1' },
      { designation: 'M8×1', origin: [0, 0, 11.4], dir: [0, 0, -1], length: 11.4, part: 'Part 1' },
    ]);
    const tip = (Math.PI * 2.5 ** 2 * (2.5 / Math.tan((59 * Math.PI) / 180))) / 3;
    const removed = Math.PI * 2.5 ** 2 * 15 + tip + Math.PI * 7.5 ** 2 * 8.6 + Math.PI * 3.5 ** 2 * 11.4 + Math.PI * 3.3 ** 2 * 20;
    expect(m.parts[0].volume!).toBeCloseTo(60 * 40 * 20 - removed, 1);
    // a pattern of the tapped hole: its thread comes along; a moved part takes its threads with it
    const r2 = await s.run([
      { op: 'linearPattern', features: ['Hole 1'], direction: 'y', distance: 12, count: 2 },
      { op: 'feature', type: 'transform', params: { parts: { $parts: 'all' }, mode: 'translateXYZ', dx: '0 mm', dy: '0 mm', dz: '5 mm' } },
    ]);
    expect(r2.error).toBeUndefined();
    expect(r2.failed).toEqual([]);
    expect(r2.model!.threads!.map((t) => [t.designation, t.origin])).toEqual([
      ['M6', [-20, 0, 25]],
      ['M8×1', [0, 0, 16.4]],
      ['M6', [-20, 12, 25]],
    ]);
    const bad = await s.run([{ op: 'hole', sketch: 'Clear', iso: { size: 'M6', type: 'tapped', pitch: 0.5 } }]);
    expect(bad.error).toMatch(/M6 has no 0.5 mm pitch/);
  }, 90000);
});
