import { describe, expect, it } from 'vitest';
import { triangulate, writeDXF } from './dxf';
import type { Prim2D } from './prim2d';

/** Splits a DXF string into [code, value] pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  expect(lines.length % 2).toBe(0);
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    expect(Number.isInteger(code)).toBe(true);
    out.push([code, lines[i + 1]]);
  }
  return out;
}

function entityTypes(dxf: string): string[] {
  const p = pairs(dxf);
  const start = p.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && p[i - 1][1] === 'SECTION');
  const out: string[] = [];
  for (let i = start + 1; i < p.length; i++) {
    const [c, v] = p[i];
    if (c !== 0) continue;
    if (v === 'ENDSEC') break;
    out.push(v);
  }
  return out;
}

const prims: Prim2D[] = [
  { t: 'line', a: [0, 0], b: [100, 0] },
  { t: 'line', a: [0, 0], b: [0, 50], style: 'hidden' },
  { t: 'line', a: [0, 50], b: [100, 50], style: 'center', layer: 'Axes' },
  { t: 'arc', c: [50, 25], r: 10, a0: 0, a1: Math.PI / 2 },
  { t: 'arc', c: [50, 25], r: 5, a0: -Math.PI / 2, a1: Math.PI },
  { t: 'arc', c: [0, 0], r: 5, a0: 0, a1: Math.PI * 2 }, // full turn -> CIRCLE
  { t: 'circle', c: [20, 20], r: 3 },
  { t: 'ellipse', c: [70, 20], rx: 10, ry: 4, rot: 0.2 },
  { t: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: true },
  { t: 'text', p: [5, 5], text: '⌀20 ±0.1 Привет', h: 5, align: 'center', vAlign: 'middle' },
  { t: 'text', p: [5, 15], text: 'plain', h: 3.5 },
  { t: 'arrow', tip: [100, 0], dir: [1, 0], size: 3 },
  { t: 'fill', pts: [[0, 0], [10, 0], [10, 10], [5, 3], [0, 10]] },
];

describe('writeDXF', () => {
  const dxf = writeDXF(prims);

  it('has the required sections and terminates with EOF', () => {
    const p = pairs(dxf);
    const sections = p.filter(([c], i) => c === 2 && i > 0 && p[i - 1][1] === 'SECTION').map(([, v]) => v);
    expect(sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
    expect(p[p.length - 1]).toEqual([0, 'EOF']);
    expect(p.filter(([c, v]) => c === 0 && v === 'SECTION').length).toBe(p.filter(([c, v]) => c === 0 && v === 'ENDSEC').length);
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('$INSUNITS\n 70\n4');
    expect(dxf).toContain('$EXTMIN');
  });

  it('writes the expected number of entities', () => {
    const types = entityTypes(dxf);
    const count = (t: string) => types.filter((x) => x === t).length;
    expect(count('LINE')).toBe(3);
    expect(count('ARC')).toBe(2);
    expect(count('CIRCLE')).toBe(2);
    expect(count('POLYLINE')).toBe(2);
    expect(count('SEQEND')).toBe(2);
    expect(count('TEXT')).toBe(2);
    expect(count('SOLID')).toBe(1 + 3); // arrow + 5-gon fill
  });

  it('defines line types and style layers', () => {
    for (const lt of ['CONTINUOUS', 'DASHED', 'CENTER']) expect(dxf).toMatch(new RegExp(`LTYPE\\n  2\\n${lt}\\n`));
    for (const layer of ['VISIBLE', 'HIDDEN', 'CENTER', 'CONSTRUCTION', 'AXES']) {
      expect(dxf).toMatch(new RegExp(`LAYER\\n  2\\n${layer}\\n`));
    }
  });

  it('writes arcs in degrees and encodes special text', () => {
    expect(dxf).toMatch(/ARC\n {2}8\nVISIBLE\n 10\n50\n 20\n25\n 30\n0\n 40\n10\n 50\n0\n 51\n90\n/);
    expect(dxf).toMatch(/ 50\n270\n 51\n180\n/);
    expect(dxf).toContain('%%c20 %%p0.1 \\U+041F');
  });

  it('converts to inches', () => {
    const inch = writeDXF([{ t: 'line', a: [0, 0], b: [25.4, 50.8] }], { units: 'in' });
    expect(inch).toContain('$INSUNITS\n 70\n1');
    expect(inch).toMatch(/LINE\n {2}8\nVISIBLE\n 10\n0\n 20\n0\n 30\n0\n 11\n1\n 21\n2\n/);
  });
});

describe('triangulate', () => {
  it('triangulates a concave polygon into n-2 triangles covering its area', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 3],
      [0, 10],
    ];
    const tris = triangulate(pts);
    expect(tris.length).toBe(3);
    const area = tris.reduce((s, [a, b, c]) => {
      const [ax, ay] = pts[a];
      const [bx, by] = pts[b];
      const [cx, cy] = pts[c];
      return s + ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    }, 0);
    expect(area).toBeCloseTo(100 - 35, 6);
  });

  it('handles clockwise input', () => {
    expect(triangulate([[0, 0], [0, 1], [1, 1], [1, 0]]).length).toBe(2);
  });
});
