// The embedded viewer's page (#/embed?parentOrigin=…&channel=…): a model that the site around it sends, shown only —
// the file's name, its tabs (Part Studios, assemblies) and the graphics area with its view controls. No editing, no
// documents of this browser, nothing saved (see embed/mode.ts).

import { useEffect, useMemo, useState } from 'react';
import { useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { startRebuildLoop } from '../store/rebuild';
import { Viewport } from '../ui/Viewport';
import { ContextMenu } from '../ui/Overlays';
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
      </ul>
    </div>
  );
}

function TabPicker() {
  const doc = useDoc((s) => s.doc);
  if (!doc) return null;
  const tabs = viewableTabs(doc);
  if (tabs.length < 2) return null;
  return (
    <select className="embed-tabs" value={doc.activeTab} title={t('Tab')} aria-label={t('Tab')} onChange={(e) => void showTab(e.target.value)}>
      {tabs.map((x) => (
        <option key={x.id} value={x.id}>
          {`${tName(x.name)} · ${t(x.type === 'assembly' ? 'Assembly' : 'Part Studio')}`}
        </option>
      ))}
    </select>
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
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', handleViewerKey);
    session.ready();
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', handleViewerKey);
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
  return (
    <div className="embed">
      <div className="embed-bar">
        <span className="embed-logo" aria-hidden="true">
          ◆
        </span>
        <span className="embed-title" title={v.title}>
          {v.title || 'WebCAD'}
        </span>
        <TabPicker />
        {graphics && <span className="embed-units">{v.units}</span>}
        <button className={'icon-btn' + (hint ? ' active' : '')} title={t('View controls')} onClick={() => setHint(!hint)}>
          <Icon name="help" size={16} />
        </button>
      </div>
      <div className="graphics">
        {graphics && <Viewport key={v.key} />}
        {v.phase === 'waiting' && <Message title={t(kernelReady ? 'Waiting for the model…' : 'Loading geometry kernel…')} />}
        {v.phase === 'error' && <Message icon="warning" title={t('The model could not be opened')} text={v.error} />}
        {v.phase === 'shown' && v.empty && <EmptyNote />}
        {v.phase === 'shown' && v.failedFeatures > 0 && (
          <div className="embed-note" role="status">
            <Icon name="warning" size={14} /> {t('Some features of the document could not be built: the model may be incomplete')}
          </div>
        )}
        {hint && <ControlsHint onClose={() => setHint(false)} />}
        <span className="embed-version">WebCAD {APP_VERSION}</span>
      </div>
      <ContextMenu />
      <TooltipLayer />
    </div>
  );
}
