import { describe, expect, it } from 'vitest';
import type { SkEntity, Vec2 } from '../core/types';
import { computeRegions, findRegion, regionAt } from './regions';
import type { ProfileCurve, ProfileLoop, SketchRegion } from './regions';

/** Small sketch builder. */
function sketch() {
  const ents: SkEntity[] = [];
  let n = 0;
  const pt = (x: number, y: number): string => {
    const id = `p${n++}`;
    ents.push({ id, type: 'point', x, y });
    return id;
  };
  const lineP = (p1: string, p2: string, construction = false): string => {
    const id = `l${n++}`;
    ents.push({ id, type: 'line', p1, p2, construction });
    return id;
  };
  const line = (a: Vec2, b: Vec2, construction = false) => lineP(pt(a[0], a[1]), pt(b[0], b[1]), construction);
  const circle = (c: Vec2, r: number, construction = false): string => {
    const id = `c${n++}`;
    ents.push({ id, type: 'circle', c: pt(c[0], c[1]), r, construction });
    return id;
  };
  const arcP = (c: string, p1: string, p2: string): string => {
    const id = `a${n++}`;
    ents.push({ id, type: 'arc', c, p1, p2 });
    return id;
  };
  /** Rectangle with shared corner points; returns line ids [bottom, right, top, left]. */
  const rect = (x0: number, y0: number, x1: number, y1: number): string[] => {
    const a = pt(x0, y0);
    const b = pt(x1, y0);
    const c = pt(x1, y1);
    const d = pt(x0, y1);
    return [lineP(a, b), lineP(b, c), lineP(c, d), lineP(d, a)];
  };
  return { ents, pt, lineP, line, circle, arcP, rect };
}

const byArea = (r: SketchRegion[]) => [...r].sort((a, b) => a.area - b.area);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

function lens(r1: number, r2: number, d: number): number {
  return (
    r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) +
    r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)) -
    0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))
  );
}

function curveEnds(c: ProfileCurve): [Vec2, Vec2] | null {
  switch (c.kind) {
    case 'line':
      return [c.a, c.b];
    case 'arc':
    case 'ellipseArc':
      return [c.start, c.end];
    case 'spline':
      return [c.pts[0], c.pts[c.pts.length - 1]];
    default:
      return null;
  }
}

function checkLoop(l: ProfileLoop) {
  const cs = l.curves;
  if (cs.length === 1 && !curveEnds(cs[0])) return;
  for (let i = 0; i < cs.length; i++) {
    const a = curveEnds(cs[i]);
    const b = curveEnds(cs[(i + 1) % cs.length]);
    expect(a && b).toBeTruthy();
    if (a && b) expect(Math.hypot(a[1][0] - b[0][0], a[1][1] - b[0][1])).toBeLessThan(1e-9);
  }
}

function checkInvariants(regions: SketchRegion[]) {
  for (const r of regions) {
    checkLoop(r.outer);
    r.holes.forEach(checkLoop);
    expect(r.area).toBeGreaterThan(0);
    expect(r.outer.area).toBeGreaterThan(0);
    for (const h of r.holes) expect(h.area).toBeLessThan(0);
    expect(r.area).toBeCloseTo(r.outer.area + r.holes.reduce((s, h) => s + h.area, 0), 9);
    // key point is inside this region and no other
    expect(regionAt(regions, r.key.pt)).toBe(r);
    expect([...r.key.ents].sort()).toEqual(r.key.ents);
    expect(new Set(r.key.ents).size).toBe(r.key.ents.length);
  }
}

describe('computeRegions', () => {
  it('rectangle of 4 lines → 1 region with area w*h', () => {
    const s = sketch();
    const ids = s.rect(1, 2, 5, 4.5);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    const r = regions[0];
    expect(r.area).toBeCloseTo(4 * 2.5, 12);
    expect(r.holes.length).toBe(0);
    expect(r.outer.curves.length).toBe(4);
    expect(r.outer.curves.every((c) => c.kind === 'line')).toBe(true);
    expect(r.key.ents).toEqual([...ids].sort());
    expect(r.centroid[0]).toBeCloseTo(3, 9);
    expect(r.centroid[1]).toBeCloseTo(3.25, 9);
    // loop is closed and CCW
    const cs = r.outer.curves;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % cs.length];
      if (a.kind === 'line' && b.kind === 'line') expect(a.b).toEqual(b.a);
    }
    checkInvariants(regions);
  });

  it('rectangle from separate (coincident) points still closes', () => {
    const s = sketch();
    s.line([0, 0], [3, 0]);
    s.line([3, 0], [3, 2]);
    s.line([3, 2], [0, 2]);
    s.line([0, 2], [0, 0]);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(regions[0].area).toBeCloseTo(6, 12);
  });

  it('rectangle with a circle inside → annulus with one hole + disk', () => {
    const s = sketch();
    s.rect(0, 0, 10, 6);
    const c = s.circle([4, 3], 2);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(2);
    const [disk, ann] = regions;
    expect(rel(disk.area, Math.PI * 4)).toBeLessThan(1e-6);
    expect(rel(ann.area, 60 - Math.PI * 4)).toBeLessThan(1e-6);
    expect(disk.holes.length).toBe(0);
    expect(ann.holes.length).toBe(1);
    expect(disk.outer.curves).toEqual([{ kind: 'circle', ent: c, c: [4, 3], r: 2 }]);
    expect(ann.holes[0].curves[0].kind).toBe('circle');
    expect(ann.holes[0].area).toBeLessThan(0);
    expect(ann.key.ents).toContain(c);
    expect(disk.key.ents).toEqual([c]);
    expect(ann.holePolygons.length).toBe(1);
    checkInvariants(regions);
  });

  it('two overlapping circles → 3 regions (lens formula)', () => {
    const s = sketch();
    s.circle([0, 0], 2);
    s.circle([2.5, 0.5], 1.5);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(3);
    const d = Math.hypot(2.5, 0.5);
    const L = lens(2, 1.5, d);
    const expected = [L, Math.PI * 1.5 * 1.5 - L, Math.PI * 4 - L].sort((a, b) => a - b);
    regions.forEach((r, i) => expect(rel(r.area, expected[i])).toBeLessThan(1e-6));
    for (const r of regions) {
      expect(r.outer.curves.length).toBe(2);
      expect(r.outer.curves.every((c) => c.kind === 'arc')).toBe(true);
    }
    checkInvariants(regions);
  });

  it('rectangle split by a line across → 2 regions', () => {
    const s = sketch();
    s.rect(0, 0, 4, 2);
    s.line([1, -1], [3, 3]); // crosses bottom and top, dangling ends outside
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(2);
    // line x = 1 + (y + 1) / 2 → at y=0: 1.5, at y=2: 2.5 → left area = (1.5 + 2.5) / 2 * 2 = 4
    expect(regions[0].area).toBeCloseTo(4, 10);
    expect(regions[1].area).toBeCloseTo(4, 10);
    expect(regions[0].area + regions[1].area).toBeCloseTo(8, 10);
    checkInvariants(regions);
  });

  it('T-junctions (end point on another line interior) split the curves', () => {
    const s = sketch();
    s.rect(0, 0, 4, 2);
    s.line([1, 2], [1, 0]); // both ends on the rectangle sides (no shared points)
    s.line([3, 2], [3, 1]); // dangling stub touching the top side
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(2);
    expect(regions[0].area).toBeCloseTo(2, 10);
    expect(regions[1].area).toBeCloseTo(6, 10);
    // the big region's top edge is split at the T-junction but merged back in the profile
    const big = regions[1];
    expect(big.outer.curves.length).toBe(4);
    checkInvariants(regions);
  });

  it('tangent line + dangling lines produce no spurious regions', () => {
    const s = sketch();
    s.circle([0, 0], 1);
    s.line([-2, 1], [2, 1]); // tangent at (0, 1)
    s.line([0, -3], [0, -1]); // touches circle at bottom
    s.line([3, 3], [4, 4]); // isolated
    s.line([3, 0], [5, 0]);
    s.line([4, -1], [4, 1]); // crossing pair, no closed area
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(rel(regions[0].area, Math.PI)).toBeLessThan(1e-9);
    expect(regions[0].outer.curves).toHaveLength(1);
    expect(regions[0].outer.curves[0].kind).toBe('circle');
    checkInvariants(regions);
  });

  it('circle inscribed in a square (tangent at 4 points) → disk + 4 corners', () => {
    const s = sketch();
    s.rect(-1, -1, 1, 1);
    s.circle([0, 0], 1);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(5);
    for (let i = 0; i < 4; i++) expect(rel(regions[i].area, (4 - Math.PI) / 4)).toBeLessThan(1e-6);
    expect(rel(regions[4].area, Math.PI)).toBeLessThan(1e-6);
    checkInvariants(regions);
  });

  it('arc + line closed "D" shape', () => {
    const s = sketch();
    const c = s.pt(0, 0);
    const a = s.pt(0, -1);
    const b = s.pt(0, 1);
    const arc = s.arcP(c, a, b); // right half, CCW from bottom to top
    const ln = s.lineP(b, a);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(rel(regions[0].area, Math.PI / 2)).toBeLessThan(1e-9);
    expect(regions[0].key.ents).toEqual([arc, ln].sort());
    const curves = regions[0].outer.curves;
    expect(curves.length).toBe(2);
    const ac = curves.find((x) => x.kind === 'arc');
    expect(ac && ac.kind === 'arc' && ac.ccw).toBe(true);
    checkInvariants(regions);
  });

  it('D shape with p2 slightly off radius uses the angle of p2', () => {
    const s = sketch();
    const c = s.pt(0, 0);
    const a = s.pt(0, -1);
    const b = s.pt(0, 1 + 1e-4);
    s.arcP(c, a, b);
    s.lineP(b, a);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(Math.abs(regions[0].area - Math.PI / 2)).toBeLessThan(1e-3);
  });

  it('reversed D (line on the arc side traversed CW)', () => {
    const s = sketch();
    const c = s.pt(0, 0);
    const a = s.pt(1, 0);
    const b = s.pt(-1, 0);
    s.arcP(c, a, b); // upper half
    s.lineP(a, b);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(rel(regions[0].area, Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('slot shape (2 lines + 2 arcs)', () => {
    const s = sketch();
    const c1 = s.pt(0, 0);
    const c2 = s.pt(4, 0);
    const p1 = s.pt(0, 1);
    const p2 = s.pt(0, -1);
    const p3 = s.pt(4, -1);
    const p4 = s.pt(4, 1);
    s.arcP(c1, p1, p2); // left cap
    s.lineP(p2, p3);
    s.arcP(c2, p3, p4); // right cap
    s.lineP(p4, p1);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(rel(regions[0].area, 8 + Math.PI)).toBeLessThan(1e-9);
    expect(regions[0].outer.curves.map((c) => c.kind).sort()).toEqual(['arc', 'arc', 'line', 'line']);
    checkInvariants(regions);
  });

  it('closed spline → 1 region', () => {
    const s = sketch();
    const ids = [s.pt(0, 0), s.pt(4, -1), s.pt(5, 3), s.pt(1, 4)];
    s.ents.push({ id: 'spl', type: 'spline', pts: ids, closed: true });
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    // the smooth curve through the 4 points bulges outside the polygon through them (area 16.5)
    expect(regions[0].area).toBeGreaterThan(16.5);
    expect(regions[0].area).toBeLessThan(30);
    expect(regions[0].outer.curves[0].kind).toBe('spline');
    expect(regions[0].key.ents).toEqual(['spl']);
    checkInvariants(regions);
  });

  it('open spline closed by a line', () => {
    const s = sketch();
    const a = s.pt(0, 0);
    const b = s.pt(4, 0);
    s.ents.push({ id: 'spl', type: 'spline', pts: [a, s.pt(2, 2), b] });
    s.lineP(a, b);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(regions[0].area).toBeGreaterThan(3);
    expect(regions[0].area).toBeLessThan(8);
  });

  it('ellipse regions use exact areas', () => {
    const s = sketch();
    const c = s.pt(1, 1);
    s.ents.push({ id: 'el', type: 'ellipse', c, rx: 3, ry: 1.5, rot: 0.3 });
    const one = computeRegions(s.ents);
    expect(one.length).toBe(1);
    expect(rel(one[0].area, Math.PI * 4.5)).toBeLessThan(1e-9);
    expect(one[0].outer.curves[0].kind).toBe('ellipse');
    // split through the centre along the major axis
    const d: Vec2 = [Math.cos(0.3) * 5, Math.sin(0.3) * 5];
    s.line([1 - d[0], 1 - d[1]], [1 + d[0], 1 + d[1]]);
    const two = computeRegions(s.ents);
    expect(two.length).toBe(2);
    for (const r of two) {
      expect(rel(r.area, (Math.PI * 4.5) / 2)).toBeLessThan(1e-6);
      expect(r.outer.curves.map((x) => x.kind).sort()).toEqual(['ellipseArc', 'line']);
    }
    checkInvariants(two);
  });

  it('construction geometry and points are ignored', () => {
    const s = sketch();
    s.rect(0, 0, 2, 2);
    s.line([0, 0], [2, 2], true);
    s.circle([1, 1], 0.5, true);
    s.pt(1, 1.5);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(regions[0].area).toBeCloseTo(4, 12);
    expect(regions[0].key.ents.length).toBe(4);
  });

  it('nested components: rect ⊃ circle ⊃ circle', () => {
    const s = sketch();
    s.rect(-5, -5, 5, 5);
    s.circle([0, 0], 3);
    s.circle([0.5, 0], 1);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(3);
    expect(rel(regions[0].area, Math.PI)).toBeLessThan(1e-9);
    expect(rel(regions[1].area, Math.PI * 8)).toBeLessThan(1e-9);
    expect(rel(regions[2].area, 100 - Math.PI * 9)).toBeLessThan(1e-9);
    expect(regions.map((r) => r.holes.length)).toEqual([0, 1, 1]);
    checkInvariants(regions);
  });

  it('two externally tangent circles inside a rectangle', () => {
    const s = sketch();
    s.rect(-4, -2, 4, 2);
    s.circle([-1, 0], 1);
    s.circle([1, 0], 1);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(3);
    expect(rel(regions[0].area, Math.PI)).toBeLessThan(1e-9);
    expect(rel(regions[1].area, Math.PI)).toBeLessThan(1e-9);
    expect(rel(regions[2].area, 32 - 2 * Math.PI)).toBeLessThan(1e-9);
    expect(regions[2].holes.length).toBe(2);
    checkInvariants(regions);
  });

  it('overlapping collinear duplicates are deduplicated', () => {
    const s = sketch();
    s.rect(0, 0, 4, 2);
    s.line([4, 2], [0, 2]); // exact duplicate of the top side
    s.line([1, 0], [3, 0]); // partial overlap on the bottom
    s.line([3, 0], [6, 0]); // overlap extending outside
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(regions[0].area).toBeCloseTo(8, 10);
  });

  it('a bridge line between outer boundary and inner circle does not break the hole', () => {
    const s = sketch();
    s.rect(0, 0, 10, 10);
    s.circle([5, 5], 2);
    s.line([0, 5], [3, 5]); // from left side to the circle
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(2);
    expect(rel(regions[1].area, 100 - 4 * Math.PI)).toBeLessThan(1e-9);
    expect(regions[1].holes.length).toBe(1);
  });

  it('circle crossing a rectangle side → 3 regions', () => {
    const s = sketch();
    s.rect(0, 0, 4, 4);
    s.circle([4, 2], 1);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(3);
    expect(rel(regions[0].area, Math.PI / 2)).toBeLessThan(1e-9);
    expect(rel(regions[1].area, Math.PI / 2)).toBeLessThan(1e-9);
    expect(rel(regions[2].area, 16 - Math.PI / 2)).toBeLessThan(1e-9);
    checkInvariants(regions);
  });

  it('circle internally tangent to a rectangle side (pinched hole)', () => {
    const s = sketch();
    s.rect(0, 0, 4, 4);
    s.circle([2, 3], 1); // touches the top side at (2, 4)
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(2);
    expect(rel(regions[0].area, Math.PI)).toBeLessThan(1e-9);
    expect(rel(regions[1].area, 16 - Math.PI)).toBeLessThan(1e-9);
    expect(regions[1].holes.length).toBe(1);
    checkInvariants(regions);
  });

  it('internally tangent circles → disk + crescent', () => {
    const s = sketch();
    s.circle([0, 0], 2);
    s.circle([1, 0], 1);
    const regions = byArea(computeRegions(s.ents));
    expect(regions.length).toBe(2);
    expect(rel(regions[0].area, Math.PI)).toBeLessThan(1e-9);
    expect(rel(regions[1].area, 3 * Math.PI)).toBeLessThan(1e-9);
    checkInvariants(regions);
  });

  it('tic-tac-toe lines inside a square → 9 regions', () => {
    const s = sketch();
    s.rect(0, 0, 3, 3);
    s.line([1, -0.5], [1, 3.5]);
    s.line([2, -0.5], [2, 3.5]);
    s.line([-0.5, 1], [3.5, 1]);
    s.line([-0.5, 2], [3.5, 2]);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(9);
    for (const r of regions) expect(r.area).toBeCloseTo(1, 12);
    checkInvariants(regions);
  });

  it('figure-eight closed spline → 2 regions', () => {
    const s = sketch();
    // bow-tie point order makes the closed curve cross itself once
    const bow = [s.pt(-2, 1), s.pt(2, -1), s.pt(2, 1), s.pt(-2, -1)];
    s.ents.push({ id: 'eight', type: 'spline', pts: bow, closed: true });
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(2);
    expect(regions[0].area).toBeCloseTo(regions[1].area, 6);
    for (const r of regions) expect(r.key.ents).toEqual(['eight']);
    checkInvariants(regions);
  });

  it('ellipse / circle overlap: areas consistent with exact full areas', () => {
    const s = sketch();
    const c = s.pt(0, 0);
    s.ents.push({ id: 'el', type: 'ellipse', c, rx: 3, ry: 1, rot: 0.2 });
    s.circle([2, 0.5], 1.2);
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(3);
    const both = regions.filter((r) => r.key.ents.length === 2);
    expect(both.length).toBe(3);
    // classify by whether the key point is inside ellipse / circle
    const inEl = (p: Vec2) => {
      const q = [Math.cos(-0.2) * p[0] - Math.sin(-0.2) * p[1], Math.sin(-0.2) * p[0] + Math.cos(-0.2) * p[1]];
      return (q[0] / 3) ** 2 + q[1] ** 2 < 1;
    };
    const inC = (p: Vec2) => Math.hypot(p[0] - 2, p[1] - 0.5) < 1.2;
    const lensR = regions.find((r) => inEl(r.key.pt) && inC(r.key.pt));
    const elOnly = regions.find((r) => inEl(r.key.pt) && !inC(r.key.pt));
    const cOnly = regions.find((r) => !inEl(r.key.pt) && inC(r.key.pt));
    expect(lensR && elOnly && cOnly).toBeTruthy();
    if (lensR && elOnly && cOnly) {
      expect(rel(lensR.area + elOnly.area, Math.PI * 3)).toBeLessThan(1e-9);
      expect(rel(lensR.area + cOnly.area, Math.PI * 1.44)).toBeLessThan(1e-9);
    }
    checkInvariants(regions);
  });

  it('rounded rectangle (tangent fillet arcs sharing end points)', () => {
    const s = sketch();
    const [w, h, r] = [6, 4, 1];
    const P = [
      s.pt(r, 0),
      s.pt(w - r, 0),
      s.pt(w, r),
      s.pt(w, h - r),
      s.pt(w - r, h),
      s.pt(r, h),
      s.pt(0, h - r),
      s.pt(0, r),
    ];
    const C = [s.pt(w - r, r), s.pt(w - r, h - r), s.pt(r, h - r), s.pt(r, r)];
    s.lineP(P[0], P[1]);
    s.arcP(C[0], P[1], P[2]);
    s.lineP(P[2], P[3]);
    s.arcP(C[1], P[3], P[4]);
    s.lineP(P[4], P[5]);
    s.arcP(C[2], P[5], P[6]);
    s.lineP(P[6], P[7]);
    s.arcP(C[3], P[7], P[0]);
    // a line leaving tangentially from a fillet end point (degree-3 vertex with tangent edges)
    s.lineP(P[1], s.pt(w + 3, 0));
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(rel(regions[0].area, w * h - (4 - Math.PI) * r * r)).toBeLessThan(1e-9);
    expect(regions[0].outer.curves.length).toBe(8);
    checkInvariants(regions);
  });

  it('circle made of two arcs plus a duplicate circle on top', () => {
    const s = sketch();
    const c = s.pt(0, 0);
    const a = s.pt(1, 0);
    const b = s.pt(-1, 0);
    s.arcP(c, a, b);
    s.arcP(c, b, a);
    s.ents.push({ id: 'dup', type: 'circle', c, r: 1 });
    const regions = computeRegions(s.ents);
    expect(regions.length).toBe(1);
    expect(rel(regions[0].area, Math.PI)).toBeLessThan(1e-9);
    checkInvariants(regions);
  });

  it('empty / degenerate input', () => {
    expect(computeRegions([])).toEqual([]);
    const s = sketch();
    s.line([0, 0], [0, 0]);
    s.circle([0, 0], 0);
    expect(computeRegions(s.ents)).toEqual([]);
  });
});

describe('findRegion / regionAt', () => {
  it('findRegion after moving a vertex slightly still matches', () => {
    const s = sketch();
    s.rect(0, 0, 4, 2);
    const top = s.pt(1, 2);
    const bot = s.pt(1.2, 0);
    s.lineP(top, bot);
    const before = byArea(computeRegions(s.ents));
    expect(before.length).toBe(2);
    const key = before[0].key; // left (small) region
    const p = s.ents.find((e) => e.id === top);
    if (p && p.type === 'point') p.x = 1.15;
    const after = computeRegions(s.ents);
    const found = findRegion(after, key);
    expect(found).not.toBeNull();
    expect(found?.key.ents).toEqual(key.ents);
    expect(found?.area).toBeCloseTo(((1.15 + 1.2) / 2) * 2, 9);
  });

  it('ties are resolved by the key point (overlapping circles)', () => {
    const s = sketch();
    const c1 = s.circle([0, 0], 2);
    s.circle([2.5, 0], 2);
    const before = computeRegions(s.ents);
    const lensRegion = byArea(before)[0];
    const c = s.ents.find((e) => e.id === c1);
    if (c && c.type === 'circle') c.r = 2.1;
    const after = computeRegions(s.ents);
    expect(after.length).toBe(3);
    const f = findRegion(after, lensRegion.key);
    expect(f).toBe(byArea(after)[0]);
    // all three regions share the same entity set → each original key re-finds its own counterpart
    for (const r of before) {
      const g = findRegion(after, r.key);
      expect(g).not.toBeNull();
      expect(g ? Math.abs(g.area - r.area) / r.area : 1).toBeLessThan(0.2);
    }
  });

  it('findRegion returns null when nothing plausible', () => {
    const s = sketch();
    s.rect(0, 0, 1, 1);
    const regions = computeRegions(s.ents);
    expect(findRegion(regions, { ents: ['nope'], pt: [5, 5] })).toBeNull();
    expect(findRegion([], { ents: ['nope'], pt: [0.5, 0.5] })).toBeNull();
    expect(findRegion(regions, { ents: ['nope'], pt: [0.5, 0.5] })).toBe(regions[0]);
  });

  it('regionAt picks the inner disk, not the annulus', () => {
    const s = sketch();
    s.rect(0, 0, 10, 10);
    const c = s.circle([5, 5], 2);
    const regions = computeRegions(s.ents);
    const inner = regionAt(regions, [5, 5]);
    expect(inner?.key.ents).toEqual([c]);
    const ann = regionAt(regions, [1, 1]);
    expect(ann?.holes.length).toBe(1);
    expect(regionAt(regions, [20, 20])).toBeNull();
  });
});

describe('performance', () => {
  it('200 curves in well under budget', () => {
    const s = sketch();
    // 20 x 20 grid of lines (40 curves) + 160 circles scattered over it
    for (let i = 0; i < 20; i++) {
      s.line([-1, i * 5], [100, i * 5]);
      s.line([i * 5, -1], [i * 5, 100]);
    }
    for (let i = 0; i < 160; i++) {
      const x = 3 + (i % 16) * 6 + (i % 3) * 0.37;
      const y = 3 + Math.floor(i / 16) * 9 + (i % 5) * 0.21;
      s.circle([x, y], 1.2 + (i % 4) * 0.4);
    }
    computeRegions(s.ents); // warm-up
    const t0 = performance.now();
    const regions = computeRegions(s.ents);
    const ms = performance.now() - t0;
    expect(regions.length).toBeGreaterThan(361);
    expect(ms).toBeLessThan(process.env.CI ? 1000 : 200); // looser on shared CI runners
    const total = regions.reduce((a, r) => a + r.area, 0);
    // union of everything inside the grid square plus circle parts outside it
    expect(total).toBeGreaterThan(95 * 95);
  });
});
