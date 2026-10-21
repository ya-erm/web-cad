// Drawing tab: sheet with title block, projected views (HLR), dimensions and notes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Draft } from 'immer';
import type { AssemblyTab, CadDocument, ConfigInput, DocTab, DrawingBalloon, DrawingData, DrawingDimension, DrawingTab, DrawingView, PartStudioTab, Vec2, Vec3, ViewOrientation, ViewRef } from '../core/types';
import { shownParts } from '../assembly/expand';
import { rotationMatrix, sourceKey } from '../assembly/compose';
import { storedBom } from '../assembly/bom';
import { uid } from '../core/ids';
import { cuttingLine, isDerivedView, isPictorial, nextViewLetter, parentView, sectionCut, smoothOutline, stepPoint, viewAxes, type ViewAxes } from '../core/drawingViews';
import type { Breakout, PlacedPart, SectionCut, ViewCut } from '../kernel/protocol';
import { v3 } from '../core/math';
import { chosenLabel, configuredFeatures, inputName, variantStudio } from '../core/config';
import { ConfigurationFields } from '../ui/ConfigurationFields';
import { derivedBuildOrder, derivedInputs, hash, studioVersion } from '../core/derived';
import { withDerivedSources } from '../store/rebuild';
import { LENGTH_FACTOR } from '../core/expr';
import { kernel } from '../kernel/client';
import { useDoc } from '../store/docStore';
import { useEditor, type ContextMenuItem } from '../store/editorStore';
import type { Prim2D } from '../export/prim2d';
import { STYLE_DEFAULTS } from '../export/prim2d';
import { writePDF } from '../export/pdf';
import { loadPdfFont } from '../export/pdfFont';
import { writeSVG } from '../export/svg';
import { writeDXF } from '../export/dxf';
import { download, safeName } from '../ui/exporting';
import { Icon } from '../ui/icons';
import { DecimalInput } from '../ui/DecimalInput';
import { Toast } from '../ui/Overlays';
import { getLang, t } from '../i18n';
import {
  angleSector,
  balloonPrims,
  balloonShelf,
  bomTablePrims,
  bomTableRect,
  ITEM_H,
  type BomTableRow,
  centerlineOf,
  chooseScale,
  cuttingLinePrims,
  detailCirclePrims,
  dimLevel,
  dimPrims,
  frameRect,
  notePrims,
  offsetForLevel,
  projectedOrientation,
  scaleLabel,
  sheetSize,
  STD_SCALES,
  titleBlockContent,
  titleBlockRect,
  titleBlockPrims,
  toModel,
  toSheet,
  VIEW_NAMES,
  viewLabel,
  viewPrims,
  viewRect,
  type ProjectionData,
} from './sheet';
import { textWidth } from '../export/prim2d';
import { TitleBlockSettings } from './TitleBlockSettings';

// ---------------------------------------------------------------------------
// Projection cache: builds the referenced part studio in the worker, then asks for HLR views.
// ---------------------------------------------------------------------------

const projCache = new Map<string, ProjectionData>();
const builtStudios = new Map<string, unknown>();

function studioKeyOf(s: PartStudioTab, doc?: CadDocument) {
  // a Part Studio that derives from others changes with them
  const sources = doc ? derivedBuildOrder(doc, s.id, configuredFeatures(s)).map((id) => studioVersion(doc, id)) : [];
  // a hash of everything it is built from (its lengths alone missed edits like 25 mm → 35 mm)
  return `${s.id}:${hash(JSON.stringify([s.features, s.rollback, s.parts, s.configuration, s.configChoice, sources]))}`;
}

async function ensureBuilt(doc: CadDocument, studio: PartStudioTab) {
  // built as its chosen configuration has it, after the Part Studios it derives from
  const inputs = [studio.features, studio.configuration, studio.configChoice, ...derivedInputs(doc, studio)];
  const built = builtStudios.get(studio.id) as unknown[] | undefined;
  if (built?.length === inputs.length && built.every((x, i) => x === inputs[i]) && !useEditor.getState().editing) return;
  const upTo = studio.rollback ?? studio.features.length;
  const features = await withDerivedSources(doc, studio.id, configuredFeatures(studio).slice(0, upTo));
  await kernel().build(studio.id, {
    units: doc.units,
    features,
    partMeta: Object.fromEntries(Object.entries(studio.parts).map(([k, v]) => [k, { name: v.name, color: v.color, hidden: v.hidden }])),
    upTo,
  });
  builtStudios.set(studio.id, inputs);
}

/** What a view's projection depends on besides the Part Studio: the axes it is seen along, its section, its parts. */
function viewGeometry(v: DrawingView, views: DrawingView[]) {
  const req = projectionRequest(v, views);
  return `${JSON.stringify([req.axes ?? v.orientation, req.section ?? null, req.breakout ?? null])}|${v.partIds.join(',')}|${v.showHidden}`;
}

function viewKey(v: DrawingView, views: DrawingView[], src: ViewSource) {
  return `${src.version}|${viewGeometry(v, views)}`;
}

/** What a view shows, as the kernel has it: a Part Studio (as the view's configuration has it), an assembly's parts. */
interface ViewSource {
  /** The kernel's builder of it. */
  key: string;
  /** What it is built from: `${key}:${hash}`. */
  version: string;
  /** Built (placed) in the kernel. */
  ensure: () => Promise<void>;
}

/** A rotation matrix (row by row, `rotationMatrix`) applied to `v`; `back` — its inverse. */
const turn = (R: number[], v: Vec3, back = false): Vec3 =>
  [0, 1, 2].map((i) => (back ? R[i] * v[0] + R[3 + i] * v[1] + R[6 + i] * v[2] : R[i * 3] * v[0] + R[i * 3 + 1] * v[1] + R[i * 3 + 2] * v[2])) as Vec3;

/** What a drawing's views come from: a Part Studio, an assembly. */
type SourceTab = PartStudioTab | AssemblyTab;

/** Assemblies placed in the kernel for drawings: builder key → the version placed. */
const placedAssemblies = new Map<string, string>();

function tabSource(doc: CadDocument, tab: DocTab | undefined, configuration?: Record<string, string>): ViewSource | undefined {
  if (tab?.type === 'partStudio') {
    const studio = variantStudio(tab, configuration);
    return { key: studio.id, version: studioKeyOf(studio, doc), ensure: () => ensureBuilt(doc, studio) };
  }
  if (tab?.type !== 'assembly') return undefined;
  // an assembly: its parts' Part Studios (each as its instances choose it), then the parts placed as one builder's
  const parts = shownParts(doc.tabs, tab);
  const studios = new Map<string, PartStudioTab>();
  for (const i of parts) {
    const s = doc.tabs.find((x) => x.id === i.studioId);
    if (s?.type === 'partStudio' && !studios.has(sourceKey(i))) studios.set(sourceKey(i), variantStudio(s, i.configuration));
  }
  const key = `drawing-assembly:${tab.id}`;
  const placed: PlacedPart[] = parts.map((i) => ({ id: i.id, studioKey: sourceKey(i), partId: i.partId, name: i.name, position: i.position, rotation: i.rotation }));
  const version = `${key}:${hash(JSON.stringify([placed, [...studios.values()].map((s) => studioKeyOf(s, doc))]))}`;
  return {
    key,
    version,
    ensure: async () => {
      for (const s of studios.values()) await ensureBuilt(doc, s);
      if (placedAssemblies.get(key) === version) return;
      await kernel().place(key, placed);
      placedAssemblies.set(key, version);
    },
  };
}

/** A view's source: its Part Studio as its configuration has it, or its assembly. */
const viewSource = (doc: CadDocument, v: DrawingView) => tabSource(doc, doc.tabs.find((x) => x.id === v.studioId), v.configuration);

/** The kernel's projection of a view: a section view — along its own axes, cut by its plane. */
function projectionRequest(v: DrawingView, views: DrawingView[]): { axes?: ViewAxes; section?: SectionCut; breakout?: Breakout } {
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
function projectedView(v: DrawingView, views: DrawingView[]): DrawingView {
  let cur = v;
  for (let i = 0; i < 16 && cur.detail; i++) cur = parentView(cur, views) ?? cur;
  return cur;
}

/** A view and the views projected with it (its parent, the parent's other views): they share scale and configuration. */
const sameFamily = (a: DrawingView, b: DrawingView) => a.id === b.id || a.parent === b.id || b.parent === a.id || (!!a.parent && a.parent === b.parent);
/** …but a detail view keeps its own scale (it enlarges). */
const sameScale = (a: DrawingView, b: DrawingView) => a.id === b.id || (sameFamily(a, b) && !a.detail && !b.detail);

/** A detail view's scale: the standard one nearest to twice its parent's (1:1 → 2:1, 1:5 → 1:2.5). */
function detailScale(parentScale: number): number {
  const up = [...STD_SCALES].reverse().find((s) => s >= parentScale * 2 - 1e-9);
  return up ?? STD_SCALES[0];
}

/** The angle of a cutting line snapped to the view's horizontal or vertical when it is within 5° of it. */
function alignCut(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ang = Math.atan2(dy, dx);
  const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(ang - q) > (5 * Math.PI) / 180) return b;
  const l = Math.hypot(dx, dy);
  return [a[0] + Math.round(Math.cos(q)) * l, a[1] + Math.round(Math.sin(q)) * l];
}

/** Where dimensions' anchors are in their views: `${studio version}|${axes}|${refs}` → points (null — lost). */
const refCache = new Map<string, ({ p: Vec2; r?: number; ends?: [Vec2, Vec2] } | null)[]>();

/** A new dimension's `refs` from the anchors found (none — no field). */
const refsOf = (a: ViewRef | null, b: ViewRef | null = null): Pick<DrawingDimension, 'refs'> =>
  a || b ? { refs: { ...(a ? { a } : {}), ...(b ? { b } : {}) } } : {};

/** The anchors of a dimension in order: its first point (a circle's centre), its second. */
const dimRefs = (dm: DrawingDimension): ViewRef[] => [dm.refs?.a, dm.refs?.b].filter((r): r is ViewRef => !!r);

/**
 * Where a dimension's anchors were, in the same order (a point on each): of a cut's several crossings, lines or
 * circles the kernel takes the nearest. An angle's lines — their points; a centre line's — their middles.
 */
function dimHints(dm: DrawingDimension): Vec2[] {
  const mid = (p: Vec2, q: Vec2 = p): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const at = dm.kind === 'angle' ? [dm.b, dm.c] : dm.kind === 'centerline' ? [mid(dm.a, dm.b), dm.c && mid(dm.c, dm.d)] : [dm.a, dm.b];
  return [dm.refs?.a && (at[0] ?? dm.a), dm.refs?.b && (at[1] ?? dm.a)].filter((p): p is Vec2 => !!p);
}

/** What a view cuts away (a section, a local section; a detail view — as its parent): none for a plain view. */
function viewCutOf(v: DrawingView, views: DrawingView[]): ViewCut | undefined {
  const { section, breakout } = projectionRequest(projectedView(v, views), views);
  return section ? { section } : breakout ? { breakout } : undefined;
}

/**
 * Dimensions that follow the model (their points anchored to its vertices and circles): the kernel finds the anchors
 * again after each change of the Part Studio. Returns a dimension as the model has it now (as stored while unresolved).
 */
function useLiveDimensions(doc: CadDocument, drawing: DrawingData) {
  const [, force] = useState(0);
  const pending = useRef(new Set<string>());
  // each anchored dimension's key (its studio's version, the axes of its view, its anchors) and the key without the version
  const keys = useMemo(() => {
    type Key = { key: string; tail: string; src: ViewSource; axes: ViewAxes; refs: ViewRef[]; cut?: ViewCut; near?: Vec2[]; partIds: string[] };
    const out = new Map<string, Key>();
    const sources = new Map<string, ViewSource | undefined>();
    for (const dm of drawing.dimensions) {
      const refs = dimRefs(dm);
      const view = drawing.views.find((v) => v.id === dm.viewId);
      if (!refs.length || !view) continue;
      const pv = projectedView(view, drawing.views);
      const sk = `${pv.studioId}|${JSON.stringify(pv.configuration ?? {})}`;
      if (!sources.has(sk)) sources.set(sk, viewSource(doc, pv));
      const src = sources.get(sk);
      if (!src) continue;
      const axes = viewAxes(view, drawing.views);
      // anchors on a section's cut: the cut, where they were
      const onCut = refs.some((r) => r.cut);
      const cut = onCut ? viewCutOf(view, drawing.views) : undefined;
      const near = onCut ? dimHints(dm) : undefined;
      const tail = `|${JSON.stringify(axes)}|${JSON.stringify(refs)}${cut ? `|${JSON.stringify([cut, near, pv.partIds])}` : ''}`;
      out.set(dm.id, { key: src.version + tail, tail, src, axes, refs, cut, near, partIds: pv.partIds });
    }
    return out;
  }, [doc, drawing]);
  useEffect(() => {
    (async () => {
      await kernel().ready();
      for (const { key, src, axes, refs, cut, near, partIds } of keys.values()) {
        if (refCache.has(key) || pending.current.has(key)) continue;
        pending.current.add(key);
        try {
          await src.ensure();
          refCache.set(key, (await kernel().viewRefs({ studioKey: src.key, axes, refs, ...(cut ? { cut, near, partIds } : {}) })).points);
        } catch (e) {
          console.error(e);
        } finally {
          pending.current.delete(key);
        }
        force((n) => n + 1);
      }
    })();
  }, [doc, keys]);
  return (dm: DrawingDimension): DrawingDimension => {
    const k = keys.get(dm.id);
    if (!k) return dm;
    let pts = refCache.get(k.key);
    // while the new places are computed: the last ones known
    if (!pts) for (const [key, p] of refCache) if (key.endsWith(k.tail)) pts = p;
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
  };
}

function useProjections(doc: CadDocument, drawing: DrawingData) {
  const [, force] = useState(0);
  const pending = useRef(new Set<string>());
  // each view's source (by its Part Studio and configuration, or its assembly)
  const sources = useMemo(() => {
    const bySource = new Map<string, ViewSource | undefined>();
    const out = new Map<string, ViewSource | undefined>();
    for (const v of drawing.views) {
      const sk = `${v.studioId}|${JSON.stringify(v.configuration ?? {})}`;
      if (!bySource.has(sk)) bySource.set(sk, viewSource(doc, v));
      out.set(v.id, bySource.get(sk));
    }
    return out;
  }, [doc, drawing.views]);
  useEffect(() => {
    (async () => {
      await kernel().ready();
      for (const v of drawing.views) {
        const src = sources.get(v.id);
        // a detail view shows its parent's projection
        if (!src || v.detail) continue;
        const key = viewKey(v, drawing.views, src);
        if (projCache.has(key) || pending.current.has(key)) continue;
        pending.current.add(key);
        try {
          await src.ensure();
          const res = await kernel().projection({ studioKey: src.key, partIds: v.partIds, orientation: v.orientation, hidden: true, ...projectionRequest(v, drawing.views) });
          projCache.set(key, { ...res, key });
        } catch (e) {
          console.error(e);
        } finally {
          pending.current.delete(key);
        }
        // always repaint: a newer effect run may be waiting on this key
        force((n) => n + 1);
      }
    })();
  }, [sources, drawing.views]);
  return (view: DrawingView): ProjectionData | undefined => {
    const v = projectedView(view, drawing.views);
    const src = sources.get(v.id);
    if (!src) return undefined;
    const exact = projCache.get(viewKey(v, drawing.views, src));
    if (exact) return exact;
    // stale projection of the same view while the new one is computed
    const geometry = `|${viewGeometry(v, drawing.views)}`;
    for (const p of projCache.values()) if (p.key.startsWith(`${src.key}:`) && p.key.endsWith(geometry)) return p;
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// SVG rendering of primitives (Y-up sheet coordinates inside a flipped group)
// ---------------------------------------------------------------------------

function PrimSvg({ p, color }: { p: Prim2D; color?: string }) {
  const st = STYLE_DEFAULTS[p.style ?? 'visible'];
  const stroke = color ?? p.color ?? st.color;
  const common = {
    stroke,
    strokeWidth: st.width,
    strokeDasharray: st.dash.length ? st.dash.join(' ') : undefined,
    fill: 'none',
    vectorEffect: undefined,
  } as const;
  switch (p.t) {
    case 'line':
      return <line x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} {...common} />;
    case 'poly':
      return <polyline points={p.pts.map((q) => q.join(',')).join(' ')} {...common} {...(p.closed ? { points: [...p.pts, p.pts[0]].map((q) => q.join(',')).join(' ') } : {})} />;
    case 'circle':
      return <circle cx={p.c[0]} cy={p.c[1]} r={p.r} {...common} />;
    case 'arc': {
      const a0 = p.a0;
      let a1 = p.a1;
      while (a1 <= a0) a1 += Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const s = [p.c[0] + p.r * Math.cos(a0), p.c[1] + p.r * Math.sin(a0)];
      const e = [p.c[0] + p.r * Math.cos(a1), p.c[1] + p.r * Math.sin(a1)];
      return <path d={`M${s[0]},${s[1]} A${p.r},${p.r} 0 ${large} 1 ${e[0]},${e[1]}`} {...common} />;
    }
    case 'ellipse':
      return <ellipse cx={p.c[0]} cy={p.c[1]} rx={p.rx} ry={p.ry} transform={`rotate(${(p.rot * 180) / Math.PI} ${p.c[0]} ${p.c[1]})`} {...common} />;
    case 'arrow': {
      const l = Math.hypot(p.dir[0], p.dir[1]) || 1;
      const u = [p.dir[0] / l, p.dir[1] / l];
      const n = [-u[1], u[0]];
      const b = [p.tip[0] - u[0] * p.size, p.tip[1] - u[1] * p.size];
      const w = p.size / 3 / 2;
      const pts = [p.tip, [b[0] + n[0] * w, b[1] + n[1] * w], [b[0] - n[0] * w, b[1] - n[1] * w]];
      return <polygon points={pts.map((q) => q.join(',')).join(' ')} fill={stroke} stroke="none" />;
    }
    case 'fill':
      return <polygon points={p.pts.map((q) => q.join(',')).join(' ')} fill={p.color ?? '#eee'} stroke="none" />;
    case 'text': {
      const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
      const ang = ((p.angle ?? 0) * 180) / Math.PI;
      return (
        <text
          x={0}
          y={0}
          transform={`translate(${p.p[0]} ${p.p[1]}) rotate(${ang}) scale(1 -1)`}
          fontSize={p.h}
          textAnchor={anchor}
          dominantBaseline={p.vAlign === 'middle' ? 'middle' : p.vAlign === 'top' ? 'hanging' : 'alphabetic'}
          fill={color ?? p.color ?? '#000'}
          fontFamily="Helvetica, Arial, sans-serif"
        >
          {p.text}
        </text>
      );
    }
  }
}

// ---------------------------------------------------------------------------

type Tool = 'select' | 'dimension' | 'chain' | 'baseline' | 'angle' | 'ordinate' | 'axis' | 'note' | 'section' | 'detail' | 'callout' | 'breakout' | 'balloon';

/**
 * Ordinate dimensions being made: their base on a view, a point picked (until the first is placed), then their axis and
 * the line of values (sheet: its y for X ordinates, x for Y ones) for the next points.
 */
type OrdinateDraft = { viewId: string; base: Vec2; point?: Vec2; axis?: 'x' | 'y'; line?: number };

/**
 * Chain or baseline dimensions being made: their view, the first point, then the second; once the first is placed —
 * their kind, the line's level across them (sheet) and which way further lines go, the last point.
 */
type RunDraft = { viewId: string; first: Vec2; second?: Vec2; kind?: DrawingDimension['kind']; level?: number; out?: number; last?: Vec2 };

/** How far apart baseline dimensions' lines are, sheet mm. */
const BASELINE_STEP = 8;

/** An angle dimension being made: its view and the lines picked (view coordinates). */
type AngleDraft = { viewId: string; l1: [Vec2, Vec2]; l2?: [Vec2, Vec2] };

/** Where two lines (through their two points each) cross; none when parallel. */
function lineCross(l1: [Vec2, Vec2], l2: [Vec2, Vec2]): Vec2 | null {
  const [p, q] = l1;
  const [r, s] = l2;
  const d1: Vec2 = [q[0] - p[0], q[1] - p[1]];
  const d2: Vec2 = [s[0] - r[0], s[1] - r[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9 * Math.hypot(...d1) * Math.hypot(...d2)) return null;
  const t = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den;
  return [p[0] + t * d1[0], p[1] + t * d1[1]];
}

/** The end of a line farthest from `x` along `dir` (the side an angle was measured on); else the farthest one. */
function lineEnd(l: [Vec2, Vec2], x: Vec2, dir?: Vec2): Vec2 {
  const score = (e: Vec2) => (dir ? (e[0] - x[0]) * dir[0] + (e[1] - x[1]) * dir[1] : Math.hypot(e[0] - x[0], e[1] - x[1]));
  return score(l[0]) >= score(l[1]) ? l[0] : l[1];
}

interface DimDraft {
  viewId: string;
  a?: Vec2;
  circle?: { c: Vec2; r: number };
}

/** A section or detail view being made: on the parent `viewId`, the cutting line's or the circle's points (its view coordinates). */
interface ViewDraft {
  viewId: string;
  a: Vec2;
  b?: Vec2;
  /** An offset section's further points (Shift+click); an aligned section's one (Alt+click). */
  steps?: Vec2[];
  aligned?: boolean;
}
/** A draft with its line (or circle) drawn: ready to be placed. */
type LinedDraft = ViewDraft & { b: Vec2 };

/** What is selected on the sheet. */
type Selection = { kind: 'view' | 'dim' | 'note' | 'balloon' | 'bom'; id: string };

type TitleFields = Pick<DrawingData, 'title' | 'author' | 'designation' | 'titleBlock'>;

const GOST_FIELDS = [
  ['material', 'Material'], ['mass', 'Mass (with unit)'], ['organization', 'Organization'], ['revision', 'Version'], ['letter', 'Letter'],
  ['checkedBy', 'Checked by'], ['technicalControl', 'Technical control'], ['standardsControl', 'Standards control'], ['approvedBy', 'Approved by'],
] as const;

function TitleBlockDialog({ drawing, extra, onSave, onClose }: {
  drawing: DrawingData;
  extra: { scale: string; units: string; date: string };
  onSave: (fields: TitleFields) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<TitleFields>({ title: drawing.title, author: drawing.author, designation: drawing.designation ?? '', titleBlock: drawing.titleBlock });
  const formRef = useRef<HTMLFormElement>(null);
  const preview = { ...drawing, ...fields };
  const rect = titleBlockRect(preview);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector('textarea')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        ref={formRef}
        className="modal drawing-title-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawing-title-dialog-heading"
        onSubmit={(e) => { e.preventDefault(); onSave(fields); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); formRef.current?.requestSubmit(); }
          if (e.key === 'Tab') {
            const controls = Array.from(formRef.current!.querySelectorAll<HTMLElement>('input, textarea, select, button'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}
      >
        <div className="modal-header" id="drawing-title-dialog-heading">{t('Edit title block')}</div>
        <div className="modal-body">
          <TitleBlockSettings drawing={preview} onChange={(titleBlock) => setFields((current) => ({ ...current, titleBlock }))} />
          <label className="drawing-field">
            <span>{t('Drawing title')}</span>
            <textarea rows={3} value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
          </label>
          <div className="drawing-field-grid">
            <label className="drawing-field">
              <span>{t('Designation')}</span>
              <input value={fields.designation} placeholder={t('Drawing number or part code')} onChange={(e) => setFields({ ...fields, designation: e.target.value })} />
            </label>
            <label className="drawing-field">
              <span>{t('Author')}</span>
              <input value={fields.author} onChange={(e) => setFields({ ...fields, author: e.target.value })} />
            </label>
          </div>
          {fields.titleBlock?.template === 'gost' && (
            <details className="drawing-gost-fields">
              <summary>{t('Additional GOST fields')}</summary>
              <div className="drawing-field-grid">
                {GOST_FIELDS.map(([key, label]) => (
                  <label className="drawing-field" key={key}>
                    <span>{t(label)}</span>
                    <input value={fields.titleBlock?.[key] ?? ''} maxLength={key === 'letter' ? 3 : undefined} onChange={(e) => {
                      const value = e.target.value;
                      setFields((current) => ({ ...current, titleBlock: { ...current.titleBlock, template: 'gost', [key]: value } }));
                    }} />
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="drawing-title-preview">
            <svg viewBox={`-0.5 -0.5 ${rect.x1 - rect.x0 + 1} ${rect.y1 - rect.y0 + 1}`} role="img" aria-label={t('Title block')}>
              <g transform={`translate(${-rect.x0} ${rect.y1}) scale(1 -1)`}>
                {titleBlockContent(preview, extra).map((p, i) => <PrimSvg key={i} p={p} />)}
              </g>
            </svg>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn primary">{t('Apply')}</button>
        </div>
      </form>
    </div>
  );
}

export function DrawingEditor({ tabId }: { tabId: string }) {
  const doc = useDoc((s) => s.doc)!;
  const update = useDoc((s) => s.update);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const tab = doc.tabs.find((x) => x.id === tabId) as DrawingTab;
  const d = tab.drawing;
  const proj = useProjections(doc, d);
  const live = useLiveDimensions(doc, d);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [cam, setCam] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [dimDraft, setDimDraft] = useState<DimDraft | null>(null);
  const [viewDraft, setViewDraft] = useState<ViewDraft | null>(null);
  /** A hole callout being placed: its view and the hole's centre there. */
  const [calloutDraft, setCalloutDraft] = useState<{ viewId: string; a: Vec2; r?: number; side?: boolean } | null>(null);
  const [angleDraft, setAngleDraft] = useState<AngleDraft | null>(null);
  const [ordDraft, setOrdDraft] = useState<OrdinateDraft | null>(null);
  const [runDraft, setRunDraft] = useState<RunDraft | null>(null);
  /** A centre line's first line picked (its view, its ends). */
  const [axisDraft, setAxisDraft] = useState<{ viewId: string; l1: [Vec2, Vec2] } | null>(null);
  /** A local section's outline being clicked: its view and the points so far (view coordinates). */
  const [breakDraft, setBreakDraft] = useState<{ viewId: string; pts: Vec2[] } | null>(null);
  /** An item number being placed: the part picked and its dot (in the part's own coordinates). */
  const [balloonDraft, setBalloonDraft] = useState<Pick<DrawingBalloon, 'viewId' | 'instance' | 'at'> | null>(null);
  // the assemblies the views (and the BOM table) show: their bill of materials, each part's item, where each part is
  const assemblies = useMemo(() => {
    const out = new Map<string, { rows: BomTableRow[]; itemOf: Map<string, string>; place: Map<string, { R: number[]; t: Vec3 }> }>();
    for (const id of new Set([...d.views.map((v) => v.studioId), ...(d.bom ? [d.bom.assemblyId] : [])])) {
      const asm = doc.tabs.find((x) => x.id === id);
      if (asm?.type !== 'assembly') continue;
      const bom = storedBom(doc, asm);
      const itemOf = new Map(bom.flatMap((r) => r.instances.map((i) => [i, r.item] as const)));
      const place = new Map(shownParts(doc.tabs, asm).map((i) => [i.id, { R: rotationMatrix(i.rotation), t: i.position }]));
      out.set(id, { rows: bom.map((r) => ({ item: r.item, partNumber: r.partNumber, name: r.name, quantity: r.quantity, material: r.material })), itemOf, place });
    }
    return out;
  }, [doc, d.views, d.bom]);
  /** The assembly a view shows (a detail view: its parent's), if it shows one. */
  const viewAssembly = (v: DrawingView) => assemblies.get(projectedView(v, d.views).studioId);
  /** An item number's text: its part's item in the bill of materials. */
  const balloonItem = (b: Pick<DrawingBalloon, 'viewId' | 'instance'>) => {
    const v = d.views.find((x) => x.id === b.viewId);
    return (v && viewAssembly(v)?.itemOf.get(b.instance)) ?? '?';
  };
  /** An item number's dot on the sheet: its point of the part where the assembly has the part now (none — it is gone). */
  const balloonDot = (b: Pick<DrawingBalloon, 'viewId' | 'instance' | 'at'>): Vec2 | null => {
    const v = d.views.find((x) => x.id === b.viewId);
    const pr = v && proj(v);
    const pl = v && viewAssembly(v)?.place.get(b.instance);
    if (!v || !pr || !pl) return null;
    const w = v3.add(turn(pl.R, b.at), pl.t);
    const { n, x } = viewAxes(v, d.views);
    const y = v3.cross(n, x);
    return toSheet(v, pr, [v3.dot(w, x), v3.dot(w, y)]);
  };
  const [noteEdit, setNoteEdit] = useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [inserting, setInserting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const size = measured ?? { w: 800, h: 600 };
  const drag = useRef<{ kind: 'pan' | 'view' | 'note' | 'dim' | 'label' | 'balloon' | 'bom'; id?: string; sx: number; sy: number; start: Vec2; orig?: Vec2; moved: boolean } | null>(null);
  const [hoverDim, setHoverDim] = useState<string | null>(null);
  /** A view's label being edited (a double click, its menu). */
  const [labelEdit, setLabelEdit] = useState<{ id: string; text: string } | null>(null);
  /** The section view whose cutting line is being drawn anew (its context menu, a double click). */
  const [editSection, setEditSection] = useState<string | null>(null);
  // what views can show: Part Studios, then assemblies
  const studios: SourceTab[] = [
    ...doc.tabs.filter((x): x is PartStudioTab => x.type === 'partStudio'),
    ...doc.tabs.filter((x): x is AssemblyTab => x.type === 'assembly'),
  ];
  const [W, H] = sheetSize(d);
  const titleRect = titleBlockRect(d);
  const unit = doc.units.length;
  const uf = LENGTH_FACTOR[unit];
  // the drawing's decimal sign on the sheet (its Sheet settings)
  const comma = d.decimal === ',';

  const upd = useCallback(
    (fn: (dd: Draft<DrawingData>) => void, key?: string) =>
      update(
        (dc) => {
          const tb = dc.tabs.find((x) => x.id === tabId);
          if (tb && tb.type === 'drawing') fn(tb.drawing);
        },
        { key },
      ),
    [update, tabId],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fit the sheet initially
  const fitCam = useCallback(() => {
    const zoom = Math.min(size.w / (W + 20), size.h / (H + 20));
    setCam({ x: W / 2, y: H / 2, zoom });
  }, [size, W, H]);
  useEffect(() => {
    if (!cam && measured) fitCam();
  }, [cam, fitCam, measured]);
  const c = cam ?? { x: W / 2, y: H / 2, zoom: 1 };

  // screen ↔ sheet
  const toSheetPt = (sx: number, sy: number): Vec2 => [c.x + (sx - size.w / 2) / c.zoom, c.y - (sy - size.h / 2) / c.zoom];
  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  // ---------------------------------------------------------------- views
  const insertStandard = async (studio: SourceTab) => {
    if (inserting) return;
    setInserting(true);
    try {
      await kernel().ready();
      const src = tabSource(doc, studio)!;
      await src.ensure();
      const front = await kernel().projection({ studioKey: src.key, partIds: [], orientation: 'front', hidden: false });
      const top = await kernel().projection({ studioKey: src.key, partIds: [], orientation: 'top', hidden: false });
      if (!front.bounds || !top.bounds) {
        useEditor.getState().showToast(t('The part studio has no parts to draw'), 'error');
        return;
      }
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
      const sideOri = projectedOrientation('front', 'right', projection)!;
      const belowOri = projectedOrientation('front', 'down', projection)!;
      const frontId = uid('v');
      const views: DrawingView[] = [
        { id: frontId, studioId: studio.id, partIds: [], orientation: 'front', x: cx, y: cy, scale, showHidden: true },
        {
          id: uid('v'),
          studioId: studio.id,
          partIds: [],
          orientation: sideOri,
          x: cx + (fw * scale) / 2 + gap + (th * scale) / 2,
          y: cy,
          scale,
          showHidden: true,
          parent: frontId,
        },
        {
          id: uid('v'),
          studioId: studio.id,
          partIds: [],
          orientation: belowOri,
          x: cx,
          y: cy - (fh * scale) / 2 - gap - (th * scale) / 2,
          scale,
          showHidden: true,
          parent: frontId,
        },
        {
          id: uid('v'),
          studioId: studio.id,
          partIds: [],
          orientation: 'iso',
          x: f.x1 - 70,
          y: f.y1 - 60,
          scale: STD_SCALES.find((x) => x <= scale * 0.8) ?? scale,
          showHidden: false,
        },
      ];
      upd((dd) => {
        dd.views.push(...views);
      });
    } catch (error) {
      useEditor.getState().showToast(String(error), 'error');
    } finally {
      setInserting(false);
    }
  };

  const insertView = (studio: SourceTab, orientation: ViewOrientation) => {
    const f = frameRect(d);
    const scale = d.views[0]?.scale ?? 1;
    upd((dd) => {
      dd.views.push({ id: uid('v'), studioId: studio.id, partIds: [], orientation, x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2, scale, showHidden: !isPictorial(orientation) });
    });
  };

  /** A section's line of projection on the sheet: across its cutting line (it keeps to it, as Onshape aligns it). */
  const sectionAxis = (s: NonNullable<DrawingView['section']>): Vec2 => {
    const l = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
    return [-(s.b[1] - s.a[1]) / l, (s.b[0] - s.a[0]) / l];
  };
  /** Move a view to `to`: aligned ones only along their line of projection; `free` (Alt) — anywhere. */
  const moveView = (id: string, to: Vec2, free = false) => {
    upd((dd) => {
      const v = dd.views.find((x) => x.id === id);
      if (!v) return;
      const [x0, y0] = [v.x, v.y];
      // keep projection alignment with the parent (a detail view is placed freely)
      const parent = v.parent && !isDerivedView(v) ? dd.views.find((x) => x.id === v.parent) : undefined;
      if (free || v.detail || v.unaligned) {
        v.x = to[0];
        v.y = to[1];
      } else if (v.section) {
        const w = sectionAxis(v.section);
        const t = (to[0] - v.x) * w[0] + (to[1] - v.y) * w[1];
        v.x += w[0] * t;
        v.y += w[1] * t;
      } else if (parent) {
        if (Math.abs(parent.x - v.x) < Math.abs(parent.y - v.y)) v.y = to[1];
        else v.x = to[0];
      } else {
        v.x = to[0];
        v.y = to[1];
      }
      const [dx, dy] = [v.x - x0, v.y - y0];
      // the texts of its callouts, radii and diameters (kept on the sheet) go along with a view
      const carry = (viewId: string, ddx: number, ddy: number) => {
        for (const dm of dd.dimensions) if (dm.viewId === viewId && dm.textPos) dm.textPos = [dm.textPos[0] + ddx, dm.textPos[1] + ddy];
      };
      carry(id, dx, dy);
      // children follow along their aligned axis: projected views, sections across their line of projection
      for (const ch of dd.views) {
        if (ch.parent !== id || ch.detail || ch.unaligned) continue;
        const [cx, cy] = [ch.x, ch.y];
        if (ch.section) {
          const w = sectionAxis(ch.section);
          const t = dx * w[0] + dy * w[1];
          ch.x += dx - w[0] * t;
          ch.y += dy - w[1] * t;
        } else if (Math.abs(ch.x - x0) < Math.abs(ch.y - y0)) ch.x += dx;
        else ch.y += dy;
        carry(ch.id, ch.x - cx, ch.y - cy);
      }
    }, `move-${id}`);
  };

  // ---------------------------------------------------------------- snapping
  const snapPoint = (sheetPt: Vec2): { viewId: string; p: Vec2; circle?: { c: Vec2; r: number } } | null => {
    const tol = 6 / c.zoom;
    let best: { viewId: string; p: Vec2; d: number; circle?: { c: Vec2; r: number } } | null = null;
    for (const v of d.views) {
      const pr = proj(v);
      if (!pr) continue;
      const r = viewRect(v, pr);
      if (sheetPt[0] < r.x0 - tol || sheetPt[0] > r.x1 + tol || sheetPt[1] < r.y0 - tol || sheetPt[1] > r.y1 + tol) continue;
      for (const e of pr.edges) {
        if (e.hidden && !v.showHidden) continue;
        const cands = [e.pts[0], e.pts[e.pts.length - 1]];
        if (e.circle) cands.push(e.circle.c);
        for (const q of cands) {
          // a detail view shows only its circle
          if (v.detail && Math.hypot(q[0] - v.detail.c[0], q[1] - v.detail.c[1]) > v.detail.r) continue;
          const s = toSheet(v, pr, q);
          const dd = Math.hypot(s[0] - sheetPt[0], s[1] - sheetPt[1]);
          if (dd < tol && (!best || dd < best.d)) best = { viewId: v.id, p: q, d: dd };
        }
        if (e.circle) {
          const cs = toSheet(v, pr, e.circle.c);
          const dd = Math.abs(Math.hypot(cs[0] - sheetPt[0], cs[1] - sheetPt[1]) - e.circle.r * v.scale);
          if (dd < tol && (!best || dd + tol * 0.5 < best.d)) {
            const m = toModel(v, pr, sheetPt);
            best = { viewId: v.id, p: m, d: dd + tol * 0.5, circle: e.circle };
          }
        }
      }
    }
    return best;
  };

  /** A local section's outline closed: on its view (in place of one it had). */
  const finishBreakout = (dr: { viewId: string; pts: Vec2[] }) => {
    if (dr.pts.length >= 3)
      upd((dd) => {
        const v = dd.views.find((x) => x.id === dr.viewId);
        if (v) v.brokenOut = { outline: dr.pts, ...(v.brokenOut?.depth !== undefined ? { depth: v.brokenOut.depth } : {}) };
      });
    setBreakDraft(null);
    setTool('select');
    setSelected({ kind: 'view', id: dr.viewId });
  };

  /** The hole (of a Hole feature, seen end-on) under a sheet point: its view and centre. */
  const holeAt = (p: Vec2): { viewId: string; a: Vec2; r: number; side?: { dir: Vec2; len: number } } | null => {
    let best: { viewId: string; a: Vec2; r: number; side?: { dir: Vec2; len: number }; d: number } | null = null;
    for (const v of d.views) {
      const pr = proj(v);
      for (const h of pr?.holes ?? []) {
        if (v.detail && Math.hypot(h.c[0] - v.detail.c[0], h.c[1] - v.detail.c[1]) > v.detail.r) continue;
        const s = toSheet(v, pr, h.c);
        // seen end-on: from its centre; from the side: from its axis (inside its outline)
        const dist = h.side ? segDist(p, s, [s[0] + h.side.dir[0] * h.side.len * v.scale, s[1] + h.side.dir[1] * h.side.len * v.scale]) : Math.hypot(s[0] - p[0], s[1] - p[1]);
        if (dist <= h.r * v.scale + 4 / c.zoom && (!best || dist < best.d)) best = { viewId: v.id, a: h.c, r: h.r, ...(h.side ? { side: h.side } : {}), d: dist };
      }
    }
    return best;
  };

  // ---------------------------------------------------------------- section and detail views
  /** A point on view `v` for a cutting line / detail circle: snapped to its corners and circle centres. */
  const draftPoint = (v: DrawingView, p: Vec2): Vec2 => {
    const sp = snapPoint(p);
    return sp && sp.viewId === v.id && !sp.circle ? sp.p : toModel(v, proj(v), p);
  };
  /** The cutting line's second point (kept horizontal / vertical near those), the circle's point. */
  const draftSecond = (v: DrawingView, a: Vec2, p: Vec2): Vec2 => {
    const b = draftPoint(v, p);
    return tool === 'section' ? alignCut(a, b) : b;
  };
  /** Which side of the cutting line a section view placed at `p` looks to: the arrows point to it (first angle) or away (third). */
  const sectionSide = (v: DrawingView, dr: LinedDraft, p: Vec2): 1 | -1 => {
    const pr = proj(v);
    const A = toSheet(v, pr, dr.a);
    const B = toSheet(v, pr, dr.b);
    const left = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]) >= 0 ? 1 : -1;
    return (d.projection ?? 'first') === 'first' ? left : (-left as 1 | -1);
  };
  const placeDerived = (v: DrawingView, dr: LinedDraft, p: Vec2) => {
    // a section's line drawn anew: the same view (letter, place, scale), its new line on this parent
    const edited = tool === 'section' && editSection ? d.views.find((x) => x.id === editSection && x.section) : undefined;
    if (edited) {
      upd((dd) => {
        const x = dd.views.find((q) => q.id === edited.id);
        if (!x?.section) return;
        x.parent = v.id;
        x.orientation = v.orientation;
        x.section = { a: dr.a, b: dr.b, side: sectionSide(v, dr, p), letter: x.section.letter, ...(dr.steps?.length ? { steps: dr.steps } : {}), ...(dr.aligned ? { aligned: true } : {}) };
      });
      setEditSection(null);
      setSelected({ kind: 'view', id: edited.id });
      return;
    }
    const id = uid('v');
    const letter = nextViewLetter(d.views, getLang());
    const base = { id, studioId: v.studioId, partIds: [...v.partIds], orientation: v.orientation, x: p[0], y: p[1], parent: v.id, ...(v.configuration ? { configuration: { ...v.configuration } } : {}) };
    const view: DrawingView =
      tool === 'section'
        ? { ...base, scale: v.scale, showHidden: false, section: { a: dr.a, b: dr.b, side: sectionSide(v, dr, p), letter, ...(dr.steps?.length ? { steps: dr.steps } : {}), ...(dr.aligned ? { aligned: true } : {}) } }
        : { ...base, scale: detailScale(v.scale), showHidden: v.showHidden, detail: { c: dr.a, r: Math.hypot(dr.b[0] - dr.a[0], dr.b[1] - dr.a[1]), letter } };
    upd((dd) => {
      dd.views.push(view);
    });
    setSelected({ kind: 'view', id });
  };

  // ---------------------------------------------------------------- events
  const onWheel = (e: React.WheelEvent) => {
    const { sx, sy } = local(e);
    const before = toSheetPt(sx, sy);
    const zoom = Math.min(50, Math.max(0.2, c.zoom * Math.exp(-e.deltaY * 0.0015)));
    const nx = before[0] - (sx - size.w / 2) / zoom;
    const ny = before[1] + (sy - size.h / 2) / zoom;
    setCam({ x: nx, y: ny, zoom });
  };

  /**
   * The model vertex (or circle, `circle`; or the straight edge along the line to `lineTo`) a point of a view stands
   * for: a dimension follows the model through it.
   */
  const anchorOf = async (v: DrawingView, p: Vec2, circle?: { r?: number; side?: boolean }, lineTo?: Vec2): Promise<ViewRef | null> => {
    const pv = projectedView(v, d.views);
    const src = viewSource(doc, pv);
    if (!src) return null;
    // in a section: of the parts as cut (a point of the cut — where an edge crosses it)
    const cut = viewCutOf(v, d.views);
    try {
      await src.ensure();
      return (
        await kernel().viewAnchor({
          studioKey: src.key,
          partIds: pv.partIds,
          axes: viewAxes(v, d.views),
          p,
          ...(circle ? { circle } : {}),
          ...(lineTo ? { lineTo } : {}),
          ...(cut ? { cut } : {}),
        })
      ).ref;
    } catch {
      return null;
    }
  };

  /** The straight line of a view under sheet point `p` (an angle dimension's line): its view and ends. */
  const lineAt = (p: Vec2): { viewId: string; l: [Vec2, Vec2] } | null => {
    const tol = 6 / c.zoom;
    let best: { viewId: string; l: [Vec2, Vec2]; d: number } | null = null;
    for (const v of d.views) {
      const pr = proj(v);
      if (!pr || isPictorial(v.orientation)) continue;
      for (const e of pr.edges) {
        if (e.pts.length !== 2 || e.circle) continue;
        const dist = segDist(p, toSheet(v, pr, e.pts[0]), toSheet(v, pr, e.pts[1]));
        if (dist < tol && (!best || dist < best.d)) best = { viewId: v.id, l: [e.pts[0], e.pts[1]], d: dist };
      }
    }
    return best && { viewId: best.viewId, l: best.l };
  };

  /** The circle or arc of a view under sheet point `p`: its view, centre and radius (view coordinates). */
  const arcAt = (p: Vec2): { viewId: string; c: Vec2; r: number } | null => {
    const tol = 6 / c.zoom;
    let best: { viewId: string; c: Vec2; r: number; d: number } | null = null;
    for (const v of d.views) {
      const pr = proj(v);
      if (!pr || isPictorial(v.orientation)) continue;
      for (const e of pr.edges) {
        if (!e.circle || e.pts.length < 2) continue;
        const s = e.pts.map((q) => toSheet(v, pr, q));
        const dist = Math.min(...s.slice(1).map((q, i) => segDist(p, s[i], q)));
        if (dist < tol && (!best || dist < best.d)) best = { viewId: v.id, c: e.circle.c, r: e.circle.r, d: dist };
      }
    }
    return best && { viewId: best.viewId, c: best.c, r: best.r };
  };

  /** An angle dimension from its two lines: where they cross, each line's far end from there. */
  const angleOf = (l1: [Vec2, Vec2], l2: [Vec2, Vec2]): { a: Vec2; b: Vec2; c: Vec2 } | null => {
    const x = lineCross(l1, l2);
    return x && { a: x, b: lineEnd(l1, x), c: lineEnd(l2, x) };
  };

  // dimensions made before they followed the model: anchored once to what is at their points now, if anything
  // (no undo step; one whose model has changed since keeps its points)
  const anchoring = useRef(new Set<string>());
  useEffect(() => {
    for (const dm of d.dimensions) {
      const v = d.views.find((x) => x.id === dm.viewId);
      // (an angle is made anchored to its lines, or never)
      if (dm.refs || dm.kind === 'angle' || dm.kind === 'centerline' || dm.kind === 'centermark' || anchoring.current.has(dm.id) || !v || !proj(v)) continue;
      anchoring.current.add(dm.id);
      const round = dm.kind === 'diameter' || dm.kind === 'radius' || dm.kind === 'hole';
      const circle = round ? (dm.b ? { r: Math.hypot(dm.b[0] - dm.a[0], dm.b[1] - dm.a[1]) } : {}) : undefined;
      void Promise.all([anchorOf(v, dm.a, circle), !round && dm.b ? anchorOf(v, dm.b) : Promise.resolve(null)]).then(([ra, rb]) => {
        if (!ra && !rb) return;
        update(
          (dc) => {
            const tb = dc.tabs.find((x) => x.id === tabId);
            const x = tb?.type === 'drawing' ? tb.drawing.dimensions.find((q) => q.id === dm.id) : undefined;
            if (x && !x.refs) Object.assign(x, refsOf(ra, rb));
          },
          { undoable: false },
        );
      });
    }
  });

  /** The dimension or hole callout whose text is at sheet point `p` (a centre line or mark: one of its lines). */
  const dimAt = (p: Vec2): DrawingDimension | undefined =>
    d.dimensions.find((dm) => {
      const v = d.views.find((x) => x.id === dm.viewId);
      if (!v || !proj(v)) return false;
      const prims = dimPrims(live(dm), v, proj(v), uf, t, comma);
      if (dm.kind === 'centerline' || dm.kind === 'centermark') return prims.some((pr) => pr.t === 'line' && segDist(p, pr.a, pr.b) < 6 / c.zoom);
      return prims.some((pr) => pr.t === 'text' && Math.hypot(pr.p[0] - p[0], pr.p[1] - p[1]) < 5);
    });

  /** The view whose label is at sheet point `p`. */
  const labelAt = (p: Vec2): DrawingView | undefined =>
    d.views.find((v) => {
      const l = viewLabel(v, proj(v), comma);
      return !!l && Math.abs(p[0] - l.p[0]) <= textWidth(l.text, l.h) / 2 + 1 && p[1] >= l.p[1] - 1 && p[1] <= l.p[1] + l.h + 1;
    });

  const applyLabel = (le: { id: string; text: string }) => {
    upd((dd) => {
      const v = dd.views.find((x) => x.id === le.id);
      if (!v) return;
      if (le.text.trim()) v.label = le.text.trim();
      else delete v.label;
    });
    setLabelEdit(null);
  };

  /** The item number whose shelf (or number) is at sheet point `p`. */
  const balloonAt = (p: Vec2) =>
    (d.balloons ?? []).find((b) => {
      const dot = balloonDot(b);
      if (!dot) return false;
      const [a, e] = balloonShelf(dot, [b.x, b.y], balloonItem(b));
      return p[0] >= Math.min(a[0], e[0]) - 1 && p[0] <= Math.max(a[0], e[0]) + 1 && p[1] >= a[1] - 1.5 && p[1] <= a[1] + ITEM_H + 2;
    });

  /** The BOM table's rectangle on the sheet, if the drawing has one. */
  const bomRect = d.bom ? bomTableRect(d.bom, assemblies.get(d.bom.assemblyId)?.rows.length ?? 0) : null;
  const bomAt = (p: Vec2) => !!bomRect && p[0] >= bomRect.x0 && p[0] <= bomRect.x1 && p[1] >= bomRect.y0 && p[1] <= bomRect.y1;

  /** The note at sheet point `p`. */
  const noteAt = (p: Vec2) =>
    d.notes.find((n) => p[0] >= n.x - 1 && p[0] <= n.x + n.text.length * n.height * 0.6 && p[1] >= n.y - 1 - (n.text.split('\n').length - 1) * n.height * 1.5 && p[1] <= n.y + n.height);

  /** The section view whose cutting line (on its parent) passes by sheet point `p`. */
  const sectionLineAt = (p: Vec2): DrawingView | undefined => {
    const tol = 6 / c.zoom;
    return d.views.find((s) => {
      const parent = s.section && parentView(s, d.views);
      if (!s.section || !parent) return false;
      const pts = cuttingLine(s.section).map((q) => toSheet(parent, proj(parent), q));
      return pts.slice(1).some((q, i) => segDist(p, pts[i], q) < tol);
    });
  };

  /** Draw a section's cutting line anew on its parent: the section keeps its letter and its place. */
  const startLineEdit = (sec: DrawingView) => {
    setViewDraft(null);
    setTool('section');
    setEditSection(sec.id);
    setSelected({ kind: 'view', id: sec.id });
  };
  /** Draw a detail view's circle anew on its parent: the detail keeps its letter, scale and place. */
  const startDetailEdit = (det: DrawingView) => {
    setViewDraft(null);
    setTool('detail');
    setEditSection(det.id);
    setSelected({ kind: 'view', id: det.id });
  };
  /** The detail view whose circle (on its parent) passes by sheet point `p`. */
  const detailCircleAt = (p: Vec2): DrawingView | undefined => {
    const tol = 6 / c.zoom;
    return d.views.find((dv) => {
      const parent = dv.detail && parentView(dv, d.views);
      if (!dv.detail || !parent) return false;
      const s = toSheet(parent, proj(parent), dv.detail.c);
      return Math.abs(Math.hypot(p[0] - s[0], p[1] - s[1]) - dv.detail.r * parent.scale) < tol;
    });
  };
  /** Draw a view's local section outline anew (it replaces the one there is). */
  const startOutlineEdit = (v: DrawingView) => {
    setBreakDraft(null);
    setTool('breakout');
    setSelected({ kind: 'view', id: v.id });
  };
  const flipSection = (id: string) =>
    upd((dd) => {
      const s = dd.views.find((x) => x.id === id)?.section;
      if (s) s.side = s.side === 1 ? -1 : 1;
    });

  /** The view under a sheet point; with a `margin` (mm) — the nearest one whose frame grown by it holds the point. */
  const hitView = (p: Vec2, margin = 0) => {
    let best: { v: DrawingView; d: number } | null = null;
    for (let i = d.views.length - 1; i >= 0; i--) {
      const v = d.views[i];
      const r = viewRect(v, proj(v));
      // the distance out of the frame (0 inside)
      const dist = Math.hypot(Math.max(r.x0 - p[0], 0, p[0] - r.x1), Math.max(r.y0 - p[1], 0, p[1] - r.y1));
      if (dist <= margin && (!best || dist < best.d)) best = { v, d: dist };
      if (dist === 0) break;
    }
    return best?.v ?? null;
  };

  const onDown = (e: React.PointerEvent) => {
    const { sx, sy } = local(e);
    const p = toSheetPt(sx, sy);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      drag.current = { kind: 'pan', sx, sy, start: [c.x, c.y], moved: false };
      return;
    }
    if (tool === 'dimension') {
      const sp = snapPoint(p);
      if (!dimDraft) {
        if (!sp) return;
        if (sp.circle) setDimDraft({ viewId: sp.viewId, circle: sp.circle, a: sp.p });
        else setDimDraft({ viewId: sp.viewId, a: sp.p });
        return;
      }
      const v = d.views.find((x) => x.id === dimDraft.viewId)!;
      const pr = proj(v);
      if (dimDraft.circle) {
        const kind = e.shiftKey ? 'radius' : 'diameter';
        const ctr = dimDraft.circle.c;
        const b: Vec2 = [ctr[0] + dimDraft.circle.r, ctr[1]];
        // anchored to the model's circle: it follows the model
        void anchorOf(v, ctr, { r: dimDraft.circle.r }).then((ra) =>
          upd((dd) => {
            dd.dimensions.push({ id: uid('d'), viewId: v.id, kind, a: ctr, b, offset: 0, textPos: p, ...refsOf(ra) });
          }),
        );
        setDimDraft(null);
        return;
      }
      if (!('b' in dimDraft) || !(dimDraft as DimDraft & { b?: Vec2 }).b) {
        if (!sp || sp.viewId !== v.id) return;
        setDimDraft({ ...dimDraft, b: sp.p } as DimDraft);
        return;
      }
      const a = toSheet(v, pr, dimDraft.a!);
      const bm = (dimDraft as DimDraft & { b: Vec2 }).b;
      const b = toSheet(v, pr, bm);
      const { kind, offset } = placeLinear(a, b, p);
      const am = dimDraft.a!;
      // anchored to the model's vertices (or circles' centres): it follows the model
      void Promise.all([anchorOf(v, am), anchorOf(v, bm)]).then(([ra, rb]) =>
        upd((dd) => {
          dd.dimensions.push({ id: uid('d'), viewId: v.id, kind, a: am, b: bm, offset, ...refsOf(ra, rb) });
        }),
      );
      setDimDraft(null);
      return;
    }
    if (tool === 'breakout') {
      if (!breakDraft) {
        // on a view of its own (not a section or a detail of another)
        const v = hitView(p);
        if (!v || !proj(v) || isDerivedView(v)) return;
        setBreakDraft({ viewId: v.id, pts: [toModel(v, proj(v), p)] });
        return;
      }
      const v = d.views.find((x) => x.id === breakDraft.viewId);
      if (!v) return setBreakDraft(null);
      const first = toSheet(v, proj(v), breakDraft.pts[0]);
      // back at the first point: the outline is closed
      if (breakDraft.pts.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) < 6 / c.zoom) finishBreakout(breakDraft);
      else setBreakDraft({ ...breakDraft, pts: [...breakDraft.pts, toModel(v, proj(v), p)] });
      return;
    }
    if (tool === 'chain' || tool === 'baseline') {
      const sp = snapPoint(p);
      const pt = sp && !sp.circle ? sp : null;
      if (!runDraft) {
        if (pt) setRunDraft({ viewId: pt.viewId, first: pt.p });
        return;
      }
      const v = d.views.find((x) => x.id === runDraft.viewId);
      if (!v) return setRunDraft(null);
      const pr = proj(v);
      const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
      // a dimension from a to b with its line at `level` (anchored, as all dimensions)
      const add = (a: Vec2, b: Vec2, kind: DrawingDimension['kind'], offset: number) =>
        void Promise.all([anchorOf(v, a), anchorOf(v, b)]).then(([ra, rb]) =>
          upd((dd) => {
            dd.dimensions.push({ id: uid('d'), viewId: v.id, kind, a, b, offset, ...refsOf(ra, rb) });
          }),
        );
      if (!runDraft.second) {
        if (!pt || pt.viewId !== v.id || same(pt.p, runDraft.first)) return;
        setRunDraft({ ...runDraft, second: pt.p });
        return;
      }
      if (!runDraft.kind) {
        // the first: as a dimension is placed; its line sets the others'
        const A = toSheet(v, pr, runDraft.first);
        const B = toSheet(v, pr, runDraft.second);
        const { kind, offset } = placeLinear(A, B, p);
        add(runDraft.first, runDraft.second, kind, offset);
        setRunDraft({ ...runDraft, kind, level: dimLevel(kind, A, B, offset), out: offset < 0 ? -1 : 1, last: runDraft.second });
        return;
      }
      // the next point: on from the last one (a chain) or from the first, a step further out (baseline)
      if (!pt || pt.viewId !== v.id) return;
      const from = tool === 'chain' ? runDraft.last! : runDraft.first;
      if (same(pt.p, from)) return;
      const level = tool === 'chain' ? runDraft.level! : runDraft.level! + runDraft.out! * BASELINE_STEP;
      add(from, pt.p, runDraft.kind, offsetForLevel(runDraft.kind, toSheet(v, pr, from), toSheet(v, pr, pt.p), level));
      setRunDraft({ ...runDraft, level, last: pt.p });
      return;
    }
    if (tool === 'axis') {
      if (!axisDraft) {
        // a circle or an arc: its centre mark at once (anchored to the model's circle)
        const arc = arcAt(p);
        const av = arc && d.views.find((x) => x.id === arc.viewId);
        if (arc && av) {
          void anchorOf(av, arc.c, { r: arc.r }).then((ra) =>
            upd((dd) => {
              dd.dimensions.push({ id: uid('d'), viewId: av.id, kind: 'centermark', a: arc.c, b: [arc.c[0] + arc.r, arc.c[1]], offset: 0, ...refsOf(ra) });
            }),
          );
          return;
        }
        // a straight line: the first of two
        const hit = lineAt(p);
        if (hit) setAxisDraft({ viewId: hit.viewId, l1: hit.l });
        return;
      }
      const v = d.views.find((x) => x.id === axisDraft.viewId);
      if (!v) return setAxisDraft(null);
      const hit = lineAt(p);
      // the second: of the same view, parallel to the first and apart from it
      const l1 = axisDraft.l1;
      const axis = hit && hit.viewId === v.id ? centerlineOf(l1, hit.l) : null;
      if (!hit || !axis) return;
      const u = [l1[1][0] - l1[0][0], l1[1][1] - l1[0][1]];
      const apart = Math.abs((hit.l[0][0] - l1[0][0]) * u[1] - (hit.l[0][1] - l1[0][1]) * u[0]) / Math.hypot(u[0], u[1]);
      if (apart < 1e-6) return;
      const l2 = hit.l;
      setAxisDraft(null);
      void Promise.all([anchorOf(v, l1[0], undefined, l1[1]), anchorOf(v, l2[0], undefined, l2[1])]).then(([ra, rb]) =>
        upd((dd) => {
          dd.dimensions.push({ id: uid('d'), viewId: v.id, kind: 'centerline', a: l1[0], b: l1[1], c: l2[0], d: l2[1], offset: 0, ...refsOf(ra, rb) });
        }),
      );
      return;
    }
    if (tool === 'ordinate') {
      const sp = snapPoint(p);
      if (!ordDraft) {
        if (sp && !sp.circle) setOrdDraft({ viewId: sp.viewId, base: sp.p });
        return;
      }
      const v = d.views.find((x) => x.id === ordDraft.viewId);
      if (!v) return setOrdDraft(null);
      const pr = proj(v);
      // an ordinate of point q on the line of values (anchored, as all dimensions)
      const place = (q: Vec2, axis: 'x' | 'y', line: number) => {
        const s = toSheet(v, pr, q);
        const textPos: Vec2 = axis === 'x' ? [s[0], line] : [line, s[1]];
        const base = ordDraft.base;
        void Promise.all([anchorOf(v, base), q === base ? Promise.resolve(null) : anchorOf(v, q)]).then(([ra, rb]) =>
          upd((dd) => {
            dd.dimensions.push({ id: uid('d'), viewId: v.id, kind: 'ordinate', ordinate: axis, a: base, b: q, offset: 0, textPos, ...refsOf(ra, q === base ? ra : rb) });
          }),
        );
      };
      if (!ordDraft.axis) {
        if (!ordDraft.point) {
          // the first point measured (not the base itself)
          if (!sp || sp.circle || sp.viewId !== v.id || Math.hypot(sp.p[0] - ordDraft.base[0], sp.p[1] - ordDraft.base[1]) < 1e-6) return;
          setOrdDraft({ ...ordDraft, point: sp.p });
          return;
        }
        // where the line of values goes: up / down from the point — X ordinates, aside — Y ones; the base's "0" too
        const s = toSheet(v, pr, ordDraft.point);
        const axis = Math.abs(p[1] - s[1]) >= Math.abs(p[0] - s[0]) ? 'x' : 'y';
        const line = axis === 'x' ? p[1] : p[0];
        place(ordDraft.base, axis, line);
        place(ordDraft.point, axis, line);
        setOrdDraft({ viewId: v.id, base: ordDraft.base, axis, line });
        return;
      }
      // more points: on the same line of values
      if (sp && !sp.circle && sp.viewId === v.id) place(sp.p, ordDraft.axis, ordDraft.line!);
      return;
    }
    if (tool === 'angle') {
      const hit = lineAt(p);
      if (!angleDraft) {
        if (hit) setAngleDraft({ viewId: hit.viewId, l1: hit.l });
        return;
      }
      const v = d.views.find((x) => x.id === angleDraft.viewId);
      if (!v) return setAngleDraft(null);
      if (!angleDraft.l2) {
        // the second line: of the same view, not parallel to the first
        if (!hit || hit.viewId !== v.id || !lineCross(angleDraft.l1, hit.l)) return;
        setAngleDraft({ ...angleDraft, l2: hit.l });
        return;
      }
      const ang = angleOf(angleDraft.l1, angleDraft.l2);
      const { l1, l2 } = angleDraft;
      setAngleDraft(null);
      if (!ang) return;
      // the sector the arc is placed in, kept from now on
      const sector = angleSector(ang.a, ang.b, ang.c, toModel(v, proj(v), p))?.signs;
      // anchored to the model's straight edges: it follows the model
      void Promise.all([anchorOf(v, l1[0], undefined, l1[1]), anchorOf(v, l2[0], undefined, l2[1])]).then(([ra, rb]) =>
        upd((dd) => {
          dd.dimensions.push({ id: uid('d'), viewId: v.id, kind: 'angle', ...ang, ...(sector ? { sector } : {}), offset: 0, textPos: p, ...refsOf(ra, rb) });
        }),
      );
      return;
    }
    if (tool === 'balloon') {
      if (balloonDraft) {
        // the shelf: here; the tool stays on for the next part
        const b = { id: uid('b'), ...balloonDraft, x: p[0], y: p[1] };
        upd((dd) => {
          (dd.balloons ??= []).push(b);
        });
        setBalloonDraft(null);
        return;
      }
      // the part under the cursor in a view of an assembly (nearest the viewer)
      const v = hitView(p);
      const pr = v && proj(v);
      if (!v || !pr) return;
      const asm = viewAssembly(v);
      if (!asm) return useEditor.getState().showToast(t('Item numbers are for views of assemblies'), 'error');
      const pv = projectedView(v, d.views);
      const src = viewSource(doc, pv);
      if (!src) return;
      const cut = viewCutOf(v, d.views);
      void (async () => {
        await src.ensure();
        const { part } = await kernel().viewPart({ studioKey: src.key, partIds: pv.partIds, axes: viewAxes(v, d.views), p: toModel(v, pr, p), tol: 3 / (c.zoom * v.scale), ...(cut ? { cut } : {}) });
        const pl = part && asm.place.get(part.id);
        // the dot in the part's own coordinates: it goes where the instance goes
        if (part && pl) setBalloonDraft({ viewId: v.id, instance: part.id, at: turn(pl.R, v3.sub(part.at, pl.t), true) });
      })();
      return;
    }
    if (tool === 'callout') {
      if (!calloutDraft) {
        const h = holeAt(p);
        if (h) setCalloutDraft({ viewId: h.viewId, a: h.a, r: h.r, ...(h.side ? { side: true } : {}) });
        return;
      }
      const dr = calloutDraft;
      const cv = d.views.find((x) => x.id === dr.viewId);
      // anchored to the hole's circle: it follows the hole when the model changes
      // (from the side: its mouth's circle, seen edge-on)
      void (cv ? anchorOf(cv, dr.a, dr.side ? { r: dr.r, side: true } : {}) : Promise.resolve(null)).then((ra) =>
        upd((dd) => {
          dd.dimensions.push({ id: uid('d'), viewId: dr.viewId, kind: 'hole', a: dr.a, offset: 0, textPos: p, ...refsOf(ra) });
        }),
      );
      setCalloutDraft(null);
      return;
    }
    if (tool === 'section' || tool === 'detail') {
      if (!viewDraft) {
        // the parent: an orthographic view (a section of an isometric one means nothing on the sheet)
        // a cutting line may start just outside the view
        const v = hitView(p, tool === 'section' ? 20 : 0);
        if (!v || !proj(v) || (tool === 'section' && isPictorial(v.orientation))) return;
        setViewDraft({ viewId: v.id, a: draftPoint(v, p) });
        return;
      }
      const v = d.views.find((x) => x.id === viewDraft.viewId);
      if (!v) return setViewDraft(null);
      if (!viewDraft.b) {
        const b = draftSecond(v, viewDraft.a, p);
        // a click on the same spot is not a line / circle
        if (Math.hypot(b[0] - viewDraft.a[0], b[1] - viewDraft.a[1]) * v.scale < 1) return;
        // a detail's circle drawn anew: done — the detail keeps its place, scale and letter
        const edited = tool === 'detail' && editSection ? d.views.find((x) => x.id === editSection && x.detail) : undefined;
        if (edited) {
          const c = viewDraft.a;
          upd((dd) => {
            const x = dd.views.find((q) => q.id === edited.id);
            if (!x?.detail) return;
            x.parent = v.id;
            x.orientation = v.orientation;
            x.detail = { ...x.detail, c, r: Math.hypot(b[0] - c[0], b[1] - c[1]) };
          });
          setViewDraft(null);
          setEditSection(null);
          setTool('select');
          setSelected({ kind: 'view', id: edited.id });
          return;
        }
        setViewDraft({ ...viewDraft, b });
        return;
      }
      // Alt: the line bends at b at any angle (an aligned section) — once, right after b
      if (tool === 'section' && e.altKey && !viewDraft.steps?.length) {
        const q = draftPoint(v, p);
        if (Math.hypot(q[0] - viewDraft.b[0], q[1] - viewDraft.b[1]) * v.scale >= 1) setViewDraft({ ...viewDraft, steps: [q], aligned: true });
        return;
      }
      // Shift: one more point of the cutting line (an offset section), along or across its first segment
      if (tool === 'section' && e.shiftKey && !viewDraft.aligned) {
        const pts = cuttingLine(viewDraft as LinedDraft);
        const q = stepPoint(viewDraft.a, viewDraft.b, pts[pts.length - 1], draftPoint(v, p));
        if (Math.hypot(q[0] - pts[pts.length - 1][0], q[1] - pts[pts.length - 1][1]) * v.scale >= 1) setViewDraft({ ...viewDraft, steps: [...(viewDraft.steps ?? []), q] });
        return;
      }
      placeDerived(v, viewDraft as LinedDraft, p);
      setViewDraft(null);
      setTool('select');
      return;
    }
    if (tool === 'note') {
      const id = uid('n');
      upd((dd) => {
        dd.notes.push({ id, x: p[0], y: p[1], text: t('Note'), height: 3.5 });
      });
      setNoteEdit({ id, text: t('Note') });
      setTool('select');
      return;
    }
    // select / move
    const balloon = balloonAt(p);
    if (balloon) {
      setSelected({ kind: 'balloon', id: balloon.id });
      drag.current = { kind: 'balloon', id: balloon.id, sx, sy, start: p, orig: [balloon.x, balloon.y], moved: false };
      return;
    }
    const note = noteAt(p);
    if (note) {
      setSelected({ kind: 'note', id: note.id });
      drag.current = { kind: 'note', id: note.id, sx, sy, start: p, orig: [note.x, note.y], moved: false };
      return;
    }
    const dimHit = dimAt(p);
    if (dimHit) {
      // and drag it: a linear one — its dimension line, a radius, diameter or hole callout — its text
      setSelected({ kind: 'dim', id: dimHit.id });
      drag.current = { kind: 'dim', id: dimHit.id, sx, sy, start: p, orig: dimHit.textPos, moved: false };
      return;
    }
    // a view's label: dragged on its own
    const lab = labelAt(p);
    if (lab) {
      setSelected({ kind: 'view', id: lab.id });
      drag.current = { kind: 'label', id: lab.id, sx, sy, start: p, orig: lab.labelOffset ?? [0, 0], moved: false };
      return;
    }
    if (d.bom && bomAt(p)) {
      setSelected({ kind: 'bom', id: 'bom' });
      drag.current = { kind: 'bom', sx, sy, start: p, orig: [d.bom.x, d.bom.y], moved: false };
      return;
    }
    const v = hitView(p);
    if (v) {
      setSelected({ kind: 'view', id: v.id });
      drag.current = { kind: 'view', id: v.id, sx, sy, start: p, orig: [v.x, v.y], moved: false };
    } else setSelected(null);
  };

  const onMove = (e: React.PointerEvent) => {
    const { sx, sy } = local(e);
    const p = toSheetPt(sx, sy);
    setCursor(p);
    const dr = drag.current;
    if (!dr) {
      // a dimension under the cursor can be dragged
      if (tool === 'select') setHoverDim(balloonAt(p)?.id ?? dimAt(p)?.id ?? labelAt(p)?.id ?? (bomAt(p) ? 'bom' : null));
      return;
    }
    if (Math.hypot(sx - dr.sx, sy - dr.sy) > 3) dr.moved = true;
    if (!dr.moved) return;
    if (dr.kind === 'pan') {
      setCam({ x: dr.start[0] - (sx - dr.sx) / c.zoom, y: dr.start[1] + (sy - dr.sy) / c.zoom, zoom: c.zoom });
    } else if (dr.kind === 'view' && dr.id && dr.orig) {
      // Alt: anywhere, not along the line of projection
      moveView(dr.id, [dr.orig[0] + p[0] - dr.start[0], dr.orig[1] + p[1] - dr.start[1]], e.altKey);
    } else if (dr.kind === 'dim' && dr.id) {
      const dm = d.dimensions.find((x) => x.id === dr.id);
      const v = dm && d.views.find((x) => x.id === dm.viewId);
      if (!dm || !v) return;
      const pr = proj(v);
      // the dimension where the model has it now
      const lv = live(dm);
      upd((dd) => {
        const x = dd.dimensions.find((q) => q.id === dr.id);
        if (!x) return;
        if (lv.b && (x.kind === 'linear' || x.kind === 'horizontal' || x.kind === 'vertical')) x.offset = linearOffset(toSheet(v, pr, lv.a), toSheet(v, pr, lv.b), x.kind, p);
        // the text keeps where it was grabbed
        else x.textPos = dr.orig ? [dr.orig[0] + p[0] - dr.start[0], dr.orig[1] + p[1] - dr.start[1]] : p;
        // an angle: the sector its arc is dragged into (stored against its own points, as the live ones may be turned)
        if (x.kind === 'angle' && x.textPos && lv.b && lv.c) {
          const s = angleSector(lv.a, lv.b, lv.c, toModel(v, pr, x.textPos))?.signs;
          if (s) {
            const was = dm.sector ?? [1, 1];
            const now = lv.sector ?? [1, 1];
            x.sector = [(s[0] * was[0] * now[0]) as 1 | -1, (s[1] * was[1] * now[1]) as 1 | -1];
          }
        }
      }, `dim-${dr.id}`);
    } else if (dr.kind === 'label' && dr.id && dr.orig) {
      const off: Vec2 = [dr.orig[0] + p[0] - dr.start[0], dr.orig[1] + p[1] - dr.start[1]];
      upd((dd) => {
        const v = dd.views.find((x) => x.id === dr.id);
        if (v) v.labelOffset = off;
      }, `label-${dr.id}`);
    } else if (dr.kind === 'note' && dr.id && dr.orig) {
      const nx = dr.orig[0] + p[0] - dr.start[0];
      const ny = dr.orig[1] + p[1] - dr.start[1];
      upd((dd) => {
        const n = dd.notes.find((x) => x.id === dr.id);
        if (n) {
          n.x = nx;
          n.y = ny;
        }
      }, `note-${dr.id}`);
    } else if ((dr.kind === 'balloon' || dr.kind === 'bom') && dr.orig) {
      const nx = dr.orig[0] + p[0] - dr.start[0];
      const ny = dr.orig[1] + p[1] - dr.start[1];
      upd((dd) => {
        const it = dr.kind === 'bom' ? dd.bom : dd.balloons?.find((x) => x.id === dr.id);
        if (it) {
          it.x = nx;
          it.y = ny;
        }
      }, `${dr.kind}-${dr.id ?? ''}`);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const dr = drag.current;
    drag.current = null;
    // a right click (no drag): the menu of what is under the cursor
    if (dr?.kind === 'pan' && !dr.moved && e.button === 2) {
      const { sx, sy } = local(e);
      openMenu(e, toSheetPt(sx, sy));
    }
  };

  /** The context menu of what is at sheet point `p`: a dimension, callout, note, cutting line, view, the title block, the sheet. */
  const openMenu = (e: React.PointerEvent, p: Vec2) => {
    if (tool !== 'select') return;
    const items: ContextMenuItem[] = [];
    const item = (label: string, icon: string, action: () => void, danger = false) => items.push({ label: t(label), icon, action, ...(danger ? { danger } : {}) });
    const sep = () => items.length && !items[items.length - 1].separator && items.push({ separator: true, label: '' });
    const setDim = (id: string, fn: (x: Draft<DrawingDimension>) => void) =>
      upd((dd) => {
        const x = dd.dimensions.find((q) => q.id === id);
        if (x) fn(x);
      });
    const setView = (id: string, fn: (x: Draft<DrawingView>) => void) =>
      upd((dd) => {
        const x = dd.views.find((q) => q.id === id);
        if (x) fn(x);
      });
    const balloon = balloonAt(p);
    const dm = !balloon ? dimAt(p) : undefined;
    const note = !balloon && !dm ? noteAt(p) : undefined;
    const lab = !balloon && !dm && !note ? labelAt(p) : undefined;
    const table = !balloon && !dm && !note && !lab && bomAt(p);
    const line = !balloon && !dm && !note && !lab && !table ? (sectionLineAt(p) ?? detailCircleAt(p)) : undefined;
    const v = line ?? (!balloon && !dm && !note && !lab && !table ? hitView(p) : undefined);
    const inTitle = p[0] >= titleRect.x0 && p[0] <= titleRect.x1 && p[1] >= titleRect.y0 && p[1] <= titleRect.y1;
    let sel: Selection | null = null;
    if (balloon) {
      sel = { kind: 'balloon', id: balloon.id };
      item('Delete', 'trash', () => removeItem({ kind: 'balloon', id: balloon.id }), true);
    } else if (table) {
      sel = { kind: 'bom', id: 'bom' };
      item('Put the table back above the title block', 'undo', () => upd((dd) => void (dd.bom &&= { ...dd.bom, x: titleRect.x1, y: titleRect.y1 })));
      sep();
      item('Delete table', 'trash', () => removeItem({ kind: 'bom', id: 'bom' }), true);
    } else if (dm) {
      sel = { kind: 'dim', id: dm.id };
      // a circle's size: as a radius or a diameter; a length: along X, Y or the points
      if (dm.kind === 'diameter') item('Show as radius', 'dimension', () => setDim(dm.id, (x) => void (x.kind = 'radius')));
      if (dm.kind === 'radius') item('Show as diameter', 'dimension', () => setDim(dm.id, (x) => void (x.kind = 'diameter')));
      if (dm.b && (dm.kind === 'linear' || dm.kind === 'horizontal' || dm.kind === 'vertical')) {
        const [ax, ay, bx, by] = [dm.a[0], dm.a[1], dm.b[0], dm.b[1]];
        const kinds: [DrawingDimension['kind'], string][] = [
          ['horizontal', 'Horizontal dimension'],
          ['vertical', 'Vertical dimension'],
          ['linear', 'Aligned dimension'],
        ];
        for (const [k, label] of kinds) {
          // only the ones that measure something different here
          const same = (k === 'horizontal' && Math.abs(ax - bx) < 1e-6) || (k === 'vertical' && Math.abs(ay - by) < 1e-6) || (k === 'linear' && (Math.abs(ax - bx) < 1e-6 || Math.abs(ay - by) < 1e-6));
          if (k !== dm.kind && !same) item(label, 'dimension', () => setDim(dm.id, (x) => void (x.kind = k)));
        }
      }
      sep();
      item('Delete', 'trash', () => removeItem({ kind: 'dim', id: dm.id }), true);
    } else if (note) {
      sel = { kind: 'note', id: note.id };
      item('Edit text', 'rename', () => setNoteEdit({ id: note.id, text: note.text }));
      sep();
      item('Delete', 'trash', () => removeItem({ kind: 'note', id: note.id }), true);
    } else if (lab) {
      sel = { kind: 'view', id: lab.id };
      item('Edit label', 'rename', () => setLabelEdit({ id: lab.id, text: lab.label ?? '' }));
      if (lab.labelOffset) item('Put the label back above the view', 'undo', () => setView(lab.id, (x) => void delete x.labelOffset));
    } else if (v) {
      sel = { kind: 'view', id: v.id };
      if (v.detail) {
        item('Edit detail circle', 'detailView', () => startDetailEdit(v));
        sep();
      }
      if (v.section) {
        item('Edit cutting line', 'drawingSection', () => startLineEdit(v));
        item('Opposite direction', 'flip', () => flipSection(v.id));
        sep();
      }
      if (v.brokenOut) {
        item('Redraw local section', 'localSection', () => startOutlineEdit(v));
        item('Remove the local section', 'trash', () => setView(v.id, (x) => void delete x.brokenOut));
      } else if (!isDerivedView(v)) item('Local section', 'localSection', () => startOutlineEdit(v));
      // views made from this one (the tool then starts on it)
      if (!isPictorial(v.orientation))
        item('Section…', 'drawingSection', () => {
          setViewDraft(null);
          setTool('section');
        });
      item('Detail view…', 'detailView', () => {
        setViewDraft(null);
        setTool('detail');
      });
      sep();
      item(v.showHidden ? 'Hide hidden lines' : 'Show hidden lines', v.showHidden ? 'eyeOff' : 'eye', () => setView(v.id, (x) => void (x.showHidden = !x.showHidden)));
      // a projected view or a section: kept on its line of projection, or anywhere (Onshape: Break alignment)
      const parent = v.parent && !v.detail ? d.views.find((x) => x.id === v.parent) : undefined;
      if (parent)
        item(v.unaligned ? 'Align with its parent view' : 'Do not align with its parent view', 'lock', () =>
          setView(v.id, (x) => {
            if (!x.unaligned) return void (x.unaligned = true);
            delete x.unaligned;
            // a projected view back in line with its parent (a section keeps its line through where it is)
            if (!x.section) {
              if (Math.abs(parent.x - x.x) < Math.abs(parent.y - x.y)) x.x = parent.x;
              else x.y = parent.y;
            }
          }),
        );
      sep();
      item('Delete view', 'trash', () => removeItem({ kind: 'view', id: v.id }), true);
    } else if (inTitle) {
      item('Edit title block', 'drawing', () => setEditingTitle(true));
    } else {
      // the sheet itself
      if (!d.views.length && studios.length) item('Standard views (3 + iso)', 'layers', () => void insertStandard(studios[0]));
      item('Zoom to fit', 'zoomFit', fitCam);
    }
    if (!items.length) return;
    setSelected(sel);
    useEditor.setState({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  };

  /** A double click: a section (or its cutting line) — draw the line anew; a local section — its outline; a note — its text. */
  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const { sx, sy } = local(e);
    const p = toSheetPt(sx, sy);
    const note = noteAt(p);
    if (note) return setNoteEdit({ id: note.id, text: note.text });
    if (dimAt(p)) return;
    const lab = labelAt(p);
    if (lab) return setLabelEdit({ id: lab.id, text: lab.label ?? '' });
    const v = sectionLineAt(p) ?? detailCircleAt(p) ?? hitView(p);
    if (v?.section) startLineEdit(v);
    else if (v?.detail) startDetailEdit(v);
    else if (v?.brokenOut) startOutlineEdit(v);
  };

  const removeItem = useCallback(
    (item: Selection) =>
      upd((dd) => {
        if (item.kind === 'view') {
          // with the section and detail views made from it (and theirs): they have no geometry without it
          const gone = new Set([item.id]);
          for (let grew = true; grew; ) {
            grew = false;
            for (const v of dd.views)
              if (!gone.has(v.id) && v.parent && gone.has(v.parent) && isDerivedView(v)) {
                gone.add(v.id);
                grew = true;
              }
          }
          dd.views = dd.views.filter((v) => !gone.has(v.id));
          dd.dimensions = dd.dimensions.filter((x) => !gone.has(x.viewId));
          if (dd.balloons) dd.balloons = dd.balloons.filter((x) => !gone.has(x.viewId));
          for (const v of dd.views) if (v.parent && gone.has(v.parent)) delete v.parent;
        }
        if (item.kind === 'dim') dd.dimensions = dd.dimensions.filter((x) => x.id !== item.id);
        if (item.kind === 'note') dd.notes = dd.notes.filter((x) => x.id !== item.id);
        if (item.kind === 'balloon' && dd.balloons) dd.balloons = dd.balloons.filter((x) => x.id !== item.id);
        if (item.kind === 'bom') delete dd.bom;
      }),
    [upd],
  );

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    removeItem(selected);
    setSelected(null);
  }, [selected, removeItem]);

  // a cutting line drawn anew only while the section tool is on
  useEffect(() => {
    if (tool !== 'section' && tool !== 'detail') setEditSection(null);
    // an angle's lines picked so far, ordinates' base: for their tools only
    if (tool !== 'angle') setAngleDraft(null);
    if (tool !== 'ordinate') setOrdDraft(null);
    if (tool !== 'axis') setAxisDraft(null);
    setRunDraft(null);
  }, [tool]);

  // (for the keys: the outline being clicked, closed by Enter)
  const breakRef = useRef<{ finish: () => void } | null>(null);
  breakRef.current = breakDraft ? { finish: () => finishBreakout(breakDraft) } : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingTitle) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'Escape') {
        setDimDraft(null);
        setViewDraft(null);
        setCalloutDraft(null);
        setBreakDraft(null);
        setAngleDraft(null);
        setOrdDraft(null);
        setAxisDraft(null);
        setRunDraft(null);
        setBalloonDraft(null);
        setTool('select');
        setSelected(null);
      }
      // Enter closes a local section's outline
      if (e.key === 'Enter' && breakRef.current) breakRef.current.finish();
      if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey) setTool('dimension');
      // N: a note (Onshape)
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) setTool('note');
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) fitCam();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, fitCam, editingTitle]);

  // ---------------------------------------------------------------- primitives
  const date = new Date(doc.modified).toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-GB');
  const mainScale = d.views.find((v) => !isPictorial(v.orientation))?.scale ?? d.views[0]?.scale;
  /** The views, dimensions and notes; `translate` — the words of hole callouts ("THRU"). */
  const sheetContent = (translate: (key: string) => string = t) => {
    const prims: Prim2D[] = [];
    // a section's line or a detail's circle being drawn anew: the old one is not shown on its parent meanwhile
    const marked = editSection ? d.views.filter((x) => x.id !== editSection) : d.views;
    for (const v of d.views) prims.push(...viewPrims(v, proj(v), marked, comma));
    for (const dm of d.dimensions) {
      const v = d.views.find((x) => x.id === dm.viewId);
      // with its view only: before the view is computed its points have nowhere to go (a reload drew them askew)
      if (v && proj(v)) prims.push(...dimPrims(live(dm), v, proj(v), uf, translate, comma));
    }
    // item numbers (with their parts' views) and the bill of materials they count
    for (const b of d.balloons ?? []) {
      const dot = balloonDot(b);
      if (dot) prims.push(...balloonPrims(dot, [b.x, b.y], balloonItem(b)));
    }
    if (d.bom) prims.push(...bomTablePrims(d.bom, assemblies.get(d.bom.assemblyId)?.rows ?? [], translate));
    prims.push(...notePrims(d));
    return prims;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const contentPrims = useMemo(() => sheetContent(), [d, proj, uf, editSection, assemblies]);
  const titleExtra = { scale: mainScale ? scaleLabel(mainScale, comma) : '—', units: unit, date };
  const allPrims = [...titleBlockPrims(d, titleExtra), ...contentPrims];

  const exportAs = async (fmt: 'pdf' | 'svg' | 'dxf') => {
    const name = safeName(`${doc.name} - ${tab.name}`);
    setMenu(null);
    if (fmt === 'pdf') {
      // Cyrillic and the like: in the embedded font; without it (it could not be loaded) the PDF has WinAnsi only,
      // so its service labels are in English then
      const font = await loadPdfFont().catch(() => undefined);
      const tr = font ? t : (key: string) => key;
      const prims = font ? allPrims : [...titleBlockPrims(d, titleExtra, tr), ...sheetContent(tr)];
      download(writePDF([{ width: W, height: H, prims }], { title: d.title, font }), `${name}.pdf`, 'application/pdf');
    }
    if (fmt === 'svg') download(writeSVG(allPrims, { width: W, height: H, background: '#ffffff' }), `${name}.svg`, 'image/svg+xml');
    if (fmt === 'dxf') download(writeDXF(allPrims, { units: 'mm' }), `${name}.dxf`, 'image/vnd.dxf');
  };

  // live preview of a dimension being placed
  const previewPrims: Prim2D[] = [];
  if (dimDraft && cursor) {
    const v = d.views.find((x) => x.id === dimDraft.viewId);
    const pr = v ? proj(v) : undefined;
    if (v && dimDraft.a) {
      const bm = (dimDraft as DimDraft & { b?: Vec2 }).b;
      if (dimDraft.circle) {
        previewPrims.push(...dimPrims({ id: 'p', viewId: v.id, kind: 'diameter', a: dimDraft.circle.c, b: [dimDraft.circle.c[0] + dimDraft.circle.r, dimDraft.circle.c[1]], offset: 0, textPos: cursor }, v, pr, uf, t, comma));
      } else if (bm) {
        const a = toSheet(v, pr, dimDraft.a);
        const b = toSheet(v, pr, bm);
        const { kind, offset } = placeLinear(a, b, cursor);
        previewPrims.push(...dimPrims({ id: 'p', viewId: v.id, kind, a: dimDraft.a, b: bm, offset }, v, pr, uf, t, comma));
      } else {
        const a = toSheet(v, pr, dimDraft.a);
        previewPrims.push({ t: 'line', a, b: cursor, style: 'dimension' });
      }
    }
  }
  // …of an item number: from its dot to the cursor
  const draftDot = balloonDraft && cursor ? balloonDot(balloonDraft) : null;
  if (balloonDraft && draftDot && cursor) previewPrims.push(...balloonPrims(draftDot, cursor, balloonItem(balloonDraft)));
  // …of a section / detail view: the cutting line (its arrows to where the view goes) or the circle
  const draftView = viewDraft && d.views.find((x) => x.id === viewDraft.viewId);
  if (viewDraft && draftView && cursor) {
    const pr = proj(draftView);
    const b = viewDraft.b ?? draftSecond(draftView, viewDraft.a, cursor);
    const dr = { ...viewDraft, b };
    // a section's or detail's own letter while it is drawn anew, else the next one free
    const edited = editSection ? d.views.find((x) => x.id === editSection) : undefined;
    const letter = edited?.section?.letter ?? edited?.detail?.letter ?? nextViewLetter(d.views, getLang());
    if (tool === 'section' && !viewDraft.b) previewPrims.push({ t: 'line', a: toSheet(draftView, pr, dr.a), b: toSheet(draftView, pr, b), style: 'center' });
    else if (tool === 'section') previewPrims.push(...cuttingLinePrims(draftView, pr, { a: dr.a, b, side: sectionSide(draftView, dr, cursor), letter, steps: viewDraft.steps, aligned: viewDraft.aligned }));
    else {
      const r = Math.hypot(b[0] - dr.a[0], b[1] - dr.a[1]);
      previewPrims.push(...detailCirclePrims(draftView, pr, { c: dr.a, r, letter }));
      // where the view goes
      if (viewDraft.b) previewPrims.push({ t: 'circle', c: cursor, r: r * detailScale(draftView.scale), style: 'hidden' });
    }
  }
  // …of a local section's outline: through the points and the cursor, closed
  const breakView = breakDraft && d.views.find((x) => x.id === breakDraft.viewId);
  if (breakDraft && breakView && cursor) {
    const pr = proj(breakView);
    const pts = [...breakDraft.pts, toModel(breakView, pr, cursor)];
    const sheetPts = (pts.length >= 3 ? smoothOutline(pts) : pts).map((q) => toSheet(breakView, pr, q));
    previewPrims.push({ t: 'poly', pts: sheetPts, closed: pts.length >= 3, style: 'thin' });
    for (const q of breakDraft.pts) previewPrims.push({ t: 'circle', c: toSheet(breakView, pr, q), r: 0.8, style: 'thin' });
  }
  // …of a hole callout: it follows the cursor
  const calloutView = calloutDraft && d.views.find((x) => x.id === calloutDraft.viewId);
  if (calloutDraft && calloutView && cursor)
    previewPrims.push(...dimPrims({ id: 'p', viewId: calloutView.id, kind: 'hole', a: calloutDraft.a, offset: 0, textPos: cursor }, calloutView, proj(calloutView), uf, t, comma));
  // …of an angle: its lines picked, then the arc through the cursor
  const angleView = angleDraft && d.views.find((x) => x.id === angleDraft.viewId);
  if (angleDraft && angleView) {
    const pr = proj(angleView);
    for (const l of [angleDraft.l1, angleDraft.l2]) if (l) previewPrims.push({ t: 'line', a: toSheet(angleView, pr, l[0]), b: toSheet(angleView, pr, l[1]), style: 'visible' });
    const ang = angleDraft.l2 && angleOf(angleDraft.l1, angleDraft.l2);
    if (ang && cursor) previewPrims.push(...dimPrims({ id: 'p', viewId: angleView.id, kind: 'angle', ...ang, offset: 0, textPos: cursor }, angleView, pr, uf, t, comma));
  }
  // …of chain / baseline dimensions: the first as a dimension is, then the next one to the point under the cursor
  const runView = runDraft && d.views.find((x) => x.id === runDraft.viewId);
  if (runDraft && runView && cursor) {
    const pr = proj(runView);
    const A = toSheet(runView, pr, runDraft.first);
    if (!runDraft.second) previewPrims.push({ t: 'line', a: A, b: cursor, style: 'dimension' });
    else if (!runDraft.kind) {
      const { kind, offset } = placeLinear(A, toSheet(runView, pr, runDraft.second), cursor);
      previewPrims.push(...dimPrims({ id: 'p', viewId: runView.id, kind, a: runDraft.first, b: runDraft.second, offset }, runView, pr, uf, t, comma));
    } else {
      const sp = snapPoint(cursor);
      const from = tool === 'chain' ? runDraft.last! : runDraft.first;
      if (sp && !sp.circle && sp.viewId === runView.id) {
        const level = tool === 'chain' ? runDraft.level! : runDraft.level! + runDraft.out! * BASELINE_STEP;
        const offset = offsetForLevel(runDraft.kind, toSheet(runView, pr, from), toSheet(runView, pr, sp.p), level);
        previewPrims.push(...dimPrims({ id: 'p', viewId: runView.id, kind: runDraft.kind, a: from, b: sp.p, offset }, runView, pr, uf, t, comma));
      }
    }
  }
  // …of ordinates: the base, then the first point's value following the cursor
  const ordView = ordDraft && d.views.find((x) => x.id === ordDraft.viewId);
  if (ordDraft && ordView) {
    const pr = proj(ordView);
    previewPrims.push({ t: 'circle', c: toSheet(ordView, pr, ordDraft.base), r: 1.2, style: 'thin' });
    if (ordDraft.point && !ordDraft.axis && cursor) {
      const s = toSheet(ordView, pr, ordDraft.point);
      const axis = Math.abs(cursor[1] - s[1]) >= Math.abs(cursor[0] - s[0]) ? 'x' : 'y';
      for (const q of [ordDraft.base, ordDraft.point]) {
        const qs = toSheet(ordView, pr, q);
        const textPos: Vec2 = axis === 'x' ? [qs[0], cursor[1]] : [cursor[0], qs[1]];
        previewPrims.push(...dimPrims({ id: 'p', viewId: ordView.id, kind: 'ordinate', ordinate: axis, a: ordDraft.base, b: q, offset: 0, textPos }, ordView, pr, uf, t, comma));
      }
    }
  }
  /** The line an angle would be measured from, lit up under the cursor. */
  const lineHint = ((tool === 'angle' && !angleDraft?.l2) || tool === 'axis') && cursor ? lineAt(cursor) : null;
  // …of a centre line: its first line; a circle or arc that would get a centre mark, lit up
  const axisView = axisDraft && d.views.find((x) => x.id === axisDraft.viewId);
  if (axisDraft && axisView) {
    const pr = proj(axisView);
    previewPrims.push({ t: 'line', a: toSheet(axisView, pr, axisDraft.l1[0]), b: toSheet(axisView, pr, axisDraft.l1[1]), style: 'visible' });
  }
  const arcHint = tool === 'axis' && !axisDraft && cursor ? arcAt(cursor) : null;
  /** The hole a callout would point at, lit up under the cursor. */
  const holeHint = tool === 'callout' && !calloutDraft && cursor ? holeAt(cursor) : null;
  const snapHint =
    (tool === 'dimension' ||
      ((tool === 'chain' || tool === 'baseline') && !(runDraft?.second && !runDraft.kind)) ||
      (tool === 'ordinate' && !(ordDraft?.point && !ordDraft.axis)) ||
      ((tool === 'section' || tool === 'detail') && !viewDraft?.b)) &&
    cursor
      ? snapPoint(cursor)
      : null;
  const selView = selected?.kind === 'view' ? d.views.find((v) => v.id === selected.id) : undefined;
  const studioOf = (v: DrawingView) => doc.tabs.find((x): x is PartStudioTab => x.id === v.studioId && x.type === 'partStudio');
  const selStudio = selView && studioOf(selView);
  /** A view's own options in the list of views: "Front · 1:2 · Large · #len = 50 mm". */
  const viewOptions = (v: DrawingView) => {
    const s = studioOf(v);
    const label = (i: ConfigInput) => (i.kind === 'variable' ? `${inputName(s!.features, i)} = ` : '') + chosenLabel(s!.features, i, v.configuration);
    return s ? (s.configuration ?? []).filter((i) => v.configuration?.[i.id]).map(label) : [];
  };

  // sheet → screen transform for the svg group
  const tx = size.w / 2 - c.x * c.zoom;
  const ty = size.h / 2 + c.y * c.zoom;

  return (
    <>
      <div className="drawing-side">
        <div className="panel-header">{t('Sheet')}</div>
        <div className="drawing-sheet-settings">
          <div className="drawing-field">
            <span>{t('Format')}</span>
            <div className="drawing-field-grid">
              <select aria-label={t('Format')} value={d.sheet} onChange={(e) => { upd((dd) => void (dd.sheet = e.target.value as DrawingData['sheet'])); setCam(null); }}>
                {['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Tabloid'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select aria-label={t('Orientation')} value={d.landscape ? 'landscape' : 'portrait'} onChange={(e) => { upd((dd) => void (dd.landscape = e.target.value === 'landscape')); setCam(null); }}>
                <option value="landscape">{t('Landscape')}</option>
                <option value="portrait">{t('Portrait')}</option>
              </select>
            </div>
          </div>
          <div className="drawing-sheet-size">{W} × {H} mm</div>
          <label className="drawing-field">
            <span>{t('Projection')}</span>
              <select value={d.projection ?? 'first'} onChange={(e) => upd((dd) => void (dd.projection = e.target.value as 'first' | 'third'))}>
                <option value="first">{t('First angle (ISO/ГОСТ)')}</option>
                <option value="third">{t('Third angle (ANSI)')}</option>
              </select>
          </label>
          <label className="drawing-field">
            <span>{t('Decimal sign')}</span>
            <select value={d.decimal ?? '.'} onChange={(e) => upd((dd) => void (dd.decimal = e.target.value === ',' ? ',' : undefined))}>
              <option value=".">{t('Point (1.5)')}</option>
              <option value=",">{t('Comma (1,5 — ГОСТ 2.307)')}</option>
            </select>
          </label>
        </div>
        <div className="panel-header">{t('Title block')}</div>
        {/* its template, size and texts: in the title block editor (also a click on it on the sheet) */}
        <div className="drawing-sheet-settings">
          <button className="btn small" onClick={() => setEditingTitle(true)}><Icon name="edit" size={14} />{t('Edit title block')}</button>
        </div>
        <div className="panel-header">
          {t('Views')} <span className="count">({d.views.length})</span>
        </div>
        <div className="panel-body" style={{ flex: 'none' }}>
          {d.views.length === 0 && <p className="drawing-panel-hint">{t('No views yet')}</p>}
          {d.views.map((v) => (
            <div key={v.id} className={'tree-item' + (selected?.id === v.id ? ' selected' : '')} onClick={() => setSelected({ kind: 'view', id: v.id })}>
              <span className="tree-icon">
                <Icon name={v.section ? 'drawingSection' : v.detail ? 'detailView' : isPictorial(v.orientation) ? 'isoView' : 'drawingView'} size={16} />
              </span>
              <span className="tree-name">
                {[
                  v.section ? `${t('Section')} ${v.section.letter}–${v.section.letter}` : v.detail ? `${t('Detail')} ${v.detail.letter}` : t(VIEW_NAMES[v.orientation]),
                  scaleLabel(v.scale, comma),
                  ...viewOptions(v),
                ].join(' · ')}
              </span>
            </div>
          ))}
        </div>
        {selView && (
          <>
            <div className="panel-header">{t('View properties')}</div>
            <div className="fd-body">
              {isDerivedView(selView) ? (
                // a section or detail view: seen as its parent is; its letter (on the parent and above the view)
                <div className="fd-row">
                  <label>{t('View letter')}</label>
                  <div className="fd-control">
                    <input
                      type="text"
                      value={selView.section?.letter ?? selView.detail?.letter ?? ''}
                      onChange={(e) =>
                        upd((dd) => {
                          const v = dd.views.find((x) => x.id === selView.id)!;
                          const l = e.target.value.trim().toUpperCase().slice(0, 4);
                          if (v.section) v.section.letter = l;
                          if (v.detail) v.detail.letter = l;
                        }, `letter-${selView.id}`)
                      }
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    {selView.section && (
                      <button
                        className="icon-btn"
                        title={t('Opposite direction')}
                        onClick={() =>
                          upd((dd) => {
                            const s = dd.views.find((x) => x.id === selView.id)!.section;
                            if (s) s.side = s.side === 1 ? -1 : 1;
                          })
                        }
                      >
                        <Icon name="flip" size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="fd-row">
                  <label>{t('Orientation')}</label>
                  <div className="fd-control">
                    <select value={selView.orientation} onChange={(e) => upd((dd) => void (dd.views.find((x) => x.id === selView.id)!.orientation = e.target.value as ViewOrientation))}>
                      {(Object.keys(VIEW_NAMES) as ViewOrientation[]).map((o) => (
                        <option key={o} value={o}>
                          {t(VIEW_NAMES[o])}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="fd-row">
                <label>{t('Scale')}</label>
                <div className="fd-control">
                  <select
                    value={String(selView.scale)}
                    onChange={(e) =>
                      upd((dd) => {
                        const s = Number(e.target.value);
                        for (const v of dd.views) if (sameScale(v, selView)) v.scale = s;
                      })
                    }
                  >
                    {[...new Set([...STD_SCALES, selView.scale])].map((s) => (
                      <option key={s} value={String(s)}>
                        {scaleLabel(s, comma)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="fd-check">
                <input type="checkbox" checked={selView.showHidden} onChange={(e) => upd((dd) => void (dd.views.find((x) => x.id === selView.id)!.showHidden = e.target.checked))} />
                {t('Show hidden lines')}
              </label>
              {selView.brokenOut && (
                // its local section: how deep it opens the parts (from their front), or take it away
                <div className="fd-row">
                  <label>{t('Local section depth')}</label>
                  <div className="fd-control">
                    <DecimalInput
                      placeholder={t('to the middle')}
                      value={selView.brokenOut.depth === undefined ? undefined : selView.brokenOut.depth / uf}
                      onValue={(n) =>
                        upd((dd) => {
                          const b = dd.views.find((x) => x.id === selView.id)?.brokenOut;
                          if (!b) return;
                          if (n !== undefined && n >= 0) b.depth = n * uf;
                          else delete b.depth;
                        }, `depth-${selView.id}`)
                      }
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <span style={{ color: 'var(--text-3)' }}>{unit}</span>
                    <button className="icon-btn" title={t('Remove the local section')} onClick={() => upd((dd) => void delete dd.views.find((x) => x.id === selView.id)!.brokenOut)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              )}
              {selStudio?.configuration?.length ? (
                // its own configuration of the Part Studio (Onshape): the views projected with it follow
                <>
                  <div className="fd-section">{t('Configuration')}</div>
                  <ConfigurationFields
                    studio={selStudio}
                    value={selView.configuration}
                    onChange={(c) =>
                      upd((dd) => {
                        for (const v of dd.views)
                          if (sameFamily(v, selView)) {
                            if (c) v.configuration = c;
                            else delete v.configuration;
                          }
                      })
                    }
                  />
                </>
              ) : null}
              <div className="fd-row">
                <label>{t('Label')}</label>
                <div className="fd-control">
                  <input type="text" value={selView.label ?? ''} onChange={(e) => upd((dd) => void (dd.views.find((x) => x.id === selView.id)!.label = e.target.value), `label-${selView.id}`)} onKeyDown={(e) => e.stopPropagation()} />
                </div>
              </div>
              <button className="btn danger small" onClick={deleteSelected}>
                <Icon name="trash" size={14} /> {t('Delete view')}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="graphics">
        <Toast />
        <div className="drawing-toolbar">
          <button className="icon-btn" title={t('Undo') + ' (Ctrl+Z)'} disabled={!canUndo} onClick={() => useDoc.getState().undo()}><Icon name="undo" /></button>
          <button className="icon-btn" title={t('Redo') + ' (Ctrl+Y)'} disabled={!canRedo} onClick={() => useDoc.getState().redo()}><Icon name="redo" /></button>
          <div className="tb-sep" />
          <div className="menu-wrap">
            <button className="btn small primary" disabled={inserting} onClick={() => setMenu(menu === 'insert' ? null : 'insert')}>
              <Icon name="drawingView" size={14} /> {t(inserting ? 'Inserting views…' : 'Insert view')}
            </button>
            {menu === 'insert' && (
              <div className="dropdown left" onMouseLeave={() => setMenu(null)}>
                {studios.map((s) => (
                  <div key={s.id}>
                    <div className="dropdown-label">{s.name}</div>
                    <div
                      className="dropdown-item"
                      onClick={() => {
                        insertStandard(s);
                        setMenu(null);
                      }}
                    >
                      <Icon name="layers" size={16} /> {t('Standard views (3 + iso)')}
                    </div>
                    {(Object.keys(VIEW_NAMES) as ViewOrientation[]).map((o) => (
                      <div
                        key={o}
                        className="dropdown-item"
                        onClick={() => {
                          insertView(s, o);
                          setMenu(null);
                        }}
                      >
                        <Icon name={isPictorial(o) ? 'isoView' : 'drawingView'} size={16} /> {t(VIEW_NAMES[o])}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="tb-sep" />
          <button className={'icon-btn' + (tool === 'select' ? ' active' : '')} title={t('Select') + ' (Esc)'} onClick={() => setTool('select')}>
            <Icon name="select" />
          </button>
          <button className={'icon-btn' + (tool === 'dimension' ? ' active' : '')} title={t('Dimension') + ' (D)'} onClick={() => setTool('dimension')}>
            <Icon name="dimension" />
          </button>
          <button className={'icon-btn' + (tool === 'chain' ? ' active' : '')} title={t('Chain dimensions')} disabled={!d.views.length} onClick={() => setTool('chain')}>
            <Icon name="chainDimension" />
          </button>
          <button className={'icon-btn' + (tool === 'baseline' ? ' active' : '')} title={t('Baseline dimensions')} disabled={!d.views.length} onClick={() => setTool('baseline')}>
            <Icon name="baselineDimension" />
          </button>
          <button
            className={'icon-btn' + (tool === 'angle' ? ' active' : '')}
            title={t('Angular dimension (between two lines)')}
            disabled={!d.views.length}
            onClick={() => {
              setAngleDraft(null);
              setTool('angle');
            }}
          >
            <Icon name="angleDimension" />
          </button>
          <button
            className={'icon-btn' + (tool === 'ordinate' ? ' active' : '')}
            title={t('Ordinate dimensions (from a base point)')}
            disabled={!d.views.length}
            onClick={() => {
              setOrdDraft(null);
              setTool('ordinate');
            }}
          >
            <Icon name="ordinateDimension" />
          </button>
          <button
            className={'icon-btn' + (tool === 'axis' ? ' active' : '')}
            title={t('Centre line or centre mark')}
            disabled={!d.views.length}
            onClick={() => {
              setAxisDraft(null);
              setTool('axis');
            }}
          >
            <Icon name="centerline" />
          </button>
          <button
            className={'icon-btn' + (tool === 'callout' ? ' active' : '')}
            title={t('Hole callout')}
            disabled={!d.views.length}
            onClick={() => {
              setCalloutDraft(null);
              setTool('callout');
            }}
          >
            <Icon name="holeCallout" />
          </button>
          <button
            className={'icon-btn' + (tool === 'balloon' ? ' active' : '')}
            title={t('Item number (of a part in a view of an assembly)')}
            disabled={!d.views.some((v) => viewAssembly(v))}
            onClick={() => {
              setBalloonDraft(null);
              setTool('balloon');
            }}
          >
            <Icon name="balloon" />
          </button>
          <button
            className={'icon-btn' + (d.bom ? ' active' : '')}
            title={t(d.bom ? 'Bill of materials table (on the sheet; right-click it to delete)' : 'Insert the bill of materials table (of the assembly in the views)')}
            disabled={!d.bom && !d.views.some((v) => viewAssembly(v))}
            onClick={() => {
              if (d.bom) return setSelected({ kind: 'bom', id: 'bom' });
              const v = d.views.find((x) => viewAssembly(x));
              if (!v) return;
              // above the title block, as wide as it
              upd((dd) => void (dd.bom = { assemblyId: projectedView(v, d.views).studioId, x: titleRect.x1, y: titleRect.y1 }));
              setSelected({ kind: 'bom', id: 'bom' });
            }}
          >
            <Icon name="bom" />
          </button>
          <button className={'icon-btn' + (tool === 'note' ? ' active' : '')} title={t('Note') + ' (N)'} onClick={() => setTool('note')}>
            <Icon name="note" />
          </button>
          <button
            className={'icon-btn' + (tool === 'section' ? ' active' : '')}
            title={t('Section view (cut along a line on a view)')}
            disabled={!d.views.length}
            onClick={() => {
              setViewDraft(null);
              setTool('section');
            }}
          >
            <Icon name="drawingSection" />
          </button>
          <button
            className={'icon-btn' + (tool === 'detail' ? ' active' : '')}
            title={t('Detail view (an enlarged circle of a view)')}
            disabled={!d.views.length}
            onClick={() => {
              setViewDraft(null);
              setTool('detail');
            }}
          >
            <Icon name="detailView" />
          </button>
          <button
            className={'icon-btn' + (tool === 'breakout' ? ' active' : '')}
            title={t('Local section (open an area of a view)')}
            disabled={!d.views.length}
            onClick={() => {
              setBreakDraft(null);
              setTool('breakout');
            }}
          >
            <Icon name="localSection" />
          </button>
          <div className="tb-sep" />
          <button className="btn small drawing-title-tool" onClick={() => setEditingTitle(true)}>
            <Icon name="drawing" size={14} />{t('Title block')}
          </button>
          <button className="icon-btn" title={t('Zoom to fit') + ' (F)'} onClick={fitCam}>
            <Icon name="zoomFit" />
          </button>
          <div style={{ flex: 1 }} />
          <div className="menu-wrap">
            <button className="btn small" onClick={() => setMenu(menu === 'export' ? null : 'export')}>
              <Icon name="download" size={14} /> {t('Export')}
            </button>
            {menu === 'export' && (
              <div className="dropdown" onMouseLeave={() => setMenu(null)}>
                <div className="dropdown-item" onClick={() => exportAs('pdf')}>
                  <Icon name="pdf" size={16} /> PDF
                </div>
                <div className="dropdown-item" onClick={() => exportAs('svg')}>
                  <Icon name="drawing" size={16} /> SVG
                </div>
                <div className="dropdown-item" onClick={() => exportAs('dxf')}>
                  <Icon name="drawing" size={16} /> DXF
                </div>
              </div>
            )}
          </div>
        </div>
        <div
          className="drawing-area"
          ref={boxRef}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: tool !== 'select' ? 'crosshair' : hoverDim ? 'move' : 'default' }}
        >
          <svg width={size.w} height={size.h}>
            <g transform={`translate(${tx} ${ty}) scale(${c.zoom} ${-c.zoom})`}>
              <rect x={0} y={0} width={W} height={H} fill="#fff" />
              {allPrims.map((p, i) => (
                <PrimSvg key={i} p={p} />
              ))}
              {tool === 'select' && (
                <rect
                  className="drawing-title-hit"
                  x={titleRect.x0} y={titleRect.y0} width={titleRect.x1 - titleRect.x0} height={titleRect.y1 - titleRect.y0}
                  role="button" tabIndex={0} aria-label={t('Edit title block')}
                  onPointerDown={(e) => { if (e.button === 0) e.stopPropagation(); }}
                  onClick={() => setEditingTitle(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setEditingTitle(true); } }}
                ><title>{t('Edit title block')}</title></rect>
              )}
              {d.views.map((v) => {
                const r = viewRect(v, proj(v));
                const sel = selected?.kind === 'view' && selected.id === v.id;
                return (
                  // the frame and the move cursor on hover with the select tool only: other tools work on the view's lines
                  <g key={v.id} className={'drawing-view-box' + (tool === 'select' ? ' movable' : '') + (sel ? ' selected' : '')}>
                    <rect className="vframe" x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="transparent" stroke="#2f80d1" strokeOpacity={sel ? 1 : 0} strokeWidth={0.4} strokeDasharray="2 1" />
                    {!proj(v) && (
                      <text x={0} y={0} transform={`translate(${v.x} ${v.y}) scale(1 -1)`} fontSize={4} textAnchor="middle" fill="#8a96a3">
                        {t('Computing view…')}
                      </text>
                    )}
                  </g>
                );
              })}
              {selected?.kind === 'balloon' &&
                (() => {
                  const b = d.balloons?.find((x) => x.id === selected.id);
                  const dot = b && balloonDot(b);
                  return b && dot ? balloonPrims(dot, [b.x, b.y], balloonItem(b)).map((p, i) => <PrimSvg key={i} p={p} color="#ff7a00" />) : null;
                })()}
              {selected?.kind === 'bom' && bomRect && (
                <rect x={bomRect.x0} y={bomRect.y0} width={bomRect.x1 - bomRect.x0} height={bomRect.y1 - bomRect.y0} fill="none" stroke="#ff7a00" strokeWidth={0.8} />
              )}
              {selected?.kind === 'dim' &&
                (() => {
                  const dm = d.dimensions.find((x) => x.id === selected.id);
                  const v = dm && d.views.find((x) => x.id === dm.viewId);
                  return dm && v && proj(v) ? dimPrims(live(dm), v, proj(v), uf, t, comma).map((p, i) => <PrimSvg key={i} p={p} color="#ff7a00" />) : null;
                })()}
              {previewPrims.map((p, i) => (
                <PrimSvg key={`pv${i}`} p={p} color="#1f6fd1" />
              ))}
              {lineHint &&
                !arcHint &&
                (() => {
                  const v = d.views.find((x) => x.id === lineHint.viewId)!;
                  const [s, e] = lineHint.l.map((q) => toSheet(v, proj(v), q));
                  return <line x1={s[0]} y1={s[1]} x2={e[0]} y2={e[1]} stroke="#ff7a00" strokeWidth={0.6} />;
                })()}
              {arcHint &&
                (() => {
                  const v = d.views.find((x) => x.id === arcHint.viewId)!;
                  const s = toSheet(v, proj(v), arcHint.c);
                  return <circle cx={s[0]} cy={s[1]} r={arcHint.r * v.scale} fill="none" stroke="#ff7a00" strokeWidth={0.6} />;
                })()}
              {holeHint &&
                (() => {
                  const v = d.views.find((x) => x.id === holeHint.viewId)!;
                  const s = toSheet(v, proj(v), holeHint.a);
                  const sd = holeHint.side;
                  if (sd) {
                    // seen from the side: its outline, mouth to bottom
                    const r = holeHint.r * v.scale;
                    const l = sd.len * v.scale;
                    const [ux, uy] = sd.dir;
                    const pts = [[-uy * r, ux * r], [-uy * r + ux * l, ux * r + uy * l], [uy * r + ux * l, -ux * r + uy * l], [uy * r, -ux * r]].map(([x, y]) => `${s[0] + x},${s[1] + y}`);
                    return <polygon points={pts.join(' ')} fill="none" stroke="#ff7a00" strokeWidth={0.6} />;
                  }
                  return <circle cx={s[0]} cy={s[1]} r={holeHint.r * v.scale} fill="none" stroke="#ff7a00" strokeWidth={0.6} />;
                })()}
              {snapHint &&
                (() => {
                  const v = d.views.find((x) => x.id === snapHint.viewId)!;
                  const s = toSheet(v, proj(v), snapHint.circle ? snapHint.circle.c : snapHint.p);
                  return snapHint.circle ? (
                    <circle cx={s[0]} cy={s[1]} r={snapHint.circle.r * v.scale} fill="none" stroke="#ff7a00" strokeWidth={0.6} />
                  ) : (
                    <circle cx={s[0]} cy={s[1]} r={1.2} fill="#ff7a00" />
                  );
                })()}
            </g>
          </svg>
          {d.views.length === 0 && studios.length > 0 && (
            <div className="drawing-empty">
              <div>{t('Insert views of a part studio to start the drawing.')}</div>
              <button className="btn primary" disabled={inserting} onClick={() => insertStandard(studios[0])}>
                <Icon name="layers" size={16} /> {t(inserting ? 'Inserting views…' : 'Standard views (3 + iso)')}
              </button>
            </div>
          )}
          {noteEdit && (
            <div className="modal-backdrop" onPointerDown={(e) => e.stopPropagation()}>
              <div className="modal" style={{ width: 360 }}>
                <div className="modal-header">{t('Note')}</div>
                <div className="modal-body">
                  <textarea autoFocus rows={4} value={noteEdit.text} onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%' }} />
                </div>
                <div className="modal-footer">
                  <button
                    className="btn primary"
                    onClick={() => {
                      const ne = noteEdit;
                      upd((dd) => {
                        const n = dd.notes.find((x) => x.id === ne.id);
                        if (n) n.text = ne.text;
                      });
                      setNoteEdit(null);
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}
          {labelEdit && (
            // a view's label; empty — a section's or detail's letters, or none
            <div className="modal-backdrop" onPointerDown={(e) => e.stopPropagation()}>
              <div className="modal" style={{ width: 360 }}>
                <div className="modal-header">{t('View label')}</div>
                <div className="modal-body">
                  <input
                    autoFocus
                    value={labelEdit.text}
                    style={{ width: '100%' }}
                    onChange={(e) => setLabelEdit({ ...labelEdit, text: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') applyLabel(labelEdit);
                      if (e.key === 'Escape') setLabelEdit(null);
                    }}
                  />
                  {isDerivedView(d.views.find((x) => x.id === labelEdit.id) ?? ({} as DrawingView)) && (
                    <div className="fd-hint">{t('Empty — the letters of the section or detail view.')}</div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setLabelEdit(null)}>
                    {t('Cancel')}
                  </button>
                  <button className="btn primary" onClick={() => applyLabel(labelEdit)}>
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {editingTitle && <TitleBlockDialog
          drawing={d} extra={{ scale: mainScale ? scaleLabel(mainScale, comma) : '—', units: unit, date }}
          onClose={() => setEditingTitle(false)}
          onSave={(fields) => { upd((dd) => { Object.assign(dd, fields); }); setEditingTitle(false); }}
        />}
        <div className="drawing-status">
          {tool === 'dimension'
            ? t('Click two points or a circle, then place the dimension. Shift = radius.')
            : tool === 'chain' || tool === 'baseline'
              ? t(
                  !runDraft
                    ? 'Click the first point on a view.'
                    : !runDraft.second
                      ? 'Click the second point.'
                      : !runDraft.kind
                        ? 'Click where the dimension line goes.'
                        : tool === 'chain'
                          ? 'Click the next point: its dimension goes on from the last one, on the same line. Esc — done.'
                          : 'Click the next point: its dimension is from the first one, a line further out. Esc — done.',
                )
            : tool === 'axis'
              ? t(!axisDraft ? 'Centre line: click two parallel lines; a circle or arc — its centre mark.' : 'Click the second line, parallel to the first. Esc — cancel.')
            : tool === 'ordinate'
              ? t(
                  !ordDraft
                    ? 'Ordinate dimensions: click the base point (0) on a view.'
                    : !ordDraft.axis && !ordDraft.point
                      ? 'Click a point to measure from the base.'
                      : !ordDraft.axis
                        ? 'Move up or down (along X) or aside (along Y) and click where the values go.'
                        : 'Click more points: their values go on the same line. Esc — done.',
                )
            : tool === 'angle'
              ? t(!angleDraft ? 'Angular dimension: click a straight line on a view.' : !angleDraft.l2 ? 'Click the second line (not parallel to the first).' : 'Click where the arc goes: the angle of that side is measured. Esc — cancel.')
            : tool === 'callout'
              ? t(!calloutDraft ? 'Hole callout: click a hole made by the Hole feature (end-on or from the side).' : 'Click where to place the callout. Esc — cancel.')
            : tool === 'balloon'
              ? t(!balloonDraft ? 'Item number: click a part in a view of an assembly.' : 'Click where the shelf with the number goes. Esc — done.')
            : tool === 'breakout'
              ? t(!breakDraft ? 'Local section: click points round the area on a view.' : 'Click more points; the first point (or Enter) closes the outline. Esc — cancel.')
            : tool === 'section' && editSection
              ? t(!viewDraft ? 'New cutting line: click its start on the view.' : !viewDraft.b ? 'Click the end of the cutting line.' : 'Click on the side to look from — the section stays in place; Shift / Alt+click — one more point of the line. Esc — cancel.')
            : tool === 'section'
              ? t(!viewDraft ? 'Section view: click the start of the cutting line on a view.' : !viewDraft.b ? 'Click the end of the cutting line.' : 'Click where to place the section view (the arrows show the way it is seen); Shift+click — one more point of the line (an offset section), Alt+click — a bend at any angle (an aligned section). Esc — cancel.')
              : tool === 'detail' && editSection && !viewDraft
                ? t('New circle of the detail view: click its centre on the view.')
              : tool === 'detail'
                ? t(!viewDraft ? 'Detail view: click the centre of the circle on a view.' : !viewDraft.b ? 'Click to set the circle’s radius.' : 'Click where to place the detail view. Esc — cancel.')
                : selView?.parent && !selView.detail && !selView.unaligned
                  ? t('The view keeps in line with its parent: drag it with Alt to put it anywhere.')
                  : t('Drag views to move. Wheel to zoom, right/middle drag to pan. Right-click — the menu of what is under the cursor.')}
        </div>
      </div>
    </>
  );
}

/** The distance from `p` to the segment `a`–`b`. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Decide horizontal / vertical / aligned from where the user places the dimension. */
function placeLinear(a: Vec2, b: Vec2, p: Vec2): { kind: DrawingDimension['kind']; offset: number } {
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
function linearOffset(a: Vec2, b: Vec2, kind: DrawingDimension['kind'], p: Vec2): number {
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
