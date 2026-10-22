// Agent API for drawings: open / create a drawing tab, insert its views (standard ones, projected, section and detail
// views), dimension the model's vertices and circles on them (anchored: they follow the model), write notes, put the
// bill of materials of an assembly with item numbers — the same things the drawing tab of the app makes. Model points
// are given in document units and the source's coordinates; they are projected into the views here.

import type { AssemblyTab, CadDocument, DrawingData, DrawingDimension, DrawingTab, DrawingView, PartStudioTab, Vec2, Vec3, ViewOrientation } from '../core/types';
import { uid } from '../core/ids';
import { LENGTH_FACTOR, tryEvaluate } from '../core/expr';
import { makeEvalContext } from '../core/features';
import { isPictorial, nextViewLetter, viewAxes } from '../core/drawingViews';
import { v3 } from '../core/math';
import { shownParts } from '../assembly/expand';
import { sourceKey } from '../assembly/compose';
import { storedBom } from '../assembly/bom';
import { getLang } from '../i18n';
import {
  balloonDot,
  detailScale,
  drawingAssemblies,
  linearOffset,
  mainScale,
  projectedView,
  projectionRequest,
  refsOf,
  standardViews,
  viewCutOf,
  type SourceOf,
} from '../drawing/drawingModel';
import {
  calloutHole,
  chooseScale,
  dimNormal,
  dimText,
  frameRect,
  measureDim,
  projectedOrientation,
  scaleLabel,
  sheetSize,
  titleBlockRect,
  toSheet,
  viewRect,
  type ProjectionData,
} from '../drawing/sheet';
import { AgentError } from './runner';
import { studioSources, type AssemblyHost } from './assembly';
import type { DrawingOp, DrawingSummary, Num, Pt3, RunReport, ScaleSpec, ViewQuery } from './types';

/** How the host draws: the kernel's source of a tab's geometry (the worker in the browser, builders in Node). */
export interface DrawingHost extends AssemblyHost {
  drawingSource(doc: CadDocument): SourceOf;
}

const OPS = new Set(['drawing', 'view', 'section', 'detail', 'dimension', 'note', 'bom', 'deleteView']);
export const isDrawingOp = (op: { op: string }) => OPS.has(op.op);

const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const lower = (s: string) => s.trim().toLowerCase();

/** A scale from a number (0.5) or a ratio ("1:2", "2:1"). */
function scaleOf(s: ScaleSpec): number {
  if (typeof s === 'number') {
    if (!(s > 0)) throw new AgentError(`Invalid scale ${s}`);
    return s;
  }
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)\s*$/.exec(s);
  const v = m ? Number(m[1].replace(',', '.')) / Number(m[2].replace(',', '.')) : Number(s);
  if (!(v > 0)) throw new AgentError(`Invalid scale "${s}": a number or a ratio like "1:2"`);
  return v;
}

/** The view a section or detail view is made from, or a projected view is aligned with. */
const kindOf = (v: DrawingView): DrawingSummary['views'][number]['kind'] => (v.section ? 'section' : v.detail ? 'detail' : v.parent ? 'projected' : 'view');

export async function runDrawingOps(doc: CadDocument, ops: DrawingOp[], host: DrawingHost): Promise<{ doc: CadDocument; report: RunReport }> {
  const d = structuredClone(doc) as CadDocument;
  const k = LENGTH_FACTOR[d.units.length];
  const sourceOf = host.drawingSource(d);
  let tab = d.tabs.find((t) => t.id === d.activeTab && t.type === 'drawing') as DrawingTab | undefined;
  const added: string[] = [];
  const changed = new Set<string>();
  const removed: string[] = [];
  function need(): DrawingData {
    if (!tab) throw new AgentError('No drawing: open or create one first with {"op":"drawing","name":"…"}');
    return tab.drawing;
  }
  const len = (v: Num, what: string) => {
    if (typeof v === 'number') return v * k;
    const r = tryEvaluate(v, 'length', makeEvalContext(d, {}));
    if (r === null) throw new AgentError(`Invalid ${what} "${v}"`);
    return r;
  };
  const mm = (p: Pt3): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
  /** A Part Studio or an assembly by name; default — what the drawing's views show, else the first Part Studio. */
  const sourceTab = (name?: string): PartStudioTab | AssemblyTab => {
    const shows = (t: { type: string }): t is PartStudioTab | AssemblyTab => t.type === 'partStudio' || t.type === 'assembly';
    if (name !== undefined) {
      const t = d.tabs.find((x) => shows(x) && x.name === name) ?? d.tabs.find((x) => shows(x) && lower(x.name) === lower(name));
      if (!t || !shows(t)) throw new AgentError(`No Part Studio or assembly "${name}". Tabs: ${d.tabs.filter(shows).map((x) => x.name).join(', ')}`);
      return t;
    }
    const first = tab?.drawing.views[0] && d.tabs.find((x) => x.id === tab!.drawing.views[0].studioId);
    const t = first && shows(first) ? first : d.tabs.find((x) => x.type === 'partStudio');
    if (!t || !shows(t)) throw new AgentError('The document has no Part Studio to draw');
    return t;
  };
  const tabName = (id: string) => d.tabs.find((x) => x.id === id)?.name ?? id;
  const viewOf = (q: ViewQuery): DrawingView => {
    const views = need().views;
    const v =
      typeof q === 'number'
        ? views[q]
        : (views.find((x) => x.id === q) ??
          views.find((x) => lower(x.section?.letter ?? x.detail?.letter ?? '') === lower(q)) ??
          views.find((x) => x.orientation === lower(q) && !x.section && !x.detail));
    if (!v) throw new AgentError(`No view ${JSON.stringify(q)}. Views: ${views.map((x, i) => `#${i} ${x.section ? `section ${x.section.letter}` : x.detail ? `detail ${x.detail.letter}` : x.orientation} (${x.id})`).join(', ') || '(none)'}`);
    return v;
  };
  // the views' projections (a detail view: its parent's), by what they depend on
  const projections = new Map<string, ProjectionData>();
  const projOf = async (v: DrawingView): Promise<ProjectionData> => {
    const views = need().views;
    const pv = projectedView(v, views);
    const req = { partIds: pv.partIds, orientation: pv.orientation, hidden: true, ...projectionRequest(pv, views) };
    const key = JSON.stringify([pv.studioId, pv.configuration ?? null, req]);
    const known = projections.get(key);
    if (known) return known;
    const src = sourceOf(d.tabs.find((x) => x.id === pv.studioId), pv.configuration);
    if (!src) throw new AgentError(`The view's ${tabName(pv.studioId)} cannot be drawn`);
    const res = { ...(await src.projection(req)), key };
    projections.set(key, res);
    return res;
  };
  /** A model point (mm) in a view's coordinates. */
  const inView = (v: DrawingView, p: Vec3): Vec2 => {
    const { n, x } = viewAxes(v, need().views);
    const y = v3.cross(n, x);
    return [v3.dot(p, x), v3.dot(p, y)];
  };
  /** Half a view's size on the sheet across `dir`. */
  const half = (v: DrawingView, p: ProjectionData, dir: 'right' | 'left' | 'up' | 'down') => {
    if (v.detail) return v.detail.r * v.scale;
    if (!p.bounds) return 0;
    const i = dir === 'right' || dir === 'left' ? 0 : 1;
    return ((p.bounds[1][i] - p.bounds[0][i]) / 2) * v.scale;
  };
  /** Place `v` beside `parent` towards `dir`, `gap` mm between them (on its line of projection). */
  const beside = async (v: DrawingView, parent: DrawingView, dir: 'right' | 'left' | 'up' | 'down', gap: number) => {
    const step = half(parent, await projOf(parent), dir) + gap + half(v, await projOf(v), dir);
    const sign = dir === 'right' || dir === 'up' ? 1 : -1;
    if (dir === 'right' || dir === 'left') [v.x, v.y] = [parent.x + sign * step, parent.y];
    else [v.x, v.y] = [parent.x, parent.y + sign * step];
  };
  const partIdsOf = async (src: PartStudioTab | AssemblyTab, names?: string[]): Promise<string[]> => {
    if (!names?.length) return [];
    if (src.type === 'assembly') {
      const parts = shownParts(d.tabs, src);
      return names.map((n) => {
        const i = parts.find((x) => x.name === n || x.id === n) ?? parts.find((x) => lower(x.name) === lower(n));
        if (!i) throw new AgentError(`No instance "${n}" in ${src.name}. Instances: ${parts.map((x) => x.name).join(', ')}`);
        return i.id;
      });
    }
    const parts = [...(await host.studio(d, src)).parts.values()];
    return names.map((n) => {
      const p = parts.find((x) => x.name === n || x.id === n) ?? parts.find((x) => lower(x.name) === lower(n));
      if (!p) throw new AgentError(`No part "${n}" in ${src.name}. Parts: ${parts.map((x) => x.name).join(', ')}`);
      return p.id;
    });
  };

  const apply = async (op: DrawingOp) => {
    switch (op.op) {
      case 'drawing': {
        const found = d.tabs.find((t) => t.type === 'drawing' && (op.name === undefined || t.name === op.name)) ?? (op.name !== undefined ? d.tabs.find((t) => t.type === 'drawing' && lower(t.name) === lower(op.name!)) : undefined);
        if (found?.type === 'drawing') {
          tab = found;
          changed.add(found.name);
        } else {
          let n = 1;
          while (d.tabs.some((t) => t.name === `Drawing ${n}`)) n++;
          tab = { id: uid('dw'), type: 'drawing', name: op.name ?? `Drawing ${n}`, drawing: { sheet: 'A3', landscape: true, views: [], dimensions: [], notes: [], title: '', author: '' } };
          d.tabs.push(tab);
          added.push(tab.name);
        }
        d.activeTab = tab.id;
        const dr = tab.drawing;
        if (op.sheet) dr.sheet = op.sheet;
        if (op.landscape !== undefined) dr.landscape = op.landscape;
        if (op.projection) dr.projection = op.projection;
        if (op.decimal) dr.decimal = op.decimal;
        if (op.title !== undefined) dr.title = op.title;
        if (op.author !== undefined) dr.author = op.author;
        if (op.designation !== undefined) dr.designation = op.designation;
        if (op.template || op.material !== undefined || op.organization !== undefined)
          dr.titleBlock = {
            ...(dr.titleBlock ?? { template: 'custom' }),
            ...(op.template ? { template: op.template } : {}),
            ...(op.material !== undefined ? { material: op.material } : {}),
            ...(op.organization !== undefined ? { organization: op.organization } : {}),
          };
        if (op.of !== undefined) {
          const src = sourceTab(op.of);
          const s = sourceOf(src);
          if (!s) throw new AgentError(`${src.name} cannot be drawn`);
          try {
            dr.views.push(...(await standardViews(dr, src.id, s)));
          } catch (e) {
            throw new AgentError(`${src.name}: ${(e as Error).message}`);
          }
        }
        return;
      }
      case 'view': {
        const dr = need();
        let v: DrawingView;
        if (op.from !== undefined) {
          const parent = viewOf(op.from);
          if (parent.section || parent.detail || isPictorial(parent.orientation)) throw new AgentError('A view is projected from a front, top, side … view');
          const dir = op.direction ?? 'right';
          const orientation = projectedOrientation(parent.orientation, dir, dr.projection ?? 'first');
          if (!orientation) throw new AgentError(`No view projects ${dir} of a ${parent.orientation} view`);
          v = { id: uid('v'), studioId: parent.studioId, partIds: [...parent.partIds], orientation, x: parent.x, y: parent.y, scale: parent.scale, showHidden: op.hidden ?? parent.showHidden, parent: parent.id, ...(parent.configuration ? { configuration: { ...parent.configuration } } : {}) };
          await beside(v, parent, dir, op.gap ?? 20);
          if (op.at) {
            // off its line of projection: placed freely
            if (Math.abs(op.at[dir === 'right' || dir === 'left' ? 1 : 0] - (dir === 'right' || dir === 'left' ? parent.y : parent.x)) > 1e-6) v.unaligned = true;
            [v.x, v.y] = op.at;
          }
        } else {
          const src = sourceTab(op.of);
          const orientation = (op.orientation ?? 'front') as ViewOrientation;
          v = { id: uid('v'), studioId: src.id, partIds: await partIdsOf(src, op.parts), orientation, x: 0, y: 0, scale: 1, showHidden: op.hidden ?? !isPictorial(orientation) };
          const p = await projOf(v);
          if (!p.bounds) throw new AgentError(`${src.name} has nothing to draw`);
          const f = frameRect(dr);
          const top = titleBlockRect(dr).y1;
          if (op.scale !== undefined) v.scale = scaleOf(op.scale);
          else {
            const own = mainScale(dr);
            const w = p.bounds[1][0] - p.bounds[0][0];
            const h = p.bounds[1][1] - p.bounds[0][1];
            v.scale = own ?? chooseScale(w, h, (f.x1 - f.x0) * 0.45, (f.y1 - top) * 0.45);
          }
          [v.x, v.y] = op.at ?? [(f.x0 + f.x1) / 2, (top + f.y1) / 2];
        }
        if (op.from !== undefined && op.scale !== undefined) v.scale = scaleOf(op.scale);
        dr.views.push(v);
        changed.add(tab!.name);
        return;
      }
      case 'section': {
        const dr = need();
        const parent = viewOf(op.view);
        if (parent.detail || isPictorial(parent.orientation)) throw new AgentError('A section is cut on a front, top, side … view');
        const pp = await projOf(parent);
        if (!pp.bounds) throw new AgentError('The view has nothing to cut');
        const c = inView(parent, mm(op.through));
        const [lo, hi] = pp.bounds;
        // a little past the view (4 mm on the sheet): its letters clear of dimensions beside it
        const m = 4 / parent.scale;
        const line = op.line ?? 'vertical';
        const [a, b]: [Vec2, Vec2] = line === 'vertical' ? [[c[0], hi[1] + m], [c[0], lo[1] - m]] : [[lo[0] - m, c[1]], [hi[0] + m, c[1]]];
        const dir = op.direction ?? (line === 'vertical' ? 'right' : 'down');
        // the way it is seen: towards where it is placed (first angle), away from it (third)
        const A = toSheet(parent, pp, a);
        const B = toSheet(parent, pp, b);
        const to: Vec2 = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] }[dir] as Vec2;
        const left = (B[0] - A[0]) * to[1] - (B[1] - A[1]) * to[0] >= 0 ? 1 : -1;
        const side = ((dr.projection ?? 'first') === 'first' ? left : -left) as 1 | -1;
        const letter = nextViewLetter(dr.views, getLang());
        const v: DrawingView = {
          id: uid('v'),
          studioId: parent.studioId,
          partIds: [...parent.partIds],
          orientation: parent.orientation,
          x: parent.x,
          y: parent.y,
          scale: parent.scale,
          showHidden: false,
          parent: parent.id,
          section: { a, b, side, letter },
          ...(parent.configuration ? { configuration: { ...parent.configuration } } : {}),
        };
        dr.views.push(v);
        await beside(v, parent, dir, op.gap ?? 25);
        changed.add(tab!.name);
        return;
      }
      case 'detail': {
        const dr = need();
        const parent = viewOf(op.view);
        const pp = await projOf(parent);
        const c = inView(parent, mm(op.center));
        const r = len(op.radius, 'radius');
        if (!(r > 0)) throw new AgentError('The radius must be positive');
        const v: DrawingView = {
          id: uid('v'),
          studioId: parent.studioId,
          partIds: [...parent.partIds],
          orientation: parent.orientation,
          x: 0,
          y: 0,
          scale: op.scale !== undefined ? scaleOf(op.scale) : detailScale(parent.scale),
          showHidden: parent.showHidden,
          parent: parent.id,
          detail: { c, r, letter: nextViewLetter(dr.views, getLang()) },
          ...(parent.configuration ? { configuration: { ...parent.configuration } } : {}),
        };
        [v.x, v.y] = op.at ?? [viewRect(parent, pp).x1 + 15 + r * v.scale, parent.y];
        dr.views.push(v);
        changed.add(tab!.name);
        return;
      }
      case 'dimension': {
        const dr = need();
        const v = viewOf(op.view);
        const p = await projOf(v);
        const pv = projectedView(v, dr.views);
        const src = sourceOf(d.tabs.find((x) => x.id === pv.studioId), pv.configuration);
        const axes = viewAxes(v, dr.views);
        const cut = viewCutOf(v, dr.views);
        const anchor = async (q: Vec2, circle?: { r?: number; side?: boolean }) => {
          try {
            return (await src?.viewAnchor({ partIds: pv.partIds, axes, p: q, ...(circle ? { circle } : {}), ...(cut ? { cut } : {}) })) ?? null;
          } catch {
            return null;
          }
        };
        const center: Vec2 = [v.x, v.y];
        const out = op.offset ?? 10;
        const id = uid('d');
        if (op.type === 'horizontal' || op.type === 'vertical' || op.type === 'aligned') {
          if (!op.from || !op.to) throw new AgentError(`A ${op.type} dimension needs "from" and "to" (model points)`);
          const a = inView(v, mm(op.from));
          const b = inView(v, mm(op.to));
          const kind: DrawingDimension['kind'] = op.type === 'aligned' ? 'linear' : op.type;
          const A = toSheet(v, p, a);
          const B = toSheet(v, p, b);
          if (Math.hypot(A[0] - B[0], A[1] - B[1]) < 1e-6) throw new AgentError('The two points are one in this view');
          let offset: number;
          if (op.at) offset = linearOffset(A, B, kind, op.at);
          else {
            // outwards: on the side of the points away from the view's middle
            const n = dimNormal(kind, A, B);
            const side = ((A[0] + B[0]) / 2 - center[0]) * n[0] + ((A[1] + B[1]) / 2 - center[1]) * n[1] >= 0 ? 1 : -1;
            offset = side * out;
          }
          const [ra, rb] = [await anchor(a), await anchor(b)];
          dr.dimensions.push({ id, viewId: v.id, kind, a, b, offset, ...refsOf(ra, rb) });
        } else {
          if (!op.center) throw new AgentError(`A ${op.type} dimension needs "center" (a model point)`);
          const a = inView(v, mm(op.center));
          const C = toSheet(v, p, a);
          // the label out of the view, slanting away from its middle — a hole callout up, a diameter down (the two
          // apart) — at the first place clear of the other views and labels, inside the frame
          type Box = { x0: number; y0: number; x1: number; y1: number };
          const boxOf = (q: Vec2, from: Vec2, w: number): Box => ({ x0: q[0] >= from[0] ? q[0] : q[0] - w, x1: q[0] >= from[0] ? q[0] + w : q[0], y0: q[1] - 4, y1: q[1] + 6 });
          const obstacles: Box[] = await Promise.all(dr.views.filter((x) => x.id !== v.id).map(async (x) => viewRect(x, await projOf(x).catch(() => undefined))));
          for (const dm of dr.dimensions)
            if (dm.textPos && (dm.kind === 'hole' || dm.kind === 'diameter' || dm.kind === 'radius')) {
              const dv = dr.views.find((x) => x.id === dm.viewId);
              const from = dv ? toSheet(dv, await projOf(dv), dm.a) : dm.textPos;
              obstacles.push(boxOf(dm.textPos, from, dm.kind === 'hole' ? 32 : 14));
            }
          const frame = frameRect(dr);
          const label = (r: number): Vec2 => {
            if (op.at) return op.at;
            const sx = C[0] >= center[0] ? 1 : -1;
            const sy = op.type === 'hole' ? 1 : -1;
            const rect = viewRect(v, p);
            const at = (dir: Vec2, extra: number): Vec2 => {
              const exit = Math.min(...[0, 1].filter((i) => Math.abs(dir[i]) > 1e-9).map((i) => (dir[i] > 0 ? [rect.x1, rect.y1][i] - C[i] : C[i] - [rect.x0, rect.y0][i]) / Math.abs(dir[i])));
              // past the linear dimensions beside the view (10 mm out by default)
              const reach = Math.max(exit, r * v.scale) + (op.offset ?? extra);
              return [C[0] + dir[0] * reach, C[1] + dir[1] * reach];
            };
            // the label's text runs along its shelf away from the circle: a callout's longer
            const w = op.type === 'hole' ? 32 : 14;
            const clear = (q: Vec2) => {
              const b = boxOf(q, C, w);
              return b.x0 > frame.x0 + 2 && b.x1 < frame.x1 - 2 && b.y0 > frame.y0 + 2 && b.y1 < frame.y1 - 2 && obstacles.every((o) => b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1);
            };
            const d = Math.SQRT1_2;
            const dirs: Vec2[] = [[sx * d, sy * d], [-sx * d, sy * d], [sx * d, -sy * d], [-sx * d, -sy * d], [sx, 0], [-sx, 0], [0, sy], [0, -sy]];
            for (const extra of [18, 32]) for (const dir of dirs) if (clear(at(dir, extra))) return at(dir, extra);
            return at(dirs[0], 18);
          };
          if (op.type === 'hole') {
            const h = calloutHole(p, a);
            if (!h) throw new AgentError('No hole of the Hole feature there in this view');
            // seen end-on: its circle; from the side: its mouth's circle, seen edge-on
            const ra = await anchor(h.c, h.side ? { r: h.r, side: true } : {});
            dr.dimensions.push({ id, viewId: v.id, kind: 'hole', a: h.c, offset: 0, textPos: label(h.r), ...refsOf(ra) });
          } else {
            // the circle seen end-on there
            const circle = p.edges.map((e) => e.circle).find((c) => c && Math.hypot(c.c[0] - a[0], c.c[1] - a[1]) < 1e-3);
            if (!circle) throw new AgentError('No circle centred there in this view (seen end-on)');
            const ra = await anchor(circle.c, { r: circle.r });
            dr.dimensions.push({ id, viewId: v.id, kind: op.type, a: circle.c, b: [circle.c[0] + circle.r, circle.c[1]], offset: 0, textPos: label(circle.r), ...refsOf(ra) });
          }
        }
        changed.add(tab!.name);
        return;
      }
      case 'note': {
        const dr = need();
        if (!op.text) throw new AgentError('A note needs "text"');
        dr.notes.push({ id: uid('n'), x: op.at[0], y: op.at[1], text: op.text, height: op.height ?? 3.5 });
        changed.add(tab!.name);
        return;
      }
      case 'bom': {
        const dr = need();
        let asm: AssemblyTab | undefined;
        if (op.assembly !== undefined) {
          const t = sourceTab(op.assembly);
          if (t.type !== 'assembly') throw new AgentError(`${t.name} is not an assembly`);
          asm = t;
        } else {
          const v = dr.views.find((x) => d.tabs.find((t) => t.id === x.studioId)?.type === 'assembly');
          asm = v && (d.tabs.find((t) => t.id === v.studioId) as AssemblyTab);
          if (!asm) throw new AgentError('No assembly: name it ("assembly") or draw a view of one first');
        }
        const title = titleBlockRect(dr);
        dr.bom = { assemblyId: asm.id, x: op.at?.[0] ?? title.x1, y: op.at?.[1] ?? title.y1 };
        if (op.balloons) {
          const v = op.balloons === true ? dr.views.find((x) => x.studioId === asm!.id && !x.section && !x.detail) : viewOf(op.balloons);
          if (!v || projectedView(v, dr.views).studioId !== asm.id) throw new AgentError(`No view of ${asm.name} for the item numbers`);
          const p = await projOf(v);
          const sources = await studioSources(d, host);
          const instances = shownParts(d.tabs, asm);
          const rect = viewRect(v, p);
          const assemblies = drawingAssemblies(d, dr);
          dr.balloons = (dr.balloons ?? []).filter((b) => b.viewId !== v.id);
          for (const row of storedBom(d, asm)) {
            const inst = instances.find((i) => row.instances.includes(i.id));
            const mesh = inst && sources.get(sourceKey(inst))?.parts.get(inst.partId);
            if (!inst || !mesh) continue;
            const at = v3.scale(v3.add(mesh.bbox[0], mesh.bbox[1]), 0.5);
            const dot = balloonDot(dr, assemblies, () => p, { viewId: v.id, instance: inst.id, at });
            if (!dot) continue;
            // the shelf out of the view, on the line from its middle through the dot
            const u = [dot[0] - v.x, dot[1] - v.y];
            const l = Math.hypot(u[0], u[1]) || 1;
            const dir: Vec2 = l > 1e-6 ? [u[0] / l, u[1] / l] : [1, 0];
            const exit = Math.min(...[0, 1].map((i) => (dir[i] > 1e-9 ? ([rect.x1, rect.y1][i] - [v.x, v.y][i]) / dir[i] : dir[i] < -1e-9 ? ([rect.x0, rect.y0][i] - [v.x, v.y][i]) / dir[i] : Infinity)));
            const reach = Math.max(exit, l) + 8;
            dr.balloons.push({ id: uid('b'), viewId: v.id, instance: inst.id, at, x: v.x + dir[0] * reach, y: v.y + dir[1] * reach });
          }
        }
        changed.add(tab!.name);
        return;
      }
      case 'deleteView': {
        const dr = need();
        const v = viewOf(op.view);
        // with the section and detail views made from it (and theirs)
        const gone = new Set([v.id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const x of dr.views)
            if (!gone.has(x.id) && x.parent && gone.has(x.parent) && (x.section || x.detail)) {
              gone.add(x.id);
              grew = true;
            }
        }
        dr.views = dr.views.filter((x) => !gone.has(x.id));
        dr.dimensions = dr.dimensions.filter((x) => !gone.has(x.viewId));
        if (dr.balloons) dr.balloons = dr.balloons.filter((x) => !gone.has(x.viewId));
        for (const x of dr.views) if (x.parent && gone.has(x.parent)) delete x.parent;
        removed.push(`view ${v.section?.letter ?? v.detail?.letter ?? v.orientation}`);
        changed.add(tab!.name);
        return;
      }
      default:
        throw new AgentError(`Unknown drawing op "${(op as { op: string }).op}"`);
    }
  };

  let i = 0;
  try {
    for (; i < ops.length; i++) await apply(ops[i]);
    need();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { doc, report: { ok: false, error: `op #${i} (${ops[i]?.op ?? '?'}): ${msg}`, added: [], changed: [], removed: [], failed: [], applied: false } };
  }
  return { doc: d, report: { ok: true, added, changed: [...changed].filter((n) => !added.includes(n)), removed, failed: [], applied: false, drawing: await summarizeDrawing(d, tab!, sourceOf, projOf) } };
}

/** A drawing as the agent sees it: its views' places and sizes, its dimensions' values as written. */
export async function summarizeDrawing(doc: CadDocument, tab: DrawingTab, sourceOf: SourceOf, projOf?: (v: DrawingView) => Promise<ProjectionData>): Promise<DrawingSummary> {
  const d = tab.drawing;
  const uf = LENGTH_FACTOR[doc.units.length];
  const comma = d.decimal === ',';
  const proj =
    projOf ??
    (async (v: DrawingView) => {
      const pv = projectedView(v, d.views);
      const src = sourceOf(doc.tabs.find((x) => x.id === pv.studioId), pv.configuration);
      if (!src) throw new Error('no source');
      return { ...(await src.projection({ partIds: pv.partIds, orientation: pv.orientation, hidden: true, ...projectionRequest(pv, d.views) })), key: pv.id };
    });
  const views: DrawingSummary['views'] = [];
  for (const v of d.views) {
    let size: [number, number] | undefined;
    try {
      const r = viewRect(v, await proj(v));
      // (less the margin it is picked with)
      size = [round(r.x1 - r.x0 - 8), round(r.y1 - r.y0 - 8)];
    } catch {
      // its source cannot be drawn
    }
    views.push({
      id: v.id,
      kind: kindOf(v),
      ...(v.section || v.detail ? { label: v.section?.letter ?? v.detail?.letter } : {}),
      orientation: v.orientation,
      of: doc.tabs.find((x) => x.id === v.studioId)?.name ?? v.studioId,
      scale: scaleLabel(v.scale),
      at: [round(v.x), round(v.y)],
      ...(size ? { size } : {}),
      ...(v.parent ? { parent: v.parent } : {}),
    });
  }
  const [w, h] = sheetSize(d);
  return {
    name: tab.name,
    sheet: d.sheet,
    landscape: d.landscape,
    projection: d.projection ?? 'first',
    size: [w, h],
    views,
    dimensions: d.dimensions.map((dm) => ({
      id: dm.id,
      view: dm.viewId,
      type: dm.kind === 'linear' ? 'aligned' : dm.kind,
      value: dm.kind === 'angle' ? round(measureDim(dm)) : round(measureDim(dm) / uf),
      text: dimText(dm, uf, comma),
      anchored: !!(dm.refs?.a || dm.refs?.b),
    })),
    notes: d.notes.length,
    ...(d.bom ? { bom: { assembly: doc.tabs.find((x) => x.id === d.bom!.assemblyId)?.name ?? d.bom.assemblyId, rows: drawingAssemblies(doc, d).get(d.bom.assemblyId)?.rows.length ?? 0 } } : {}),
    balloons: d.balloons?.length ?? 0,
  };
}
