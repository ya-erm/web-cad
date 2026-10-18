// A floating panel moved by its header: where it was put is remembered in this browser (per panel) and kept inside
// the area it floats in — also when the window gets smaller. Without a remembered place it stands where its CSS
// puts it.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

type Place = { x: number; y: number };

const storageKey = (key: string) => `webcad.panel.${key}`;

function load(key: string): Place | null {
  try {
    const p = JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null') as Place | null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

/** Keep a place inside the area: the whole panel when it fits, at least its header otherwise. */
export function clampPlace(p: Place, size: { w: number; h: number }, area: { w: number; h: number }, margin = 4): Place {
  const maxX = Math.max(margin, area.w - size.w - margin);
  const maxY = Math.max(margin, area.h - Math.min(size.h, area.h - 2 * margin) - margin);
  return { x: Math.round(Math.min(Math.max(margin, p.x), maxX)), y: Math.round(Math.min(Math.max(margin, p.y), maxY)) };
}

export function useDraggable(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(() => load(key));
  const fit = (p: Place): Place => {
    const el = ref.current;
    const area = el?.offsetParent as HTMLElement | null;
    return el && area ? clampPlace(p, { w: el.offsetWidth, h: el.offsetHeight }, { w: area.clientWidth, h: area.clientHeight }) : p;
  };
  // a remembered place from a bigger window, and the window getting smaller
  useEffect(() => {
    const refit = () => setPlace((p) => (p ? fit(p) : p));
    refit();
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** On the header: drag the panel (not from its buttons and fields). */
  const onPointerDown = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (e.button !== 0 || !el || (e.target as HTMLElement).closest('button, input, select, textarea')) return;
    e.preventDefault();
    const start = { px: e.clientX, py: e.clientY, x: el.offsetLeft, y: el.offsetTop };
    let last: Place = { x: start.x, y: start.y };
    const move = (ev: PointerEvent) => {
      last = fit({ x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py });
      setPlace(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorage.setItem(storageKey(key), JSON.stringify(last));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Back to where the CSS puts it. */
  const reset = () => {
    localStorage.removeItem(storageKey(key));
    setPlace(null);
  };

  // moved: as tall as the space below it allows
  const style: CSSProperties | undefined = place ? { left: place.x, top: place.y, right: 'auto', bottom: 'auto', maxHeight: `calc(100% - ${place.y + 8}px)` } : undefined;
  return { ref, style, onPointerDown, reset };
}
