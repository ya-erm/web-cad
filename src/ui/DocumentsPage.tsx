import { useEffect, useRef, useState } from 'react';
import type { CadDocument } from '../core/types';
import { useDoc } from '../store/docStore';
import { allowFolder, chooseFolder, createInFolder, leaveFolder, openFolderFile, refreshFolder, saveToFolder, useFolder } from '../store/folderStore';
import { folderSupported } from '../store/localFolder';
import { Icon } from './icons';
import { t, getLang } from '../i18n';
import { openHelp } from '../help/context';

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const fmtSize = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1e6).toFixed(1)} MB`);

/**
 * The folder on the computer (Chrome / Edge): its project files as cards, a new document in it, another folder.
 * Without access (after the browser restarted) — a button to allow it again.
 */
function FolderView({ onOpen }: { onOpen: (id: string) => void }) {
  const dir = useFolder((s) => s.dir);
  const access = useFolder((s) => s.access);
  const files = useFolder((s) => s.files);
  const links = useFolder((s) => s.links);
  const docs = useDoc((s) => s.docs);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const open = (name: string) =>
    run(async () => {
      try {
        onOpen(await openFolderFile(name));
      } catch (e) {
        throw new Error(`${name}: ${t('Invalid project file')}`, { cause: e });
      }
    });
  const create = () =>
    run(async () => {
      const id = await createInFolder(t('Untitled document'));
      if (id) onOpen(id);
    });
  const thumb = (name: string) => {
    const id = Object.keys(links).find((k) => links[k] === name);
    return id ? docs.find((d) => d.id === id)?.thumbnail : undefined;
  };
  if (!folderSupported())
    return (
      <div className="empty-state">
        <Icon name="folder" size={48} />
        <h3>{t('A folder on this computer')}</h3>
        <div className="folder-hint">{t('Working with a folder on the computer needs Chrome or Edge. Here, use Import project and Export project.')}</div>
      </div>
    );
  if (!dir)
    return (
      <div className="empty-state">
        <Icon name="folder" size={48} />
        <h3>{t('Work in a folder on this computer')}</h3>
        <div className="folder-hint">
          {t('Choose a folder: its WebCAD documents are files (*.webcad.json) that you can copy, back up or keep in Git or a cloud folder. Changes are saved to the files as you work.')}
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={() => void run(chooseFolder)}>
            <Icon name="folder" size={16} /> {t('Choose folder…')}
          </button>
        </div>
        {error && <div className="docs-error">{error}</div>}
      </div>
    );
  return (
    <>
      <div className="folder-bar">
        <Icon name="folder" size={16} />
        <span className="folder-name">{dir.name}</span>
        <span style={{ flex: 1 }} />
        {access && (
          <>
            <button className="btn small primary" onClick={() => void create()}>
              <Icon name="plus" size={14} /> {t('New document in the folder')}
            </button>
            <button className="btn small" onClick={() => void run(refreshFolder)}>
              {t('Refresh')}
            </button>
          </>
        )}
        <button className="btn small" onClick={() => void run(chooseFolder)}>
          {t('Another folder…')}
        </button>
        <button className="btn small" title={t('The files and the documents stay; they are just no longer linked')} onClick={() => void run(leaveFolder)}>
          {t('Forget folder')}
        </button>
      </div>
      {error && <div className="docs-error">{error}</div>}
      {!access ? (
        <div className="empty-state">
          <Icon name="lock" size={40} />
          <h3>{t('The browser asks again for access to the folder')}</h3>
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => void run(allowFolder)}>
              {t('Allow access')}
            </button>
          </div>
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <Icon name="folder" size={40} />
          <h3>{t('No WebCAD documents in this folder yet')}</h3>
          <div className="folder-hint">{t('Create a document here, or save one of your documents into the folder from its card.')}</div>
        </div>
      ) : (
        <div className="docs-grid">
          {files.map((f) => {
            const src = thumb(f.name);
            return (
              <div key={f.name} className="doc-card" title={f.name} onClick={() => void open(f.name)}>
                <div className="doc-thumb">{src ? <img src={src} alt="" /> : <Icon name="partStudio" size={40} />}</div>
                <div className="doc-meta">
                  <div className="doc-name">{f.title}</div>
                  <div className="doc-date">
                    {t('Modified')}: {fmtDate(f.modified)} · {fmtSize(f.size)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export function DocumentsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const all = useDoc((s) => s.docs);
  const { loadList, createDocument, deleteDocument, renameDocument, duplicateDocument, importDocument, trashDocument, restoreDocument, emptyTrash } =
    useDoc.getState();
  const folder = useFolder((s) => s.dir);
  const folderOpen = useFolder((s) => !!s.dir && s.access);
  const links = useFolder((s) => s.links);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [view, setView] = useState<'docs' | 'trash' | 'folder'>('docs');
  /** Last document moved to the trash (the "Restore" bar). */
  const [notice, setNotice] = useState<{ id: string; name: string } | null>(null);
  /** Two-click confirmation for permanent deletion (no native confirm(): blocked in embedded browsers). */
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(id);
  }, [confirming]);
  const trashed = all.filter((d) => d.trashed).sort((a, b) => (b.trashed ?? 0) - (a.trashed ?? 0));
  const docs = view === 'trash' ? trashed : all.filter((d) => !d.trashed);
  const confirmThen = (key: string, action: () => void) => {
    if (confirming === key) {
      setConfirming(null);
      action();
    } else setConfirming(key);
  };

  const create = async () => {
    const id = await createDocument(t('Untitled document'));
    onOpen(id);
  };

  const list =
    view === 'trash' && docs.length === 0 ? (
      <div className="empty-state">
        <Icon name="trash" size={48} />
        <h3>{t('The trash is empty')}</h3>
      </div>
    ) : docs.length === 0 ? (
      <div className="empty-state">
        <Icon name="cube" size={48} />
        <h3>{t('No documents yet')}</h3>
        <div>{t('Create your first document to start modeling.')}</div>
        <div style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={create}>
            <Icon name="plus" size={16} /> {t('New document')}
          </button>
        </div>
      </div>
    ) : (
      <div className="docs-grid">
        {docs.map((d) => (
          <div key={d.id} className={'doc-card' + (d.trashed ? ' trashed' : '')} onClick={() => !d.trashed && renaming !== d.id && onOpen(d.id)}>
            <div className="doc-thumb">{d.thumbnail ? <img src={d.thumbnail} alt="" /> : <Icon name="partStudio" size={40} />}</div>
            {links[d.id] && (
              <span className="doc-folder" title={`${t('A file of the folder on this computer')}: ${links[d.id]}`}>
                <Icon name="folder" size={13} />
              </span>
            )}
            <div className="doc-meta">
              {renaming === d.id ? (
                <input
                  className="tree-rename"
                  autoFocus
                  defaultValue={d.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    if (v) await renameDocument(d.id, v);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <div className="doc-name">{d.name}</div>
              )}
              <div className="doc-date">{d.trashed ? `${t('Deleted')}: ${fmtDate(d.trashed)}` : `${t('Modified')}: ${fmtDate(d.modified)}`}</div>
            </div>
            {d.trashed ? (
              <div className="doc-actions trash-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn small" onClick={() => void restoreDocument(d.id)}>
                  <Icon name="undo" size={14} /> {t('Restore')}
                </button>
                <button
                  className={'btn small' + (confirming === d.id ? ' danger' : '')}
                  title={t('Delete permanently')}
                  onClick={() => confirmThen(d.id, () => void deleteDocument(d.id))}
                >
                  <Icon name="trash" size={14} /> {t(confirming === d.id ? 'Click again to delete permanently' : 'Delete permanently')}
                </button>
              </div>
            ) : (
              <div className="doc-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title={t('Rename')} onClick={() => setRenaming(d.id)}>
                  <Icon name="rename" size={14} />
                </button>
                <button className="icon-btn" title={t('Duplicate')} onClick={() => duplicateDocument(d.id)}>
                  <Icon name="copy" size={14} />
                </button>
                {folderOpen && !links[d.id] && (
                  <button className="icon-btn" title={`${t('Save to the folder')} «${folder?.name}»`} onClick={() => void saveToFolder(d.id)}>
                    <Icon name="folder" size={14} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  title={t('Move to trash')}
                  onClick={() => {
                    void trashDocument(d.id);
                    setNotice({ id: d.id, name: d.name });
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div className="docs-page">
      <div className="docs-top">
        <div className="brand">
          <div className="brand-logo">◆</div> WebCAD
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn small" title={t('Help')} onClick={() => openHelp()}>
          <Icon name="help" size={14} /> {t('Help')}
        </button>
      </div>
      <div className="docs-body">
        <div className="docs-side">
          <button className="btn primary" onClick={create}>
            <Icon name="plus" size={16} /> {t('Create')}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> {t('Import project')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.webcad.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const doc = JSON.parse(await f.text()) as CadDocument;
                if (!doc.tabs || !doc.units) throw new Error('bad file');
                const id = await importDocument(doc);
                onOpen(id);
              } catch {
                alert('Invalid project file');
              }
              e.target.value = '';
            }}
          />
          <div className="docs-nav">
            <button className={'docs-nav-item' + (view === 'docs' ? ' active' : '')} onClick={() => setView('docs')}>
              <Icon name="document" size={16} /> {t('Documents')}
            </button>
            <button className={'docs-nav-item' + (view === 'trash' ? ' active' : '')} onClick={() => setView('trash')}>
              <Icon name="trash" size={16} /> {t('Trash')}
              {trashed.length > 0 && <span className="docs-nav-count">{trashed.length}</span>}
            </button>
            <button className={'docs-nav-item' + (view === 'folder' ? ' active' : '')} title={folder?.name} onClick={() => setView('folder')}>
              <Icon name="folder" size={16} /> {t('Folder on this computer')}
            </button>
          </div>
          <div className="offline-note">
            {t(folder ? 'Works offline. Documents are stored in this browser; those of the folder are also saved to its files.' : 'Works offline. Your documents are stored only in this browser.')}
          </div>
        </div>
        <div className="docs-main">
          {notice && (
            <div className="docs-notice">
              «{notice.name}» {t('moved to the trash')}
              <button
                className="btn small"
                onClick={() => {
                  void restoreDocument(notice.id);
                  setNotice(null);
                }}
              >
                {t('Restore')}
              </button>
            </div>
          )}
          <div className="docs-title">
            <h2>{t(view === 'trash' ? 'Trash' : view === 'folder' ? 'Folder on this computer' : 'Documents')}</h2>
            {view === 'trash' && trashed.length > 0 && (
              <button className={'btn small' + (confirming === 'empty' ? ' danger' : '')} onClick={() => confirmThen('empty', () => void emptyTrash())}>
                <Icon name="trash" size={14} /> {t(confirming === 'empty' ? 'Click again to empty the trash' : 'Empty trash')}
              </button>
            )}
          </div>
          {view === 'trash' && (
            <div className="docs-hint">{t('Documents in the trash can be restored. Deleting them from the trash removes them permanently.')}</div>
          )}
          {view === 'folder' ? <FolderView onOpen={onOpen} /> : list}
        </div>
      </div>
    </div>
  );
}
