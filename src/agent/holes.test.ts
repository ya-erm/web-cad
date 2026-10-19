// Standard (ISO) holes and their cosmetic threads, end to end with the real OpenCascade kernel.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import { ansiHole, isoHole } from '../core/holes';
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

describe('ANSI (inch) hole sizes', () => {
  it('gives UNC / UNF tap drills, ASME B18.2.8 clearance holes, counterbores and 82° countersinks — in mm', () => {
    // 1/4-20 UNC: #7 drill 0.201"; 1/4-28 UNF: #3 0.213"
    expect(ansiHole({ holeType: 'tapped', size: '1/4' })).toMatchObject({ diameter: 5.105, thread: { designation: '1/4-20 UNC', major: 6.35, pitch: 1.27 } });
    expect(ansiHole({ holeType: 'tapped', size: '1/4', pitch: '28' })).toMatchObject({ diameter: 5.41, thread: { designation: '1/4-28 UNF' } });
    // #10: close 0.206", normal 0.221", loose 0.238"; counterbore 3/8" as deep as the normal hole; countersink 0.411"
    expect(ansiHole({ holeType: 'clearance', size: '#10', fit: 'close' })).toMatchObject({ diameter: 5.232 });
    expect(ansiHole({ holeType: 'clearance', size: '#10' })).toMatchObject({ diameter: 5.613, cboreDiameter: 9.525, cboreDepth: 5.613, csinkDiameter: 10.439, csinkAngle: 82 });
    expect(ansiHole({ holeType: 'clearance', size: '#10', fit: 'loose' })).toMatchObject({ diameter: 6.045 });
    // #0 has only the fine thread
    expect(ansiHole({ holeType: 'tapped', size: '#0' })).toMatchObject({ thread: { designation: '#0-80 UNF' } });
    expect(ansiHole({ holeType: 'tapped', size: '1/4', pitch: '32' })).toBe('1/4 has no 32 threads per inch');
    // sizes the tables do not give: said so, not guessed
    expect(ansiHole({ holeType: 'clearance', size: '#12' })).toMatch(/No clearance hole size for #12/);
    expect(ansiHole({ holeType: 'clearance', size: '#5', style: 'countersink' })).toMatch(/No countersink size for #5/);
    expect(ansiHole({ holeType: 'tapped', size: 'M6' })).toBe('Unknown ANSI size "M6"');
  });

  it('drills a tapped inch hole with its thread through the agent', async () => {
    const s = await openHeadless(emptyDocument('ANSI holes'), wasm);
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 40 }] },
      { op: 'extrude', depth: 20 },
      { op: 'sketch', name: 'Pts', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [0, 0] }] },
      { op: 'hole', sketch: 'Pts', ansi: { size: '1/4', type: 'tapped' } },
    ] as never);
    expect(r.failed).toEqual([]);
    const m = r.model as ModelSummary;
    // a blind tap drill hole: 2 d of thread (12.7 mm), drilled 3 pitches deeper; a cone at its tip
    expect(m.threads?.[0]).toMatchObject({ designation: '1/4-20 UNC' });
    expect(m.parts[0].volume!).toBeLessThan(40 * 40 * 20 - Math.PI * (5.105 / 2) ** 2 * 12.7);
    const bad = await s.run([{ op: 'hole', sketch: 'Pts', ansi: { size: '#12' } }] as never);
    expect(bad.error).toMatch(/No clearance hole size for #12/);
  }, 60000);
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

describe('Counterbore and countersink together (counterdrill)', () => {
  it('cuts a countersink at the counterbore mouth, custom and ISO', async () => {
    const s = await openHeadless(emptyDocument('Counterdrill'), wasm);
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 60, h: 40 }] },
      { op: 'extrude', depth: 10 },
      { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [-15, 0] }] },
      { op: 'hole', sketch: 'P', diameter: 6, through: true, style: 'counterdrill', cboreDiameter: 11, cboreDepth: 6, csinkDiameter: 13, csinkAngle: 90 },
    ]);
    expect(r.failed).toEqual([]);
    // a 1 mm tall 90° cone from ⌀13 to ⌀11, the counterbore on to 6 mm, the ⌀6 hole through the rest
    const cone = (Math.PI / 3) * (6.5 ** 2 + 6.5 * 5.5 + 5.5 ** 2);
    const removed = cone + Math.PI * 5.5 ** 2 * 5 + Math.PI * 9 * 4;
    expect(r.model!.parts[0].volume!).toBeCloseTo(60 * 40 * 10 - removed, 2);
    // ISO M6: the counterbore of ISO 4762 with a 0.5 mm × 45° chamfer at its mouth
    const iso = await s.run([
      { op: 'sketch', name: 'Q', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [15, 0] }] },
      { op: 'hole', sketch: 'Q', through: true, style: 'counterdrill', iso: { size: 'M6' } },
    ]);
    expect(iso.failed).toEqual([]);
    const isoCone = (Math.PI / 3) * 0.5 * (6 ** 2 + 6 * 5.5 + 5.5 ** 2);
    const isoRemoved = isoCone + Math.PI * 5.5 ** 2 * 6.1 + Math.PI * 3.3 ** 2 * 3.4;
    expect(r.model!.parts[0].volume! - iso.model!.parts[0].volume!).toBeCloseTo(isoRemoved, 2);
    // the countersink too big for the counterbore: an error
    const bad = await s.run([{ op: 'hole', sketch: 'Q', through: true, style: 'counterdrill', cboreDiameter: 11, cboreDepth: 1, csinkDiameter: 16 }]);
    expect(bad.failed[0]?.error).toMatch(/countersink must end above the counterbore floor/);
  }, 60000);
});

describe('Countersink sunk in a recess', () => {
  it('goes straight down the recess, then the cone, then the hole', async () => {
    const s = await openHeadless(emptyDocument('Recess'), wasm);
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 40 }] },
      { op: 'extrude', depth: 20 },
      { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [0, 0] }] },
      { op: 'hole', sketch: 'P', diameter: 6, through: true, style: 'countersink', csinkDiameter: 12, csinkAngle: 90, csinkRecess: 4 },
    ]);
    expect(r.failed).toEqual([]);
    // ⌀12 × 4 recess, a 90° cone 3 tall from ⌀12 to ⌀6, the ⌀6 hole through the 13 left
    const cone = (Math.PI / 3) * 3 * (36 + 18 + 9);
    const removed = Math.PI * 36 * 4 + cone + Math.PI * 9 * 13;
    expect(r.model!.parts[0].volume!).toBeCloseTo(40 * 40 * 20 - removed, 2);
  }, 60000);
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
