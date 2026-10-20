// Drawing dimensions that follow the model: their points anchored to model vertices and circles (real OpenCascade).

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, nodeKernel } from '../agent/headless';
import { runOps } from '../agent/runner';
import type { PartStudioTab } from '../core/types';
import { VIEW_AXES, sectionCut } from '../core/drawingViews';

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
    // the Front view's top line (an angle dimension's line): the straight edge seen along it
    const topLine = k.builder.viewAnchor([], front, [-20, 20], undefined, [20, 20]);
    expect(topLine?.kind).toBe('edge');
    // no edge along a line through the middle of the face
    expect(k.builder.viewAnchor([], front, [-20, 10], undefined, [20, 10])).toBeNull();
    // the block taller: the corner goes up with it, the hole stays
    const taller = await runOps(built, doc.units, [{ op: 'setVariable', name: 'h', value: 35 }] as never, k);
    expect(taller.report.failed).toEqual([]);
    const [c] = k.builder.viewRefs(front, [corner!]);
    expect(c?.p[0]).toBeCloseTo(20, 6);
    expect(c?.p[1]).toBeCloseTo(35, 6);
    const [h] = k.builder.viewRefs(top, [hole!]);
    expect(h?.p[0]).toBeCloseTo(10, 6);
    expect(h?.r).toBeCloseTo(5, 6);
    // the top line up at 35, its ends where they are
    const [l] = k.builder.viewRefs(front, [topLine!]);
    expect(l?.ends?.map((e) => e[1])).toEqual([expect.closeTo(35, 6), expect.closeTo(35, 6)]);
    expect(l?.ends?.map((e) => Math.abs(e[0]))).toEqual([expect.closeTo(20, 6), expect.closeTo(20, 6)]);
  }, 60000);

  it('anchors the points, lines and circles of a section to where edges and faces of the model meet the cut', async () => {
    await initOpenCascade(wasm);
    const doc = emptyDocument('Section dimensions');
    const k = nodeKernel(doc.units);
    // the same block, the hole ⌀#d
    const { report, studio: built } = await runOps(
      doc.tabs[0] as PartStudioTab,
      doc.units,
      [
        { op: 'variable', name: 'h', value: 20 },
        { op: 'variable', name: 'd', value: 10 },
        { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
        { op: 'extrude', depth: '#h' },
        { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [10, 0] }] },
        { op: 'hole', sketch: 'P', diameter: '#d', through: true },
      ] as never,
      k,
    );
    expect(report.failed).toEqual([]);
    // A–A across the Top view through the hole (seen as the Front view: x → X, y → Z), what lies at y < 0 cut away
    const aa = sectionCut(VIEW_AXES.top, { a: [-30, 0], b: [30, 0], side: 1 });
    const cutA = { section: aa.cut };
    // a corner of the cut: where the block's bottom edge on the left crosses it
    const corner = k.builder.viewAnchor([], aa.axes, [-20, 0], undefined, undefined, cutA);
    expect(corner).toMatchObject({ kind: 'edge', cut: true });
    // the hole's edge on the cut, at the top: where its upper circle crosses it (it does twice)
    const lip = k.builder.viewAnchor([], aa.axes, [5, 20], undefined, undefined, cutA);
    expect(lip).toMatchObject({ kind: 'edge', cut: true });
    // the hole's wall on the cut: where its cylinder meets it
    const wall = k.builder.viewAnchor([], aa.axes, [5, 0], undefined, [5, 20], cutA);
    expect(wall?.kind).toMatch(/face|edge/);
    // B–B across the Front view at mid-height, seen from above: the hole's circle on the cut
    const bb = sectionCut(VIEW_AXES.front, { a: [-30, 10], b: [30, 10], side: -1 });
    const cutB = { section: bb.cut };
    const ring = k.builder.viewAnchor([], bb.axes, [10, 0], { r: 5 }, undefined, cutB);
    expect(ring).toMatchObject({ kind: 'face', cut: true });
    // the block taller, the hole wider
    const changed = await runOps(built, doc.units, [{ op: 'setVariable', name: 'h', value: 35 }, { op: 'setVariable', name: 'd', value: 16 }] as never, k);
    expect(changed.report.failed).toEqual([]);
    const [c, t, w] = k.builder.viewRefs(aa.axes, [corner!, lip!, wall!], cutA, [[-20, 0], [5, 20], [5, 10]]);
    expect(c?.p[0]).toBeCloseTo(-20, 6);
    expect(c?.p[1]).toBeCloseTo(0, 6);
    // the crossing nearest to where it was: the hole's left side, up at 35
    expect(t?.p[0]).toBeCloseTo(2, 6);
    expect(t?.p[1]).toBeCloseTo(35, 6);
    expect(w?.ends?.map((e) => e[0])).toEqual([expect.closeTo(2, 6), expect.closeTo(2, 6)]);
    expect(w?.ends?.map((e) => e[1]).sort((a, b) => a - b)).toEqual([expect.closeTo(0, 6), expect.closeTo(35, 6)]);
    const [r] = k.builder.viewRefs(bb.axes, [ring!], cutB, [[10, 0]]);
    expect(r?.p[0]).toBeCloseTo(10, 6);
    expect(r?.p[1]).toBeCloseTo(0, 6);
    expect(r?.r).toBeCloseTo(8, 6);
    // the block's corner on the cut at the top right: not its vertex behind it (farther from the viewer)
    const top = k.builder.viewAnchor([], aa.axes, [20, 35], undefined, undefined, cutA);
    expect(top).toMatchObject({ kind: 'edge', cut: true });
  }, 60000);
});
