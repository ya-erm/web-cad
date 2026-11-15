// Projected views that show other parts than their parent stay on the parent's line of projection: across it they are
// centred where the parent is, not in the middle of their own bounds.

import { describe, expect, it } from 'vitest';
import type { DrawingView, Vec2 } from '../core/types';
import { alignedProjection } from './drawingModel';
import { toSheet, type ProjectionData } from './sheet';

const view = (v: Partial<DrawingView> & Pick<DrawingView, 'id' | 'orientation'>): DrawingView => ({ studioId: 's', partIds: [], x: 100, y: 200, scale: 2, showHidden: false, ...v });
const proj = (key: string, bounds: [Vec2, Vec2]): ProjectionData => ({ type: 'projection', reqId: 0, edges: [], bounds, key });

// a plate X −30…30, Y −20…20, Z 0…10 and a box X 40…60, Y −10…10, Z 0…30 beside it
const front = view({ id: 'f', orientation: 'front' });
const top = view({ id: 't', orientation: 'top', parent: 'f', partIds: ['plate'], y: 100 });
const left = view({ id: 'l', orientation: 'left', parent: 'f', partIds: ['plate'], x: 220 });
const same = view({ id: 's', orientation: 'top', parent: 'f', y: 60 });
const free = view({ id: 'u', orientation: 'top', parent: 'f', partIds: ['plate'], y: 40, unaligned: true });
const views = [front, top, left, same, free];
const raw = new Map<string, ProjectionData>([
  ['f', proj('f', [[-30, 0], [60, 30]])],
  ['t', proj('t', [[-30, -20], [30, 20]])],
  // seen from the left: −Y to the right, Z up
  ['l', proj('l', [[-20, 0], [20, 10]])],
  ['s', proj('s', [[-30, -20], [60, 20]])],
  ['u', proj('u', [[-30, -20], [30, 20]])],
]);
const at = (v: DrawingView) => alignedProjection(v, views, (x) => raw.get(x.id));

describe('projected views with parts of their own', () => {
  it('stay in line with the parent across their line of projection', () => {
    const pf = at(front);
    // below the front view: the plate's corner X = −30 straight under the front view's
    const pt = at(top);
    expect(pt?.center).toEqual([15, 0]);
    expect(toSheet(top, pt, [-30, -20])[0]).toBeCloseTo(toSheet(front, pf, [-30, 0])[0], 9);
    // beside it: the plate's top Z = 10 level with the front view's
    const pl = at(left);
    expect(toSheet(left, pl, [20, 10])[1]).toBeCloseTo(toSheet(front, pf, [-30, 10])[1], 9);
    // the same object while nothing changes
    expect(at(top)).toBe(pt);
  });

  it('leave a view with the parent’s parts, a free one and the parent itself as they are', () => {
    expect(at(same)).toBe(raw.get('s'));
    expect(at(free)).toBe(raw.get('u'));
    expect(at(front)).toBe(raw.get('f'));
  });
});
