// ASCII DXF writer (R12 / AC1009). R12 is the most widely supported flavour (AutoCAD,
// LibreCAD, Inkscape, QCAD, laser cutter software) and needs no entity handles.
// Ellipses are approximated by closed POLYLINEs, filled shapes by SOLID triangles.

import type { Vec2 } from '../core/types';
import {
  type LineStyle,
  type Prim2D,
  CAP_HEIGHT,
  LINE_STYLES,
  STYLE_DEFAULTS,
  arcSweep,
  arrowTriangle,
  ellipsePoint,
  fmtNum,
  isFullSweep,
  parseColor,
  primBounds,
  primStyle,
} from './prim2d';

export interface DXFOptions {
  /** Output units. Primitives are always in mm; 'in' converts coordinates to inches. */
  units?: 'mm' | 'in';
}

interface LTypeDef {
  name: string;
  desc: string;
  /** Pattern in mm: positive = dash, negative = gap. */
  pattern: number[];
}

function dashToPattern(dash: number[]): number[] {
  return dash.map((d, i) => (i % 2 === 0 ? d : -d));
}

const LTYPES: LTypeDef[] = [
  { name: 'CONTINUOUS', desc: 'Solid line', pattern: [] },
  { name: 'DASHED', desc: 'Dashed __ __ __ __', pattern: dashToPattern(STYLE_DEFAULTS.hidden.dash) },
  { name: 'CENTER', desc: 'Center ____ _ ____ _', pattern: dashToPattern(STYLE_DEFAULTS.center.dash) },
  { name: 'DASHED2', desc: 'Dashed (small) _ _ _ _', pattern: dashToPattern(STYLE_DEFAULTS.construction.dash) },
];

const STYLE_LTYPE: Record<LineStyle, string> = {
  visible: 'CONTINUOUS',
  hidden: 'DASHED',
  center: 'CENTER',
  thin: 'CONTINUOUS',
  dimension: 'CONTINUOUS',
  border: 'CONTINUOUS',
  construction: 'DASHED2',
};

const ELLIPSE_SEGMENTS = 72;

// AutoCAD Color Index palette subset used to map RGB colours.
const ACI_PALETTE: [number, number, number, number][] = [
  [1, 255, 0, 0],
  [2, 255, 255, 0],
  [3, 0, 255, 0],
  [4, 0, 255, 255],
  [5, 0, 0, 255],
  [6, 255, 0, 255],
  [7, 0, 0, 0],
  [7, 255, 255, 255],
  [8, 128, 128, 128],
  [9, 192, 192, 192],
  [250, 51, 51, 51],
  [251, 80, 80, 80],
  [252, 105, 105, 105],
  [253, 130, 130, 130],
  [254, 190, 190, 190],
];

/** Nearest AutoCAD Color Index for a CSS colour (7 = black/white foreground). */
export function colorToACI(color: string | undefined): number {
  const c = parseColor(color);
  if (!c) return 7;
  let best = 7;
  let bestD = Infinity;
  for (const [aci, r, g, b] of ACI_PALETTE) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = aci;
    }
  }
  return best;
}

function styleLayerName(s: LineStyle): string {
  return s.toUpperCase();
}

function sanitizeLayer(name: string): string {
  const s = name.trim().replace(/[^A-Za-z0-9_$-]/g, '_').toUpperCase();
  return s.length ? s.slice(0, 255) : '0';
}

/** Encodes text for a DXF TEXT entity: AutoCAD %% codes for common symbols, \U+XXXX for the rest. */
function encodeText(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp === 0x2300 || cp === 0x2205) out += '%%c';
    else if (cp === 0xb0) out += '%%d';
    else if (cp === 0xb1) out += '%%p';
    else if (cp < 32) out += ' ';
    else if (cp < 127) out += ch;
    else if (cp <= 0xffff) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    else out += '?';
  }
  return out;
}

/** Ear-clipping triangulation of a simple polygon. Returns index triples (CCW). */
export function triangulate(pts: Vec2[]): [number, number, number][] {
  let n = pts.length;
  if (n > 3 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) n--;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (area < 0) idx.reverse();
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 10) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j];
        if (cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate input (collinear / self-touching): drop a vertex to guarantee progress.
      idx.splice(1, 1);
    }
  }
  if (idx.length === 3) {
    const [ia, ib, ic] = idx;
    if (Math.abs(cross(pts[ia], pts[ib], pts[ic])) > 1e-12) tris.push([ia, ib, ic]);
  }
  return tris;
}

export function writeDXF(prims: Prim2D[], opts: DXFOptions = {}): string {
  const units = opts.units ?? 'mm';
  const k = units === 'in' ? 1 / 25.4 : 1;
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    out.push(String(code).padStart(3, ' '), typeof value === 'number' ? fmtNum(value, 6) : value);
  };
  const pt = (code: number, x: number, y: number) => {
    g(code, x * k);
    g(code + 10, y * k);
    g(code + 20, 0);
  };

  // Layers: '0', one per line style (always present) + custom layers. name -> [ACI colour, linetype]
  const layers = new Map<string, [number, string]>();
  layers.set('0', [7, 'CONTINUOUS']);
  for (const s of LINE_STYLES) layers.set(styleLayerName(s), [colorToACI(STYLE_DEFAULTS[s].color), STYLE_LTYPE[s]]);
  for (const p of prims) {
    if (p.layer !== undefined) {
      const name = sanitizeLayer(p.layer);
      if (!layers.has(name)) layers.set(name, [7, 'CONTINUOUS']);
    }
  }

  // --- HEADER ---
  const b = primBounds(prims);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$DWGCODEPAGE');
  g(3, 'ANSI_1252');
  g(9, '$INSBASE');
  pt(10, 0, 0);
  g(9, '$EXTMIN');
  pt(10, b.min[0], b.min[1]);
  g(9, '$EXTMAX');
  pt(10, b.max[0], b.max[1]);
  g(9, '$LIMMIN');
  g(10, b.min[0] * k);
  g(20, b.min[1] * k);
  g(9, '$LIMMAX');
  g(10, b.max[0] * k);
  g(20, b.max[1] * k);
  g(9, '$LTSCALE');
  g(40, 1);
  g(9, '$INSUNITS');
  g(70, units === 'in' ? 1 : 4);
  g(0, 'ENDSEC');

  // --- TABLES ---
  g(0, 'SECTION');
  g(2, 'TABLES');

  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, LTYPES.length);
  for (const lt of LTYPES) {
    g(0, 'LTYPE');
    g(2, lt.name);
    g(70, 0);
    g(3, lt.desc);
    g(72, 65);
    g(73, lt.pattern.length);
    g(40, lt.pattern.reduce((s, v) => s + Math.abs(v), 0) * k);
    for (const v of lt.pattern) g(49, v * k);
  }
  g(0, 'ENDTAB');

  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.size);
  for (const [name, [color, ltype]] of layers) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, ltype);
  }
  g(0, 'ENDTAB');

  g(0, 'TABLE');
  g(2, 'STYLE');
  g(70, 1);
  g(0, 'STYLE');
  g(2, 'STANDARD');
  g(70, 0);
  g(40, 0);
  g(41, 1);
  g(50, 0);
  g(71, 0);
  g(42, 2.5 * k);
  g(3, 'txt');
  g(0, 'ENDTAB');

  g(0, 'ENDSEC');

  // --- BLOCKS (empty, present for picky readers) ---
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  g(0, 'ENDSEC');

  // --- ENTITIES ---
  g(0, 'SECTION');
  g(2, 'ENTITIES');

  for (const p of prims) {
    const style = primStyle(p);
    const layer = p.layer === undefined ? styleLayerName(style) : sanitizeLayer(p.layer);
    const [layerColor, layerLtype] = layers.get(layer) ?? [7, 'CONTINUOUS'];
    const color = colorToACI(p.color ?? STYLE_DEFAULTS[style].color);
    const ltype = STYLE_LTYPE[style];

    // Entities inherit colour / linetype from their layer unless they differ (BYLAYER otherwise).
    const common = (filled = false) => {
      g(8, layer);
      if (!filled && ltype !== layerLtype) g(6, ltype);
      if (color !== layerColor) g(62, color);
    };
    const polyline = (pts: Vec2[], closed: boolean) => {
      if (pts.length < 2) return;
      g(0, 'POLYLINE');
      common();
      g(66, 1);
      pt(10, 0, 0);
      g(70, closed ? 1 : 0);
      for (const q of pts) {
        g(0, 'VERTEX');
        g(8, layer);
        pt(10, q[0], q[1]);
      }
      g(0, 'SEQEND');
      g(8, layer);
    };
    const solid = (a: Vec2, bb: Vec2, c: Vec2) => {
      g(0, 'SOLID');
      common(true);
      pt(10, a[0], a[1]);
      pt(11, bb[0], bb[1]);
      pt(12, c[0], c[1]);
      pt(13, c[0], c[1]);
    };

    switch (p.t) {
      case 'line':
        g(0, 'LINE');
        common();
        pt(10, p.a[0], p.a[1]);
        pt(11, p.b[0], p.b[1]);
        break;
      case 'circle':
        g(0, 'CIRCLE');
        common();
        pt(10, p.c[0], p.c[1]);
        g(40, p.r * k);
        break;
      case 'arc': {
        const sweep = arcSweep(p.a0, p.a1);
        if (sweep <= 0) break;
        if (isFullSweep(sweep)) {
          g(0, 'CIRCLE');
          common();
          pt(10, p.c[0], p.c[1]);
          g(40, p.r * k);
          break;
        }
        const deg = (r: number) => {
          let d = ((r * 180) / Math.PI) % 360;
          if (d < 0) d += 360;
          return d;
        };
        g(0, 'ARC');
        common();
        pt(10, p.c[0], p.c[1]);
        g(40, p.r * k);
        g(50, deg(p.a0));
        g(51, deg(p.a0 + sweep));
        break;
      }
      case 'ellipse': {
        const pts: Vec2[] = [];
        for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
          pts.push(ellipsePoint(p.c, p.rx, p.ry, p.rot, (i / ELLIPSE_SEGMENTS) * Math.PI * 2));
        }
        polyline(pts, true);
        break;
      }
      case 'poly':
        polyline(p.pts, !!p.closed);
        break;
      case 'text': {
        if (!p.text) break;
        const hj = p.align === 'center' ? 1 : p.align === 'right' ? 2 : 0;
        const vj = p.vAlign === 'middle' ? 2 : p.vAlign === 'top' ? 3 : 0;
        g(0, 'TEXT');
        common(true);
        pt(10, p.p[0], p.p[1]);
        g(40, p.h * CAP_HEIGHT * k);
        g(1, encodeText(p.text));
        const ang = (((p.angle ?? 0) * 180) / Math.PI) % 360;
        if (ang !== 0) g(50, ang < 0 ? ang + 360 : ang);
        g(7, 'STANDARD');
        if (hj !== 0) g(72, hj);
        if (hj !== 0 || vj !== 0) pt(11, p.p[0], p.p[1]);
        if (vj !== 0) g(73, vj);
        break;
      }
      case 'arrow': {
        const [a, l, r] = arrowTriangle(p);
        solid(a, l, r);
        break;
      }
      case 'fill':
        for (const [i, j, m] of triangulate(p.pts)) solid(p.pts[i], p.pts[j], p.pts[m]);
        break;
    }
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}
