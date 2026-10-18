// 2D primitive model shared by sketch export and engineering drawings.
// All coordinates are in millimetres, Y axis pointing up (mathematical convention).
// Writers for Y-down formats (SVG) flip the geometry themselves.

import type { Vec2 } from '../core/types';

export type LineStyle = 'visible' | 'hidden' | 'center' | 'thin' | 'dimension' | 'border' | 'construction';

export interface PrimBase {
  style?: LineStyle;
  layer?: string;
  /** Optional colour override (CSS hex such as '#d0d0d0'); defaults to the style colour. */
  color?: string;
}

/**
 * Text: `h` is the font size (em height) in mm; capital letters are `CAP_HEIGHT * h` tall.
 * `angle` is in radians, CCW. `p` is the anchor, interpreted through `align` / `vAlign`
 * ('middle' and 'top' refer to the capital letter height).
 */
export type Prim2D =
  | ({ t: 'line'; a: Vec2; b: Vec2 } & PrimBase)
  | ({ t: 'arc'; c: Vec2; r: number; a0: number; a1: number } & PrimBase) // radians, CCW from a0 to a1
  | ({ t: 'circle'; c: Vec2; r: number } & PrimBase)
  | ({ t: 'ellipse'; c: Vec2; rx: number; ry: number; rot: number } & PrimBase)
  | ({ t: 'poly'; pts: Vec2[]; closed?: boolean } & PrimBase)
  | ({
      t: 'text';
      p: Vec2;
      text: string;
      h: number;
      angle?: number;
      align?: 'left' | 'center' | 'right';
      vAlign?: 'baseline' | 'middle' | 'top';
    } & PrimBase)
  | ({ t: 'arrow'; tip: Vec2; dir: Vec2; size: number } & PrimBase) // filled triangular arrowhead pointing along dir
  | ({ t: 'fill'; pts: Vec2[] } & PrimBase); // filled polygon (e.g. title block shading)

export type TextPrim = Extract<Prim2D, { t: 'text' }>;

export interface Bounds2D {
  min: Vec2;
  max: Vec2;
}

export interface StyleDef {
  /** Line width in mm. */
  width: number;
  /** Dash pattern in mm (on, off, on, off...); empty = continuous. */
  dash: number[];
  color: string;
}

export const STYLE_DEFAULTS: Record<LineStyle, StyleDef> = {
  visible: { width: 0.5, dash: [], color: '#000000' },
  hidden: { width: 0.35, dash: [3, 1.5], color: '#000000' },
  center: { width: 0.25, dash: [8, 2, 1.5, 2], color: '#000000' },
  thin: { width: 0.25, dash: [], color: '#000000' },
  dimension: { width: 0.25, dash: [], color: '#000000' },
  border: { width: 0.7, dash: [], color: '#000000' },
  construction: { width: 0.25, dash: [2, 2], color: '#808080' },
};

export const LINE_STYLES: LineStyle[] = ['visible', 'hidden', 'center', 'thin', 'dimension', 'border', 'construction'];

export const TAU = Math.PI * 2;
/** Helvetica capital height as a fraction of the font size. */
export const CAP_HEIGHT = 0.718;
/** Helvetica descender depth as a fraction of the font size. */
export const DESCENT = 0.207;
/** Arrowhead width / length ratio (ISO 129: 1:3). */
export const ARROW_WIDTH_RATIO = 1 / 3;

export function primStyle(p: PrimBase): LineStyle {
  return p.style ?? 'visible';
}

export function primColor(p: PrimBase): string {
  return p.color ?? STYLE_DEFAULTS[primStyle(p)].color;
}

/** CCW sweep from a0 to a1 in [0, 2π]. a1 = a0 + 2π (or any non-zero multiple) yields a full turn. */
export function arcSweep(a0: number, a1: number): number {
  const d = a1 - a0;
  if (!Number.isFinite(d)) return 0;
  let s = d % TAU;
  if (s < 0) s += TAU;
  if (s < 1e-12 && Math.abs(d) > 1e-12) s = TAU;
  return s;
}

export function isFullSweep(sweep: number): boolean {
  return sweep >= TAU - 1e-9;
}

export function ellipsePoint(c: Vec2, rx: number, ry: number, rot: number, t: number): Vec2 {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const x = rx * Math.cos(t);
  const y = ry * Math.sin(t);
  return [c[0] + x * cr - y * sr, c[1] + x * sr + y * cr];
}

/** Arrowhead triangle: [tip, left base corner, right base corner] (CCW). */
export function arrowTriangle(p: { tip: Vec2; dir: Vec2; size: number }): [Vec2, Vec2, Vec2] {
  const len = Math.hypot(p.dir[0], p.dir[1]);
  const ux = len > 0 ? p.dir[0] / len : 1;
  const uy = len > 0 ? p.dir[1] / len : 0;
  const bx = p.tip[0] - ux * p.size;
  const by = p.tip[1] - uy * p.size;
  const hw = (p.size * ARROW_WIDTH_RATIO) / 2;
  return [
    [p.tip[0], p.tip[1]],
    [bx - uy * hw, by + ux * hw],
    [bx + uy * hw, by - ux * hw],
  ];
}

// ---------------------------------------------------------------------------
// Text metrics: Helvetica AFM widths (1/1000 em) indexed by WinAnsi code.
// ---------------------------------------------------------------------------

// prettier-ignore
const HELV_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32-47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
  278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, // A-M
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // N-Z
  278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, // a-m
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // n-z
  334, 260, 334, 584, // { | } ~
];

// prettier-ignore
const HELV_LATIN1 = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, // 160-175
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, // 176-191
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, // 192-207
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, // 208-223
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, // 224-239
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500, // 240-255
];

// [unicode, WinAnsi code, width] for the 0x80-0x9F block.
// prettier-ignore
const WINANSI_EXTRA: [number, number, number][] = [
  [0x20ac, 0x80, 556], [0x201a, 0x82, 222], [0x0192, 0x83, 556], [0x201e, 0x84, 333],
  [0x2026, 0x85, 1000], [0x2020, 0x86, 556], [0x2021, 0x87, 556], [0x02c6, 0x88, 333],
  [0x2030, 0x89, 1000], [0x0160, 0x8a, 667], [0x2039, 0x8b, 333], [0x0152, 0x8c, 1000],
  [0x017d, 0x8e, 611], [0x2018, 0x91, 222], [0x2019, 0x92, 222], [0x201c, 0x93, 333],
  [0x201d, 0x94, 333], [0x2022, 0x95, 350], [0x2013, 0x96, 556], [0x2014, 0x97, 1000],
  [0x02dc, 0x98, 333], [0x2122, 0x99, 1000], [0x0161, 0x9a, 500], [0x203a, 0x9b, 333],
  [0x0153, 0x9c, 944], [0x017e, 0x9e, 500], [0x0178, 0x9f, 667],
];

// Characters common in drawings that have a close WinAnsi substitute.
const WINANSI_ALIASES: [number, number][] = [
  [0x2300, 0xd8], // ⌀ diameter sign -> Ø
  [0x2205, 0xd8], // ∅ empty set -> Ø
  [0x2212, 0x2d], // − minus -> -
  [0x2010, 0x2d], // ‐ hyphen
  [0x2011, 0x2d], // non-breaking hyphen
];

const UNI_TO_WINANSI = new Map<number, number>();
const WINANSI_WIDTHS = new Uint16Array(256);
for (let i = 32; i <= 126; i++) {
  UNI_TO_WINANSI.set(i, i);
  WINANSI_WIDTHS[i] = HELV_ASCII[i - 32];
}
for (let i = 160; i <= 255; i++) {
  UNI_TO_WINANSI.set(i, i);
  WINANSI_WIDTHS[i] = HELV_LATIN1[i - 160];
}
for (const [u, code, w] of WINANSI_EXTRA) {
  UNI_TO_WINANSI.set(u, code);
  WINANSI_WIDTHS[code] = w;
}
for (const [u, code] of WINANSI_ALIASES) UNI_TO_WINANSI.set(u, code);

/** WinAnsi byte for a Unicode code point, or undefined if not representable. */
export function toWinAnsi(cp: number): number | undefined {
  return UNI_TO_WINANSI.get(cp);
}

/** Advance width in 1/1000 em (Helvetica). Unrepresentable characters count as '?'. */
export function charWidth(cp: number): number {
  if (cp < 32) return WINANSI_WIDTHS[32];
  const b = UNI_TO_WINANSI.get(cp);
  return b === undefined ? WINANSI_WIDTHS[63] : WINANSI_WIDTHS[b];
}

/** Approximate rendered width (mm) of `text` at font size `h` (mm). */
export function textWidth(text: string, h: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0) ?? 63);
  return (w / 1000) * h;
}

/** Offset from the anchor to the baseline along the text's local Y axis (mm, Y up). */
export function baselineOffset(vAlign: TextPrim['vAlign'], h: number): number {
  if (vAlign === 'middle') return (-CAP_HEIGHT * h) / 2;
  if (vAlign === 'top') return -CAP_HEIGHT * h;
  return 0;
}

export interface TextFrame {
  /** Start of the baseline (left end) in world coordinates. */
  origin: Vec2;
  width: number;
  cos: number;
  sin: number;
}

export function textFrame(p: TextPrim): TextFrame {
  const width = textWidth(p.text, p.h);
  const ang = p.angle ?? 0;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const dx = p.align === 'center' ? -width / 2 : p.align === 'right' ? -width : 0;
  const dy = baselineOffset(p.vAlign, p.h);
  return { origin: [p.p[0] + dx * cos - dy * sin, p.p[1] + dx * sin + dy * cos], width, cos, sin };
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export function primBounds(prims: Prim2D[]): Bounds2D {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  for (const p of prims) {
    switch (p.t) {
      case 'line':
        add(p.a[0], p.a[1]);
        add(p.b[0], p.b[1]);
        break;
      case 'circle':
        add(p.c[0] - p.r, p.c[1] - p.r);
        add(p.c[0] + p.r, p.c[1] + p.r);
        break;
      case 'arc': {
        const sweep = arcSweep(p.a0, p.a1);
        add(p.c[0] + p.r * Math.cos(p.a0), p.c[1] + p.r * Math.sin(p.a0));
        add(p.c[0] + p.r * Math.cos(p.a0 + sweep), p.c[1] + p.r * Math.sin(p.a0 + sweep));
        for (let k = 0; k < 4; k++) {
          let d = ((k * Math.PI) / 2 - p.a0) % TAU;
          if (d < 0) d += TAU;
          if (d <= sweep) add(p.c[0] + p.r * Math.cos((k * Math.PI) / 2), p.c[1] + p.r * Math.sin((k * Math.PI) / 2));
        }
        break;
      }
      case 'ellipse': {
        const cr = Math.cos(p.rot);
        const sr = Math.sin(p.rot);
        const hx = Math.hypot(p.rx * cr, p.ry * sr);
        const hy = Math.hypot(p.rx * sr, p.ry * cr);
        add(p.c[0] - hx, p.c[1] - hy);
        add(p.c[0] + hx, p.c[1] + hy);
        break;
      }
      case 'poly':
      case 'fill':
        for (const q of p.pts) add(q[0], q[1]);
        break;
      case 'arrow':
        for (const q of arrowTriangle(p)) add(q[0], q[1]);
        break;
      case 'text': {
        const f = textFrame(p);
        const lo = -DESCENT * p.h;
        const hi = CAP_HEIGHT * p.h;
        for (const [lx, ly] of [
          [0, lo],
          [f.width, lo],
          [f.width, hi],
          [0, hi],
        ]) {
          add(f.origin[0] + lx * f.cos - ly * f.sin, f.origin[1] + lx * f.sin + ly * f.cos);
        }
        break;
      }
    }
  }
  if (x0 > x1 || y0 > y1) return { min: [0, 0], max: [0, 0] };
  return { min: [x0, y0], max: [x1, y1] };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Formats a number with at most `digits` decimals, no exponent, no trailing zeros, no "-0". */
export function fmtNum(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '0';
  const m = 10 ** digits;
  const r = Math.round(v * m) / m;
  if (r === 0) return '0';
  if (Math.abs(r) >= 1e21) return r.toFixed(0);
  let s = r.toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
};

/** Parses '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb()/rgba()' and a few names to [r, g, b, a] (0-255). */
export function parseColor(s: string | undefined): [number, number, number, number] | null {
  if (!s) return null;
  let v = s.trim().toLowerCase();
  if (NAMED_COLORS[v]) v = NAMED_COLORS[v];
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const h = m[1];
    const c = [...h].map((d) => parseInt(d + d, 16));
    return [c[0], c[1], c[2], c.length > 3 ? c[3] : 255];
  }
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    const h = m[1];
    const c = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
    return [c[0], c[1], c[2], c[3]];
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (x: string) => {
      const n = parseFloat(x);
      return Math.max(0, Math.min(255, Math.round(x.endsWith('%') ? n * 2.55 : n)));
    };
    const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    const alpha = parts[3]?.endsWith('%') ? a / 100 : a;
    return [ch(parts[0]), ch(parts[1]), ch(parts[2]), Math.max(0, Math.min(255, Math.round(alpha * 255)))];
  }
  return null;
}
