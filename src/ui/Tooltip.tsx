// Fast custom tooltips replacing the native `title` attribute everywhere in the app.
// Any element with `title` (or `data-tip`) gets a styled tooltip; a trailing "(Shift+E)"
// is rendered as a keyboard shortcut badge. `data-tip-position="cursor"` follows the pointer.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const SHOW_DELAY = 250;
/** Moving from one tooltipped element to another within this window shows instantly. */
const WARM_WINDOW = 600;

interface TipState {
  text: string;
  shortcut?: string;
  x: number;
  y: number;
  placement: 'below' | 'above';
  cursor?: boolean;
}

function parse(text: string): { text: string; shortcut?: string } {
  const m = /^(.*?)\s*\(([^()]*(?:Shift|Ctrl|Alt|Cmd|Enter|Esc|[A-Z]|\[|\]|\d)[^()]*)\)\s*$/.exec(text);
  if (m && m[2].length <= 14) return { text: m[1], shortcut: m[2] };
  return { text };
}

function tipTarget(el: EventTarget | null): HTMLElement | null {
  let n = el as HTMLElement | null;
  while (n && n !== document.body) {
    if (n.nodeType === 1) {
      if (n.hasAttribute('title')) {
        const t = n.getAttribute('title');
        n.removeAttribute('title');
        if (t) {
          n.setAttribute('data-tip', t);
          // keep the accessible name the title used to provide (icon-only buttons)
          if (!n.hasAttribute('aria-label') && !n.textContent?.trim()) n.setAttribute('aria-label', t);
        }
      }
      if (n.hasAttribute('data-tip')) return n.getAttribute('data-tip') ? n : null;
    }
    n = n.parentElement;
  }
  return null;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const lastHidden = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      if (current.current) lastHidden.current = performance.now();
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      if (!document.body.contains(el)) return;
      const r = el.getBoundingClientRect();
      const { text, shortcut } = parse(el.getAttribute('data-tip') ?? '');
      const cursor = el.dataset.tipPosition === 'cursor';
      const below = cursor || r.bottom + 40 < window.innerHeight;
      setTip({
        text,
        shortcut,
        x: cursor ? pointer.current.x : r.left + r.width / 2,
        y: cursor ? pointer.current.y : below ? r.bottom + 6 : r.top - 6,
        cursor,
        placement: below ? 'below' : 'above',
      });
    };
    const onOver = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (e.buttons) {
        hide();
        return;
      }
      const el = tipTarget(e.target);
      if (el === current.current) return;
      clear();
      if (!el) {
        if (current.current) hide();
        return;
      }
      const warm = !!current.current || performance.now() - lastHidden.current < WARM_WINDOW;
      current.current = el;
      setTip(null);
      if (warm) show(el);
      else timer.current = setTimeout(() => show(el), SHOW_DELAY);
    };
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const el = tipTarget(e.target);
      if (el?.dataset.tipPosition !== 'cursor') return;
      if (e.buttons) {
        hide();
        return;
      }
      if (el !== current.current) {
        onOver(e);
        return;
      }
      // Moving during the show delay updates the anchor without bypassing the delay.
      setTip((shown) => (shown ? { ...shown, x: e.clientX, y: e.clientY } : shown));
    };
    const onDown = () => hide();
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('wheel', onDown, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      clear();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('wheel', onDown, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    // keep the tooltip inside the window horizontally (before it is painted): it is centred on `tip.x`
    const el = ref.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = tip.x - w / 2;
    const margin = 4;
    if (tip.cursor) {
      const h = el.offsetHeight;
      const x = tip.x + 14 + w <= window.innerWidth - margin ? tip.x + 14 : tip.x - w - 14;
      const y = tip.y + 16 + h <= window.innerHeight - margin ? tip.y + 16 : tip.y - h - 12;
      setOffset({
        x: Math.max(margin, Math.min(x, window.innerWidth - w - margin)) - tip.x,
        y: Math.max(margin, Math.min(y, window.innerHeight - h - margin)) - tip.y,
      });
    } else {
      setOffset({
        x: left < margin ? margin - left : left + w > window.innerWidth - margin ? window.innerWidth - margin - (left + w) : 0,
        y: 0,
      });
    }
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className={'tooltip ' + (tip.cursor ? 'cursor' : tip.placement)}
      style={{ left: tip.x + offset.x, top: tip.y + offset.y }}
      role="tooltip"
    >
      <span>{tip.text}</span>
      {tip.shortcut && <kbd>{tip.shortcut}</kbd>}
    </div>
  );
}
