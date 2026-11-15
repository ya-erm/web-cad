// A drawing's sheet in the embedded viewer: its SVG (the writer's, sanitized) in the page, crisp at any zoom — the
// view is the SVG's viewBox. Drag (a finger) moves the sheet, the wheel and a pinch zoom it, a double click or the
// button shows it whole.

import { useEffect, useRef } from 'react';
import { Icon } from '../ui/icons';
import { t } from '../i18n';
import { useViewer, type SheetImage } from './show';

/** What a sheet's SVG may have: shapes and text (no scripts, links, foreign content or event handlers). */
const ALLOWED = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan']);

/** The sheet's SVG as an element of this page: anything but shapes and text left out. */
function sheetElement(svg: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length) throw new Error('The sheet could not be drawn');
  const clean = (el: Element) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /href$/i.test(a.name)) el.removeAttribute(a.name);
  };
  clean(root);
  for (const el of [...root.querySelectorAll('*')]) {
    if (!ALLOWED.has(el.localName)) el.remove();
    else clean(el);
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

/** Around the sheet when it is shown whole, mm. */
const MARGIN = 8;

export function SheetView({ sheet, viewKey }: { sheet: SheetImage; viewKey: string }) {
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** The view: the sheet point (SVG units, Y down) in the middle, pixels per mm; `fit` — of the whole sheet. */
  const cam = useRef({ cx: sheet.width / 2, cy: -sheet.height / 2, scale: 1, fit: 1 });

  const apply = () => {
    const el = host.current;
    const svg = svgRef.current;
    if (!el || !svg) return;
    const c = cam.current;
    const w = el.clientWidth / c.scale;
    const h = el.clientHeight / c.scale;
    svg.setAttribute('viewBox', `${c.cx - w / 2} ${c.cy - h / 2} ${w} ${h}`);
  };
  const fit = () => {
    const el = host.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / (sheet.width + 2 * MARGIN), el.clientHeight / (sheet.height + 2 * MARGIN)) || 1;
    cam.current = { cx: sheet.width / 2, cy: -sheet.height / 2, scale, fit: scale };
    apply();
  };
  /** Zoom by `k` about a point of the host (pixels). */
  const zoomAt = (k: number, x: number, y: number) => {
    const el = host.current;
    if (!el) return;
    const c = cam.current;
    const scale = Math.min(c.fit * 80, Math.max(c.fit / 4, c.scale * k));
    const px = c.cx + (x - el.clientWidth / 2) / c.scale;
    const py = c.cy + (y - el.clientHeight / 2) / c.scale;
    cam.current = { ...c, scale, cx: px - (x - el.clientWidth / 2) / scale, cy: py - (y - el.clientHeight / 2) / scale };
    apply();
  };
  const pan = (dx: number, dy: number) => {
    const c = cam.current;
    cam.current = { ...c, cx: c.cx - dx / c.scale, cy: c.cy - dy / c.scale };
    apply();
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let svg: SVGSVGElement;
    try {
      svg = sheetElement(sheet.svg);
    } catch (e) {
      console.error('The embedded viewer could not show the sheet', e);
      return;
    }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('class', 'embed-sheet-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    el.replaceChildren(svg);
    svgRef.current = svg;
    fit();
    // a new size keeps the zoom and the middle of the view
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    useViewer.setState({ sheetShown: viewKey });
    // pointers: one drags the sheet, two move and pinch it
    const pts = new Map<number, { x: number; y: number }>();
    const local = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, local(e));
      el.setPointerCapture?.(e.pointerId);
      if (e.button === 1) e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, p);
        const [c, d] = [...pts.values()];
        const m1 = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        pan(m1.x - m0.x, m1.y - m0.y);
        if (d0 > 1 && d1 > 1) zoomAt(d1 / d0, m1.x, m1.y);
        return;
      }
      pts.set(e.pointerId, p);
      pan(p.x - prev.x, p.y - prev.y);
    };
    const up = (e: PointerEvent) => void pts.delete(e.pointerId);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      zoomAt(Math.exp(-delta * 0.0015), p.x, p.y);
    };
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && target?.tagName !== 'SELECT') fit();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    const menu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener('dblclick', fit);
    el.addEventListener('contextmenu', menu);
    window.addEventListener('keydown', key);
    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', fit);
      el.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', key);
      el.replaceChildren();
      svgRef.current = null;
    };
    // (the sheet and its key make the view; the helpers read the refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, viewKey]);

  return (
    <>
      <div className="embed-sheet" ref={host} role="img" aria-label={t('Drawing')} />
      <div className="view-menu embed-sheet-tools">
        <button className="icon-btn" title={`${t('Zoom to fit')} (F)`} onClick={fit}>
          <Icon name="zoomFit" size={18} />
        </button>
      </div>
    </>
  );
}
