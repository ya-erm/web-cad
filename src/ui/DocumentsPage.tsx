import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../store/docStore';
import { addFolder, allowFolder, createInFolder, openFolderFile, readProject, refreshFolder, removeFolder, renameFolderDoc, saveToFolder, syncLinked, useFolder } from '../store/folderStore';
import { copiedVersionIds, importVersions } from '../store/versions';
import { renameVersionSources } from '../core/derived';
import { folderSupported } from '../store/localFolder';
import { useEditor, type ContextMenuItem } from '../store/editorStore';
import { Icon } from './icons';
import { ContextMenu } from './Overlays';
import { AppSettingsButton } from './AppSettings';
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

/** The card whose menu is open: its "⋯" then closes the menu instead of opening it again. */
let menuOwner: string | null = null;

/** The menu of a card: at the cursor on a right click, under the "⋯" button when it is clicked. */
function openCardMenu(e: React.MouseEvent, owner: string, items: ContextMenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  let { clientX: x, clientY: y } = e;
  if (e.type !== 'contextmenu') {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  }
  menuOwner = owner;
  useEditor.setState({ contextMenu: { x, y, items } });
}

/** The "⋯" button in the corner of a card (on hover): the same menu as a right click on the card. */
function CardMenuButton({ owner, items }: { owner: string; items: () => ContextMenuItem[] }) {
  /** The press already closed this card's open menu (a press outside the menu closes it). */
  const wasOpen = useRef(false);
  return (
    <div className="doc-actions" onClick={(e) => e.stopPropagation()}>
      <button
        className="icon-btn"
        title={t('Actions')}
        onPointerDown={() => (wasOpen.current = !!useEditor.getState().contextMenu && menuOwner === owner)}
        onClick={(e) => !wasOpen.current && openCardMenu(e, owner, items())}
      >
        <Icon name="more" size={14} />
      </button>
    </div>
  );
}

/** Run an action of the folder pages, showing what went wrong. */
function useRun() {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { error, run };
}

/** Before any folder is added: what a folder on the computer is, and the button to add one. */
function FolderIntro({ onAdded }: { onAdded: (id: string) => void }) {
  const { error, run } = useRun();
  if (!folderSupported())
    return (
      <div className="empty-state">
        <Icon name="folder" size={48} />
        <h3>{t('A folder on this computer')}</h3>
        <div className="folder-hint">{t('Working with a folder on the computer needs Chrome or Edge. Here, use Import project and Export project.')}</div>
      </div>
    );
  return (
    <div className="empty-state">
      <Icon name="folder" size={48} />
      <h3>{t('Work in a folder on this computer')}</h3>
      <div className="folder-hint">
        {t('Choose a folder: its WebCAD documents are files (*.webcad.json) that you can copy, back up or keep in Git or a cloud folder. Changes are saved to the files as you work. You can add several folders.')}
      </div>
      <div style={{ marginTop: 16 }}>
        <button
          className="btn primary"
          onClick={() =>
            void run(async () => {
              const id = await addFolder();
              if (id) onAdded(id);
            })
          }
        >
          <Icon name="folder" size={16} /> {t('Choose folder…')}
        </button>
      </div>
      {error && <div className="docs-error">{error}</div>}
    </div>
  );
}

/**
 * A folder on the computer (Chrome / Edge): its project files as cards, a new document in it. Without access (after
 * the browser restarted) — a button to allow it again.
 */
function FolderView({ folderId, onOpen, onRemoved }: { folderId: string; onOpen: (id: string) => void; onRemoved: () => void }) {
  const folder = useFolder((s) => s.folders.find((f) => f.id === folderId));
  const links = useFolder((s) => s.links);
  const docs = useDoc((s) => s.docs);
  const { error, run } = useRun();
  /** The file whose card is being renamed. */
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!folder) return null;
  const { dir, access, files } = folder;
  const open = (name: string) =>
    run(async () => {
      try {
        onOpen(await openFolderFile(folderId, name));
      } catch (e) {
        throw new Error(`${name}: ${t('Invalid project file')}`, { cause: e });
      }
    });
  const create = () =>
    run(async () => {
      const id = await createInFolder(folderId, t('Untitled document'));
      if (id) onOpen(id);
    });
  const thumb = (name: string) => {
    const id = Object.keys(links).find((k) => links[k].folder === folderId && links[k].name === name);
    return id ? docs.find((d) => d.id === id)?.thumbnail : undefined;
  };
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
            <button className="btn small" onClick={() => void run(() => refreshFolder(folderId))}>
              {t('Refresh')}
            </button>
          </>
        )}
        <button
          className="btn small"
          title={t('The files and the documents stay; they are just no longer linked')}
          onClick={() =>
            void run(async () => {
              await removeFolder(folderId);
              onRemoved();
            })
          }
        >
          {t('Remove folder from the list')}
        </button>
      </div>
      {error && <div className="docs-error">{error}</div>}
      {!access ? (
        <div className="empty-state">
          <Icon name="lock" size={40} />
          <h3>{t('The browser asks again for access to the folder')}</h3>
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => void run(() => allowFolder(folderId))}>
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
            const menu = (): ContextMenuItem[] => [{ label: t('Rename'), icon: 'rename', action: () => setRenaming(f.name) }];
            return (
              <div
                key={f.name}
                className="doc-card"
                title={f.name}
                onClick={() => renaming !== f.name && void open(f.name)}
                onContextMenu={(e) => renaming !== f.name && openCardMenu(e, `${folderId}/${f.name}`, menu())}
              >
                <div className="doc-thumb">{src ? <img src={src} alt="" /> : <Icon name="partStudio" size={40} />}</div>
                <div className="doc-meta">
                  {renaming === f.name ? (
                    // the file and its document get the new name
                    <input
                      className="tree-rename"
                      autoFocus
                      defaultValue={f.title}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        setRenaming(null);
                        if (v && v !== f.title) void run(() => renameFolderDoc(folderId, f.name, v));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <div className="doc-name">{f.title}</div>
                  )}
                  <div className="doc-date">
                    {t('Modified')}: {fmtDate(f.modified)} · {fmtSize(f.size)}
                  </div>
                </div>
                <CardMenuButton owner={`${folderId}/${f.name}`} items={menu} />
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
  const folders = useFolder((s) => s.folders);
  const links = useFolder((s) => s.links);
  /** Folders a document can be saved into now. */
  const writable = folders.filter((f) => f.access);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Documents, the trash, a folder on the computer (`folder:<id>`) or the page about folders (`folders`). */
  const [view, setView] = useState<string>('docs');
  const shownFolder = view.startsWith('folder:') ? folders.find((f) => `folder:${f.id}` === view) : undefined;
  const linkTitle = (id: string) => {
    const l = links[id];
    const f = l && folders.find((x) => x.id === l.folder);
    return f ? `${t('A file of the folder on this computer')}: ${f.dir.name}/${l.name}` : undefined;
  };
  const add = async () => {
    if (!folderSupported()) return setView('folders');
    const id = await addFolder().catch(() => null);
    if (id) setView(`folder:${id}`);
  };
  /** Last document moved to the trash (the "Restore" bar). */
  const [notice, setNotice] = useState<{ id: string; name: string } | null>(null);
  /** Two-click confirmation for permanent deletion (no native confirm(): blocked in embedded browsers). */
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void loadList();
  }, [loadList]);
  // a card menu left open must not show up in the editor
  useEffect(() => () => useEditor.setState({ contextMenu: null }), []);
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
  /** The card menu ("⋯" or a right click). In the trash, "Delete permanently" asks again on the card's button. */
  const docMenu = (d: (typeof all)[number]): ContextMenuItem[] =>
    d.trashed
      ? [
          { label: t('Restore'), icon: 'undo', action: () => void restoreDocument(d.id) },
          { separator: true, label: '' },
          { label: t('Delete permanently'), icon: 'trash', danger: true, action: () => setConfirming(d.id) },
        ]
      : [
          { label: t('Rename'), icon: 'rename', action: () => setRenaming(d.id) },
          { label: t('Duplicate'), icon: 'copy', action: () => void duplicateDocument(d.id) },
          // a document of the browser goes into a folder: one item per folder
          ...(links[d.id]
            ? []
            : writable.map((f) => ({ label: `${t('Save to the folder')} «${f.dir.name}»`, icon: 'folder', action: () => void saveToFolder(d.id, f.id) }))),
          { separator: true, label: '' },
          {
            label: t('Move to trash'),
            icon: 'trash',
            danger: true,
            action: () => {
              void trashDocument(d.id);
              setNotice({ id: d.id, name: d.name });
            },
          },
        ];

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
          <div
            key={d.id}
            className={'doc-card' + (d.trashed ? ' trashed' : '')}
            onClick={() => !d.trashed && renaming !== d.id && onOpen(d.id)}
            onContextMenu={(e) => renaming !== d.id && openCardMenu(e, d.id, docMenu(d))}
          >
            <div className="doc-thumb">{d.thumbnail ? <img src={d.thumbnail} alt="" /> : <Icon name="partStudio" size={40} />}</div>
            {linkTitle(d.id) && (
              <span className="doc-folder" title={linkTitle(d.id)}>
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
                  onFocus={(e) => e.target.select()}
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    if (v) await renameDocument(d.id, v);
                    // a document of a folder: its file is renamed too
                    if (v && links[d.id]) await syncLinked(d.id);
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
              <CardMenuButton owner={d.id} items={() => docMenu(d)} />
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
        {notice && (
          // in the middle of the header: "Restore", a cross; it goes by itself after a few seconds
          <div className="docs-notice" role="status">
            <span className="docs-notice-text">
              «{notice.name}» {t('moved to the trash')}
            </span>
            <button
              className="btn small"
              onClick={() => {
                void restoreDocument(notice.id);
                setNotice(null);
              }}
            >
              {t('Restore')}
            </button>
            <button className="icon-btn" title={t('Close')} onClick={() => setNotice(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        <button className="btn small" title={t('Help')} onClick={() => openHelp()}>
          <Icon name="help" size={14} /> {t('Help')}
        </button>
        <AppSettingsButton />
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
                const { doc, versions } = readProject(JSON.parse(await f.text()), f.name.replace(/(\.webcad)?\.json$/i, ''));
                // a copy: its versions come as copies too (its Derived features that use them — with them)
                const copies = copiedVersionIds(versions);
                const id = await importDocument({ ...doc, tabs: renameVersionSources(doc.tabs, copies) });
                await importVersions(id, versions, false, copies);
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
          </div>
          <div className="docs-nav">
            <div className="docs-nav-head">{t('Folders on this computer')}</div>
            {folders.map((f) => (
              <button
                key={f.id}
                className={'docs-nav-item' + (view === `folder:${f.id}` ? ' active' : '')}
                title={f.access ? f.dir.name : `${f.dir.name}: ${t('The browser asks again for access to the folder')}`}
                onClick={() => setView(`folder:${f.id}`)}
              >
                <Icon name={f.access ? 'folder' : 'lock'} size={16} /> <span className="docs-nav-name">{f.dir.name}</span>
              </button>
            ))}
            {folders.length === 0 ? (
              <button className={'docs-nav-item' + (view === 'folders' ? ' active' : '')} onClick={() => setView('folders')}>
                <Icon name="folder" size={16} /> {t('Folder on this computer')}
              </button>
            ) : (
              <button className="docs-nav-item" onClick={() => void add()}>
                <Icon name="plus" size={16} /> {t('Add folder…')}
              </button>
            )}
          </div>
          <div className="offline-note">
            {t(folders.length ? 'Works offline. Documents are stored in this browser; those of the folders are also saved to their files.' : 'Works offline. Your documents are stored only in this browser.')}
          </div>
        </div>
        <div className="docs-main">
          <div className="docs-title">
            <h2>{t(view === 'trash' ? 'Trash' : view === 'docs' ? 'Documents' : 'Folder on this computer')}</h2>
            {view === 'trash' && trashed.length > 0 && (
              <button className={'btn small' + (confirming === 'empty' ? ' danger' : '')} onClick={() => confirmThen('empty', () => void emptyTrash())}>
                <Icon name="trash" size={14} /> {t(confirming === 'empty' ? 'Click again to empty the trash' : 'Empty trash')}
              </button>
            )}
          </div>
          {view === 'trash' && (
            <div className="docs-hint">{t('Documents in the trash can be restored. Deleting them from the trash removes them permanently.')}</div>
          )}
          {shownFolder ? (
            <FolderView key={shownFolder.id} folderId={shownFolder.id} onOpen={onOpen} onRemoved={() => setView('docs')} />
          ) : view === 'docs' || view === 'trash' ? (
            list
          ) : (
            <FolderIntro onAdded={(id) => setView(`folder:${id}`)} />
          )}
        </div>
      </div>
      <ContextMenu />
    </div>
  );
}
