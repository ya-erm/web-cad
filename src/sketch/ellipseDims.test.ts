// Ellipse axis dimensions (Onshape: diameters of the first / second axis, picked by `variant`).

import { describe, expect, it } from 'vitest';
import type { SkEllipse, SketchData } from '../core/types';
import { addConstraint, addEllipse } from './sketchOps';
import { measureConstraint, solveSketch } from './solver';
import { dimensionGeometry } from './dimensions';
import { entityMap } from './curves';

function ellipseSketch() {
  const d: SketchData = { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] };
  const el = addEllipse(d, [0, 0], 10, 4, 0.3);
  return { d, el };
}

describe('ellipse dimensions', () => {
  it('measures both axis diameters and radii', () => {
    const { d, el } = ellipseSketch();
    const m = (type: 'diameter' | 'radius', variant: number) => measureConstraint({ id: 'q', type, refs: [el.id], variant }, d.entities);
    expect(m('diameter', 0)).toBeCloseTo(20, 9);
    expect(m('diameter', 1)).toBeCloseTo(8, 9);
    expect(m('radius', 1)).toBeCloseTo(4, 9);
  });

  it('drives the semi-axes without redundancy', () => {
    const { d, el } = ellipseSketch();
    addConstraint(d, 'diameter', [el.id], { value: '30', variant: 0 });
    addConstraint(d, 'diameter', [el.id], { value: '12', variant: 1 });
    const [a, b] = d.constraints.map((c) => c.id);
    const res = solveSketch(d.entities, d.constraints, { [a]: 30, [b]: 12 });
    expect(res.ok).toBe(true);
    expect(res.redundant).toEqual([]);
    // centre (2) and rotation (1) stay free
    expect(res.dof).toBe(3);
    const e = res.entities.find((x) => x.id === el.id) as SkEllipse;
    expect(e.rx).toBeCloseTo(15, 9);
    expect(e.ry).toBeCloseTo(6, 9);
    expect(e.rot).toBeCloseTo(0.3, 9);
  });

  it('draws the dimension across the chosen axis', () => {
    const { d, el } = ellipseSketch();
    const g = dimensionGeometry({ id: 'q', type: 'diameter', refs: [el.id], variant: 1 }, entityMap(d.entities), 0.1)!;
    // arrow tips at the ends of the second axis, offset sideways along the first axis
    const ax: [number, number] = [-Math.sin(0.3), Math.cos(0.3)];
    const along = g.arrows.map((a) => a.tip[0] * ax[0] + a.tip[1] * ax[1]).sort((p, q) => p - q);
    expect(along[0]).toBeCloseTo(-4, 9);
    expect(along[1]).toBeCloseTo(4, 9);
  });
});
