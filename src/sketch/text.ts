// Sketch text (Onshape Text): glyph outlines of the bundled fonts (SIL OFL, see fonts/OFL.txt) laid out along a
// text entity's baseline and expanded into derived sketch geometry — lines and cubic Bézier spans (two-point splines
// with handles) with ids `<text>~text~<key>`, like pattern copies: they make regions, the solver never sees them.

import opentype, { type Font } from 'opentype.js';
import type { SkEntity, SkFont, SkText, Vec2 } from '../core/types';
import { entityMap, pointInPolygon, pointOf, sampleEntity, type EntityMap } from './curves';
import type { SketchRegion } from './regions';
import { COPY_SEP } from './patterns';

export const FONT_FILES: Record<SkFont, URL> = {
  sans: new URL('./fonts/Inter-Regular.woff', import.meta.url),
  sansBold: new URL('./fonts/Inter-SemiBold.woff', import.meta.url),
  mono: new URL('./fonts/JetBrainsMono-Regular.woff', import.meta.url),
};

/** Font names for the UI (not translated). */
export const FONT_NAMES: Record<SkFont, string> = {
  sans: 'Inter',
  sansBold: 'Inter SemiBold',
  mono: 'JetBrains Mono',
};

const fonts = new Map<SkFont, Font>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

/** A font from its file's bytes (Node reads the files itself; the browser and the worker — `loadFonts`). */
export function registerFont(name: SkFont, data: ArrayBuffer) {
  fonts.set(name, opentype.parse(data));
  layouts.clear();
  for (const f of listeners) f();
}

export function fontsLoaded(): boolean {
  return fonts.size === Object.keys(FONT_FILES).length;
}

/** Fetch the bundled fonts (once; a failure is retried on the next call). */
export function loadFonts(): Promise<void> {
  if (fontsLoaded()) return Promise.resolve();
  loading ??= Promise.all(
    (Object.keys(FONT_FILES) as SkFont[]).map(async (k) => {
      const r = await fetch(FONT_FILES[k]);
      if (!r.ok) throw new Error(`Font ${FONT_NAMES[k]}: ${r.status}`);
      registerFont(k, await r.arrayBuffer());
    }),
  )
    .then(() => undefined)
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Called whenever a font arrives (the sketch is drawn again with its letters). */
export function onFontLoaded(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ---------------------------------------------------------------------------
// Layout (font units, y up, baseline at 0)
// ---------------------------------------------------------------------------

/** A span to `to` from the previous point: a line, or a cubic Bézier with inner control points c1, c2. */
interface Span {
  to: Vec2;
  c1?: Vec2;
  c2?: Vec2;
}

interface Contour {
  start: Vec2;
  spans: Span[];
}

interface Layout {
  /** Contours of each glyph (glyph order: stable keys for the letters before an edit). */
  glyphs: Contour[][];
  /** Advance width of the line. */
  width: number;
  /** Height of the capital letters. */
  cap: number;
}

const layouts = new Map<string, Layout>();

function layoutText(font: SkFont, text: string): Layout | null {
  const f = fonts.get(font);
  if (!f) return null;
  const key = `${font}\n${text}`;
  const hit = layouts.get(key);
  if (hit) return hit;
  const upm = f.unitsPerEm;
  const cap = f.tables.os2?.sCapHeight || f.charToGlyph('H').getBoundingBox().y2 || upm * 0.7;
  const glyphs: Contour[][] = [];
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  const width = f.forEachGlyph(text, 0, 0, upm, { kerning: true }, (g, x) => {
    const contours: Contour[] = [];
    let cur: Contour | null = null;
    let last: Vec2 = [0, 0];
    const P = (px: number, py: number): Vec2 => [x + px, py];
    for (const c of g.path.commands) {
      if (c.type === 'M') {
        cur = { start: P(c.x, c.y), spans: [] };
        contours.push(cur);
        last = cur.start;
      } else if (!cur) continue;
      else if (c.type === 'L') {
        const to = P(c.x, c.y);
        if (!same(to, last)) cur.spans.push({ to });
        last = to;
      } else if (c.type === 'Q') {
        // the quadratic raised to a cubic: inner points 2/3 of the way to the control point
        const q = P(c.x1, c.y1);
        const to = P(c.x, c.y);
        const c1: Vec2 = [last[0] + ((q[0] - last[0]) * 2) / 3, last[1] + ((q[1] - last[1]) * 2) / 3];
        const c2: Vec2 = [to[0] + ((q[0] - to[0]) * 2) / 3, to[1] + ((q[1] - to[1]) * 2) / 3];
        cur.spans.push({ to, c1, c2 });
        last = to;
      } else if (c.type === 'C') {
        const to = P(c.x, c.y);
        cur.spans.push({ to, c1: P(c.x1, c.y1), c2: P(c.x2, c.y2) });
        last = to;
      } else {
        if (!same(last, cur.start)) cur.spans.push({ to: cur.start });
        cur = null;
      }
    }
    // an unclosed last contour closes too
    if (cur && !same(last, cur.start)) cur.spans.push({ to: cur.start });
    glyphs.push(contours.filter((k) => k.spans.length > 1 || (k.spans.length === 1 && !!k.spans[0].c1)));
  });
  const out = { glyphs, width: Number.isFinite(width) ? width : 0, cap };
  layouts.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

export const TEXT_KEY = 'text';
const PART = `${COPY_SEP}${TEXT_KEY}${COPY_SEP}`;

export function textPartId(textId: string, key: string): string {
  return `${textId}${PART}${key}`;
}

/** Whether an id is of the derived geometry of a text (its letters, its box). */
export function isTextPart(id: string): boolean {
  return id.includes(PART);
}

/** The text entity a derived id belongs to. */
export function textOfPart(id: string): string | null {
  const i = id.indexOf(PART);
  return i < 0 ? null : id.slice(0, i);
}

/** A text's frame: its baseline start, the directions of its lines (right) and letters (up), the capital height. */
export function textFrame(t: SkText, map: EntityMap): { o: Vec2; right: Vec2; up: Vec2; h: number } | null {
  const o = pointOf(map, t.p1);
  const top = pointOf(map, t.p2);
  const h = Math.hypot(top[0] - o[0], top[1] - o[1]);
  if (!(h > 1e-9)) return null;
  const up: Vec2 = [(top[0] - o[0]) / h, (top[1] - o[1]) / h];
  return { o, right: [up[1], -up[0]], up, h };
}

/** Width of the text's box (its advance), in sketch units; a fallback before the font is there. */
export function textWidth(t: SkText, map: EntityMap): number {
  const fr = textFrame(t, map);
  if (!fr) return 0;
  const lay = layoutText(t.font, t.text);
  return lay ? (lay.width * fr.h) / lay.cap : fr.h * 0.6 * t.text.length;
}

/** The letters of a text and its box (construction): derived sketch entities. */
export function textGeometry(t: SkText, map: EntityMap): SkEntity[] {
  const fr = textFrame(t, map);
  if (!fr) return [];
  const lay = layoutText(t.font, t.text);
  const s = lay ? fr.h / lay.cap : 1;
  const P = (q: Vec2): Vec2 => [fr.o[0] + (fr.right[0] * q[0] + fr.up[0] * q[1]) * s, fr.o[1] + (fr.right[1] * q[0] + fr.up[1] * q[1]) * s];
  const out: SkEntity[] = [];
  const point = (key: string, p: Vec2) => {
    const id = textPartId(t.id, key);
    out.push({ id, type: 'point', x: p[0], y: p[1], owner: t.id });
    return id;
  };
  // the box: baseline, right side, top (the left side runs between the text's own points)
  const w = textWidth(t, map);
  const br = point('b1', [fr.o[0] + fr.right[0] * w, fr.o[1] + fr.right[1] * w]);
  const tr = point('b2', [fr.o[0] + (fr.right[0] * w + fr.up[0] * fr.h), fr.o[1] + (fr.right[1] * w + fr.up[1] * fr.h)]);
  const sides: [string, string, string][] = [
    ['box0', t.p1, br],
    ['box1', br, tr],
    ['box2', tr, t.p2],
    ['box3', t.p2, t.p1],
  ];
  for (const [k, a, b] of sides) out.push({ id: textPartId(t.id, k), type: 'line', p1: a, p2: b, construction: true });
  if (!lay) return out;
  const cons = t.construction ? { construction: true as const } : {};
  lay.glyphs.forEach((contours, gi) =>
    contours.forEach((k, ci) => {
      const base = `g${gi}c${ci}`;
      const start = point(`${base}p0`, P(k.start));
      let prev = start;
      k.spans.forEach((sp, si) => {
        const end = si === k.spans.length - 1 ? start : point(`${base}p${si + 1}`, P(sp.to));
        const id = textPartId(t.id, `${base}s${si}`);
        if (sp.c1 && sp.c2) {
          const h0 = point(`${base}s${si}h0`, P(sp.c1));
          const h1 = point(`${base}s${si}h1`, P(sp.c2));
          out.push({ id, type: 'spline', pts: [prev, end], h0, h1, ...cons });
        } else out.push({ id, type: 'line', p1: prev, p2: end, ...cons });
        prev = end;
      });
    }),
  );
  return out;
}

/** Polylines of a text that is not in the sketch yet (the tool's preview): its box and letters. */
export function textOutline(text: string, font: SkFont, o: Vec2, h: number): Vec2[][] {
  const pts: SkEntity[] = [
    { id: 'p1', type: 'point', x: o[0], y: o[1] },
    { id: 'p2', type: 'point', x: o[0], y: o[1] + h },
  ];
  const t: SkText = { id: 't', type: 'text', text, font, p1: 'p1', p2: 'p2' };
  const all = [...pts, t, ...textGeometry(t, entityMap([...pts, t]))];
  const map = entityMap(all);
  return all.filter((e) => e.type === 'line' || e.type === 'spline').map((e) => sampleEntity(e, map));
}

/**
 * The counters of letters (the inside of "O", "A"): regions bounded by letters only that lie in the hole of a letter —
 * picking a whole sketch leaves them out, so its letters extrude as letters.
 */
export function isTextCounter(r: SketchRegion, regions: SketchRegion[]): boolean {
  const lettersOnly = (x: SketchRegion) => x.key.ents.length > 0 && x.key.ents.every(isTextPart);
  return lettersOnly(r) && regions.some((o) => o !== r && lettersOnly(o) && o.holePolygons.some((h) => pointInPolygon(r.key.pt, h)));
}

/** Entities with the letters and boxes of their texts added (as derived geometry). */
export function expandTexts(entities: SkEntity[]): SkEntity[] {
  if (!entities.some((e) => e.type === 'text')) return entities;
  const map = entityMap(entities);
  const out = [...entities];
  for (const e of entities) if (e.type === 'text') out.push(...textGeometry(e, map));
  return out;
}
