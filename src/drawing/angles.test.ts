// Angle dimensions of drawings: the sector measured (where the arc is placed), the arc, its value.

import { describe, expect, it } from 'vitest';
import type { DrawingDimension, DrawingView, Vec2 } from '../core/types';
import { angleSector, centerlineOf, dimLevel, dimPrims, offsetForLevel, type ProjectionData } from './sheet';

const view: DrawingView = { id: 'v', studioId: 's', partIds: [], orientation: 'front', x: 100, y: 100, scale: 1, showHidden: false };
// the view's centre at its origin: a view point p is at (100, 100) + p on the sheet
const proj: ProjectionData = { type: 'projection', reqId: 0, key: 'k', edges: [], bounds: [[-10, -10], [10, 10]] };
const at = (deg: number, r: number): Vec2 => [100 + r * Math.cos((deg * Math.PI) / 180), 100 + r * Math.sin((deg * Math.PI) / 180)];
const angle = (b: Vec2, c: Vec2, textPos: Vec2): DrawingDimension => ({ id: 'd', viewId: 'v', kind: 'angle', a: [0, 0], b, c, offset: 0, textPos });
const texts = (d: DrawingDimension, comma = false) => dimPrims(d, view, proj, 1, (k) => k, comma).flatMap((p) => (p.t === 'text' ? [p.text] : []));

describe('Angle dimensions', () => {
  it('measures the sector the arc is placed in', () => {
    // lines along 0° and 60° through the origin
    const b: Vec2 = [10, 0];
    const c: Vec2 = [5, 5 * Math.sqrt(3)];
    expect(texts(angle(b, c, at(30, 12)))).toEqual(['60°']);
    // the other side of the 60° line: between it and the first line beyond the vertex
    expect(texts(angle(b, c, at(120, 12)))).toEqual(['120°']);
    // opposite the first sector: the same angle again
    expect(texts(angle(b, c, at(210, 12)))).toEqual(['60°']);
    expect(angleSector([0, 0], b, c)?.deg).toBeCloseTo(60, 9);
    // the sector kept (signs) wins over where the text is: the model may have moved the vertex
    expect(angleSector([0, 0], b, c, [-5, 8], [1, 1])?.deg).toBeCloseTo(60, 9);
    expect(angleSector([0, 0], b, c, [-5, 8])?.signs).toEqual([-1, 1]);
    expect(texts({ ...angle(b, c, at(120, 12)), sector: [1, 1] })).toEqual(['60°']);
  });

  it('writes ordinates: the distance from the base along X or Y, at the end of a line out to the values', () => {
    const ord = (b: Vec2, axis: 'x' | 'y', textPos: Vec2): DrawingDimension => ({ id: 'o', viewId: 'v', kind: 'ordinate', ordinate: axis, a: [-10, -5], b, offset: 0, textPos });
    // X: 12.5 from the base, its line up from the point to y = 130, the value upright
    const x = dimPrims(ord([2.5, 3], 'x', [0, 130]), view, proj, 1);
    const line = x.find((p) => p.t === 'line');
    if (line?.t !== 'line') throw new Error('a line');
    expect(line.a[0]).toBeCloseTo(102.5, 9);
    expect(line.b[1]).toBeCloseTo(130, 9);
    const text = x.find((p) => p.t === 'text');
    if (text?.t !== 'text') throw new Error('a value');
    expect(text.text).toBe('12.5');
    expect(text.angle).toBeCloseTo(Math.PI / 2, 9);
    // Y: 8 from the base, written level to the left
    expect(texts(ord([2.5, 3], 'y', [70, 0]))).toEqual(['8']);
    // the base itself: 0
    expect(texts(ord([-10, -5], 'x', [0, 130]))).toEqual(['0']);
  });

  it('puts chain dimensions on one line: the offset for a level and back', () => {
    // points of a view at different heights; the line at sheet y = 120 above them all
    const pts: Vec2[] = [[0, 0], [10, 5], [25, -3]];
    const lineY = (a: Vec2, b: Vec2) => {
      const A: Vec2 = [100 + a[0], 100 + a[1]];
      const B: Vec2 = [100 + b[0], 100 + b[1]];
      const offset = offsetForLevel('horizontal', A, B, 120);
      expect(dimLevel('horizontal', A, B, offset)).toBeCloseTo(120, 9);
      const prims = dimPrims({ id: 'h', viewId: 'v', kind: 'horizontal', a, b, offset }, view, proj, 1);
      // the dimension line: the line between its two arrows
      const arrows = prims.filter((p) => p.t === 'arrow');
      return arrows.map((p) => (p.t === 'arrow' ? p.tip[1] : 0));
    };
    expect(lineY(pts[0], pts[1])).toEqual([expect.closeTo(120, 9), expect.closeTo(120, 9)]);
    expect(lineY(pts[1], pts[2])).toEqual([expect.closeTo(120, 9), expect.closeTo(120, 9)]);
    // below them all (a negative offset)
    const A: Vec2 = [100, 100];
    const B: Vec2 = [125, 97];
    expect(dimLevel('horizontal', A, B, offsetForLevel('horizontal', A, B, 80))).toBeCloseTo(80, 9);
  });

  it('draws a centre line midway between two parallel lines, a little past them; a centre mark', () => {
    // a bore seen from the side: its outline at y = ±3 from x = 0 … 20 (the second line shorter, reversed)
    expect(centerlineOf([[0, 3], [20, 3]], [[18, -3], [2, -3]])).toEqual([[0, 0], [20, 0]]);
    expect(centerlineOf([[0, 3], [20, 3]], [[0, -3], [20, 0]])).toBeNull();
    const cl = dimPrims({ id: 'c', viewId: 'v', kind: 'centerline', a: [0, 3], b: [20, 3], c: [18, -3], d: [2, -3], offset: 0 }, view, proj, 1);
    expect(cl).toEqual([{ t: 'line', a: [97, 100], b: [123, 100], style: 'center' }]);
    // a circle ⌀8 at (5, 5): its two chain lines 4 + 3 either way of the centre
    const cm = dimPrims({ id: 'm', viewId: 'v', kind: 'centermark', a: [5, 5], b: [9, 5], offset: 0 }, view, proj, 1);
    expect(cm.map((p) => (p.t === 'line' ? [p.a, p.b] : null))).toEqual([
      [[98, 105], [112, 105]],
      [[105, 98], [105, 112]],
    ]);
  });

  it('draws an arc through the text position, with arrows and the value; a comma when asked', () => {
    const d = angle([10, 0], [0, 10], at(45, 20));
    const prims = dimPrims(d, view, proj, 1);
    const arc = prims.find((p) => p.t === 'arc');
    if (arc?.t !== 'arc') throw new Error('an arc');
    expect(arc.r).toBeCloseTo(20, 9);
    expect(arc.a1 - arc.a0).toBeCloseTo(Math.PI / 2, 9);
    expect(prims.filter((p) => p.t === 'arrow').length).toBe(2);
    // the lines end at 10, the arc is at 20: extension lines out to it
    expect(prims.filter((p) => p.t === 'line').length).toBe(2);
    expect(texts(angle([10, 0], [10, 10], at(20, 30)), true)).toEqual(['45°']);
    expect(texts(angle([10, 0], [10, 5], at(10, 30)), true)[0]).toMatch(/^26,57°$/);
  });
});
