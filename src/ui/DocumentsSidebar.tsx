import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { t } from '../i18n';
import {
  documentsSidebarWidth,
  loadDocumentsSidebarWidth,
  saveDocumentsSidebarWidth,
  DOCUMENTS_SIDEBAR_DEFAULT,
  DOCUMENTS_SIDEBAR_MIN,
  DOCUMENTS_SIDEBAR_MAX,
} from './documentsSidebarSize';

/** The document navigator resizes independently of the CAD editor and remembers its preferred width. */
export function DocumentsSidebar({ children }: { children: ReactNode }) {
  const [preferred, setPreferred] = useState(loadDocumentsSidebarWidth);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ id: number; x: number; width: number; previous: number; last: number } | null>(null);
  const id = useId();
  const width = documentsSidebarWidth(preferred, viewport);
  const update = (value: number, persist = true) => {
    const next = documentsSidebarWidth(value, window.innerWidth);
    setPreferred(next);
    if (persist) saveDocumentsSidebarWidth(next);
    return next;
  };
  const reset = () => {
    setPreferred(DOCUMENTS_SIDEBAR_DEFAULT);
    saveDocumentsSidebarWidth(null);
  };
  const finish = (cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (cancel) setPreferred(current.previous);
    else saveDocumentsSidebarWidth(current.last);
    setResizing(false);
    document.body.classList.remove('panel-resizing-x');
  };
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (drag.current) document.body.classList.remove('panel-resizing-x');
    };
  }, []);
  useEffect(() => {
    if (!resizing) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(true);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [resizing]);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, width, previous: preferred, last: width };
    setResizing(true);
    document.body.classList.add('panel-resizing-x');
  };
  return (
    <div className="docs-side" id={id} style={{ width }}>
      {children}
      <div
        className={'panel-resizer docs-sidebar-resizer' + (resizing ? ' dragging' : '')}
        role="separator"
        tabIndex={0}
        aria-label={t('Document folders panel width')}
        aria-controls={id}
        aria-orientation="vertical"
        aria-valuemin={DOCUMENTS_SIDEBAR_MIN}
        aria-valuemax={documentsSidebarWidth(DOCUMENTS_SIDEBAR_MAX, viewport)}
        aria-valuenow={width}
        title={t('Drag to resize. Double-click to reset.')}
        onPointerDown={start}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.id === event.pointerId) current.last = update(current.width + event.clientX - current.x, false);
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          finish();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish()}
        onDoubleClick={reset}
        onKeyDown={(event) => {
          if (resizing) return;
          let next: number;
          if (event.key === 'Enter') {
            event.preventDefault();
            reset();
            return;
          }
          if (event.key === 'Home') next = DOCUMENTS_SIDEBAR_MIN;
          else if (event.key === 'End') next = DOCUMENTS_SIDEBAR_MAX;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            next = width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 50 : 10);
          else return;
          event.preventDefault();
          update(next);
        }}
      />
    </div>
  );
}
