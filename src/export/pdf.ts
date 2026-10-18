// Minimal PDF 1.4 writer: vector content streams (uncompressed) + the standard Type1
// Helvetica font with WinAnsi encoding. Page content is drawn in millimetres via a `cm`
// scale, so line widths, dash patterns and font sizes are all specified in mm.

import type { Vec2 } from '../core/types';
import {
  type LineStyle,
  type Prim2D,
  STYLE_DEFAULTS,
  TAU,
  arcSweep,
  arrowTriangle,
  fmtNum,
  isFullSweep,
  parseColor,
  primColor,
  primStyle,
  textFrame,
  toWinAnsi,
} from './prim2d';

export interface PDFPage {
  /** Page width in mm. */
  width: number;
  /** Page height in mm. */
  height: number;
  prims: Prim2D[];
}

export interface PDFOptions {
  title?: string;
}

export const PT_PER_MM = 72 / 25.4;

const num = (v: number) => fmtNum(v, 4);

/** Encodes a string as a PDF literal string body in WinAnsi; unrepresentable chars become '?'. */
export function encodePdfLiteral(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63;
    const b = cp < 32 ? 32 : (toWinAnsi(cp) ?? 63);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out;
}

/** PDF text string (document metadata): plain literal for ASCII, UTF-16BE hex otherwise. */
function pdfTextString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[()\\]/g, (c) => '\\' + c)})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

function rgb(color: string): string {
  const c = parseColor(color) ?? [0, 0, 0, 255];
  return `${fmtNum(c[0] / 255, 3)} ${fmtNum(c[1] / 255, 3)} ${fmtNum(c[2] / 255, 3)}`;
}

/**
 * Cubic Bézier approximation of an elliptical arc (≤ 90° per segment), CCW from parameter t0
 * through `sweep`. Returns path operators starting with `m`.
 */
function ellipseArcPath(c: Vec2, rx: number, ry: number, rot: number, t0: number, sweep: number): string[] {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const pt = (t: number): Vec2 => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [c[0] + x * cr - y * sr, c[1] + x * sr + y * cr];
  };
  const dpt = (t: number): Vec2 => {
    const x = -rx * Math.sin(t);
    const y = ry * Math.cos(t);
    return [x * cr - y * sr, x * sr + y * cr];
  };
  const segs = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const dt = sweep / segs;
  const k = (4 / 3) * Math.tan(dt / 4);
  const p0 = pt(t0);
  const ops = [`${num(p0[0])} ${num(p0[1])} m`];
  for (let i = 0; i < segs; i++) {
    const ta = t0 + i * dt;
    const tb = ta + dt;
    const a = pt(ta);
    const b = pt(tb);
    const da = dpt(ta);
    const db = dpt(tb);
    ops.push(
      `${num(a[0] + k * da[0])} ${num(a[1] + k * da[1])} ${num(b[0] - k * db[0])} ${num(b[1] - k * db[1])} ${num(b[0])} ${num(b[1])} c`,
    );
  }
  return ops;
}

function polyPath(pts: Vec2[], close: boolean): string[] {
  const ops = pts.map((p, i) => `${num(p[0])} ${num(p[1])} ${i === 0 ? 'm' : 'l'}`);
  if (close) ops.push('h');
  return ops;
}

function pageContent(prims: Prim2D[]): string {
  const ops: string[] = ['q', `${fmtNum(PT_PER_MM, 6)} 0 0 ${fmtNum(PT_PER_MM, 6)} 0 0 cm`, '1 j'];
  let curStroke = '';
  let curFill = '';
  let curWidth = -1;
  let curDash = '';
  let curCap = -1;

  const setStroke = (style: LineStyle, color: string) => {
    const def = STYLE_DEFAULTS[style];
    const c = rgb(color);
    if (c !== curStroke) ops.push(`${c} RG`);
    curStroke = c;
    if (def.width !== curWidth) ops.push(`${num(def.width)} w`);
    curWidth = def.width;
    const dash = `[${def.dash.map(num).join(' ')}] 0 d`;
    if (dash !== curDash) ops.push(dash);
    curDash = dash;
    const cap = def.dash.length ? 0 : 1;
    if (cap !== curCap) ops.push(`${cap} J`);
    curCap = cap;
  };
  const setFill = (color: string) => {
    const c = rgb(color);
    if (c !== curFill) ops.push(`${c} rg`);
    curFill = c;
  };

  for (const p of prims) {
    const style = primStyle(p);
    const color = primColor(p);
    switch (p.t) {
      case 'line':
        setStroke(style, color);
        ops.push(`${num(p.a[0])} ${num(p.a[1])} m ${num(p.b[0])} ${num(p.b[1])} l S`);
        break;
      case 'arc': {
        const sweep = arcSweep(p.a0, p.a1);
        if (sweep <= 0 || !(p.r > 0)) break;
        setStroke(style, color);
        ops.push(...ellipseArcPath(p.c, p.r, p.r, 0, p.a0, sweep), isFullSweep(sweep) ? 'h S' : 'S');
        break;
      }
      case 'circle':
        if (!(p.r > 0)) break;
        setStroke(style, color);
        ops.push(...ellipseArcPath(p.c, p.r, p.r, 0, 0, TAU), 'h S');
        break;
      case 'ellipse':
        setStroke(style, color);
        ops.push(...ellipseArcPath(p.c, p.rx, p.ry, p.rot, 0, TAU), 'h S');
        break;
      case 'poly':
        if (p.pts.length < 2) break;
        setStroke(style, color);
        ops.push(...polyPath(p.pts, !!p.closed), 'S');
        break;
      case 'fill':
        if (p.pts.length < 3) break;
        setFill(color);
        ops.push(...polyPath(p.pts, true), 'f');
        break;
      case 'arrow':
        setFill(color);
        ops.push(...polyPath(arrowTriangle(p), true), 'f');
        break;
      case 'text': {
        if (!p.text) break;
        const f = textFrame(p);
        setFill(color);
        ops.push(
          `BT /F1 ${num(p.h)} Tf ${fmtNum(f.cos, 6)} ${fmtNum(f.sin, 6)} ${fmtNum(-f.sin, 6)} ${fmtNum(f.cos, 6)} ` +
            `${num(f.origin[0])} ${num(f.origin[1])} Tm (${encodePdfLiteral(p.text)}) Tj ET`,
        );
        break;
      }
    }
  }
  ops.push('Q');
  return ops.join('\n');
}

/** Converts a string whose chars are all < 256 into bytes (Latin-1). */
function latin1Bytes(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c < 256 ? c : 63;
  }
  return out;
}

export function writePDF(pages: PDFPage[], opts: PDFOptions = {}): Uint8Array<ArrayBuffer> {
  const pageList = pages.length ? pages : [{ width: 210, height: 297, prims: [] }];

  // Object numbers: 1 catalog, 2 page tree, 3 font, 4 info, then (page, content) pairs.
  const objs: string[] = [];
  const pageObjNums = pageList.map((_, i) => 5 + 2 * i);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageList.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  let info = '<< /Producer (WebCAD) /Creator (WebCAD)';
  if (opts.title) info += ` /Title ${pdfTextString(opts.title)}`;
  objs[4] = info + ' >>';
  pageList.forEach((pg, i) => {
    const pageNum = pageObjNums[i];
    const w = Math.max(pg.width, 1) * PT_PER_MM;
    const h = Math.max(pg.height, 1) * PT_PER_MM;
    objs[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}]` +
      ` /Resources << /Font << /F1 3 0 R >> /ProcSet [/PDF /Text] >> /Contents ${pageNum + 1} 0 R >>`;
    const content = pageContent(pg.prims);
    objs[pageNum + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  // Everything below is 1 char == 1 byte, so string lengths are byte offsets.
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; // binary marker comment
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f\r\n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n\r\n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return latin1Bytes(out);
}
