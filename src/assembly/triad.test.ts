// Triad manipulator geometry: dragging along an arrow's axis and about an arc's axis.

import { describe, expect, it } from 'vitest';
import { angleAbout, closestOnAxis, placedTriad, rayPlane, triadStep, wrapAngle } from './triad';

describe('triad manipulator', () => {
  it('an arrow follows the point of its axis nearest to the mouse ray', () => {
    // looking down −Y at the X axis: the ray through x = 7 meets the axis at t = 7
    expect(closestOnAxis([7, 50, 3], [0, -1, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(7);
    // an oblique ray: still the point of the axis closest to it
    const d = [0, -Math.SQRT1_2, -Math.SQRT1_2] as [number, number, number];
    expect(closestOnAxis([4, 10, 10], d, [1, 0, 0], [1, 0, 0])).toBeCloseTo(3);
    // a ray along the axis gives no answer
    expect(closestOnAxis([0, 0, 5], [0, 0, -1], [0, 0, 0], [0, 0, 1])).toBeNull();
  });

  it('an arc turns by the signed angle of the mouse about its axis', () => {
    const hit = rayPlane([3, 4, 100], [0, 0, -1], [0, 0, 10], [0, 0, 1]);
    expect(hit).toEqual([3, 4, 10]);
    expect(rayPlane([0, 0, 1], [1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeNull();
    expect(angleAbout([0, 0, 1], [1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2);
    expect(angleAbout([0, 0, -1], [1, 0, 0], [0, 1, 0])).toBeCloseTo(-Math.PI / 2);
    // components along the axis do not count
    expect(angleAbout([0, 0, 1], [1, 0, 5], [-1, 0, -2])).toBeCloseTo(Math.PI);
    // a turn accumulated in steps goes past half a revolution
    let a = 0;
    let prev: [number, number, number] = [1, 0, 0];
    for (let i = 1; i <= 7; i++) {
      const u: [number, number, number] = [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4), 0];
      a += wrapAngle(angleAbout([0, 0, 1], prev, u));
      prev = u;
    }
    expect(a).toBeCloseTo((7 * Math.PI) / 4);
  });

  it('a triad on a mate connector moves and turns with the instance', () => {
    // connector 10 mm along the part's X, its Z along the part's X; the part turned 90° about Z and moved
    const local = { R: [0, 0, 1, 0, 1, 0, -1, 0, 0], o: [10, 0, 0] as [number, number, number] };
    const pl = { R: [0, -1, 0, 1, 0, 0, 0, 0, 1], t: [5, 5, 0] as [number, number, number] };
    const f = placedTriad(pl, local);
    near(f.o, [5, 15, 0]);
    near(f.axes[2], [0, 1, 0]);
    near(f.axes[0], [0, 0, -1]);
  });

  it('a typed value moves along the arrow or turns about the arc', () => {
    const frame = { o: [1, 2, 3] as [number, number, number], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]] };
    const move = triadStep({ kind: 'arrow', axis: 0 }, 12, frame);
    near(move.delta, [0, 12, 0]);
    expect(move.angle).toBe(0);
    const turn = triadStep({ kind: 'ring', axis: 2 }, Math.PI / 2, frame);
    near(turn.delta, [0, 0, 0]);
    expect(turn.angle).toBeCloseTo(Math.PI / 2);
    near(turn.axis, [0, 0, 1]);
  });
});

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
