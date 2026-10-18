// SVG writer. Geometry is emitted in its native Y-up millimetre coordinates inside a
// `scale(1,-1)` group; text elements counter-flip themselves so they stay upright.

import type { Vec2 } from '../core/types';
import {
  type LineStyle,
  type Prim2D,
  STYLE_DEFAULTS,
  arcSweep,
  arrowTriangle,
  baselineOffset,
  fmtNum,
  isFullSweep,
  primBounds,
  primColor,
  primStyle,
} from './prim2d';

export interface SVGOptions {
  /** Page width in mm. With `height` the viewBox is the page [0..width] x [0..height] (Y up). */
  width?: number;
  /** Page height in mm. */
  height?: number;
  /** Margin (mm) around the content bounds when no page size is given. Default 5. */
  margin?: number;
  /** Background fill colour (omitted = transparent). */
  background?: string;
  /** Multiplier for stroke widths (e.g. to thicken lines in on-screen previews). Default 1. */
  strokeScale?: number;
}

const FONT_FAMILY = 'Helvetica, Arial, sans-serif';

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

/** Removes characters that are not allowed in XML 1.0 documents. */
function stripInvalidXml(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const ok = cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp !== 0xfffe && cp !== 0xffff && !(cp >= 0xd800 && cp <= 0xdfff));
    if (ok) out += ch;
  }
  return out;
}

const n = (v: number) => fmtNum(v, 4);
const pts = (list: Vec2[]) => list.map((p) => `${n(p[0])},${n(p[1])}`).join(' ');

function strokeAttrs(style: LineStyle, color: string, strokeScale: number): string {
  const def = STYLE_DEFAULTS[style];
  let a = `stroke="${escapeXml(color)}" stroke-width="${n(def.width * strokeScale)}"`;
  if (def.dash.length) a += ` stroke-dasharray="${def.dash.map(n).join(' ')}" stroke-linecap="butt"`;
  else a += ' stroke-linecap="round"';
  return a;
}

function primElement(p: Prim2D, color: string): string {
  switch (p.t) {
    case 'line':
      return `<line x1="${n(p.a[0])}" y1="${n(p.a[1])}" x2="${n(p.b[0])}" y2="${n(p.b[1])}"/>`;
    case 'circle':
      return `<circle cx="${n(p.c[0])}" cy="${n(p.c[1])}" r="${n(p.r)}"/>`;
    case 'arc': {
      const sweep = arcSweep(p.a0, p.a1);
      if (sweep <= 0) return '';
      if (isFullSweep(sweep)) return `<circle cx="${n(p.c[0])}" cy="${n(p.c[1])}" r="${n(p.r)}"/>`;
      const x0 = p.c[0] + p.r * Math.cos(p.a0);
      const y0 = p.c[1] + p.r * Math.sin(p.a0);
      const x1 = p.c[0] + p.r * Math.cos(p.a0 + sweep);
      const y1 = p.c[1] + p.r * Math.sin(p.a0 + sweep);
      // In the (Y-up) local frame a CCW arc runs in the positive-angle direction: sweep-flag = 1.
      const large = sweep > Math.PI ? 1 : 0;
      return `<path d="M${n(x0)} ${n(y0)}A${n(p.r)} ${n(p.r)} 0 ${large} 1 ${n(x1)} ${n(y1)}"/>`;
    }
    case 'ellipse': {
      const rot = (p.rot * 180) / Math.PI;
      const tr = rot !== 0 ? ` transform="rotate(${n(rot)} ${n(p.c[0])} ${n(p.c[1])})"` : '';
      return `<ellipse cx="${n(p.c[0])}" cy="${n(p.c[1])}" rx="${n(p.rx)}" ry="${n(p.ry)}"${tr}/>`;
    }
    case 'poly':
      if (p.pts.length < 2) return '';
      return p.closed ? `<polygon points="${pts(p.pts)}"/>` : `<polyline points="${pts(p.pts)}"/>`;
    case 'fill':
      if (p.pts.length < 3) return '';
      return `<polygon points="${pts(p.pts)}" fill="${escapeXml(color)}" stroke="none"/>`;
    case 'arrow':
      return `<polygon points="${pts(arrowTriangle(p))}" fill="${escapeXml(color)}" stroke="none"/>`;
    case 'text': {
      if (!p.text) return '';
      const deg = ((p.angle ?? 0) * 180) / Math.PI;
      // translate to the anchor, un-flip (local frame is Y-down again), then rotate CCW on screen.
      let tr = `translate(${n(p.p[0])} ${n(p.p[1])}) scale(1 -1)`;
      if (deg !== 0) tr += ` rotate(${n(-deg)})`;
      const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
      const dy = -baselineOffset(p.vAlign, p.h); // Y-down local frame
      return (
        `<text transform="${tr}" x="0" y="${n(dy)}" font-family="${FONT_FAMILY}" font-size="${n(p.h)}"` +
        ` text-anchor="${anchor}" fill="${escapeXml(color)}" stroke="none" xml:space="preserve">` +
        `${escapeXml(stripInvalidXml(p.text))}</text>`
      );
    }
  }
}

export function writeSVG(prims: Prim2D[], opts: SVGOptions = {}): string {
  const strokeScale = opts.strokeScale ?? 1;

  // View rectangle in Y-up world coordinates.
  let x0: number;
  let y0: number;
  let w: number;
  let h: number;
  let physW: number;
  let physH: number;
  if (opts.width !== undefined && opts.height !== undefined) {
    x0 = 0;
    y0 = 0;
    w = opts.width;
    h = opts.height;
    physW = w;
    physH = h;
  } else {
    const m = opts.margin ?? 5;
    const b = primBounds(prims);
    x0 = b.min[0] - m;
    y0 = b.min[1] - m;
    w = Math.max(b.max[0] - b.min[0] + 2 * m, 1e-3);
    h = Math.max(b.max[1] - b.min[1] + 2 * m, 1e-3);
    if (w < 1 && h < 1) {
      w = Math.max(w, 1);
      h = Math.max(h, 1);
    }
    if (opts.width !== undefined) {
      physW = opts.width;
      physH = (opts.width * h) / w;
    } else if (opts.height !== undefined) {
      physH = opts.height;
      physW = (opts.height * w) / h;
    } else {
      physW = w;
      physH = h;
    }
  }

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${n(physW)}mm" height="${n(physH)}mm"` +
      ` viewBox="${n(x0)} ${n(-(y0 + h))} ${n(w)} ${n(h)}">`,
  );
  if (opts.background) {
    out.push(
      `<rect x="${n(x0)}" y="${n(-(y0 + h))}" width="${n(w)}" height="${n(h)}" fill="${escapeXml(opts.background)}" stroke="none"/>`,
    );
  }
  out.push('<g transform="scale(1,-1)" fill="none" stroke-linejoin="round">');

  // Consecutive primitives sharing style/colour/layer go into one group.
  let groupKey: string | null = null;
  for (const p of prims) {
    const style = primStyle(p);
    const color = primColor(p);
    const key = `${style}|${color}|${p.layer ?? ''}`;
    const el = primElement(p, color);
    if (!el) continue;
    if (key !== groupKey) {
      if (groupKey !== null) out.push('</g>');
      const layerAttr = p.layer !== undefined ? ` data-layer="${escapeXml(p.layer)}"` : '';
      out.push(`<g class="${style}"${layerAttr} ${strokeAttrs(style, color, strokeScale)}>`);
      groupKey = key;
    }
    out.push(el);
  }
  if (groupKey !== null) out.push('</g>');

  out.push('</g>');
  out.push('</svg>');
  return out.join('\n') + '\n';
}
