// Fast custom tooltips replacing the native `title` attribute everywhere in the app.
// Any element with `title` (or `data-tip`) gets a styled tooltip; a trailing "(Shift+E)"
// is rendered as a keyboard shortcut badge.

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
      const below = r.bottom + 40 < window.innerHeight;
      setTip({
        text,
        shortcut,
        x: r.left + r.width / 2,
        y: below ? r.bottom + 6 : r.top - 6,
        placement: below ? 'below' : 'above',
      });
    };
    const onOver = (e: PointerEvent) => {
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
    const onDown = () => hide();
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('wheel', onDown, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('wheel', onDown, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    // keep the tooltip inside the window horizontally (before it is painted): it is centred on `tip.x`
    const el = ref.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = tip.x - w / 2;
    const margin = 4;
    setDx(left < margin ? margin - left : left + w > window.innerWidth - margin ? window.innerWidth - margin - (left + w) : 0);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className={'tooltip ' + tip.placement}
      style={{ left: tip.x + dx, top: tip.y }}
      role="tooltip"
    >
      <span>{tip.text}</span>
      {tip.shortcut && <kbd>{tip.shortcut}</kbd>}
    </div>
  );
}
