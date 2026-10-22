// A drawing outside the editor (the agent API): what its views show — their projections by the kernel — its
// dimensions where the model has them now, its item numbers and bill of materials, as the sheet's lines; the standard
// views of a source; how a linear dimension lies. The editor shares these rules (with caches of its own).

import type { CadDocument, DocTab, DrawingBalloon, DrawingData, DrawingDimension, DrawingTab, DrawingView, Vec2, Vec3, ViewRef } from '../core/types';
import type { ProjectionRequest, ProjectionResult, ViewAnchorRequest, ViewCut, ViewRefsRequest, ViewRefsResult } from '../kernel/protocol';
import { isPictorial, parentView, sectionCut, smoothOutline, viewAxes } from '../core/drawingViews';
import { v3 } from '../core/math';
import { uid } from '../core/ids';
import { shownParts } from '../assembly/expand';
import { rotationMatrix } from '../assembly/compose';
import { storedBom } from '../assembly/bom';
import { LENGTH_FACTOR } from '../core/expr';
import type { Prim2D } from '../export/prim2d';
import { writePDF, type PdfFont } from '../export/pdf';
import { writeSVG } from '../export/svg';
import { writeDXF } from '../export/dxf';
import { getLang, t } from '../i18n';
import {
  STD_SCALES,
  balloonPrims,
  bomTablePrims,
  chooseScale,
  dimPrims,
  frameRect,
  notePrims,
  projectedOrientation,
  scaleLabel,
  sheetSize,
  titleBlockPrims,
  titleBlockRect,
  toSheet,
  viewPrims,
  type BomTableRow,
  type ProjectionData,
} from './sheet';

type Req<T> = Omit<T, 'type' | 'reqId' | 'studioKey'>;

/** What the views of a drawing come from, as the kernel has it built (a Part Studio as a view's configuration has it, an assembly placed). */
export interface DrawingSource {
  projection(req: Req<ProjectionRequest>): Promise<ProjectionResult>;
  viewAnchor(req: Req<ViewAnchorRequest>): Promise<ViewRef | null>;
  viewRefs(req: Req<ViewRefsRequest>): Promise<ViewRefsResult['points']>;
}

/** The kernel's source of a tab (a Part Studio, an assembly) in a configuration; none — it shows nothing. */
export type SourceOf = (tab: DocTab | undefined, configuration?: Record<string, string>) => DrawingSource | undefined;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** The kernel's projection of a view: a section view — along its own axes, cut by its plane. */
export function projectionRequest(v: DrawingView, views: DrawingView[]): Pick<Req<ProjectionRequest>, 'axes' | 'section' | 'breakout'> {
  const parent = v.section && parentView(v, views);
  if (v.section && parent) {
    const { axes, cut } = sectionCut(viewAxes(parent, views), v.section);
    return { axes, section: cut };
  }
  // a local section: its outline across the view (in space)
  if (v.brokenOut && v.brokenOut.outline.length >= 3) {
    const { n, x } = viewAxes(v, views);
    const y = v3.cross(n, x);
    const outline = smoothOutline(v.brokenOut.outline).map((p) => v3.add(v3.scale(x, p[0]), v3.scale(y, p[1])));
    return { breakout: { outline, ...(v.brokenOut.depth !== undefined ? { depth: v.brokenOut.depth } : {}) } };
  }
  return {};
}

/** The view whose projection a view shows: a detail view — its parent's (the parent's parent's …). */
export function projectedView(v: DrawingView, views: DrawingView[]): DrawingView {
  let cur = v;
  for (let i = 0; i < 16 && cur.detail; i++) cur = parentView(cur, views) ?? cur;
  return cur;
}

/** What a view cuts away (a section, a local section; a detail view — as its parent): none for a plain view. */
export function viewCutOf(v: DrawingView, views: DrawingView[]): ViewCut | undefined {
  const { section, breakout } = projectionRequest(projectedView(v, views), views);
  return section ? { section } : breakout ? { breakout } : undefined;
}

/** A detail view's scale: the standard one nearest to twice its parent's (1:1 → 2:1, 1:5 → 1:2.5). */
export function detailScale(parentScale: number): number {
  const up = [...STD_SCALES].reverse().find((s) => s >= parentScale * 2 - 1e-9);
  return up ?? STD_SCALES[0];
}

/**
 * The standard views of a source (a Part Studio, an assembly): the front, the side and below it as the drawing's
 * projection places them, an isometric one in the corner — at the standard scale that fits them on the sheet.
 */
export async function standardViews(d: DrawingData, studioId: string, src: DrawingSource): Promise<DrawingView[]> {
  const front = await src.projection({ partIds: [], orientation: 'front', hidden: false });
  const top = await src.projection({ partIds: [], orientation: 'top', hidden: false });
  if (!front.bounds || !top.bounds) throw new Error('The part studio has no parts to draw');
  const fw = front.bounds[1][0] - front.bounds[0][0];
  const fh = front.bounds[1][1] - front.bounds[0][1];
  const th = top.bounds[1][1] - top.bounds[0][1];
  const f = frameRect(d);
  const availW = f.x1 - f.x0 - 30;
  const availH = Math.max(1, f.y1 - titleBlockRect(d).y1 - 20);
  // front + side horizontally, front + top vertically
  const scale = chooseScale(fw + th + 30, fh + th + 30, availW * 0.95, availH * 0.95);
  const gap = 20;
  const projection = d.projection ?? 'first';
  const cx = f.x0 + 15 + (fw * scale) / 2 + 10;
  const cy = f.y1 - 15 - (fh * scale) / 2;
  const frontId = uid('v');
  const view = (v: Omit<DrawingView, 'studioId' | 'partIds' | 'id'> & { id?: string }): DrawingView => ({ id: uid('v'), studioId, partIds: [], ...v });
  return [
    view({ id: frontId, orientation: 'front', x: cx, y: cy, scale, showHidden: true }),
    view({ orientation: projectedOrientation('front', 'right', projection)!, x: cx + (fw * scale) / 2 + gap + (th * scale) / 2, y: cy, scale, showHidden: true, parent: frontId }),
    view({ orientation: projectedOrientation('front', 'down', projection)!, x: cx, y: cy - (fh * scale) / 2 - gap - (th * scale) / 2, scale, showHidden: true, parent: frontId }),
    view({ orientation: 'iso', x: f.x1 - 70, y: f.y1 - 60, scale: STD_SCALES.find((x) => x <= scale * 0.8) ?? scale, showHidden: false }),
  ];
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** A new dimension's `refs` from the anchors found (none — no field). */
export const refsOf = (a: ViewRef | null, b: ViewRef | null = null): Pick<DrawingDimension, 'refs'> =>
  a || b ? { refs: { ...(a ? { a } : {}), ...(b ? { b } : {}) } } : {};

/** The anchors of a dimension in order: its first point (a circle's centre), its second. */
export const dimRefs = (dm: DrawingDimension): ViewRef[] => [dm.refs?.a, dm.refs?.b].filter((r): r is ViewRef => !!r);

/**
 * Where a dimension's anchors were, in the same order (a point on each): of a cut's several crossings, lines or
 * circles the kernel takes the nearest. An angle's lines — their points; a centre line's — their middles.
 */
export function dimHints(dm: DrawingDimension): Vec2[] {
  const mid = (p: Vec2, q: Vec2 = p): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const at = dm.kind === 'angle' ? [dm.b, dm.c] : dm.kind === 'centerline' ? [mid(dm.a, dm.b), dm.c && mid(dm.c, dm.d)] : [dm.a, dm.b];
  return [dm.refs?.a && (at[0] ?? dm.a), dm.refs?.b && (at[1] ?? dm.a)].filter((p): p is Vec2 => !!p);
}

/** Where two lines (through their two points) cross; none if parallel. */
export function lineCross(l1: [Vec2, Vec2], l2: [Vec2, Vec2]): Vec2 | null {
  const [p, q] = l1;
  const [r, s] = l2;
  const d1: Vec2 = [q[0] - p[0], q[1] - p[1]];
  const d2: Vec2 = [s[0] - r[0], s[1] - r[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9 * Math.hypot(...d1) * Math.hypot(...d2)) return null;
  const k = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den;
  return [p[0] + k * d1[0], p[1] + k * d1[1]];
}

/** The end of a line farthest from `x` along `dir` (the side an angle was measured on); else the farthest one. */
export function lineEnd(l: [Vec2, Vec2], x: Vec2, dir?: Vec2): Vec2 {
  const score = (e: Vec2) => (dir ? (e[0] - x[0]) * dir[0] + (e[1] - x[1]) * dir[1] : Math.hypot(e[0] - x[0], e[1] - x[1]));
  return score(l[0]) >= score(l[1]) ? l[0] : l[1];
}

/** A dimension as the model has it now: its anchors where the kernel found them (`pts`, in their order; none — as stored). */
export function liveDimension(dm: DrawingDimension, pts: ViewRefsResult['points'] | undefined): DrawingDimension {
  if (!pts) return dm;
  let i = 0;
  const a = dm.refs?.a ? pts[i++] : null;
  const b = dm.refs?.b ? pts[i++] : null;
  // a centre line: between its two lines as they are now
  if (dm.kind === 'centerline') return a?.ends && b?.ends ? { ...dm, a: a.ends[0], b: a.ends[1], c: b.ends[0], d: b.ends[1] } : dm;
  // an angle: where its lines cross now, each line's end on the side it was measured from
  if (dm.kind === 'angle') {
    const x = a?.ends && b?.ends ? lineCross(a.ends, b.ends) : null;
    if (!x || !dm.b || !dm.c) return dm;
    const dir = (p: Vec2): Vec2 => [p[0] - dm.a[0], p[1] - dm.a[1]];
    const nb = lineEnd(a!.ends!, x, dir(dm.b));
    const nc = lineEnd(b!.ends!, x, dir(dm.c));
    // the same sector as before: a line whose point is now on the other side of the vertex counts the other way
    const turned = (n: Vec2, was: Vec2): 1 | -1 => ((n[0] - x[0]) * dir(was)[0] + (n[1] - x[1]) * dir(was)[1] < 0 ? -1 : 1);
    const sector: [1 | -1, 1 | -1] | undefined = dm.sector && [(dm.sector[0] * turned(nb, dm.b)) as 1 | -1, (dm.sector[1] * turned(nc, dm.c)) as 1 | -1];
    return { ...dm, a: x, b: nb, c: nc, ...(sector ? { sector } : {}) };
  }
  const live = { ...dm };
  if (a) {
    live.a = a.p;
    // a circle's size: its point on the circle from the centre
    if ((dm.kind === 'diameter' || dm.kind === 'radius' || dm.kind === 'centermark') && a.r !== undefined) live.b = [a.p[0] + a.r, a.p[1]];
  }
  if (b) live.b = b.p;
  return live;
}

/** A linear dimension between sheet points `a`, `b` whose line goes through `p`: horizontal, vertical or aligned, and its offset. */
export function placeLinear(a: Vec2, b: Vec2, p: Vec2): { kind: DrawingDimension['kind']; offset: number } {
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  let kind: DrawingDimension['kind'] = 'linear';
  if ((p[1] > maxY || p[1] < minY) && p[0] >= minX - 2 && p[0] <= maxX + 2) kind = 'horizontal';
  else if ((p[0] > maxX || p[0] < minX) && p[1] >= minY - 2 && p[1] <= maxY + 2) kind = 'vertical';
  if (Math.abs(a[0] - b[0]) < 1e-6) kind = 'vertical';
  if (Math.abs(a[1] - b[1]) < 1e-6) kind = 'horizontal';
  return { kind, offset: linearOffset(a, b, kind, p) };
}

/** The offset of a linear dimension of `kind` between sheet points `a`, `b` whose dimension line goes through `p`. */
export function linearOffset(a: Vec2, b: Vec2, kind: DrawingDimension['kind'], p: Vec2): number {
  let axis: Vec2 = kind === 'horizontal' ? [1, 0] : kind === 'vertical' ? [0, 1] : [b[0] - a[0], b[1] - a[1]];
  const l = Math.hypot(axis[0], axis[1]) || 1;
  axis = [axis[0] / l, axis[1] / l];
  const n: Vec2 = [-axis[1], axis[0]];
  const pn = p[0] * n[0] + p[1] * n[1];
  const an = a[0] * n[0] + a[1] * n[1];
  const bn = b[0] * n[0] + b[1] * n[1];
  const offset = pn >= Math.max(an, bn) ? pn - Math.max(an, bn) : pn <= Math.min(an, bn) ? pn - Math.min(an, bn) : pn - Math.max(an, bn);
  return Math.abs(offset) < 3 ? (offset < 0 ? -8 : 8) : offset;
}

// ---------------------------------------------------------------------------
// Assemblies: the bill of materials, item numbers
// ---------------------------------------------------------------------------

/** An assembly a drawing shows: its bill of materials, each part's item, where each part is. */
export interface DrawingAssembly {
  rows: BomTableRow[];
  itemOf: Map<string, string>;
  place: Map<string, { R: number[]; t: Vec3 }>;
}

/** The assemblies a drawing's views and its BOM table show, by their tab ids. */
export function drawingAssemblies(doc: CadDocument, d: DrawingData): Map<string, DrawingAssembly> {
  const out = new Map<string, DrawingAssembly>();
  for (const id of new Set([...d.views.map((v) => v.studioId), ...(d.bom ? [d.bom.assemblyId] : [])])) {
    const asm = doc.tabs.find((x) => x.id === id);
    if (asm?.type !== 'assembly') continue;
    const bom = storedBom(doc, asm);
    const itemOf = new Map(bom.flatMap((r) => r.instances.map((i) => [i, r.item] as const)));
    const place = new Map(shownParts(doc.tabs, asm).map((i) => [i.id, { R: rotationMatrix(i.rotation), t: i.position }]));
    out.set(id, { rows: bom.map((r) => ({ item: r.item, partNumber: r.partNumber, name: r.name, quantity: r.quantity, material: r.material })), itemOf, place });
  }
  return out;
}

/** A rotation matrix (row by row, `rotationMatrix`) applied to `v`. */
const turn = (R: number[], v: Vec3): Vec3 => [0, 1, 2].map((i) => R[i * 3] * v[0] + R[i * 3 + 1] * v[1] + R[i * 3 + 2] * v[2]) as Vec3;

/** An item number's text: its part's item in the bill of materials of the view's assembly. */
export function balloonItem(d: DrawingData, assemblies: Map<string, DrawingAssembly>, b: Pick<DrawingBalloon, 'viewId' | 'instance'>): string {
  const v = d.views.find((x) => x.id === b.viewId);
  return (v && assemblies.get(projectedView(v, d.views).studioId)?.itemOf.get(b.instance)) ?? '?';
}

/** An item number's dot on the sheet: its point of the part where the assembly has the part now (none — it is gone). */
export function balloonDot(
  d: DrawingData,
  assemblies: Map<string, DrawingAssembly>,
  proj: (v: DrawingView) => ProjectionData | undefined,
  b: Pick<DrawingBalloon, 'viewId' | 'instance' | 'at'>,
): Vec2 | null {
  const v = d.views.find((x) => x.id === b.viewId);
  const pr = v && proj(v);
  const pl = v && assemblies.get(projectedView(v, d.views).studioId)?.place.get(b.instance);
  if (!v || !pr || !pl) return null;
  const w = v3.add(turn(pl.R, b.at), pl.t);
  const { n, x } = viewAxes(v, d.views);
  const y = v3.cross(n, x);
  return toSheet(v, pr, [v3.dot(w, x), v3.dot(w, y)]);
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export interface SheetContext {
  proj: (v: DrawingView) => ProjectionData | undefined;
  /** A dimension as the model has it now. */
  live: (dm: DrawingDimension) => DrawingDimension;
  assemblies: Map<string, DrawingAssembly>;
  /** The document's length unit in mm. */
  unitFactor: number;
  /** The words of hole callouts ("THRU"), the BOM table's header. */
  translate?: (key: string) => string;
  /** The views whose cutting lines and detail circles their parents show (none — all). */
  marked?: DrawingView[];
}

/** The views, dimensions, item numbers, BOM table and notes of a drawing (its title block apart). */
export function sheetPrims(d: DrawingData, ctx: SheetContext): Prim2D[] {
  const { proj, live, assemblies, unitFactor, translate = t } = ctx;
  const comma = d.decimal === ',';
  const prims: Prim2D[] = [];
  for (const v of d.views) prims.push(...viewPrims(v, proj(v), ctx.marked ?? d.views, comma));
  for (const dm of d.dimensions) {
    const v = d.views.find((x) => x.id === dm.viewId);
    // with its view only: before the view is computed its points have nowhere to go
    if (v && proj(v)) prims.push(...dimPrims(live(dm), v, proj(v), unitFactor, translate, comma));
  }
  for (const b of d.balloons ?? []) {
    const dot = balloonDot(d, assemblies, proj, b);
    if (dot) prims.push(...balloonPrims(dot, [b.x, b.y], balloonItem(d, assemblies, b)));
  }
  if (d.bom) prims.push(...bomTablePrims(d.bom, assemblies.get(d.bom.assemblyId)?.rows ?? [], translate));
  prims.push(...notePrims(d));
  return prims;
}

/** The scale written in the title block: of the first orthographic view (else the first). */
export function mainScale(d: DrawingData): number | undefined {
  return d.views.find((v) => !isPictorial(v.orientation))?.scale ?? d.views[0]?.scale;
}

/** A drawing as the kernel makes it now: its views projected, its dimensions where the model has them. */
export interface DrawnSheet {
  width: number;
  height: number;
  prims: Prim2D[];
  /** Each view's projection (a detail view: its parent's). */
  proj: (v: DrawingView) => ProjectionData | undefined;
}

/** Draw a drawing's sheet: every view's projection, the dimensions' anchors, the title block. */
export async function drawSheet(doc: CadDocument, tab: DrawingTab, sourceOf: SourceOf, translate: (key: string) => string = t): Promise<DrawnSheet> {
  const d = tab.drawing;
  const views = d.views;
  const tabOf = (v: DrawingView) => doc.tabs.find((x) => x.id === v.studioId);
  const projs = new Map<string, ProjectionData>();
  for (const v of views) {
    if (v.detail) continue;
    const src = sourceOf(tabOf(v), v.configuration);
    if (!src) continue;
    const res = await src.projection({ partIds: v.partIds, orientation: v.orientation, hidden: true, ...projectionRequest(v, views) });
    projs.set(v.id, { ...res, key: v.id });
  }
  const proj = (v: DrawingView) => projs.get(projectedView(v, views).id);
  // the dimensions' anchors where the model has them now
  const lives = new Map<string, DrawingDimension>();
  for (const dm of d.dimensions) {
    const refs = dimRefs(dm);
    const v = views.find((x) => x.id === dm.viewId);
    if (!refs.length || !v) continue;
    const pv = projectedView(v, views);
    const src = sourceOf(tabOf(pv), pv.configuration);
    if (!src) continue;
    const onCut = refs.some((r) => r.cut);
    const cut = onCut ? viewCutOf(v, views) : undefined;
    try {
      const pts = await src.viewRefs({ axes: viewAxes(v, views), refs, ...(cut ? { cut, near: dimHints(dm), partIds: pv.partIds } : {}) });
      lives.set(dm.id, liveDimension(dm, pts));
    } catch {
      // as stored
    }
  }
  const [width, height] = sheetSize(d);
  const scale = mainScale(d);
  const date = new Date(doc.modified).toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-GB');
  const extra = { scale: scale ? scaleLabel(scale, d.decimal === ',') : '—', units: doc.units.length, date };
  const prims = [
    ...titleBlockPrims(d, extra, translate),
    ...sheetPrims(d, { proj, live: (dm) => lives.get(dm.id) ?? dm, assemblies: drawingAssemblies(doc, d), unitFactor: LENGTH_FACTOR[doc.units.length], translate }),
  ];
  return { width, height, prims, proj };
}

/** A drawn sheet as a file: PDF (with `font` — Cyrillic too; without — Latin only), SVG or DXF. */
export function sheetFile(sheet: DrawnSheet, format: 'pdf' | 'svg' | 'dxf', title: string, font?: PdfFont): { data: Uint8Array | string; mime: string; ext: string } {
  if (format === 'pdf') return { data: writePDF([{ width: sheet.width, height: sheet.height, prims: sheet.prims }], { title, font }), mime: 'application/pdf', ext: 'pdf' };
  if (format === 'svg') return { data: writeSVG(sheet.prims, { width: sheet.width, height: sheet.height, background: '#ffffff' }), mime: 'image/svg+xml', ext: 'svg' };
  return { data: writeDXF(sheet.prims, { units: 'mm' }), mime: 'image/vnd.dxf', ext: 'dxf' };
}
