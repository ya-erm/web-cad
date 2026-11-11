// The panel at the left of a Part Studio or an assembly: two lists one above the other (Features over Parts,
// Instances over Mates). Its right edge is dragged to change its width, the line between the lists to give one of
// them more height; a double-click on either puts the usual size back. Both are remembered in this browser.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clampSplit, clampWidth, DEFAULT_SPLIT, loadSplit, loadWidth, saveSplit, saveWidth, type SplitKind } from './panelSize';

/**
 * Follow the pointer from a press on a handle until it is let go. The handle captures the pointer, so the
 * graphics area and the lists under it don't react on the way; the cursor stays the handle's everywhere.
 */
function drag(e: ReactPointerEvent<HTMLElement>, axis: 'x' | 'y', move: (ev: PointerEvent) => void, done: () => void) {
  const handle = e.currentTarget;
  const cursor = `panel-resizing-${axis}`;
  handle.setPointerCapture(e.pointerId);
  handle.classList.add('dragging');
  document.body.classList.add(cursor);
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('lostpointercapture', end);
    handle.classList.remove('dragging');
    document.body.classList.remove(cursor);
    done();
  };
  handle.addEventListener('pointermove', move);
  // let go, cancelled or taken away: the capture ends in each case
  handle.addEventListener('lostpointercapture', end);
}

export function LeftPanel({ kind, top, bottom }: { kind: SplitKind; top: ReactNode; bottom: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(loadWidth);
  const [split, setSplit] = useState(() => loadSplit(kind));
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  // a width set in a wider window leaves the graphics area room in a narrower one (and comes back when it widens)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onWidthDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const panel = ref.current;
    if (e.button !== 0 || !panel) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = panel.offsetWidth;
    let last = w0;
    drag(
      e,
      'x',
      (ev) => setWidth((last = clampWidth(w0 + ev.clientX - x0, window.innerWidth))),
      () => last !== w0 && saveWidth(last),
    );
  };

  const onSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const above = e.currentTarget.previousElementSibling as HTMLElement | null;
    const below = e.currentTarget.nextElementSibling as HTMLElement | null;
    if (e.button !== 0 || !above || !below) return;
    e.preventDefault();
    const y0 = above.getBoundingClientRect().top;
    const total = above.offsetHeight + below.offsetHeight;
    let last: number | null = null;
    drag(
      e,
      'y',
      (ev) => setSplit((last = clampSplit((ev.clientY - y0) / total, total))),
      () => last != null && saveSplit(kind, last),
    );
  };

  const share = split ?? DEFAULT_SPLIT[kind];
  const style = {
    width: width == null ? undefined : clampWidth(width, windowWidth),
    '--split-top': String(share),
    '--split-bottom': String(Math.round((1 - share) * 1000) / 1000),
  } as CSSProperties;
  return (
    <div className="left-panel" ref={ref} style={style}>
      {top}
      <div
        className="panel-splitter"
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={onSplitDown}
        onDoubleClick={() => {
          saveSplit(kind, null);
          setSplit(null);
        }}
      />
      {bottom}
      <div
        className="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onWidthDown}
        onDoubleClick={() => {
          saveWidth(null);
          setWidth(null);
        }}
      />
    </div>
  );
}
