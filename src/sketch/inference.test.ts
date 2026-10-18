// Inference while drawing: parallel / perpendicular / tangent directions and points on the extension of a line.

import { describe, expect, it } from 'vitest';
import type { SkEntity } from '../core/types';
import { entityMap } from './curves';
import { extensionPoint, inferDirection } from './inference';

const pt = (id: string, x: number, y: number): SkEntity => ({ id, type: 'point', x, y });
// a slanted line (1, 2) from (0, 0) to (10, 20), and an arc around (50, 0) of radius 10 from (60, 0) to (50, 10)
const map = entityMap([
  pt('a', 0, 0),
  pt('b', 10, 20),
  { id: 'L', type: 'line', p1: 'a', p2: 'b' },
  pt('c', 50, 0),
  pt('s', 60, 0),
  pt('e', 50, 10),
  { id: 'A', type: 'arc', c: 'c', p1: 's', p2: 'e' },
]);
const px = 0.1;

describe('inference while drawing', () => {
  it('parallel to a line: the cursor moves onto the direction', () => {
    const anchor: [number, number] = [100, 100];
    const r = inferDirection(map, anchor, [110.3, 120], ['L'], [], px)!;
    expect(r.kind).toBe('parallel');
    expect(r.ref).toBe('L');
    // exactly along (1, 2)
    expect((r.pos[1] - anchor[1]) / (r.pos[0] - anchor[0])).toBeCloseTo(2, 9);
  });

  it('perpendicular to the line it starts on; nothing when far from any direction', () => {
    const anchor: [number, number] = [10, 20];
    const r = inferDirection(map, anchor, [10 - 20, 20 + 10.4], [], ['L'], px)!;
    expect(r.kind).toBe('perpendicular');
    expect((r.pos[0] - anchor[0]) * 1 + (r.pos[1] - anchor[1]) * 2).toBeCloseTo(0, 9);
    expect(inferDirection(map, anchor, [30, 20], [], ['L'], px)).toBeNull();
    // too close to the anchor to tell
    expect(inferDirection(map, anchor, [10.2, 20.4], [], ['L'], px)).toBeNull();
  });

  it('tangent to the arc the line starts on (square to its radius there), only from it', () => {
    const r = inferDirection(map, [60, 0], [60.3, 15], [], ['A'], px)!;
    expect(r.kind).toBe('tangent');
    expect(r.pos[0]).toBeCloseTo(60, 9);
    // an arc that is only acquired, not started on: no tangent
    expect(inferDirection(map, [60, 0], [60.3, 15], ['A'], [], px)).toBeNull();
  });

  it('a point on the extension of a line, beyond its ends; where a horizontal guide crosses it', () => {
    const e = extensionPoint(map, ['L'], [15.3, 30], px)!;
    expect(e.id).toBe('L');
    expect(e.pos[1] / e.pos[0]).toBeCloseTo(2, 9);
    // on the line itself: not its extension; far from it: nothing
    expect(extensionPoint(map, ['L'], [5.2, 10], px)).toBeNull();
    expect(extensionPoint(map, ['L'], [30, 30], px)).toBeNull();
    const g = extensionPoint(map, ['L'], [15.3, 30], px, { y: 30.2 })!;
    expect(g.pos).toEqual([15.1, 30.2]);
  });
});
