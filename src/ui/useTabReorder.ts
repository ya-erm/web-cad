import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

interface DropTarget { id: string; after: boolean; vertical: boolean }
interface Drag {
  id: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: DropTarget | null;
}

/** Pointer capture works on desktop and on touch grips; documents change only after a valid drop. */
export function useTabReorder(documentId: string, enabled: boolean, commit: (source: string, target: string, after: boolean, inList: boolean) => void, openList: () => void) {
  const [view, setView] = useState<{ source: string | null; target: DropTarget | null }>({ source: null, target: null });
  const drag = useRef<Drag | null>(null);
  const ignoreClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const frame = useRef(0);
  const latest = useRef({ documentId, enabled, commit, openList });
  latest.current = { documentId, enabled, commit, openList };
  const finish = (save: boolean, render = true) => {
    const current = drag.current;
    drag.current = null;
    cleanup.current?.(); cleanup.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    document.body.classList.remove('tab-reordering');
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (render) setView({ source: null, target: null });
    if (save && current?.active && current.target && latest.current.enabled)
      latest.current.commit(current.id, current.target.id, current.target.after, current.target.vertical);
  };
  useEffect(() => () => finish(false, false), [documentId]);
  useEffect(() => {
    const clearClick = () => { ignoreClick.current = false; };
    document.addEventListener('pointerdown', clearClick, true);
    return () => document.removeEventListener('pointerdown', clearClick, true);
  }, []);
  useEffect(() => { if (!enabled) finish(false); }, [enabled]);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary || drag.current || !enabled || (event.target as HTMLElement).closest('input')) return;
    // Touching names still scrolls the strip/list; only the explicit grip claims the gesture.
    if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('.tab-drag-handle')) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    drag.current = { id, pointerId: event.pointerId, element, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null };
    const owner = documentId;
    const targetAtPointer = () => {
      const current = drag.current;
      if (!current?.active) return;
      const hit = document.elementFromPoint(current.x, current.y) as HTMLElement | null;
      if (hit?.closest('[data-tab-list-toggle]')) latest.current.openList();
      let row = hit?.closest<HTMLElement>('[data-reorder-tab]') ?? null;
      const surface = hit?.closest<HTMLElement>('.document-tab-strip, .document-tab-list');
      if (!row && surface) {
        const rows = [...surface.querySelectorAll<HTMLElement>('[data-reorder-tab]')];
        const vertical = surface.classList.contains('document-tab-list');
        row = rows.find((item) => {
          const r = item.getBoundingClientRect();
          return vertical ? current.y < r.bottom : current.x < r.right;
        }) ?? rows.at(-1) ?? null;
      }
      let target: DropTarget | null = null;
      if (row?.closest<HTMLElement>('[data-reorder-doc]')?.dataset.reorderDoc === owner && row.dataset.reorderTab !== id) {
        const r = row.getBoundingClientRect(), vertical = row.dataset.reorderVertical === 'true';
        target = { id: row.dataset.reorderTab!, vertical, after: vertical ? current.y > r.y + r.height / 2 : current.x > r.x + r.width / 2 };
      }
      current.target = target;
      setView((previous) => previous.source === id && previous.target?.id === target?.id && previous.target?.after === target?.after && previous.target?.vertical === target?.vertical ? previous : { source: id, target });
    };
    const autoScroll = () => {
      frame.current = 0;
      const current = drag.current;
      if (!current?.active) return;
      const hit = document.elementFromPoint(current.x, current.y) as HTMLElement | null;
      const surface = hit?.closest<HTMLElement>('.document-tab-strip, .document-tab-list');
      if (!surface) return;
      const vertical = surface.classList.contains('document-tab-list'), r = surface.getBoundingClientRect();
      const point = vertical ? current.y : current.x, start = vertical ? r.top : r.left, end = vertical ? r.bottom : r.right;
      const delta = point < start + 30 ? -12 : point > end - 30 ? 12 : 0;
      const previous = vertical ? surface.scrollTop : surface.scrollLeft;
      if (vertical) surface.scrollTop += delta;
      else surface.scrollLeft += delta;
      if ((vertical ? surface.scrollTop : surface.scrollLeft) !== previous) {
        targetAtPointer();
        frame.current = requestAnimationFrame(autoScroll);
      }
    };
    const move = (e: PointerEvent) => {
      const current = drag.current;
      if (!current || e.pointerId !== current.pointerId) return;
      if (latest.current.documentId !== owner || !latest.current.enabled) { finish(false); return; }
      current.x = e.clientX; current.y = e.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return;
      current.active = true;
      ignoreClick.current = true;
      document.body.classList.add('tab-reordering');
      e.preventDefault();
      targetAtPointer();
      if (!frame.current) frame.current = requestAnimationFrame(autoScroll);
    };
    const up = (e: PointerEvent) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      if (drag.current.active) { drag.current.x = e.clientX; drag.current.y = e.clientY; targetAtPointer(); }
      finish(true);
    };
    const cancel = (e: PointerEvent) => { if (drag.current?.pointerId === e.pointerId) finish(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    const blur = () => finish(false);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', blur);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    document.addEventListener('keydown', escape, true);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      element.removeEventListener('lostpointercapture', blur);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
      document.removeEventListener('keydown', escape, true);
    };
  };
  const onClickCapture = (event: ReactMouseEvent) => {
    if (!ignoreClick.current || event.detail === 0) return;
    ignoreClick.current = false;
    event.preventDefault(); event.stopPropagation();
  };
  return { ...view, dragging: drag, onPointerDown, onClickCapture };
}
