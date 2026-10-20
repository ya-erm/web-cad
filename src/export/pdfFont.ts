// The font a PDF embeds for text the standard Helvetica (WinAnsi) cannot show — Cyrillic and the rest: the sketches'
// sans (Inter, SIL OFL — see sketch/fonts/OFL.txt), its TrueType data taken out of the bundled WOFF.

import opentype from 'opentype.js';
import { unzlibSync, zlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { FONT_FILES } from '../sketch/text';
import type { PdfFont } from './pdf';

/** The sfnt (TrueType / OpenType) inside a WOFF 1.0 file: its tables inflated and laid out again; other data as it is. */
export function sfntOfWoff(woff: Uint8Array): Uint8Array {
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (dv.getUint32(0) !== 0x774f4646) return woff;
  const flavor = dv.getUint32(4);
  const n = dv.getUint16(12);
  const tables: { tag: number; sum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const off = dv.getUint32(o + 4);
    const comp = dv.getUint32(o + 8);
    const orig = dv.getUint32(o + 12);
    const raw = woff.subarray(off, off + comp);
    tables.push({ tag: dv.getUint32(o), sum: dv.getUint32(o + 16), data: comp < orig ? unzlibSync(raw) : raw });
  }
  tables.sort((a, b) => a.tag - b.tag);
  const pad = (k: number) => (k + 3) & ~3;
  const out = new Uint8Array(12 + 16 * n + tables.reduce((s, t) => s + pad(t.data.length), 0));
  const ov = new DataView(out.buffer);
  const es = Math.floor(Math.log2(n));
  const range = 16 * 2 ** es;
  ov.setUint32(0, flavor);
  ov.setUint16(4, n);
  ov.setUint16(6, range);
  ov.setUint16(8, es);
  ov.setUint16(10, n * 16 - range);
  let at = 12 + 16 * n;
  tables.forEach((t, i) => {
    const r = 12 + 16 * i;
    ov.setUint32(r, t.tag);
    ov.setUint32(r + 4, t.sum);
    ov.setUint32(r + 8, at);
    ov.setUint32(r + 12, t.data.length);
    out.set(t.data, at);
    at += pad(t.data.length);
  });
  return out;
}

/** A font for `writePDF` from a TrueType font file (or its WOFF). */
export function pdfFontOf(bytes: ArrayBuffer, name = 'Inter-Regular'): PdfFont {
  const font = opentype.parse(bytes);
  const sfnt = sfntOfWoff(new Uint8Array(bytes));
  const head = font.tables.head ?? { xMin: 0, yMin: font.descender, xMax: font.unitsPerEm, yMax: font.ascender };
  return {
    name,
    file: zlibSync(sfnt),
    length: sfnt.length,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascender,
    descent: font.descender,
    capHeight: font.tables.os2?.sCapHeight ?? font.ascender * 0.7,
    bbox: [head.xMin, head.yMin, head.xMax, head.yMax],
    glyph: (cp) => font.charToGlyph(String.fromCodePoint(cp)).index,
    advance: (gid) => font.glyphs.get(gid)?.advanceWidth ?? 0,
  };
}

let loading: Promise<PdfFont> | null = null;

/** The PDF font, fetched once (a failure is retried the next time). */
export function loadPdfFont(): Promise<PdfFont> {
  loading ??= fetch(FONT_FILES.sans)
    .then((r) => {
      if (!r.ok) throw new Error(`PDF font: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => pdfFontOf(b))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
