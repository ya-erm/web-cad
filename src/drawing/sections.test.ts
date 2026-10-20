// Section and detail views of drawings: the axes a section is seen along, the cut faces from the real OpenCascade
// kernel, their hatching, a detail view cut to its circle, the letters.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { DocumentOp } from '../agent/document';
import type { DrawingView, PartStudioTab, Vec2, Vec3 } from '../core/types';
import { nextViewLetter, sectionCut, sectionPlane, stepPoint, VIEW_AXES, viewAxes } from '../core/drawingViews';
import { threadLines } from '../kernel/build';
import { clipPolyline, clipToCircle, hatchLines, viewPrims, type ProjectionData } from './sheet';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));

const view = (v: Partial<DrawingView>): DrawingView => ({ id: 'v', studioId: 's', partIds: [], orientation: 'front', x: 100, y: 100, scale: 1, showHidden: false, ...v });

describe('Section view axes', () => {
  it('turns the parent about the cutting line: the standard views come out', () => {
    // Front, a vertical line looked along to the left (−X): seen from the right
    const right = sectionPlane(VIEW_AXES.front, { a: [10, -50], b: [10, 50], side: 1 });
    near(right.axes.n, VIEW_AXES.right.n);
    near(right.axes.x, VIEW_AXES.right.x);
    // a point of the line: its start
    near(right.origin, [10, 0, -50]);
    // Front, a horizontal line looked along downwards: seen from the top
    const top = sectionPlane(VIEW_AXES.front, { a: [-50, 5], b: [50, 5], side: -1 });
    near(top.axes.n, VIEW_AXES.top.n);
    near(top.axes.x, VIEW_AXES.top.x);
    near(top.origin, [-50, 0, 5]);
  });

  it('a detail view is seen as its parent; a section of a section turns again', () => {
    const front = view({ id: 'f' });
    const sec = view({ id: 's1', parent: 'f', section: { a: [0, -10], b: [0, 10], side: 1, letter: 'A' } });
    const det = view({ id: 'd1', parent: 's1', detail: { c: [0, 0], r: 5, letter: 'B' } });
    const views = [front, sec, det];
    near(viewAxes(sec, views).n, VIEW_AXES.right.n);
    expect(viewAxes(det, views)).toEqual(viewAxes(sec, views));
    // the parent gone: as its own orientation
    expect(viewAxes(det, [det])).toEqual(VIEW_AXES.front);
  });

  it('gives the letters in order, skipping the ones standards leave out', () => {
    const used = (letters: string[]) => letters.map((l, i) => view({ id: `v${i}`, section: { a: [0, 0], b: [1, 0], side: 1, letter: l } }));
    expect(nextViewLetter([], 'ru')).toBe('А');
    expect(nextViewLetter(used(['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж']), 'ru')).toBe('И');
    expect(nextViewLetter(used(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), 'en')).toBe('J');
  });
});

describe('Hatching and clipping', () => {
  it('hatches a square with a hole at 45°, nothing in the hole', () => {
    const sq = (c: Vec2, h: number): Vec2[] => [[c[0] - h, c[1] - h], [c[0] + h, c[1] - h], [c[0] + h, c[1] + h], [c[0] - h, c[1] + h], [c[0] - h, c[1] - h]];
    const lines = hatchLines([sq([0, 0], 10), sq([0, 0], 4)], 45, 2);
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) {
      if (l.t !== 'line') throw new Error('a line');
      expect(Math.abs(l.b[1] - l.a[1])).toBeCloseTo(Math.abs(l.b[0] - l.a[0]), 9);
      const mid: Vec2 = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2];
      expect(Math.max(Math.abs(mid[0]), Math.abs(mid[1]))).toBeGreaterThan(4 - 1e-9);
      for (const p of [l.a, l.b]) expect(Math.max(Math.abs(p[0]), Math.abs(p[1]))).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('clips polylines and drops what lies outside a circle', () => {
    expect(clipPolyline([[-20, 0], [20, 0]], [0, 0], 5)).toEqual([[[-5, 0], [5, 0]]]);
    expect(clipPolyline([[-20, 10], [20, 10]], [0, 0], 5)).toEqual([]);
    const pieces = clipPolyline([[-20, 0], [0, 0], [0, 20], [3, 0], [20, 0]], [0, 0], 5);
    expect(pieces.length).toBe(2);
    const prims = clipToCircle([{ t: 'circle', c: [0, 0], r: 3, style: 'visible' }, { t: 'circle', c: [4, 0], r: 3, style: 'visible' }, { t: 'text', p: [9, 9], text: 'x', h: 2 }], [0, 0], 5);
    expect(prims.length).toBe(1);
  });
});

describe('Section views of a model (OpenCascade)', () => {
  it('cuts the parts along the plane and returns the cut faces, hatched on the sheet', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Sections');
    const studio = doc.tabs[0] as PartStudioTab;
    const k = nodeKernel(doc.units);
    // a 40 × 30 × 10 block, through holes ⌀6 at x = ±10
    const { report } = await runOps(studio, doc.units, [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 10 },
      { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [-10, 0] }, { type: 'point', at: [10, 0] }] },
      { op: 'hole', sketch: 'P', diameter: 6, through: true },
    ] as DocumentOp[] as never, k);
    expect(report.failed).toEqual([]);
    // on the Front view a vertical line through the hole at x = 10, looking to −X (the right side's material removed)
    const { axes, origin } = sectionPlane(VIEW_AXES.front, { a: [10, -20], b: [10, 20], side: 1 });
    const res = k.builder.projection([], 'front', false, { axes, section: { origin, normal: axes.n } });
    // the plane goes along the hole's axis: two rectangles 12 × 10 either side of it
    expect(res.sections?.length).toBe(2);
    const spans = res.sections!.map((s) => {
      const pts = s.edges.flat();
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6 + 0);
    });
    expect(spans.sort((a, b) => a[0] - b[0])).toEqual([[-15, -3, 0, 10], [3, 15, 0, 10]]);
    // the view (seen from the right): the block's 30 × 10 outline
    expect(res.bounds!.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6 + 0))).toEqual([[-15, 0], [15, 10]]);
    // on the sheet: hatch lines only inside those rectangles
    const proj: ProjectionData = { type: 'projection', reqId: 0, key: 'k', ...res };
    const v = view({ id: 's', parent: 'f', section: { a: [10, -20], b: [10, 20], side: 1, letter: 'A' } });
    const prims = viewPrims(v, proj, [view({ id: 'f' }), v]);
    const hatch = prims.filter((p) => p.t === 'line' && p.style === 'thin');
    expect(hatch.length).toBeGreaterThan(8);
    for (const p of hatch) if (p.t === 'line') expect(Math.abs(p.a[0] - 100)).toBeGreaterThan(3 - 1e-6);
    expect(prims.some((p) => p.t === 'text' && p.text === 'A–A')).toBe(true);
  }, 60000);

  it('makes an offset section: each step of the line cuts its own plane, the steps themselves are not drawn', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Offset section');
    const k = nodeKernel(doc.units);
    // a 60 × 40 × 10 block, through holes ⌀6 at (−15, −8) and (15, 8)
    const { report } = await runOps(doc.tabs[0] as PartStudioTab, doc.units, [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 60, h: 40 }] },
      { op: 'extrude', depth: 10 },
      { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [-15, -8] }, { type: 'point', at: [15, 8] }] },
      { op: 'hole', sketch: 'P', diameter: 6, through: true },
    ] as DocumentOp[] as never, k);
    expect(report.failed).toEqual([]);
    // on the Top view: along y = −8 to x = 0, a step to y = 8, on to the right; looking from the front
    const s = { a: [-40, -8] as Vec2, b: [0, -8] as Vec2, steps: [[0, 8], [40, 8]] as Vec2[], side: 1 as const, letter: 'A' };
    const { axes, cut } = sectionCut(VIEW_AXES.top, s);
    near(axes.n, VIEW_AXES.front.n);
    expect(cut.line?.length).toBe(4);
    const res = k.builder.projection([], 'top', false, { axes, section: cut });
    // two cut faces at each depth, either side of the hole the plane goes through
    const spans = res.sections!.map((f) => {
      const xs = f.edges.flat().map((p) => p[0]);
      return [Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v * 1e6) / 1e6 + 0);
    });
    expect(spans.sort((p, q) => p[0] - q[0])).toEqual([[-30, -18], [-12, 0], [0, 12], [18, 30]]);
    // no line where the step is (x = 0, seen edge-on)
    expect(res.edges.some((e) => e.pts.every((p) => Math.abs(p[0]) < 1e-6))).toBe(false);
  }, 60000);

  it('makes a half section (a line ending across, out of the part) and a local section', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Half and local');
    const k = nodeKernel(doc.units);
    // a 60 × 40 × 10 block, blind holes ⌀6 6 deep at x = ±15
    const { report } = await runOps(doc.tabs[0] as PartStudioTab, doc.units, [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 60, h: 40 }] },
      { op: 'extrude', depth: 10 },
      { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [-15, 0] }, { type: 'point', at: [15, 0] }] },
      { op: 'hole', sketch: 'P', diameter: 6, depth: 6 },
    ] as DocumentOp[] as never, k);
    expect(report.failed).toEqual([]);
    // half: cut along y = 0 to the middle, then across towards the viewer and out of the block
    const s = { a: [-40, 0] as Vec2, b: [0, 0] as Vec2, steps: [[0, -40]] as Vec2[], side: 1 as const, letter: 'A' };
    const { axes, cut } = sectionCut(VIEW_AXES.top, s);
    const half = k.builder.projection([], 'top', false, { axes, section: cut });
    const xs = half.sections!.map((f) => Math.max(...f.edges.flat().map((p) => p[0])));
    expect(Math.max(...xs)).toBeCloseTo(0, 6);
    // the axis between section and view: along x = 0, a little beyond the block (z 0 … 10)
    expect(half.centerLines?.length).toBe(1);
    const [p0, p1] = half.centerLines![0];
    expect([p0[0], p1[0]].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 0]);
    expect(Math.min(p0[1], p1[1])).toBeCloseTo(-2, 6);
    expect(Math.max(p0[1], p1[1])).toBeCloseTo(12, 6);
    // local: on the Front view round the left hole, to the middle (z = 5) — the hole is opened, the cut face hatched
    const outline: Vec3[] = [[-25, 0, 1], [-5, 0, 1], [-5, 0, 11], [-25, 0, 11]];
    const local = k.builder.projection([], 'front', false, { breakout: { outline } });
    expect(local.sections?.length).toBeGreaterThan(0);
    expect(local.breaks?.[0].length).toBe(4);
    // the hole's walls are seen (visible lines at x = −18 and −12), the outline's own walls are not drawn
    const vertical = (x: number) => local.edges.some((e) => !e.hidden && e.pts.every((p) => Math.abs(p[0] - x) < 1e-6));
    expect(vertical(-18) && vertical(-12)).toBe(true);
    expect(local.edges.some((e) => e.pts.every((p) => Math.abs(p[0] + 5) < 1e-6))).toBe(false);
  }, 60000);

  it('makes an aligned section: the part beyond the bend turned into the plane of the first segment', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Aligned section');
    const k = nodeKernel(doc.units);
    // a flange ⌀80 × 10: a centre hole ⌀20, holes ⌀10 at 0° and 120° on a ⌀60 circle
    const top = { face: { normal: 'z', pick: '+z' } };
    const at120: Vec2 = [30 * Math.cos((2 * Math.PI) / 3), 30 * Math.sin((2 * Math.PI) / 3)];
    const { report } = await runOps(doc.tabs[0] as PartStudioTab, doc.units, [
      { op: 'sketch', shapes: [{ type: 'circle', c: [0, 0], r: 40 }] },
      { op: 'extrude', depth: 10 },
      { op: 'sketch', name: 'C', plane: top, shapes: [{ type: 'point', at: [0, 0] }] },
      { op: 'hole', sketch: 'C', diameter: 20, through: true },
      { op: 'sketch', name: 'P', plane: top, shapes: [{ type: 'point', at: [30, 0] }, { type: 'point', at: at120 }] },
      { op: 'hole', sketch: 'P', diameter: 10, through: true },
    ] as DocumentOp[] as never, k);
    expect(report.failed).toEqual([]);
    // from the right through the 0° hole to the centre, then out through the 120° one
    const s = { a: [50, 0] as Vec2, b: [0, 0] as Vec2, steps: [[50 * Math.cos((2 * Math.PI) / 3), 50 * Math.sin((2 * Math.PI) / 3)]] as Vec2[], side: 1 as const, letter: 'A', aligned: true };
    const { axes, cut } = sectionCut(VIEW_AXES.top, s);
    expect(cut.aligned).toBe(true);
    const res = k.builder.projection([], 'top', false, { axes, section: cut });
    const spans = res.sections!.map((f) => {
      const xs = f.edges.flat().map((p) => p[0]);
      return [Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v * 1e4) / 1e4 + 0);
    });
    // the 120° hole turned to x = −30: the two halves alike
    expect(spans.sort((p, q) => p[0] - q[0])).toEqual([[-40, -35], [-25, -10], [10, 25], [35, 40]]);
    // the outline is whole: the centre hole's far wall is seen right across (−10 … 10), no seam where the pieces meet
    const upper = Math.max(...res.edges.flatMap((e) => e.pts.map((p) => p[1])));
    const covers = (x: number) =>
      res.edges.some((e) => !e.hidden && e.pts.every((p) => Math.abs(p[1] - upper) < 1e-6) && Math.min(...e.pts.map((p) => p[0])) <= x + 1e-6 && Math.max(...e.pts.map((p) => p[0])) >= x - 1e-6);
    expect([-9, -1, 0, 1, 9].every(covers)).toBe(true);
    expect(res.edges.some((e) => e.pts.every((p) => Math.abs(p[0]) < 1e-6))).toBe(false);
  }, 60000);

  it('turns an offset line along or across its first segment', () => {
    expect(stepPoint([0, 0], [10, 0], [10, 0], [12, 9])).toEqual([10, 9]);
    expect(stepPoint([0, 0], [10, 0], [10, 9], [30, 10])).toEqual([30, 9]);
  });
});

describe('Cosmetic threads in sections', () => {
  const thread = { origin: [0, 0, 10] as Vec3, dir: [0, 0, -1] as Vec3, major: 8, length: 16 };
  const front = VIEW_AXES.front;
  it('cut lengthwise: the major diameter as thin solid lines, the thread end a thick one', () => {
    const lines = threadLines([thread], front.n, front.x, false, { normal: front.n, planes: [[0, 0, 0]] });
    expect(lines.map((l) => [l.hidden, !!l.thin])).toEqual([[false, true], [false, true], [false, false]]);
    expect(lines[0].pts.map((p) => p.map((v) => Math.round(v * 1e9) / 1e9 + 0))).toEqual([[-4, 10], [-4, -6]]);
  });
  it('behind the cut: as in any view (hidden, not shown here); in front of it: gone', () => {
    expect(threadLines([thread], front.n, front.x, false, { normal: front.n, planes: [[0, -10, 0]] })).toEqual([]);
    expect(threadLines([thread], front.n, front.x, true, { normal: front.n, planes: [[0, -10, 0]] }).every((l) => l.hidden)).toBe(true);
    expect(threadLines([thread], front.n, front.x, true, { normal: front.n, planes: [[0, 10, 0]] })).toEqual([]);
  });
});
