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

/** An sfnt's tables by tag. */
function sfntTables(sfnt: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < dv.getUint16(4); i++) {
    const r = 12 + 16 * i;
    out.set(String.fromCharCode(...sfnt.subarray(r, r + 4)), sfnt.subarray(dv.getUint32(r + 8), dv.getUint32(r + 8) + dv.getUint32(r + 12)));
  }
  return out;
}

/** The sum of a table's (or a file's) big-endian 32-bit words, zero-padded. */
function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + (((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0)) >>> 0;
  return sum;
}

/** A TrueType file of these tables (sorted by tag; checksums and head's adjustment set). */
function sfntOf(tables: Map<string, Uint8Array>): Uint8Array {
  const list = [...tables].sort(([a], [b]) => (a < b ? -1 : 1));
  const pad = (k: number) => (k + 3) & ~3;
  const n = list.length;
  const out = new Uint8Array(12 + 16 * n + list.reduce((s, [, d]) => s + pad(d.length), 0));
  const dv = new DataView(out.buffer);
  const es = Math.floor(Math.log2(n));
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, n);
  dv.setUint16(6, 16 * 2 ** es);
  dv.setUint16(8, es);
  dv.setUint16(10, n * 16 - 16 * 2 ** es);
  let at = 12 + 16 * n;
  let headAt = -1;
  list.forEach(([tag, data], i) => {
    const r = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[r + k] = tag.charCodeAt(k);
    out.set(data, at);
    // head's checksum: with its adjustment at 0
    if (tag === 'head') {
      headAt = at;
      dv.setUint32(at + 8, 0);
    }
    dv.setUint32(r + 4, checksum(out.subarray(at, at + data.length)));
    dv.setUint32(r + 8, at);
    dv.setUint32(r + 12, data.length);
    at += pad(data.length);
  });
  if (headAt >= 0) dv.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/**
 * A TrueType font with only the glyphs `used` (glyph → its character) and those their composites are made of — the
 * glyphs keep their numbers (the PDF's text codes), the others are left empty; no layout tables (GPOS, GSUB…), no
 * glyph names, a character map of the used ones only.
 */
export function subsetTrueType(sfnt: Uint8Array, used: Map<number, number>): Uint8Array {
  const t = sfntTables(sfnt);
  const head = t.get('head');
  const maxp = t.get('maxp');
  const hhea = t.get('hhea');
  const loca = t.get('loca');
  const glyf = t.get('glyf');
  const hmtx = t.get('hmtx');
  if (!head || !maxp || !hhea || !loca || !glyf || !hmtx) return sfnt;
  const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
  const numGlyphs = view(maxp).getUint16(4);
  const long = view(head).getInt16(50) === 1;
  const lv = view(loca);
  const at = (g: number) => (long ? lv.getUint32(g * 4) : lv.getUint16(g * 2) * 2);
  const gv = view(glyf);
  // the glyphs kept: .notdef, the used ones and the parts of composite glyphs
  const keep = new Set<number>([0]);
  const todo = [...used.keys()].filter((g) => g > 0 && g < numGlyphs);
  while (todo.length) {
    const g = todo.pop()!;
    if (keep.has(g)) continue;
    keep.add(g);
    const s = at(g);
    if (at(g + 1) <= s || gv.getInt16(s) >= 0) continue;
    for (let o = s + 10, more = true; more; ) {
      const flags = gv.getUint16(o);
      todo.push(gv.getUint16(o + 2));
      o += 4 + (flags & 0x0001 ? 4 : 2) + (flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0);
      more = (flags & 0x0020) !== 0;
    }
  }
  // glyf and a long loca: the kept glyphs' data (4-byte aligned), empty ones for the rest
  const pad = (k: number) => (k + 3) & ~3;
  let size = 0;
  for (const g of keep) size += pad(Math.max(0, at(g + 1) - at(g)));
  const newGlyf = new Uint8Array(size);
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const nl = view(newLoca);
  let off = 0;
  for (let g = 0; g < numGlyphs; g++) {
    nl.setUint32(g * 4, off);
    if (!keep.has(g) || at(g + 1) <= at(g)) continue;
    newGlyf.set(glyf.subarray(at(g), at(g + 1)), off);
    off += pad(at(g + 1) - at(g));
  }
  nl.setUint32(numGlyphs * 4, off);
  const newHead = head.slice();
  view(newHead).setInt16(50, 1);
  // metrics of the glyphs left out: zero (the PDF has its own widths)
  const newHmtx = hmtx.slice();
  const hm = view(newHmtx);
  const nh = view(hhea).getUint16(34);
  for (let g = 0; g < numGlyphs; g++)
    if (!keep.has(g)) {
      if (g < nh) hm.setUint32(g * 4, 0);
      else if (nh * 4 + (g - nh) * 2 + 2 <= newHmtx.length) hm.setInt16(nh * 4 + (g - nh) * 2, 0);
    }
  // post without glyph names (version 3)
  const post = t.get('post');
  const newPost = post ? post.slice(0, 32) : undefined;
  if (newPost) view(newPost).setUint32(0, 0x00030000);
  const out = new Map<string, Uint8Array>([
    ['head', newHead],
    ['hhea', hhea],
    ['maxp', maxp],
    ['hmtx', newHmtx],
    ['loca', newLoca],
    ['glyf', newGlyf],
    ['cmap', cmapOf(used)],
  ]);
  if (newPost) out.set('post', newPost);
  for (const tag of ['OS/2', 'name', 'cvt ', 'fpgm', 'prep', 'gasp']) {
    const d = t.get(tag);
    if (d) out.set(tag, d);
  }
  return sfntOf(out);
}

/** A character map (Windows Unicode, format 4) of the used glyphs' characters in the Basic Multilingual Plane. */
function cmapOf(used: Map<number, number>): Uint8Array {
  // (one glyph per character)
  const pairs = [...new Map([...used].filter(([, cp]) => cp > 0 && cp < 0xffff).map(([g, cp]) => [cp, g] as const))].map(([cp, g]) => [g, cp] as const).sort((a, b) => a[1] - b[1]);
  const segs = [...pairs.map(([g, cp]) => ({ cp, delta: (g - cp) & 0xffff })), { cp: 0xffff, delta: 1 }];
  const n = segs.length;
  const sub = 16 + 8 * n;
  const out = new Uint8Array(12 + sub);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1);
  dv.setUint16(4, 3);
  dv.setUint16(6, 1);
  dv.setUint32(8, 12);
  const es = Math.floor(Math.log2(n));
  const o = 12;
  dv.setUint16(o, 4);
  dv.setUint16(o + 2, sub);
  dv.setUint16(o + 6, n * 2);
  dv.setUint16(o + 8, 2 * 2 ** es);
  dv.setUint16(o + 10, es);
  dv.setUint16(o + 12, n * 2 - 2 * 2 ** es);
  segs.forEach((s, i) => {
    dv.setUint16(o + 14 + 2 * i, s.cp);
    dv.setUint16(o + 16 + 2 * n + 2 * i, s.cp);
    dv.setUint16(o + 16 + 4 * n + 2 * i, s.delta);
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
    embed: (used) => {
      const sub = subsetTrueType(sfnt, used);
      return { file: zlibSync(sub), length: sub.length, subset: sub !== sfnt };
    },
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
