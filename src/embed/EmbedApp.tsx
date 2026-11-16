// The embedded viewer's page (#/embed?parentOrigin=…&channel=…): a model that the site around it sends, shown only —
// the file's name, the graphics area with its view controls and the tabs under it (Part Studios, assemblies, drawings). No editing, no
// documents of this browser, nothing saved (see embed/mode.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { activeTab, useDoc } from '../store/docStore';
import { SheetView } from './SheetView';
import { setRotationMode, useEditor } from '../store/editorStore';
import { startRebuildLoop } from '../store/rebuild';
import { Viewport } from '../ui/Viewport';
import { ContextMenu, MeasureRows } from '../ui/Overlays';
import { measureSelection } from './measure';
import type { Measured } from './meshMeasure';
import { TooltipLayer } from '../ui/Tooltip';
import { Icon } from '../ui/icons';
import { handleViewerKey } from '../ui/keyboard';
import { APP_VERSION } from '../ui/version';
import { t, tName } from '../i18n';
import { embedParams } from './protocol';
import { EmbedSession } from './session';
import { viewableTabs } from './model';
import { showFile, showTab, useViewer } from './show';

/** How the view is turned, moved and zoomed (mouse and touch). */
function ControlsHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="embed-hint" role="dialog" aria-label={t('View controls')}>
      <div className="embed-hint-head">
        {t('View controls')}
        <button className="icon-btn" title={t('Close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <ul>
        <li>{t('Turn: drag with the left or right button, or with one finger')}</li>
        <li>{t('Move: drag with the middle button or Shift + left button, or with two fingers')}</li>
        <li>{t('Zoom: the mouse wheel or pinch')}</li>
        <li>{t('The whole model: the Zoom to fit button or F; standard views: the cube and the Views menu')}</li>
        <li>{t('The turntable button keeps the Z axis upright while turning')}</li>
        <li>{t('The ruler button measures: click faces, edges and vertices')}</li>
        <li>{t('Drawings: drag or two fingers move the sheet, the wheel or a pinch zooms it, a double click shows it whole')}</li>
      </ul>
    </div>
  );
}

/** Measuring: what to click (and a button that drops the selection). */
function MeasureHint() {
  const selected = useEditor((s) => s.selection.length > 0);
  return (
    <div className="embed-measure-hint" role="status">
      <Icon name="measure" size={14} />
      <span>{t(selected ? 'One more — the distance and angle; a click on a selected one drops it' : 'Click a face, an edge or a vertex; two of them — the distance between them')}</span>
      {selected && (
        <button className="icon-btn" title={t('Clear selection')} aria-label={t('Clear selection')} onClick={() => useEditor.getState().clearSelection()}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** Measuring: the values of the selection (one — its size, two — the distance and angle between them) or the model's overall size. */
function MeasureResults() {
  const selection = useEditor((s) => s.selection);
  const build = useEditor((s) => s.build);
  const units = useViewer((s) => s.units);
  const [res, setRes] = useState<Measured | null>(null);
  useEffect(() => {
    let cancelled = false;
    measureSelection(selection)
      .then((r) => !cancelled && setRes(r))
      .catch((e) => {
        console.warn('The embedded viewer could not measure the selection', e);
        if (!cancelled) setRes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selection, build]);
  if (!res || !res.items.length) return null;
  return (
    <MeasureRows
      res={res}
      units={units}
      selection={selection}
      top={
        !selection.length && (
          <div className="mrow mhead">
            <span>{t('Overall size of the model')}</span>
          </div>
        )
      }
    />
  );
}

/** The document's tabs that can be shown, under the graphics area as in WebCAD itself (a single tab — no strip). */
function TabStrip() {
  const doc = useDoc((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  const active = doc?.activeTab;
  // the open tab stays in sight when the strip is wider than the window (scrolled here: scrollIntoView could move
  // the page around the frame too)
  useEffect(() => {
    const strip = ref.current;
    const tab = strip?.querySelector<HTMLElement>('.tab.active');
    if (!strip || !tab) return;
    if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth - strip.clientWidth;
  }, [active]);
  if (!doc) return null;
  const tabs = viewableTabs(doc);
  if (tabs.length < 2) return null;
  return (
    <div className="embed-tabbar" role="tablist" aria-label={t('Tabs')} ref={ref}>
      {tabs.map((x) => {
        const open = x.id === doc.activeTab;
        return (
          <button
            key={x.id}
            role="tab"
            aria-selected={open}
            className={'tab' + (open ? ' active' : '')}
            title={`${tName(x.name)} · ${t(x.type === 'assembly' ? 'Assembly' : x.type === 'drawing' ? 'Drawing' : 'Part Studio')}`}
            onClick={() => !open && void showTab(x.id)}
          >
            <Icon name={x.type} size={14} />
            {tName(x.name)}
          </button>
        );
      })}
    </div>
  );
}

/** A message over the graphics area: nothing sent yet, a file that cannot be shown, an empty tab. */
function Message({ icon, title, text }: { icon?: 'warning'; title: string; text?: string }) {
  return (
    <div className="embed-message" role={icon ? 'alert' : 'status'}>
      <div className="loading-card">
        {icon ? <Icon name={icon} size={28} /> : <div className="loading-spinner" />}
        <div className="embed-message-title">{title}</div>
        {text && <div className="embed-message-text">{text}</div>}
      </div>
    </div>
  );
}

function EmptyNote() {
  const asm = useDoc((s) => s.doc?.tabs.find((x) => x.id === s.doc?.activeTab)?.type === 'assembly');
  return (
    <div className="embed-message embed-empty" role="status">
      <div className="loading-card">
        <div className="embed-message-title">{t(asm ? 'This assembly has no parts to show' : 'This tab has no parts or sketches to show')}</div>
      </div>
    </div>
  );
}

export default function EmbedApp() {
  const params = useMemo(() => embedParams(location.hash, import.meta.env.DEV), []);
  const framed = window.parent !== window;
  const v = useViewer();
  const kernelReady = useEditor((s) => s.kernelReady);
  const turntable = useEditor((s) => s.rotationMode === 'turntable');
  const drawing = useDoc((s) => activeTab(s.doc)?.type === 'drawing');
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!params || !framed) return;
    // the kernel starts loading now, while the page around fetches the file
    startRebuildLoop();
    // the model alone: the default planes stay hidden (P shows them)
    useEditor.setState({ showPlanes: false });
    const session = new EmbedSession(params, window.parent, {
      post: (msg) => window.parent.postMessage(msg, params.parentOrigin),
      show: showFile,
    });
    const onMessage = (e: MessageEvent) => void session.receive(e);
    // the view's keys; Esc drops the selection
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditor.getState().clearSelection();
      else handleViewerKey(e);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    session.ready();
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, [params, framed]);

  useEffect(() => {
    document.title = v.title ? `${v.title} — WebCAD` : 'WebCAD';
  }, [v.title]);

  if (!params || !framed)
    return (
      <div className="embed embed-denied">
        <Message
          icon="warning"
          title={t('The embedded viewer of WebCAD')}
          text={t(framed ? 'This site is not allowed to show models in WebCAD.' : 'It shows models inside the sites that embed WebCAD. To work with your documents, open WebCAD itself.')}
        />
        {!framed && (
          <a className="btn primary embed-open" href="./">
            {t('Open WebCAD')}
          </a>
        )}
      </div>
    );

  const graphics = v.phase === 'loading' || v.phase === 'shown';
  // a drawing: its sheet instead of the 3D view (no turning, measuring is the model's)
  const measuring = v.measuring && !drawing;
  return (
    <div className="embed">
      <div className="embed-bar">
        <span className="embed-logo" aria-hidden="true">
          ◆
        </span>
        <span className="embed-title" title={v.title}>
          {v.title || 'WebCAD'}
        </span>
        {graphics && <span className="embed-units">{v.units}</span>}
        <button
          className={'icon-btn' + (turntable ? ' active' : '')}
          title={t(turntable ? 'Rotation about the vertical (Z up): click for free rotation' : 'Free rotation: click to keep the Z axis upright')}
          aria-pressed={turntable}
          disabled={drawing}
          onClick={() => setRotationMode(turntable ? 'free' : 'turntable')}
        >
          <Icon name="rotateLeft" size={16} />
        </button>
        <button
          className={'icon-btn' + (measuring ? ' active' : '')}
          title={t('Measure')}
          aria-pressed={measuring}
          disabled={!graphics || drawing}
          onClick={() => {
            // measuring ends with its selection
            if (v.measuring) useEditor.getState().clearSelection();
            useViewer.setState({ measuring: !v.measuring });
          }}
        >
          <Icon name="measure" size={16} />
        </button>
        <button className={'icon-btn' + (hint ? ' active' : '')} title={t('View controls')} onClick={() => setHint(!hint)}>
          <Icon name="help" size={16} />
        </button>
      </div>
      <div className="graphics">
        {graphics &&
          (!drawing ? <Viewport key={v.key} /> : v.sheet ? <SheetView key={v.key} sheet={v.sheet} viewKey={v.key} /> : <Message title={t('Drawing the sheet…')} />)}
        <div className="embed-corner">
          {v.phase === 'shown' && measuring && <MeasureHint />}
          {hint && <ControlsHint onClose={() => setHint(false)} />}
        </div>
        {v.phase === 'shown' && measuring && <MeasureResults />}
        {v.phase === 'waiting' && <Message title={t(kernelReady ? 'Waiting for the model…' : 'Loading geometry kernel…')} />}
        {v.phase === 'error' && <Message icon="warning" title={t('The model could not be opened')} text={v.error} />}
        {v.phase === 'shown' && v.empty && <EmptyNote />}
        {v.phase === 'shown' && v.failedFeatures > 0 && (
          <div className="embed-note" role="status">
            <Icon name="warning" size={14} /> {t('Some features of the document could not be built: the model may be incomplete')}
          </div>
        )}
        <span className="embed-version">WebCAD {APP_VERSION}</span>
      </div>
      <TabStrip />
      <ContextMenu />
      <TooltipLayer />
    </div>
  );
}
