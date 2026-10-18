import { describe, expect, it } from 'vitest';
import { encodePdfLiteral, writePDF } from './pdf';
import type { Prim2D } from './prim2d';

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

const prims: Prim2D[] = [
  { t: 'line', a: [10, 10], b: [100, 10] },
  { t: 'line', a: [10, 20], b: [100, 20], style: 'hidden' },
  { t: 'arc', c: [50, 50], r: 20, a0: 0, a1: Math.PI * 1.5, style: 'center' },
  { t: 'circle', c: [150, 50], r: 10 },
  { t: 'ellipse', c: [150, 120], rx: 20, ry: 10, rot: 0.3 },
  { t: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: true },
  { t: 'text', p: [20, 200], text: 'Hello (world) \\ Ø20 Привет', h: 5, align: 'center', vAlign: 'middle', angle: 0.5 },
  { t: 'arrow', tip: [100, 100], dir: [1, 0], size: 3 },
  { t: 'fill', pts: [[0, 0], [5, 0], [5, 5], [0, 5]], color: '#e0e0e0' },
];

describe('writePDF', () => {
  const bytes = writePDF(
    [
      { width: 297, height: 210, prims },
      { width: 210, height: 297, prims: [] },
    ],
    { title: 'Чертёж (test)' },
  );
  const text = latin1(bytes);

  it('has PDF header and trailer markers', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has an xref table whose offsets point at every object', () => {
    const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const head = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
    expect(head).not.toBeNull();
    const size = Number(head![1]);
    expect(size).toBe(1 + 4 + 2 * 2);
    let o = startxref + head![0].length;
    for (let i = 0; i < size; i++) {
      const entry = text.slice(o, o + 20);
      expect(entry).toMatch(/^\d{10} \d{5} [nf]\r\n$/);
      if (i > 0) {
        const off = Number(entry.slice(0, 10));
        expect(text.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
      }
      o += 20;
    }
    expect(text).toMatch(new RegExp(`/Size ${size}\\b`));
  });

  it('stream lengths match their content', () => {
    const re = /<< \/Length (\d+) >>\nstream\n/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length;
      const len = Number(m[1]);
      expect(text.slice(start + len, start + len + 10)).toBe('\nendstream');
      count++;
    }
    expect(count).toBe(2);
  });

  it('uses Helvetica/WinAnsi, mm scaling and Bézier arcs', () => {
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/WinAnsiEncoding');
    expect(text).toContain('2.834646 0 0 2.834646 0 0 cm');
    expect(text).toMatch(/ c\n/);
    expect(text).toContain('[3 1.5] 0 d');
    expect(text).toContain(' Tm (');
    expect(text).toMatch(/MediaBox \[0 0 841\.8898 595\.2756\]/);
  });

  it('only contains a few non-ASCII bytes (binary marker)', () => {
    const high = [...bytes].filter((b) => b > 126).length;
    expect(high).toBe(4);
  });
});

describe('encodePdfLiteral', () => {
  it('escapes delimiters and maps to WinAnsi', () => {
    expect(encodePdfLiteral('a(b)c\\')).toBe('a\\(b\\)c\\\\');
    expect(encodePdfLiteral('Ø°')).toBe('\\330\\260');
    expect(encodePdfLiteral('Жx')).toBe('?x');
    expect(encodePdfLiteral('€')).toBe('\\200');
  });
});
