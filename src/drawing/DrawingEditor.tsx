// Drawing tab: sheet with title block, projected views (HLR), dimensions and notes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Draft } from 'immer';
import type { CadDocument, DrawingData, DrawingDimension, DrawingTab, DrawingView, PartStudioTab, Vec2, ViewOrientation } from '../core/types';
import { uid } from '../core/ids';
import { LENGTH_FACTOR } from '../core/expr';
import { kernel } from '../kernel/client';
import { useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import type { Prim2D } from '../export/prim2d';
import { STYLE_DEFAULTS } from '../export/prim2d';
import { writePDF } from '../export/pdf';
import { writeSVG } from '../export/svg';
import { writeDXF } from '../export/dxf';
import { download, safeName } from '../ui/exporting';
import { Icon } from '../ui/icons';
import { Toast } from '../ui/Overlays';
import { getLang, t } from '../i18n';
import {
  chooseScale,
  dimPrims,
  frameRect,
  notePrims,
  projectedOrientation,
  scaleLabel,
  sheetSize,
  STD_SCALES,
  TITLE_H,
  titleBlockRect,
  titleBlockPrims,
  toModel,
  toSheet,
  VIEW_NAMES,
  viewPrims,
  viewRect,
  type ProjectionData,
} from './sheet';

// ---------------------------------------------------------------------------
// Projection cache: builds the referenced part studio in the worker, then asks for HLR views.
// ---------------------------------------------------------------------------

const projCache = new Map<string, ProjectionData>();
const builtStudios = new Map<string, unknown>();

function studioKeyOf(s: PartStudioTab) {
  return `${s.id}:${s.features.length}:${JSON.stringify(s.features).length}:${s.rollback}:${JSON.stringify(s.parts).length}`;
}

async function ensureBuilt(doc: CadDocument, studio: PartStudioTab) {
  if (builtStudios.get(studio.id) === studio.features && !useEditor.getState().editing) return;
  const upTo = studio.rollback ?? studio.features.length;
  await kernel().build(studio.id, {
    units: doc.units,
    features: studio.features.slice(0, upTo),
    partMeta: Object.fromEntries(Object.entries(studio.parts).map(([k, v]) => [k, { name: v.name, color: v.color, hidden: v.hidden }])),
    upTo,
  });
  builtStudios.set(studio.id, studio.features);
}

function viewKey(v: DrawingView, studio: PartStudioTab) {
  return `${studioKeyOf(studio)}|${v.orientation}|${v.partIds.join(',')}|${v.showHidden}`;
}

function useProjections(doc: CadDocument, drawing: DrawingData) {
  const [, force] = useState(0);
  const pending = useRef(new Set<string>());
  useEffect(() => {
    (async () => {
      await kernel().ready();
      for (const v of drawing.views) {
        const studio = doc.tabs.find((x) => x.id === v.studioId) as PartStudioTab | undefined;
        if (!studio || studio.type !== 'partStudio') continue;
        const key = viewKey(v, studio);
        if (projCache.has(key) || pending.current.has(key)) continue;
        pending.current.add(key);
        try {
          await ensureBuilt(doc, studio);
          const res = await kernel().projection({ studioKey: studio.id, partIds: v.partIds, orientation: v.orientation, hidden: true });
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
  }, [doc, drawing.views]);
  return (v: DrawingView): ProjectionData | undefined => {
    const studio = doc.tabs.find((x) => x.id === v.studioId) as PartStudioTab | undefined;
    if (!studio || studio.type !== 'partStudio') return undefined;
    const exact = projCache.get(viewKey(v, studio));
    if (exact) return exact;
    // stale projection of the same view while the new one is computed
    for (const p of projCache.values()) if (p.key.startsWith(`${studio.id}:`) && p.key.endsWith(`|${v.orientation}|${v.partIds.join(',')}|${v.showHidden}`)) return p;
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

type Tool = 'select' | 'dimension' | 'note';

interface DimDraft {
  viewId: string;
  a?: Vec2;
  circle?: { c: Vec2; r: number };
}

type TitleFields = Pick<DrawingData, 'title' | 'author' | 'designation'>;

function TitleBlockDialog({ drawing, extra, onSave, onClose }: {
  drawing: DrawingData;
  extra: { scale: string; units: string; date: string };
  onSave: (fields: TitleFields) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<TitleFields>({ title: drawing.title, author: drawing.author, designation: drawing.designation ?? '' });
  const formRef = useRef<HTMLFormElement>(null);
  const rect = titleBlockRect(drawing);
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
            const controls = Array.from(formRef.current!.querySelectorAll<HTMLElement>('input, textarea, button'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}
      >
        <div className="modal-header" id="drawing-title-dialog-heading">{t('Edit title block')}</div>
        <div className="modal-body">
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
          <div className="drawing-title-preview">
            <svg viewBox={`0 0 ${rect.x1 - rect.x0} ${TITLE_H}`} role="img" aria-label={t('Title block')}>
              <g transform={`translate(${-rect.x0} ${rect.y1}) scale(1 -1)`}>
                {titleBlockPrims({ ...drawing, ...fields }, extra).map((p, i) => <PrimSvg key={i} p={p} />)}
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
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<{ kind: 'view' | 'dim' | 'note'; id: string } | null>(null);
  const [cam, setCam] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [dimDraft, setDimDraft] = useState<DimDraft | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [inserting, setInserting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const size = measured ?? { w: 800, h: 600 };
  const drag = useRef<{ kind: 'pan' | 'view' | 'note'; id?: string; sx: number; sy: number; start: Vec2; orig?: Vec2; moved: boolean } | null>(null);
  const studios = doc.tabs.filter((x): x is PartStudioTab => x.type === 'partStudio');
  const [W, H] = sheetSize(d);
  const titleRect = titleBlockRect(d);
  const unit = doc.units.length;
  const uf = LENGTH_FACTOR[unit];

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
  const insertStandard = async (studio: PartStudioTab) => {
    if (inserting) return;
    setInserting(true);
    try {
      await kernel().ready();
      await ensureBuilt(doc, studio);
      const front = await kernel().projection({ studioKey: studio.id, partIds: [], orientation: 'front', hidden: false });
      const top = await kernel().projection({ studioKey: studio.id, partIds: [], orientation: 'top', hidden: false });
      if (!front.bounds || !top.bounds) {
        useEditor.getState().showToast(t('The part studio has no parts to draw'), 'error');
        return;
      }
      const fw = front.bounds[1][0] - front.bounds[0][0];
      const fh = front.bounds[1][1] - front.bounds[0][1];
      const th = top.bounds[1][1] - top.bounds[0][1];
      const f = frameRect(d);
      const availW = f.x1 - f.x0 - 30;
      const availH = f.y1 - f.y0 - TITLE_H - 20;
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

  const insertView = (studio: PartStudioTab, orientation: ViewOrientation) => {
    const f = frameRect(d);
    const scale = d.views[0]?.scale ?? 1;
    upd((dd) => {
      dd.views.push({ id: uid('v'), studioId: studio.id, partIds: [], orientation, x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2, scale, showHidden: orientation !== 'iso' });
    });
  };

  const moveView = (id: string, to: Vec2) => {
    upd((dd) => {
      const v = dd.views.find((x) => x.id === id);
      if (!v) return;
      const dx = to[0] - v.x;
      const dy = to[1] - v.y;
      // keep projection alignment with the parent
      const parent = v.parent ? dd.views.find((x) => x.id === v.parent) : undefined;
      if (parent) {
        if (Math.abs(parent.x - v.x) < Math.abs(parent.y - v.y)) v.y = to[1];
        else v.x = to[0];
      } else {
        v.x = to[0];
        v.y = to[1];
      }
      // children follow along their aligned axis
      for (const ch of dd.views)
        if (ch.parent === id) {
          if (Math.abs(ch.x - (v.x - dx)) < Math.abs(ch.y - (v.y - dy))) ch.x += v.x - (to[0] - dx);
          else ch.y += v.y - (to[1] - dy);
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

  // ---------------------------------------------------------------- events
  const onWheel = (e: React.WheelEvent) => {
    const { sx, sy } = local(e);
    const before = toSheetPt(sx, sy);
    const zoom = Math.min(50, Math.max(0.2, c.zoom * Math.exp(-e.deltaY * 0.0015)));
    const nx = before[0] - (sx - size.w / 2) / zoom;
    const ny = before[1] + (sy - size.h / 2) / zoom;
    setCam({ x: nx, y: ny, zoom });
  };

  const hitView = (p: Vec2) => {
    for (let i = d.views.length - 1; i >= 0; i--) {
      const v = d.views[i];
      const r = viewRect(v, proj(v));
      if (p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1) return v;
    }
    return null;
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
        upd((dd) => {
          dd.dimensions.push({ id: uid('d'), viewId: v.id, kind, a: ctr, b, offset: 0, textPos: p });
        });
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
      upd((dd) => {
        dd.dimensions.push({ id: uid('d'), viewId: v.id, kind, a: dimDraft.a!, b: bm, offset });
      });
      setDimDraft(null);
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
    const note = d.notes.find((n) => p[0] >= n.x - 1 && p[0] <= n.x + n.text.length * n.height * 0.6 && p[1] >= n.y - 1 - (n.text.split('\n').length - 1) * n.height * 1.5 && p[1] <= n.y + n.height);
    if (note) {
      setSelected({ kind: 'note', id: note.id });
      drag.current = { kind: 'note', id: note.id, sx, sy, start: p, orig: [note.x, note.y], moved: false };
      return;
    }
    const dimHit = d.dimensions.find((dm) => {
      const v = d.views.find((x) => x.id === dm.viewId);
      if (!v) return false;
      const prims = dimPrims(dm, v, proj(v), uf);
      return prims.some((pr) => pr.t === 'text' && Math.hypot(pr.p[0] - p[0], pr.p[1] - p[1]) < 5);
    });
    if (dimHit) {
      setSelected({ kind: 'dim', id: dimHit.id });
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
    if (!dr) return;
    if (Math.hypot(sx - dr.sx, sy - dr.sy) > 3) dr.moved = true;
    if (!dr.moved) return;
    if (dr.kind === 'pan') {
      setCam({ x: dr.start[0] - (sx - dr.sx) / c.zoom, y: dr.start[1] + (sy - dr.sy) / c.zoom, zoom: c.zoom });
    } else if (dr.kind === 'view' && dr.id && dr.orig) {
      moveView(dr.id, [dr.orig[0] + p[0] - dr.start[0], dr.orig[1] + p[1] - dr.start[1]]);
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
    }
  };

  const onUp = () => {
    drag.current = null;
  };

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    upd((dd) => {
      if (selected.kind === 'view') {
        dd.views = dd.views.filter((v) => v.id !== selected.id);
        dd.dimensions = dd.dimensions.filter((x) => x.viewId !== selected.id);
        for (const v of dd.views) if (v.parent === selected.id) delete v.parent;
      }
      if (selected.kind === 'dim') dd.dimensions = dd.dimensions.filter((x) => x.id !== selected.id);
      if (selected.kind === 'note') dd.notes = dd.notes.filter((x) => x.id !== selected.id);
    });
    setSelected(null);
  }, [selected, upd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingTitle) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'Escape') {
        setDimDraft(null);
        setTool('select');
        setSelected(null);
      }
      if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey) setTool('dimension');
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) fitCam();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, fitCam, editingTitle]);

  // ---------------------------------------------------------------- primitives
  const date = new Date(doc.modified).toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-GB');
  const mainScale = d.views.find((v) => v.orientation !== 'iso')?.scale ?? d.views[0]?.scale;
  const contentPrims = useMemo(() => {
    const prims: Prim2D[] = [];
    for (const v of d.views) prims.push(...viewPrims(v, proj(v)));
    for (const dm of d.dimensions) {
      const v = d.views.find((x) => x.id === dm.viewId);
      if (v) prims.push(...dimPrims(dm, v, proj(v), uf));
    }
    prims.push(...notePrims(d));
    return prims;
  }, [d, proj, uf]);
  const titleExtra = { scale: mainScale ? scaleLabel(mainScale) : '—', units: unit, date };
  const allPrims = [...titleBlockPrims(d, titleExtra), ...contentPrims];

  const exportAs = (fmt: 'pdf' | 'svg' | 'dxf') => {
    const name = safeName(`${doc.name} - ${tab.name}`);
    // The current PDF writer uses WinAnsi; keep its service labels representable.
    if (fmt === 'pdf') download(writePDF([{ width: W, height: H, prims: [...titleBlockPrims(d, titleExtra, (key) => key), ...contentPrims] }], { title: d.title }), `${name}.pdf`, 'application/pdf');
    if (fmt === 'svg') download(writeSVG(allPrims, { width: W, height: H, background: '#ffffff' }), `${name}.svg`, 'image/svg+xml');
    if (fmt === 'dxf') download(writeDXF(allPrims, { units: 'mm' }), `${name}.dxf`, 'image/vnd.dxf');
    setMenu(null);
  };

  // live preview of a dimension being placed
  const previewPrims: Prim2D[] = [];
  if (dimDraft && cursor) {
    const v = d.views.find((x) => x.id === dimDraft.viewId);
    const pr = v ? proj(v) : undefined;
    if (v && dimDraft.a) {
      const bm = (dimDraft as DimDraft & { b?: Vec2 }).b;
      if (dimDraft.circle) {
        previewPrims.push(...dimPrims({ id: 'p', viewId: v.id, kind: 'diameter', a: dimDraft.circle.c, b: [dimDraft.circle.c[0] + dimDraft.circle.r, dimDraft.circle.c[1]], offset: 0, textPos: cursor }, v, pr, uf));
      } else if (bm) {
        const a = toSheet(v, pr, dimDraft.a);
        const b = toSheet(v, pr, bm);
        const { kind, offset } = placeLinear(a, b, cursor);
        previewPrims.push(...dimPrims({ id: 'p', viewId: v.id, kind, a: dimDraft.a, b: bm, offset }, v, pr, uf));
      } else {
        const a = toSheet(v, pr, dimDraft.a);
        previewPrims.push({ t: 'line', a, b: cursor, style: 'dimension' });
      }
    }
  }
  const snapHint = tool === 'dimension' && cursor ? snapPoint(cursor) : null;
  const selView = selected?.kind === 'view' ? d.views.find((v) => v.id === selected.id) : undefined;

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
        </div>
        <div className="panel-header">{t('Title block')}</div>
        <div className="drawing-sheet-settings">
          <label className="drawing-field">
            <span>{t('Drawing title')}</span>
            <textarea rows={3} value={d.title} onChange={(e) => upd((dd) => void (dd.title = e.target.value), 'title')} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="drawing-field">
            <span>{t('Designation')}</span>
            <input value={d.designation ?? ''} placeholder={t('Drawing number or part code')} onChange={(e) => upd((dd) => void (dd.designation = e.target.value), 'designation')} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="drawing-field">
            <span>{t('Author')}</span>
            <input value={d.author} onChange={(e) => upd((dd) => void (dd.author = e.target.value), 'author')} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <button className="btn small" onClick={() => setEditingTitle(true)}><Icon name="edit" size={14} />{t('Edit title block')}</button>
          <p className="drawing-panel-hint">{t('Click the title block on the sheet to edit it.')}</p>
        </div>
        <div className="panel-header">
          {t('Views')} <span className="count">({d.views.length})</span>
        </div>
        <div className="panel-body" style={{ flex: 'none' }}>
          {d.views.length === 0 && <p className="drawing-panel-hint">{t('No views yet')}</p>}
          {d.views.map((v) => (
            <div key={v.id} className={'tree-item' + (selected?.id === v.id ? ' selected' : '')} onClick={() => setSelected({ kind: 'view', id: v.id })}>
              <span className="tree-icon">
                <Icon name={v.orientation === 'iso' ? 'isoView' : 'drawingView'} size={16} />
              </span>
              <span className="tree-name">
                {t(VIEW_NAMES[v.orientation])} · {scaleLabel(v.scale)}
              </span>
            </div>
          ))}
        </div>
        {selView && (
          <>
            <div className="panel-header">{t('View properties')}</div>
            <div className="fd-body">
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
              <div className="fd-row">
                <label>{t('Scale')}</label>
                <div className="fd-control">
                  <select
                    value={String(selView.scale)}
                    onChange={(e) =>
                      upd((dd) => {
                        const s = Number(e.target.value);
                        for (const v of dd.views) if (v.id === selView.id || v.parent === selView.id || (selView.parent && (v.id === selView.parent || v.parent === selView.parent))) v.scale = s;
                      })
                    }
                  >
                    {[...new Set([...STD_SCALES, selView.scale])].map((s) => (
                      <option key={s} value={String(s)}>
                        {scaleLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="fd-check">
                <input type="checkbox" checked={selView.showHidden} onChange={(e) => upd((dd) => void (dd.views.find((x) => x.id === selView.id)!.showHidden = e.target.checked))} />
                {t('Show hidden lines')}
              </label>
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
                        <Icon name="drawingView" size={16} /> {t(VIEW_NAMES[o])}
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
          <button className={'icon-btn' + (tool === 'note' ? ' active' : '')} title={t('Note')} onClick={() => setTool('note')}>
            <Icon name="note" />
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
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
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
                  x={titleRect.x0} y={titleRect.y0} width={titleRect.x1 - titleRect.x0} height={TITLE_H}
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
                  <g key={v.id} className={'drawing-view-box' + (sel ? ' selected' : '')}>
                    <rect className="vframe" x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="transparent" stroke="#2f80d1" strokeOpacity={sel ? 1 : 0} strokeWidth={0.4} strokeDasharray="2 1" />
                    {!proj(v) && (
                      <text x={0} y={0} transform={`translate(${v.x} ${v.y}) scale(1 -1)`} fontSize={4} textAnchor="middle" fill="#8a96a3">
                        {t('Computing view…')}
                      </text>
                    )}
                  </g>
                );
              })}
              {selected?.kind === 'dim' &&
                (() => {
                  const dm = d.dimensions.find((x) => x.id === selected.id);
                  const v = dm && d.views.find((x) => x.id === dm.viewId);
                  return dm && v ? dimPrims(dm, v, proj(v), uf).map((p, i) => <PrimSvg key={i} p={p} color="#ff7a00" />) : null;
                })()}
              {previewPrims.map((p, i) => (
                <PrimSvg key={`pv${i}`} p={p} color="#1f6fd1" />
              ))}
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
        </div>
        {editingTitle && <TitleBlockDialog
          drawing={d} extra={{ scale: mainScale ? scaleLabel(mainScale) : '—', units: unit, date }}
          onClose={() => setEditingTitle(false)}
          onSave={(fields) => { upd((dd) => { Object.assign(dd, fields); }); setEditingTitle(false); }}
        />}
        <div className="drawing-status">
          {cursor && `${cursor[0].toFixed(1)}, ${cursor[1].toFixed(1)} mm`} · {tool === 'dimension' ? t('Click two points or a circle, then place the dimension. Shift = radius.') : t('Drag views to move. Wheel to zoom, right/middle drag to pan.')}
        </div>
      </div>
    </>
  );
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
  let axis: Vec2 = kind === 'horizontal' ? [1, 0] : kind === 'vertical' ? [0, 1] : [b[0] - a[0], b[1] - a[1]];
  const l = Math.hypot(axis[0], axis[1]) || 1;
  axis = [axis[0] / l, axis[1] / l];
  const n: Vec2 = [-axis[1], axis[0]];
  const pn = p[0] * n[0] + p[1] * n[1];
  const an = a[0] * n[0] + a[1] * n[1];
  const bn = b[0] * n[0] + b[1] * n[1];
  const offset = pn >= Math.max(an, bn) ? pn - Math.max(an, bn) : pn <= Math.min(an, bn) ? pn - Math.min(an, bn) : pn - Math.max(an, bn);
  return { kind, offset: Math.abs(offset) < 3 ? (offset < 0 ? -8 : 8) : offset };
}
