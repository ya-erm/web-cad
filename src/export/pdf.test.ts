import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { encodePdfLiteral, writePDF } from './pdf';
import opentype from 'opentype.js';
import { pdfFontOf, sfntOfWoff } from './pdfFont';
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

describe('writePDF with an embedded font (Cyrillic)', () => {
  const file = readFileSync(fileURLToPath(new URL('../sketch/fonts/Inter-Regular.woff', import.meta.url)));
  const font = pdfFontOf(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const text = latin1(writePDF([{ width: 297, height: 210, prims }], { title: 'Чертёж', font }));

  it('takes the TrueType font out of the WOFF', () => {
    const sfnt = sfntOfWoff(new Uint8Array(file));
    expect(new DataView(sfnt.buffer).getUint32(0)).toBe(0x00010000);
    expect(font.glyph('Ж'.codePointAt(0)!)).toBeGreaterThan(0);
  });

  it('embeds only the glyphs the text uses, under their own numbers', () => {
    const fileObj = Number(/\/FontFile2 (\d+) 0 R/.exec(text)![1]);
    const obj = text.slice(text.indexOf(`\n${fileObj} 0 obj\n`));
    const data = obj.slice(obj.indexOf('stream\n') + 7, obj.indexOf('\nendstream'));
    const zipped = Uint8Array.from(data, (ch) => ch.charCodeAt(0));
    // a few kilobytes, not the whole font (~140 KB compressed)
    expect(zipped.length).toBeLessThan(20000);
    const sub = unzlibSync(zipped);
    expect(Number(/\/Length1 (\d+)/.exec(obj)![1])).toBe(sub.length);
    const parsed = opentype.parse(sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength) as ArrayBuffer);
    const whole = opentype.parse(sfntOfWoff(new Uint8Array(file)).slice().buffer as ArrayBuffer);
    // "П" where it was, with its outline; "Ж" (not in the text) left empty
    const p = font.glyph(0x41f);
    expect(parsed.glyphs.get(p).getPath(0, 0, 100).toPathData(2)).toBe(whole.glyphs.get(p).getPath(0, 0, 100).toPathData(2));
    expect(parsed.glyphs.get(p).getPath(0, 0, 100).commands.length).toBeGreaterThan(0);
    expect(parsed.glyphs.get(font.glyph('Ж'.codePointAt(0)!)).getPath(0, 0, 100).commands.length).toBe(0);
    // its own small character map
    expect(parsed.charToGlyph('П').index).toBe(p);
    // the name with a subset tag
    expect(text).toMatch(/\/FontName \/[A-Z]{6}\+Inter-Regular/);
  });

  it('embeds it as a CID font for all the text, with widths and a ToUnicode map', () => {
    expect(text).toMatch(/\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+Inter-Regular \/Encoding \/Identity-H/);
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).toMatch(/\/FontFile2 \d+ 0 R/);
    expect(text).toMatch(/\/Length1 \d+ \/Filter \/FlateDecode/);
    // the text as glyph ids, not WinAnsi; no "?" for the Cyrillic letters
    expect(text).toMatch(/\/F2 5 Tf [^\n]* Tm <[0-9A-F]+> Tj ET/);
    expect(text).not.toContain(' Tm (');
    // "П" (U+041F) is mapped back to its character
    const g = font.glyph(0x41f).toString(16).toUpperCase().padStart(4, '0');
    expect(text).toContain(`<${g}> <041F>`);
    expect(text).toMatch(/\/W \[\d+ \[\d+\]/);
  });

  it('keeps the xref right with the binary font stream', () => {
    const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
    const size = Number(/^xref\n0 (\d+)\n/.exec(text.slice(startxref))![1]);
    expect(size).toBe(1 + 4 + 2 + 5);
    const o = startxref + `xref\n0 ${size}\n`.length;
    for (let i = 1; i < size; i++) {
      const off = Number(text.slice(o + 20 * i, o + 20 * i + 10));
      expect(text.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });

  it('stays with Helvetica when all the text is WinAnsi', () => {
    const latin = latin1(writePDF([{ width: 100, height: 100, prims: [{ t: 'text', p: [10, 10], text: 'Ø20 (A)', h: 5 }] }], { font }));
    expect(latin).not.toContain('/FontFile2');
    expect(latin).toContain(' Tm (');
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
