// Engineering drawing model → 2D primitives (sheet millimetres, Y up, origin bottom-left).

import type { DrawingData, DrawingDimension, DrawingView, Vec2, ViewOrientation } from '../core/types';
import type { Prim2D } from '../export/prim2d';
import type { ProjectionResult } from '../kernel/protocol';
import { formatNumber } from '../core/expr';
import { textWidth } from '../export/prim2d';
import { t } from '../i18n';

export const SHEETS: Record<DrawingData['sheet'], [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  Letter: [279.4, 215.9],
  Tabloid: [431.8, 279.4],
};

export const STD_SCALES = [10, 5, 4, 2, 1, 1 / 2, 1 / 2.5, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 1 / 25, 1 / 50, 1 / 100, 1 / 200, 1 / 500, 1 / 1000];

export function scaleLabel(s: number): string {
  if (s >= 1) return `${formatNumber(s, 2)}:1`;
  return `1:${formatNumber(1 / s, 2)}`;
}

export function sheetSize(d: DrawingData): [number, number] {
  const [w, h] = SHEETS[d.sheet];
  return d.landscape ? [w, h] : [h, w];
}

/** Inner frame: 20 mm binding margin on the left, 5 mm elsewhere (ISO 5457 / ГОСТ 2.301). */
export function frameRect(d: DrawingData): { x0: number; y0: number; x1: number; y1: number } {
  const [w, h] = sheetSize(d);
  return { x0: 20, y0: 5, x1: w - 5, y1: h - 5 };
}

export const TITLE_W = 185;
export const TITLE_H = 55;

export function titleBlockRect(d: DrawingData) {
  const f = frameRect(d);
  return { x0: f.x1 - TITLE_W, y0: f.y0, x1: f.x1, y1: f.y0 + TITLE_H };
}

// Use a conservative estimate for Unicode glyphs absent from Helvetica's metrics.
function labelWidth(text: string, height: number): number {
  return Array.from(text).reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) > 255 ? height * 0.85 : textWidth(ch, height)), 0);
}

function wrapText(text: string, width: number, height: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (labelWidth(next, height) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const ch of word) {
        if (line && labelWidth(line + ch, height) > width) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    return [...lines, line];
  });
}

/** Bounded text shared by the screen and every drawing export. */
function cellText(text: string, x: number, y: number, width: number, height: number, fontSize: number, maxLines = 1): Prim2D[] {
  let h = fontSize;
  let lines = wrapText(text || '—', width - 6, h);
  while (lines.length > maxLines && h > 2.5) {
    h = Math.max(2.5, h - 0.25);
    lines = wrapText(text || '—', width - 6, h);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && labelWidth(last + '…', h) > width - 6) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  const centerY = y + (height - 6) / 2;
  return lines.map((line, i) => ({
    t: 'text', p: [x + width / 2, centerY + ((lines.length - 1) / 2 - i) * h * 1.35],
    text: line, h, align: 'center', vAlign: 'middle', style: 'visible',
  }));
}

export interface ProjectionData extends ProjectionResult {
  key: string;
}

export function viewCenter(p: ProjectionData | undefined): Vec2 {
  if (!p?.bounds) return [0, 0];
  const [lo, hi] = p.bounds;
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
}

/** Model (view-local) coordinates → sheet coordinates. */
export function toSheet(v: DrawingView, proj: ProjectionData | undefined, p: Vec2): Vec2 {
  const c = viewCenter(proj);
  return [v.x + (p[0] - c[0]) * v.scale, v.y + (p[1] - c[1]) * v.scale];
}

export function toModel(v: DrawingView, proj: ProjectionData | undefined, s: Vec2): Vec2 {
  const c = viewCenter(proj);
  return [(s[0] - v.x) / v.scale + c[0], (s[1] - v.y) / v.scale + c[1]];
}

export function viewRect(v: DrawingView, proj: ProjectionData | undefined): { x0: number; y0: number; x1: number; y1: number } {
  if (!proj?.bounds) return { x0: v.x - 10, y0: v.y - 10, x1: v.x + 10, y1: v.y + 10 };
  const [lo, hi] = proj.bounds;
  const a = toSheet(v, proj, lo);
  const b = toSheet(v, proj, hi);
  const m = 4;
  return { x0: Math.min(a[0], b[0]) - m, y0: Math.min(a[1], b[1]) - m, x1: Math.max(a[0], b[0]) + m, y1: Math.max(a[1], b[1]) + m };
}

export const VIEW_NAMES: Record<ViewOrientation, string> = {
  front: 'Front',
  back: 'Back',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
  iso: 'Isometric',
};

export function viewPrims(v: DrawingView, proj: ProjectionData | undefined): Prim2D[] {
  if (!proj) return [];
  const out: Prim2D[] = [];
  for (const e of proj.edges) {
    if (e.hidden && !v.showHidden) continue;
    const pts = e.pts.map((p) => toSheet(v, proj, p));
    const style = e.hidden ? 'hidden' : 'visible';
    if (pts.length === 2) out.push({ t: 'line', a: pts[0], b: pts[1], style });
    else out.push({ t: 'poly', pts, style });
  }
  // centre marks for visible circles
  for (const e of proj.edges) {
    if (!e.circle || e.hidden) continue;
    const full = e.pts.length > 2 && Math.hypot(e.pts[0][0] - e.pts[e.pts.length - 1][0], e.pts[0][1] - e.pts[e.pts.length - 1][1]) < 1e-6;
    if (!full) continue;
    const c = toSheet(v, proj, e.circle.c);
    const r = e.circle.r * v.scale + 2;
    out.push({ t: 'line', a: [c[0] - r, c[1]], b: [c[0] + r, c[1]], style: 'center' });
    out.push({ t: 'line', a: [c[0], c[1] - r], b: [c[0], c[1] + r], style: 'center' });
  }
  if (v.label) {
    const r = viewRect(v, proj);
    out.push({ t: 'text', p: [(r.x0 + r.x1) / 2, r.y1 + 3], text: v.label, h: 3.5, align: 'center', style: 'thin' });
  }
  return out;
}

const ARROW = 3;
const TEXT_H = 3.5;

export function measureDim(d: DrawingDimension): number {
  if (d.kind === 'radius' || d.kind === 'diameter') {
    const r = d.b ? Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) : 0;
    return d.kind === 'diameter' ? 2 * r : r;
  }
  if (!d.b) return 0;
  if (d.kind === 'horizontal') return Math.abs(d.b[0] - d.a[0]);
  if (d.kind === 'vertical') return Math.abs(d.b[1] - d.a[1]);
  return Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
}

export function dimText(d: DrawingDimension, unitFactor: number): string {
  const v = measureDim(d) / unitFactor;
  const s = formatNumber(v, 2);
  if (d.kind === 'diameter') return `Ø${s}`;
  if (d.kind === 'radius') return `R${s}`;
  return s;
}

/** Dimension primitives in sheet coordinates. For radius/diameter `a` is the centre and `b` a point on the circle. */
export function dimPrims(d: DrawingDimension, v: DrawingView, proj: ProjectionData | undefined, unitFactor: number): Prim2D[] {
  const out: Prim2D[] = [];
  const A = toSheet(v, proj, d.a);
  const text = dimText(d, unitFactor);
  if (d.kind === 'radius' || d.kind === 'diameter') {
    if (!d.b) return out;
    const B = toSheet(v, proj, d.b);
    const r = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const T: Vec2 = d.textPos ?? [A[0] + r * 1.4, A[1] + r * 1.1];
    const u = norm([T[0] - A[0], T[1] - A[1]]);
    const P: Vec2 = [A[0] + u[0] * r, A[1] + u[1] * r];
    const start: Vec2 = d.kind === 'diameter' ? [A[0] - u[0] * r, A[1] - u[1] * r] : A;
    const outside = Math.hypot(T[0] - A[0], T[1] - A[1]) > r;
    out.push({ t: 'line', a: start, b: outside ? T : P, style: 'dimension' });
    out.push({ t: 'arrow', tip: P, dir: outside ? [-u[0], -u[1]] : u, size: ARROW, style: 'dimension' });
    if (d.kind === 'diameter') out.push({ t: 'arrow', tip: start, dir: [-u[0], -u[1]], size: ARROW, style: 'dimension' });
    // shoulder + text
    const right = T[0] >= A[0];
    const tw = text.length * TEXT_H * 0.6 + 2;
    const end: Vec2 = [T[0] + (right ? tw : -tw), T[1]];
    out.push({ t: 'line', a: T, b: end, style: 'dimension' });
    out.push({ t: 'text', p: [(T[0] + end[0]) / 2, T[1] + 1], text, h: TEXT_H, align: 'center', style: 'dimension' });
    return out;
  }
  if (!d.b) return out;
  const B = toSheet(v, proj, d.b);
  let axis: Vec2 = d.kind === 'horizontal' ? [1, 0] : d.kind === 'vertical' ? [0, 1] : norm([B[0] - A[0], B[1] - A[1]]);
  if (!Number.isFinite(axis[0])) axis = [1, 0];
  const n: Vec2 = [-axis[1], axis[0]];
  const off = d.offset;
  // dimension line position: offset from the farther point along n
  const base = Math.max(dot(A, n), dot(B, n));
  const baseMin = Math.min(dot(A, n), dot(B, n));
  const level = off >= 0 ? base + off : baseMin + off;
  const PA: Vec2 = add(A, mul(n, level - dot(A, n)));
  const PB: Vec2 = add(B, mul(n, level - dot(B, n)));
  const gap = 1.5;
  const ext = 2;
  const sgn = Math.sign(off) || 1;
  out.push({ t: 'line', a: add(A, mul(n, sgn * gap)), b: add(PA, mul(n, sgn * ext)), style: 'dimension' });
  out.push({ t: 'line', a: add(B, mul(n, sgn * gap)), b: add(PB, mul(n, sgn * ext)), style: 'dimension' });
  out.push({ t: 'line', a: PA, b: PB, style: 'dimension' });
  const u = norm([PB[0] - PA[0], PB[1] - PA[1]]);
  out.push({ t: 'arrow', tip: PA, dir: [-u[0], -u[1]], size: ARROW, style: 'dimension' });
  out.push({ t: 'arrow', tip: PB, dir: u, size: ARROW, style: 'dimension' });
  const mid: Vec2 = [(PA[0] + PB[0]) / 2, (PA[1] + PB[1]) / 2];
  let ang = Math.atan2(u[1], u[0]);
  if (ang > Math.PI / 2 + 1e-6) ang -= Math.PI;
  if (ang < -Math.PI / 2 + 1e-6) ang += Math.PI;
  const tn: Vec2 = [-Math.sin(ang), Math.cos(ang)];
  out.push({ t: 'text', p: add(mid, mul(tn, 1)), text, h: TEXT_H, angle: ang, align: 'center', style: 'dimension' });
  return out;
}

export function titleBlockPrims(d: DrawingData, extra: { scale: string; units: string; date: string }, translate: (key: string) => string = t): Prim2D[] {
  const [w, h] = sheetSize(d);
  const f = frameRect(d);
  const out: Prim2D[] = [];
  out.push({ t: 'poly', pts: [[0, 0], [w, 0], [w, h], [0, h]], closed: true, style: 'thin' });
  out.push({ t: 'poly', pts: [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]], closed: true, style: 'border' });
  // title block in the bottom-right corner
  const { x0, y0, x1, y1 } = titleBlockRect(d);
  out.push({ t: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true, style: 'border' });
  out.push({ t: 'line', a: [x0 + 130, y0], b: [x0 + 130, y1], style: 'border' });
  for (const dy of [18, 30]) out.push({ t: 'line', a: [x0, y0 + dy], b: [x1, y0 + dy], style: 'thin' });
  out.push({ t: 'line', a: [x0 + 85, y0], b: [x0 + 85, y0 + 18], style: 'thin' });
  out.push({ t: 'line', a: [x0 + 157.5, y0 + 30], b: [x0 + 157.5, y1], style: 'thin' });
  const cell = (x: number, y: number, cw: number, ch: number, label: string, value: string, font = 3.5, lines = 1) => {
    out.push({ t: 'text', p: [x0 + x + 2, y0 + y + ch - 3.5], text: translate(label), h: 2.3, style: 'thin' });
    out.push(...cellText(value, x0 + x, y0 + y, cw, ch, font, lines));
  };
  cell(0, 30, 130, 25, 'Title', d.title || translate('Untitled drawing'), 5, 3);
  cell(0, 18, 130, 12, 'Designation', d.designation ?? '', 4);
  cell(0, 0, 85, 18, 'Author', d.author, 3.5, 2);
  cell(85, 0, 45, 18, 'Date', extra.date);
  cell(130, 30, 27.5, 25, 'Scale', extra.scale, 4);
  cell(157.5, 30, 27.5, 25, 'Format', d.sheet, 4);
  cell(130, 18, 55, 12, 'Units', extra.units);
  cell(130, 0, 55, 18, 'Projection', (d.projection ?? 'first') === 'first' ? 'ISO E · 1' : 'ISO A · 3', 3.5);
  return out;
}

export function notePrims(d: DrawingData): Prim2D[] {
  return d.notes.flatMap((n) =>
    n.text.split('\n').map((line, i) => ({ t: 'text' as const, p: [n.x, n.y - i * n.height * 1.5] as Vec2, text: line, h: n.height, style: 'visible' as const })),
  );
}

/** Choose a standard scale so that the given model extent fits into the target size. */
export function chooseScale(modelW: number, modelH: number, availW: number, availH: number): number {
  for (const s of STD_SCALES) if (modelW * s <= availW && modelH * s <= availH) return s;
  return STD_SCALES[STD_SCALES.length - 1];
}

/** Orientation of a projected child view placed in direction `dir` from a parent front-like view. */
export function projectedOrientation(parent: ViewOrientation, dir: 'up' | 'down' | 'left' | 'right', projection: 'first' | 'third'): ViewOrientation | null {
  // Seen-from direction for third angle: placing a view above shows the top.
  const third: Partial<Record<ViewOrientation, Record<string, ViewOrientation>>> = {
    front: { up: 'top', down: 'bottom', left: 'left', right: 'right' },
    back: { up: 'top', down: 'bottom', left: 'right', right: 'left' },
    right: { up: 'top', down: 'bottom', left: 'front', right: 'back' },
    left: { up: 'top', down: 'bottom', left: 'back', right: 'front' },
    top: { up: 'back', down: 'front', left: 'left', right: 'right' },
    bottom: { up: 'front', down: 'back', left: 'left', right: 'right' },
  };
  const flip: Record<string, 'up' | 'down' | 'left' | 'right'> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const t = third[parent];
  if (!t) return null;
  return t[projection === 'third' ? dir : flip[dir]] ?? null;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}
function mul(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s];
}
function dot(a: Vec2, b: Vec2) {
  return a[0] * b[0] + a[1] * b[1];
}
function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
}
