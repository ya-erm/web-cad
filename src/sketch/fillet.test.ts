// A sketch fillet rounds the corner between a centre rectangle's two sides, whichever of the corner's three points
// (two sides' ends and the construction diagonal's) the click hits; the diagonal keeps its end at the sharp corner.

import { describe, expect, it } from 'vitest';
import type { SkArc, SkPoint, SketchData } from '../core/types';
import { addCenterRectangle, addConstraint, addLine, filletCorner, filletLines } from './sketchOps';
import { solveSketch } from './solver';

function rect() {
  const d: SketchData = { plane: { kind: 'std', name: 'front' }, entities: [], constraints: [] };
  // 70 × 30 around the origin: lines[1] — the right side (up), lines[2] — the top (to the left)
  const r = addCenterRectangle(d, [0, 0], [35, 15]);
  const diag = d.entities.find((e) => e.type === 'line' && e.construction)!;
  return { d, r, diag: diag as { id: string; p1: string; p2: string } };
}

function fillet(d: SketchData, pid: string, r: number) {
  const arcId = filletCorner(d, pid, r);
  expect(arcId).toBeTruthy();
  addConstraint(d, 'radius', [arcId!], { value: String(r) });
  // every fillet's radius (the dimensions' values)
  const values = Object.fromEntries(d.constraints.filter((c) => c.type === 'radius').map((c) => [c.id, Number(c.value)]));
  const res = solveSketch(d.entities, d.constraints, values);
  const pt = (id: string) => {
    const p = res.entities.find((e) => e.id === id) as SkPoint;
    return [p.x, p.y];
  };
  const arc = res.entities.find((e) => e.id === arcId) as SkArc;
  return { res, pt, arc };
}

describe('sketch fillet', () => {
  it.each(['side', 'top', 'diagonal'])('a centre rectangle corner, clicked on the %s end: between the two sides', (which) => {
    const { d, r, diag } = rect();
    const pid = { side: r.lines[1].p2, top: r.lines[2].p1, diagonal: diag.p2 }[which]!;
    expect(filletLines(d, pid)?.lines.map((l) => l.line.id).sort()).toEqual([r.lines[1].id, r.lines[2].id].sort());
    const { res, pt, arc } = fillet(d, pid, 6);
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    // the centre, width and height still free: nothing new to fix
    expect(res.dof).toBe(4);
    const [cx, cy] = pt(arc.c);
    expect(cx).toBeCloseTo(29, 6);
    expect(cy).toBeCloseTo(9, 6);
    // the sides end where the arc starts; the diagonal still ends at the sharp corner
    expect(pt(r.lines[1].p2)).toEqual([expect.closeTo(35, 6), expect.closeTo(9, 6)]);
    expect(pt(r.lines[2].p1)).toEqual([expect.closeTo(29, 6), expect.closeTo(15, 6)]);
    expect(pt(diag.p2)).toEqual([expect.closeTo(35, 6), expect.closeTo(15, 6)]);
    expect(pt(r.center)).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);
  });

  it('a corner without the diagonal', () => {
    const { d, r } = rect();
    const { res, pt, arc } = fillet(d, r.lines[2].p2, 2);
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(4);
    expect(pt(arc.c)).toEqual([expect.closeTo(-33, 6), expect.closeTo(13, 6)]);
  });

  it('both corners of a side, the diagonal one too', () => {
    const { d, r, diag } = rect();
    fillet(d, r.lines[2].p2, 2);
    const { res, pt } = fillet(d, diag.p2, 6);
    expect(res.ok).toBe(true);
    expect(res.dof).toBe(4);
    expect(pt(r.lines[2].p1)).toEqual([expect.closeTo(29, 6), expect.closeTo(15, 6)]);
    expect(pt(r.lines[2].p2)).toEqual([expect.closeTo(-33, 6), expect.closeTo(15, 6)]);
  });

  it('no fillet where three real lines meet', () => {
    const { d, r } = rect();
    const extra = addLine(d, [35, 15], [50, 30]);
    addConstraint(d, 'coincident', [extra.p1, r.lines[2].p1]);
    expect(filletLines(d, r.lines[1].p2)).toBeNull();
    expect(filletCorner(d, r.lines[1].p2, 6)).toBeNull();
  });
});
