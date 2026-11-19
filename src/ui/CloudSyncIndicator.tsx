import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCloudSync } from '../cloud/syncState';
import { openCloudDocument } from '../cloud/client';
import { useDoc } from '../store/docStore';
import { t } from '../i18n';
import { CloudUploadDialog } from './CloudLibrary';
import { documentTime } from './documentTime';
import { Icon, type IconName } from './icons';

const LABELS = {
  signed_out: 'Sign in to sync documents.',
  paused: 'Cloud sync is paused',
  waiting: 'Waiting to sync',
  syncing: 'Syncing with cloud',
  offline: 'Offline; sync will resume when connected.',
  error: 'Cloud sync failed',
  conflict: 'Cloud changes need your attention.',
  synced: 'Synced with cloud',
} as const;

/** A compact account neighbour; editing remains available in every sync state. */
export function CloudSyncIndicator() {
  const sync = useCloudSync();
  const docs = useDoc((s) => s.docs);
  const active = useDoc((s) => s.doc);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const attention = sync.conflicts.length > 0 || sync.remoteChanges.length > 0;
  const phase = sync.accountId && !sync.enabled ? 'paused' : sync.phase;
  const label = attention && (phase === 'synced' || phase === 'waiting') ? LABELS.conflict : LABELS[phase];
  const nameOf = (id: string) => docs.find((d) => d.id === id)?.name ?? (active?.id === id ? active.name : t('Untitled document'));
  const mark: IconName | null =
    phase === 'synced' && !attention
      ? 'check'
      : phase === 'paused'
        ? 'pause'
        : phase === 'error' || phase === 'conflict' || attention
          ? 'warning'
          : phase === 'offline'
            ? 'close'
            : phase === 'waiting'
              ? 'history'
              : null;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      details.current.open = false;
      summary.current?.focus();
    };
    const resized = () => {
      if (details.current) details.current.open = false;
    };
    window.addEventListener('resize', resized);
    window.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', resized);
      window.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
  useEffect(() => {
    setUpload(null);
    setExpanded(false);
    setNotice('');
    setOpening(null);
    if (details.current) details.current.open = false;
  }, [sync.accountId]);
  useLayoutEffect(() => {
    if (!expanded || !popup.current || !summary.current) return;
    const anchor = summary.current.getBoundingClientRect(),
      box = popup.current.getBoundingClientRect();
    Object.assign(popup.current.style, {
      position: 'fixed',
      right: 'auto',
      left: Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8)) + 'px',
      top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - box.height - 8)) + 'px',
    });
  }, [expanded, sync.phase, sync.pending, sync.conflicts, sync.remoteChanges, notice, opening]);
  const resolve = (id: string) => {
    if (details.current) details.current.open = false;
    setUpload(id);
  };
  const openRemote = async (id: string) => {
    const owner = sync.accountId,
      doc = useDoc.getState().docs.find((d) => d.id === id);
    if (!owner || !doc?.cloudSource || doc.cloudSource.userId !== owner) return;
    setOpening(id);
    setNotice('');
    try {
      const opened = await openCloudDocument(doc.cloudSource.documentId);
      if (useCloudSync.getState().accountId !== owner) return;
      useCloudSync.getState().retry(id);
      if (details.current) details.current.open = false;
      location.hash = '#/doc/' + opened;
    } catch {
      if (useCloudSync.getState().accountId === owner) setNotice('Cloud is unavailable. Local documents are safe.');
    } finally {
      setOpening(null);
    }
  };
  return (
    <>
      <details
        className={'cloud-sync-menu phase-' + phase + (attention ? ' needs-attention' : '')}
        ref={details}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary ref={summary} title={t(label)} aria-label={`${t('Cloud sync')}: ${t(label)}`}>
          <span className="cloud-sync-symbol" aria-hidden="true">
            <Icon name="cloud" size={18} />
            {phase === 'syncing' ? (
              <span className="cloud-sync-mark spinner" />
            ) : (
              mark && (
                <span className="cloud-sync-mark">
                  <Icon name={mark} size={10} />
                </span>
              )
            )}
          </span>
        </summary>
        {expanded && (
          <div ref={popup} className="dropdown cloud-sync-dropdown" role="dialog" aria-label={t('Cloud sync')}>
            <div className="cloud-sync-title">
              <span>{t('Cloud sync')}</span>
              <button
                className="icon-btn"
                title={t('Close')}
                onClick={() => {
                  if (details.current) details.current.open = false;
                  summary.current?.focus();
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
            <div className="cloud-sync-status" role="status">
              {t(label)}
            </div>
            <label className="cloud-sync-toggle">
              <input type="checkbox" checked={sync.enabled} onChange={(event) => sync.setEnabled(event.target.checked)} />
              {t('Automatic cloud sync')}
            </label>
            <div className="cloud-sync-note">{t('Browser documents; computer folders stay separate.')}</div>
            {sync.accountId && (
              <>
                <dl className="cloud-sync-details">
                  <div>
                    <dt>{t('Queued')}</dt>
                    <dd>{sync.pending}</dd>
                  </div>
                  {sync.currentDocId && (
                    <div>
                      <dt>{t('Uploading')}</dt>
                      <dd>{nameOf(sync.currentDocId)}</dd>
                    </div>
                  )}
                  {sync.lastSyncedAt && (
                    <div>
                      <dt>{t('Last synced')}</dt>
                      <dd>{documentTime(sync.lastSyncedAt)}</dd>
                    </div>
                  )}
                </dl>
                {sync.error && (phase === 'error' || phase === 'conflict') && (
                  <div className="cloud-sync-error" role="alert">
                    {t(sync.error)}
                  </div>
                )}
                {sync.conflicts.map((id) => (
                  <div className="cloud-sync-item" key={'conflict:' + id}>
                    <b>{nameOf(id)}</b>
                    <span>{t('Local and cloud versions differ.')}</span>
                    <button className="btn small" disabled={!!opening || phase === 'offline'} onClick={() => resolve(id)}>
                      {t('Choose cloud version…')}
                    </button>
                  </div>
                ))}
                {sync.conflicts.length > 0 && (
                  <div className="cloud-sync-note">
                    {t('Confirm replacement when uploading. A separate copy may leave the original conflict unresolved.')}
                  </div>
                )}
                {sync.remoteChanges.map((id) => (
                  <div className="cloud-sync-item" key={'remote:' + id}>
                    <b>{nameOf(id)}</b>
                    <span>{t('A newer version is in the cloud.')}</span>
                    <button className="btn small" disabled={!!opening || phase === 'offline'} onClick={() => void openRemote(id)}>
                      <Icon name="download" size={13} />
                      {t(opening === id ? 'Opening…' : 'Open cloud version')}
                    </button>
                  </div>
                ))}
                {sync.enabled && (
                  <button
                    className="btn small cloud-sync-retry"
                    disabled={phase === 'syncing' || phase === 'offline' || !!opening}
                    onClick={() => sync.retry()}
                  >
                    <Icon name="refresh" size={13} />
                    {t('Retry sync')}
                  </button>
                )}
              </>
            )}
            {notice && (
              <div className="cloud-sync-error" role="alert">
                {t(notice)}
              </div>
            )}
          </div>
        )}
      </details>
      {upload && (
        <CloudUploadDialog
          initial={[upload]}
          initialFolder={docs.find((d) => d.id === upload)?.folderId ?? ''}
          onClose={() => setUpload(null)}
          onComplete={() => useCloudSync.getState().retry(upload)}
        />
      )}
    </>
  );
}
