import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Icon } from './icons';
import { LibraryFolderDialog, LibraryFolderGrid, LibraryMoveDialog, LibraryPath } from './LibraryFolders';
import { folderTrail, type LibraryFolder } from '../store/library';
import { useDoc } from '../store/docStore';
import { useFolder } from '../store/folderStore';
import { listLibraryFolders } from '../store/persistence';
import {
  CloudFailure,
  listCloud,
  saveCloudFolder,
  deleteCloudFolder,
  moveCloudDocument,
  openCloudDocument,
  uploadCloudDocument,
  type CloudList,
  type CloudDocument,
} from '../cloud/client';

function errorText(error: unknown): string {
  if (error instanceof CloudFailure) {
    const messages: Record<string, string> = {
      sign_in_required: 'Sign in to use cloud documents.',
      revision_conflict: 'This document already exists or has changed. Refresh the list or upload a separate copy.',
      folder_not_empty: 'Only empty folders can be deleted',
      folder_name_exists: 'A folder with this name already exists',
      folder_cycle: 'A folder cannot contain itself',
      folder_not_found: 'Folder not found',
    };
    return t(messages[error.code] ?? 'Cloud is unavailable. Local documents are safe.');
  }
  return t(error instanceof Error && !(error instanceof TypeError) ? error.message : 'Cloud is unavailable. Local documents are safe.');
}

export function CloudLibrary({ onOpen, onUpload }: { onOpen: (id: string) => void; onUpload: () => void }) {
  const [data, setData] = useState<CloudList | null>(null),
    [path, setPath] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<LibraryFolder | 'new' | null>(null),
    [moving, setMoving] = useState<CloudDocument | null>(null);
  const requestEpoch = useRef(0);
  const refresh = async () => {
    const epoch = ++requestEpoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await listCloud();
      if (epoch === requestEpoch.current) setData(result);
    } catch (e) {
      if (epoch === requestEpoch.current) {
        setError(errorText(e));
        setData(null);
      }
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  };
  useEffect(() => {
    const changed = () => {
      setData(null);
      void refresh();
    };
    void refresh();
    window.addEventListener('webcad:account-changed', changed);
    return () => {
      requestEpoch.current++;
      window.removeEventListener('webcad:account-changed', changed);
    };
  }, []);
  const explain = (e: unknown): never => {
    throw new Error(errorText(e));
  };
  const current = data?.folders.some((f) => f.id === path) ? path : '';
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="library-toolbar">
        <button className="btn small" disabled={busy} onClick={() => void refresh()}>
          <Icon name="refresh" size={14} />
          {t('Refresh')}
        </button>
        {data && (
          <>
            <button className="btn small" disabled={busy} onClick={() => setEdit('new')}>
              <Icon name="folder" size={14} />
              {t('New folder')}
            </button>
            <button className="btn primary small" onClick={onUpload}>
              <Icon name="upload" size={14} />
              {t('Upload documents…')}
            </button>
          </>
        )}
      </div>
      <div className="docs-hint">{t('Cloud uploads are optional. Local autosave does not upload changes yet.')}</div>
      {error && (
        <div className="docs-error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <div className="docs-hint" role="status">
          {t('Loading…')}
        </div>
      )}
      {data && (
        <>
          <LibraryPath folders={data.folders} current={current} label={t('Cloud')} onGo={setPath} />
          <LibraryFolderGrid folders={data.folders} current={current} onGo={setPath} onEdit={setEdit} />
          <div className="docs-grid">
            {data.documents
              .filter((d) => d.folderId === current)
              .map((d) => (
                <div key={d.id} className="doc-card">
                  <button
                    className="cloud-document-open"
                    disabled={busy}
                    onClick={() => void act(async () => onOpen(await openCloudDocument(d.id)))}
                  >
                    <div className="doc-thumb">
                      {d.thumbnailUrl ? (
                        <img src={d.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <Icon name="partStudio" size={40} />
                      )}
                    </div>
                    <div className="doc-meta">
                      <div className="doc-name">{d.name}</div>
                      <div className="doc-date">
                        {Math.max(1, Math.round(d.size / 1024))} KB · {new Date(d.modified).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                  <div className="doc-actions">
                    <button className="icon-btn" title={t('Move to folder…')} onClick={() => setMoving(d)}>
                      <Icon name="folder" size={14} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
          {data.documents.length === 0 && data.folders.length === 0 && (
            <div className="empty-state">
              <Icon name="cloud" size={48} />
              <h3>{t('No cloud documents yet')}</h3>
              <div>{t('Upload selected documents from this device to open them elsewhere.')}</div>
            </div>
          )}
        </>
      )}
      {edit && data && (
        <LibraryFolderDialog
          folders={data.folders}
          initial={edit === 'new' ? undefined : edit}
          parent={current}
          onClose={() => setEdit(null)}
          onSave={async (name, parentId) => {
            const now = Date.now();
            await saveCloudFolder(
              { ...(edit === 'new' ? { id: crypto.randomUUID(), created: now } : edit), name, parentId, modified: now },
              edit === 'new' ? undefined : edit.modified,
            ).catch(explain);
            await refresh();
          }}
          onDelete={
            edit === 'new'
              ? undefined
              : async () => {
                  await deleteCloudFolder(edit.id).catch(explain);
                  await refresh();
                }
          }
        />
      )}
      {moving && data && (
        <LibraryMoveDialog
          folders={data.folders}
          onClose={() => setMoving(null)}
          onSave={async (folderId) => {
            await moveCloudDocument(moving, folderId).catch(explain);
            await refresh();
          }}
        />
      )}
    </>
  );
}

export function CloudUploadDialog({ initial, onClose, onComplete }: { initial?: string[]; onClose: () => void; onComplete: () => void }) {
  const docs = useDoc((s) => s.docs).filter((d) => !d.trashed);
  const links = useFolder((s) => s.links);
  const [selected, setSelected] = useState<string[]>(initial ?? []),
    [data, setData] = useState<CloudList | null>(null),
    [localFolders, setLocalFolders] = useState<LibraryFolder[]>([]);
  const [target, setTarget] = useState(''),
    [copy, setCopy] = useState(false),
    [keepFolders, setKeepFolders] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('');
  useEffect(() => {
    void Promise.all([listCloud(), listLibraryFolders()])
      .then(([cloud, folders]) => {
        setData(cloud);
        setLocalFolders(folders);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  const upload = async () => {
    if (!data || busy) return;
    setBusy(true);
    setError('');
    const done: string[] = [];
    try {
      const folders = [...data.folders];
      for (const id of selected) {
        const doc = docs.find((d) => d.id === id);
        if (!doc) continue;
        setProgress(`${done.length + 1} / ${selected.length}: ${doc.name}`);
        let folderId = target;
        if (keepFolders && !links[id] && doc.folderId) {
          for (const f of folderTrail(localFolders, doc.folderId)) {
            let destination = folders.find((p) => p.parentId === folderId && p.name.toLowerCase() === f.name.toLowerCase());
            if (!destination) {
              destination = { id: crypto.randomUUID(), name: f.name, parentId: folderId, created: Date.now(), modified: Date.now() };
              await saveCloudFolder(destination);
              folders.push(destination);
            }
            folderId = destination.id;
          }
        }
        await uploadCloudDocument(doc, folderId, copy);
        done.push(id);
      }
      onComplete();
      onClose();
    } catch (e) {
      setSelected((current) => current.filter((id) => !done.includes(id)));
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal cloud-upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('Upload documents…')}
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <div className="modal-header">{t('Upload documents…')}</div>
        <div className="modal-body library-form">
          <div className="docs-hint">{t('Choose documents to copy to the cloud. Files on this device stay in place.')}</div>
          {data && (
            <>
              <label>
                {t('Destination folder')}
                <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">{t('Cloud')}</option>
                  {data.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {folderTrail(data.folders, f.id)
                        .map((p) => p.name)
                        .join(' / ')}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cloud-upload-list">
                {docs.map((d) => (
                  <label key={d.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.includes(d.id)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, d.id] : s.filter((id) => id !== d.id)))}
                    />
                    <span>
                      {d.name}
                      <small>
                        {links[d.id] ? links[d.id].name : d.cloudSource ? t('Cloud copy on this device') : t('In this browser')}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <label className="library-check">
                <input type="checkbox" checked={keepFolders} disabled={busy} onChange={(e) => setKeepFolders(e.target.checked)} />
                {t('Preserve browser folders')}
              </label>
              <label className="library-check">
                <input type="checkbox" checked={copy} disabled={busy} onChange={(e) => setCopy(e.target.checked)} />
                {t('Upload as separate copies')}
              </label>
            </>
          )}
          {progress && <div role="status">{progress}</div>}
          {error && (
            <div className="docs-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={busy || !data || !selected.length}>
            <Icon name="upload" size={14} />
            {t('Upload')}
          </button>
        </div>
      </form>
    </div>
  );
}
