// Agent API for drawings with the real OpenCascade kernel: standard views of a part, dimensions anchored to its
// vertices and circles (they follow the model), section and detail views, notes, a bill of materials with item
// numbers; the sheet exported as PDF, SVG and DXF.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless, type HeadlessSession } from './headless';
import type { DrawingSummary, Pt3 } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** A plate #w (60) × 40 × 10 centred at the origin, with a hole Ø8 through it at x 15 (a Hole feature). */
async function plate(): Promise<{ s: HeadlessSession; hole: Pt3 }> {
  const s = await openHeadless(emptyDocument('Drawing test'), wasm);
  const r = await s.run([
    { op: 'variable', name: 'w', value: 60 },
    { op: 'sketch', name: 'Base', shapes: [{ type: 'rect', center: true, w: '#w', h: 40 }] },
    { op: 'extrude', depth: 10 },
    { op: 'sketch', name: 'P', plane: { face: { normal: 'z', pick: '+z' } }, shapes: [{ type: 'point', at: [15, 0] }] },
    { op: 'hole', sketch: 'P', diameter: 8, through: true },
  ]);
  expect(r.error).toBeUndefined();
  const q = (await s.query({ edges: { type: 'circle', z: 10 } })) as { edges: { center: Pt3 }[] };
  return { s, hole: q.edges[0].center };
}

/** The views by orientation; a section and a detail view by their kind (their letters are of the app's language). */
const viewIds = (d: DrawingSummary) => Object.fromEntries(d.views.map((v) => [v.kind === 'view' || v.kind === 'projected' ? v.orientation : v.kind, v]));

describe('agent API: drawings', () => {
  it('draws a part: standard views, dimensions on its corners and hole, a section, a detail, a note', async () => {
    const { s, hole } = await plate();
    const r = await s.run([
      { op: 'drawing', name: 'Plate', of: 'Part Studio 1', title: 'Plate', author: 'Agent' },
      { op: 'dimension', view: 'top', type: 'horizontal', from: [-30, -20, 10], to: [30, -20, 10] },
      { op: 'dimension', view: 'top', type: 'vertical', from: [30, -20, 10], to: [30, 20, 10] },
      { op: 'dimension', view: 'top', type: 'diameter', center: hole },
      { op: 'dimension', view: 'top', type: 'hole', center: hole },
      { op: 'dimension', view: 'front', type: 'vertical', from: [-30, -20, 0], to: [-30, -20, 10] },
      { op: 'section', view: 'top', through: hole },
      { op: 'detail', view: 'front', center: [30, -20, 10], radius: 5 },
      { op: 'note', text: 'Break sharp edges\nМатериал: сталь', at: [30, 40] },
    ]);
    expect(r.error).toBeUndefined();
    const d = r.drawing!;
    expect(d.name).toBe('Plate');
    expect([d.sheet, d.landscape, d.size]).toEqual(['A3', true, [420, 297]]);
    // front, its side and below it (first angle: the top view below the front), isometric; the section, the detail
    const v = viewIds(d);
    expect(Object.keys(v).sort()).toEqual(['detail', 'front', 'iso', 'left', 'section', 'top']);
    expect(v.left.parent).toBe(v.front.id);
    expect(v.top.parent).toBe(v.front.id);
    expect(v.top.at[0]).toBeCloseTo(v.front.at[0], 6);
    expect(v.top.at[1]).toBeLessThan(v.front.at[1]);
    // 60 × 40 seen from the top, at the scale chosen for the sheet
    const scale = v.front.scale === '1:1' ? 1 : Number(v.front.scale.split(':')[0]) / Number(v.front.scale.split(':')[1]);
    expect(v.top.size![0]).toBeCloseTo(60 * scale, 1);
    expect(v.top.size![1]).toBeCloseTo(40 * scale, 1);
    // the section through the hole, beside the top view; the detail twice the front view's scale
    expect(v.section.at[0]).toBeGreaterThan(v.top.at[0]);
    expect(v.section.at[1]).toBeCloseTo(v.top.at[1], 6);
    expect(v.section.parent).toBe(v.top.id);
    expect(v.section.label).toBeTruthy();
    expect(v.detail.parent).toBe(v.front.id);
    expect(v.detail.label).not.toBe(v.section.label);
    // the dimensions as written, anchored to the model
    expect(d.dimensions.map((x) => [x.type, x.value, x.anchored])).toEqual([
      ['horizontal', 60, true],
      ['vertical', 40, true],
      ['diameter', 8, true],
      ['hole', 0, true],
      ['vertical', 10, true],
    ]);
    expect(d.notes).toBe(1);

    // the model changes: the dimensions follow it (on the sheet as exported)
    const text = async () => new TextDecoder().decode(await s.exportDrawing('svg'));
    expect(await text()).toContain('>60<');
    const wider = await s.run([{ op: 'studio', name: 'Part Studio 1' }, { op: 'setVariable', name: 'w', value: 80 }, { op: 'drawing', name: 'Plate' }]);
    expect(wider.error).toBeUndefined();
    const svg = await text();
    expect(svg).toContain('>80<');
    expect(svg).not.toContain('>60<');

    // PDF (the note's Cyrillic embedded), DXF
    const pdf = await s.exportDrawing('pdf');
    expect(new TextDecoder('latin1').decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(new TextDecoder('latin1').decode(pdf)).toContain('FontFile2');
    const dxf = new TextDecoder().decode(await s.exportDrawing('dxf'));
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('60');
    // the state of the drawing tab
    const st = (await s.state()) as { drawing: DrawingSummary };
    expect(st.drawing.views.length).toBe(6);
  }, 180000);

  it('places views one by one: projected, scaled, deleted with what is on them', async () => {
    const { s } = await plate();
    const r = await s.run([
      { op: 'drawing', sheet: 'A4', projection: 'third' },
      { op: 'view', orientation: 'front', at: [80, 150], scale: '1:1' },
      { op: 'view', from: 'front', direction: 'down' },
      { op: 'view', from: 'front', direction: 'right', gap: 30 },
      { op: 'view', orientation: 'iso', at: [160, 220], scale: 0.5 },
      { op: 'dimension', view: 'front', type: 'horizontal', from: [-30, -20, 0], to: [30, -20, 0], offset: 15 },
    ]);
    expect(r.error).toBeUndefined();
    const v = viewIds(r.drawing!);
    // third angle: below the front — the bottom view? no: the top view goes above; below it — the bottom
    expect(v.bottom.at[1]).toBeLessThan(v.front.at[1]);
    expect(v.right.at[0]).toBeGreaterThan(v.front.at[0]);
    expect(v.right.at[0] - v.front.at[0]).toBeCloseTo(30 + 30 + 20, 4);
    expect(v.iso.scale).toBe('1:2');
    expect(r.drawing!.dimensions[0].value).toBe(60);
    const del = await s.run([{ op: 'deleteView', view: 'front' }]);
    expect(del.error).toBeUndefined();
    expect(del.drawing!.dimensions).toEqual([]);
    // the projected views stay, now free
    expect(del.drawing!.views.map((x) => x.orientation).sort()).toEqual(['bottom', 'iso', 'right']);
    expect(del.drawing!.views.every((x) => !x.parent)).toBe(true);
    // a bad query says what there is
    const bad = await s.run([{ op: 'dimension', view: 'front', type: 'horizontal', from: [0, 0, 0], to: [1, 0, 0] }]);
    expect(bad.error).toMatch(/No view "front"/);
  }, 180000);

  it('draws an assembly with its bill of materials and item numbers', async () => {
    const s = await openHeadless(emptyDocument('BOM test'), wasm);
    const r = await s.run([
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
      { op: 'extrude', depth: 6 },
      { op: 'part', part: 'Part 1', name: 'Plate' },
      { op: 'sketch', name: 'Pin', shapes: [{ type: 'circle', c: [100, 0], r: 4 }] },
      { op: 'extrude', sketch: 'Pin', depth: 20 },
      { op: 'part', part: 'Part 2', name: 'Pin' },
      { op: 'assembly', name: 'Rig' },
      { op: 'insert', part: 'Plate', fixed: true },
      { op: 'insert', part: 'Pin', position: [-100, 0, 6] },
      { op: 'insert', part: 'Pin', position: [-90, 0, 6] },
      { op: 'drawing', name: 'Rig drawing', of: 'Rig' },
      { op: 'bom', balloons: true },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.drawing!.bom).toEqual({ assembly: 'Rig', rows: 2 });
    expect(r.drawing!.balloons).toBe(2);
    const svg = new TextDecoder().decode(await s.exportDrawing('svg', 'Rig drawing'));
    expect(svg).toContain('>Pin<');
    expect(svg).toContain('>Plate<');
  }, 180000);

  it('places a section and a detail of the front view past the side view standing beside it', async () => {
    const { s, hole } = await plate();
    const r = await s.run([
      { op: 'drawing', name: 'Plate', of: 'Part Studio 1' },
      { op: 'section', view: 'front', through: hole },
      { op: 'detail', view: 'front', center: [30, -20, 10], radius: 5 },
    ]);
    expect(r.error).toBeUndefined();
    const v = viewIds(r.drawing!);
    const box = (x: DrawingSummary['views'][number]) => [x.at[0] - x.size![0] / 2, x.at[1] - x.size![1] / 2, x.at[0] + x.size![0] / 2, x.at[1] + x.size![1] / 2];
    const apart = (a: number[], b: number[]) => a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1];
    // on the front view's line, right of the side view
    expect(v.section.at[1]).toBeCloseTo(v.front.at[1], 6);
    expect(box(v.section)[0]).toBeGreaterThan(box(v.left)[2]);
    for (const other of [v.front, v.left, v.top, v.iso]) expect(apart(box(v.section), box(other))).toBe(true);
    expect(v.detail.at[0]).toBeGreaterThan(box(v.left)[2]);
  }, 180000);
});
