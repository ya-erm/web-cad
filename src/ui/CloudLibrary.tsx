import { Fragment, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { documentTime } from './documentTime';
import { Icon } from './icons';
import { createPortal } from 'react-dom';
import { CardMenuButton, openCardMenu, RenameInput, FolderPreview, FolderCardMeta } from './DocumentCards';
import { CloudMoveDialog } from './CloudMoveDialog';
import { canMoveCloudItem, cloudFolderPreview, cloudFolderRows, type CloudItem } from '../cloud/folders';
import { libraryDocumentStatus, recentDocuments, unifiedLibrary, type UnifiedFolder, type LibraryDocument } from '../cloud/library';
import type { ContextMenuItem } from '../store/editorStore';
import { folderTrail, validateLibraryChange, type LibraryFolder } from '../store/library';
import { useDoc } from '../store/docStore';
import { useFolder } from '../store/folderStore';
import { markCloudCopy, changeLibrary, rememberLibraryFolders, listLibraryFolders, setTrashed } from '../store/persistence';
import {
  CloudFailure,
  listCloud,
  saveCloudFolder,
  deleteCloudFolder,
  moveCloudDocument,
  renameCloudDocument,
  trashCloudDocument,
  openCloudDocument,
  uploadCloudDocument,
  type CloudList,
  type CloudUploadProgress,
} from '../cloud/client';

function errorText(error: unknown): string {
  if (error instanceof CloudFailure) {
    const messages: Record<string, string> = {
      document_trashed: 'Restore this document from the trash first.',
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

const LIBRARY_TREE_KEY = 'webcad.library.expanded';
function loadLibraryTree(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LIBRARY_TREE_KEY) ?? '[]');
    if (Array.isArray(value) && value.every((id) => typeof id === 'string')) return value;
  } catch {
    /* Folder navigation remains available without browser storage. */
  }
  return [];
}

export function CloudLibrary({
  onOpen,
  onUpload,
  path,
  onGo,
  sidebar,
  heading,
  trash = false,
  active = true,
  uploadBusy = false,
}: {
  onOpen: (id: string) => void;
  onUpload: (folderId: string, ids?: string[], direct?: boolean) => void;
  path: string;
  onGo: (id: string) => void;
  sidebar?: HTMLElement | null;
  heading?: HTMLElement | null;
  trash?: boolean;
  active?: boolean;
  uploadBusy?: boolean;
}) {
  const localDocs = useDoc((s) => s.docs),
    diskLinks = useFolder((s) => s.links);
  const [localFolders, setLocalFolders] = useState<LibraryFolder[]>([]),
    [data, setData] = useState<CloudList | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null),
    [moving, setMoving] = useState<CloudItem | null>(null),
    [variants, setVariants] = useState<LibraryDocument | null>(null),
    [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragged, setDragged] = useState<CloudItem | null>(null),
    [over, setOver] = useState<string | null>(null),
    [expanded, setExpanded] = useState<string[]>(loadLibraryTree);
  const epoch = useRef(0),
    working = useRef(false),
    previousTrash = useRef(trash);
  const browserDocs = localDocs.filter((d) => !diskLinks[d.id] || Boolean(d.trashed));
  const view = unifiedLibrary(localFolders, browserDocs, data, trash);
  const current = view.folders.some((f) => f.id === path) ? path : '';
  const refresh = async () => {
    const request = ++epoch.current;
    setBusy(true);
    setError('');
    await useDoc.getState().loadList();
    const folders = await listLibraryFolders();
    if (request !== epoch.current) return;
    setLocalFolders(folders);
    try {
      const remote = await listCloud();
      if (request !== epoch.current) return;
      const local = useDoc.getState().docs.filter((d) => !useFolder.getState().links[d.id]);
      for (const d of local) {
        const remoteDoc = remote.documents.find((r) => r.id === d.cloudSource?.documentId && d.cloudSource.userId === remote.userId);
        if (remoteDoc && Boolean(d.trashed) !== Boolean(remoteDoc.trashed)) await setTrashed(d.id, remoteDoc.trashed ?? null);
      }
      const merged = unifiedLibrary(folders, local, remote),
        locations: Record<string, string> = {};
      for (const d of merged.documents) if (d.cloud) for (const local of d.locals) locations[local.id] = d.folderId;
      const mirrored = merged.folders.map(({ cloudId, ...f }) => ({
        ...f,
        ...(cloudId ? { cloudSource: { userId: remote.userId, folderId: cloudId } } : {}),
      }));
      await rememberLibraryFolders(mirrored, locations);
      if (request !== epoch.current) return;
      setData(remote);
      setLocalFolders(mirrored);
      await useDoc.getState().loadList();
    } catch (e) {
      if (request !== epoch.current) return;
      if (e instanceof CloudFailure && e.status === 401) setData(null);
      else setError(errorText(e));
    } finally {
      if (request === epoch.current) setBusy(false);
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
      epoch.current++;
      window.removeEventListener('webcad:account-changed', changed);
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    setExpanded((s) => [...new Set([...s, ...folderTrail(view.folders, current).map((f) => f.id)])]);
  }, [current]);
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_TREE_KEY, JSON.stringify(expanded));
    } catch {
      /* Optional persistence. */
    }
  }, [expanded]);
  useEffect(() => {
    if (active && !trash) return;
    setRenaming(null);
    setMoving(null);
    setVariants(null);
    setConfirmDelete(null);
    setDragged(null);
    setOver(null);
  }, [active, trash]);
  useEffect(() => {
    // The trash has no toolbar: opening it still refreshes cross-device deletions.
    if (trash && !previousTrash.current && !busy) void refresh();
    previousTrash.current = trash;
  }, [trash]);
  const act = async (fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const ensureLocal = async () => {
    const folders = view.folders.map(({ cloudId, ...f }) => ({
      ...f,
      ...(cloudId && data ? { cloudSource: { userId: data.userId, folderId: cloudId } } : {}),
    }));
    await rememberLibraryFolders(folders, {});
    setLocalFolders(folders);
  };
  const cloudTarget = async (target: string) => {
    if (!data) throw new Error('Sign in to use cloud documents.');
    let parent = '';
    for (const f of folderTrail(view.folders, target)) {
      const existing = view.folders.find((v) => v.id === f.id)?.cloudId ?? f.cloudSource?.folderId;
      if (existing && data.folders.some((v) => v.id === existing)) {
        parent = existing;
        continue;
      }
      const created = { ...f, id: f.id, parentId: parent, modified: Date.now() };
      await saveCloudFolder(created);
      parent = created.id;
    }
    return parent;
  };
  const moveItem = async (item: CloudItem, target: string) => {
    if (!canMoveCloudItem(view.folders, view.documents, item, target)) return;
    await ensureLocal();
    if (item.kind === 'document') {
      const doc = view.documents.find((d) => d.id === item.id)!;
      if (!data && doc.locals.some((l) => l.cloudSource)) throw new Error('Connect to organise cloud documents.');
      if (doc.cloud) {
        const moved = await moveCloudDocument(doc.cloud, await cloudTarget(target));
        for (const local of doc.locals)
          if (local.cloudSource) await markCloudCopy(local.id, { ...local.cloudSource, cloudModified: moved.document.modified });
      }
      for (const local of doc.locals) await changeLibrary({ kind: 'document', id: local.id, folderId: target });
    } else {
      const folder = view.folders.find((f) => f.id === item.id)!;
      validateLibraryChange(view.folders, localDocs, { kind: 'folder', folder: { ...folder, parentId: target } });
      if (!data && folder.cloudSource) throw new Error('Connect to organise cloud documents.');
      if (folder.cloudId && data) {
        const remote = data.folders.find((f) => f.id === folder.cloudId)!;
        await saveCloudFolder({ ...remote, parentId: await cloudTarget(target) }, remote.modified);
      }
      await changeLibrary({ kind: 'folder', folder: { ...folder, parentId: target, modified: Date.now() } });
    }
    await refresh();
  };
  const finishMove = async (item: CloudItem, target: string) => {
    try {
      await moveItem(item, target);
    } catch (e) {
      throw new Error(errorText(e));
    }
  };
  const dropProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragged || busy || !canMoveCloudItem(view.folders, view.documents, dragged, id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(id);
    },
    onDragLeave: () => setOver((v) => (v === id ? null : v)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const item = dragged;
      setDragged(null);
      setOver(null);
      if (item) void act(() => moveItem(item, id));
    },
  });
  const dragStart = (e: React.DragEvent, item: CloudItem, name: string) => {
    setDragged(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', name);
  };
  const dragEnd = () => {
    setDragged(null);
    setOver(null);
  };
  const dropClass = (id: string) => (over === id ? ' drop-over' : '');
  const rename = async (item: CloudItem, value: string | null) => {
    setRenaming(null);
    if (!value) return;
    await act(async () => {
      await ensureLocal();
      if (item.kind === 'folder') {
        const f = view.folders.find((f) => f.id === item.id)!;
        validateLibraryChange(view.folders, localDocs, { kind: 'folder', folder: { ...f, name: value } });
        if (!data && f.cloudSource) throw new Error('Connect to organise cloud documents.');
        if (f.cloudId && data) {
          const remote = data.folders.find((r) => r.id === f.cloudId)!;
          await saveCloudFolder({ ...remote, name: value }, remote.modified);
        }
        await changeLibrary({ kind: 'folder', folder: { ...f, name: value, modified: Date.now() } });
      } else {
        const d = view.documents.find((d) => d.id === item.id)!;
        if (!data && d.locals.some((l) => l.cloudSource)) throw new Error('Connect to organise cloud documents.');
        const renamed = d.cloud ? await renameCloudDocument(d.cloud, value) : null;
        for (const local of d.locals) {
          await useDoc.getState().renameDocument(local.id, value);
          if (local.cloudSource && renamed) {
            const fresh = useDoc.getState().docs.find((v) => v.id === local.id)!;
            await markCloudCopy(local.id, {
              ...local.cloudSource,
              cloudModified: renamed.document.modified,
              ...(local.cloudSource.savedModified === local.modified ? { savedModified: fresh.modified } : {}),
            });
          }
        }
      }
      await refresh();
    });
  };
  const createFolder = () =>
    void act(async () => {
      const names = new Set(view.folders.filter((f) => f.parentId === current).map((f) => f.name.toLocaleLowerCase()));
      let name = t('New folder');
      for (let i = 2; names.has(name.toLocaleLowerCase()); i++) name = `${t('New folder')} (${i})`;
      const now = Date.now(),
        id = crypto.randomUUID();
      await ensureLocal();
      const cloudParent = view.folders.find((f) => f.id === current)?.cloudId;
      if (cloudParent && data) await saveCloudFolder({ id, name, parentId: cloudParent, created: now, modified: now });
      await changeLibrary({
        kind: 'folder',
        folder: {
          id,
          name,
          parentId: current,
          created: now,
          modified: now,
          ...(cloudParent && data ? { cloudSource: { userId: data.userId, folderId: id } } : {}),
        },
      });
      await refresh();
      setRenaming('folder:' + id);
    });
  const createDocument = () =>
    void act(async () => {
      await ensureLocal();
      const id = await useDoc.getState().createDocument(t('Untitled document'));
      if (current) await changeLibrary({ kind: 'document', id, folderId: current });
      onOpen(id);
    });
  const open = async (doc: LibraryDocument, forceCloud = false) => {
    if (doc.locals.length && !forceCloud) {
      if (doc.locals.length > 1) {
        setVariants(doc);
        return;
      }
      onOpen(doc.locals[0].id);
      return;
    }
    if (doc.cloud)
      await act(async () => {
        const id = await openCloudDocument(doc.cloud!.id);
        await ensureLocal();
        await changeLibrary({ kind: 'document', id, folderId: doc.folderId });
        onOpen(id);
      });
  };
  const folderMenu = (f: UnifiedFolder): ContextMenuItem[] => [
    { label: t('Open'), icon: 'folder', action: () => onGo(f.id) },
    {
      label: t('Rename'),
      icon: 'rename',
      disabled: busy,
      action: () => {
        onGo(f.parentId);
        setRenaming('folder:' + f.id);
      },
    },
    {
      label: t('Move to folder…'),
      icon: 'folder',
      disabled: busy,
      action: () => {
        onGo(f.parentId);
        setMoving({ kind: 'folder', id: f.id });
      },
    },
    {
      label: t('Delete empty folder'),
      icon: 'trash',
      danger: true,
      disabled: busy,
      action: () => {
        onGo(f.parentId);
        void act(async () => {
          await ensureLocal();
          const preview = cloudFolderPreview(view.folders, view.documents, f.id);
          if (preview.count || view.folders.some((c) => c.parentId === f.id)) throw new Error('Only empty folders can be deleted');
          validateLibraryChange(view.folders, localDocs, { kind: 'remove', id: f.id });
          if (f.cloudId) await deleteCloudFolder(f.cloudId);
          await changeLibrary({ kind: 'remove', id: f.id });
          await refresh();
        });
      },
    },
  ];
  const changeTrash = async (d: LibraryDocument, remove: boolean) =>
    act(async () => {
      if (!d.cloud && d.locals.some((l) => l.cloudSource)) throw new Error('Connect to organise cloud documents.');
      if (d.cloud) {
        const changed = await trashCloudDocument(d.cloud, remove);
        for (const local of d.locals)
          if (local.cloudSource) await markCloudCopy(local.id, { ...local.cloudSource, cloudModified: changed.document.modified });
      }
      for (const local of d.locals)
        await (remove ? useDoc.getState().trashDocument(local.id) : useDoc.getState().restoreDocument(local.id));
      await refresh();
    });
  const documentMenu = (d: LibraryDocument): ContextMenuItem[] =>
    trash
      ? [
          { label: t('Restore'), icon: 'undo', disabled: busy, action: () => void changeTrash(d, false) },
          ...(!d.cloud && !d.locals.some((l) => l.cloudSource)
            ? [{ label: t('Delete permanently'), icon: 'trash', danger: true, disabled: busy, action: () => setConfirmDelete(d.id) }]
            : []),
        ]
      : [
          { label: t('Open'), icon: 'document', action: () => void open(d) },
          ...(d.cloud ? [{ label: t('Open cloud version'), icon: 'cloud', action: () => void open(d, true) }] : []),
          { label: t('Rename'), icon: 'rename', disabled: busy, action: () => setRenaming('document:' + d.id) },
          { label: t('Move to folder…'), icon: 'folder', disabled: busy, action: () => setMoving({ kind: 'document', id: d.id }) },
          ...(d.locals.length
            ? [
                {
                  label: t('Upload to cloud'),
                  icon: 'cloud',
                  disabled: uploadBusy,
                  action: () => onUpload(d.folderId, [d.locals[0].id], true),
                },
              ]
            : []),
          ...(d.locals.length > 1 ? [{ label: t('Local variants…'), icon: 'copy', action: () => setVariants(d) }] : []),
          { label: t('Move to trash'), icon: 'trash', danger: true, disabled: busy, action: () => void changeTrash(d, true) },
        ];
  const node = (parent: string, depth = 0): React.ReactNode =>
    view.folders
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => {
        const children = view.folders.some((c) => c.parentId === f.id),
          isOpen = expanded.includes(f.id);
        return (
          <Fragment key={f.id}>
            <button
              className={'docs-nav-item folder-nav' + (active && !trash && current === f.id ? ' active' : '') + dropClass(f.id)}
              style={{ paddingLeft: 4 + depth * 14 }}
              onClick={() => onGo(f.id)}
              {...dropProps(f.id)}
              onContextMenu={(e) => openCardMenu(e, 'library-folder:' + f.id, folderMenu(f))}
            >
              <span
                className="tree-toggle"
                onClick={(e) => {
                  if (!children) return;
                  e.stopPropagation();
                  setExpanded((s) => (s.includes(f.id) ? s.filter((id) => id !== f.id) : [...s, f.id]));
                }}
              >
                {children && <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />}
              </span>
              <Icon name="folder" size={16} />
              <span className="docs-nav-name">{f.name}</span>
            </button>
            {isOpen && node(f.id, depth + 1)}
          </Fragment>
        );
      });
  const children = view.folders.filter((f) => !trash && f.parentId === current).sort((a, b) => a.name.localeCompare(b.name)),
    documents = view.documents.filter((d) => trash || d.folderId === current);
  const crumbs = [{ id: '', name: t('My documents') }, ...folderTrail(view.folders, current)];
  const movingName =
    moving?.kind === 'folder' ? view.folders.find((f) => f.id === moving.id)?.name : view.documents.find((d) => d.id === moving?.id)?.name;
  return (
    <>
      {active &&
        heading &&
        createPortal(
          <span className="library-loading" role={busy ? 'status' : undefined} aria-label={busy ? t('Loading…') : undefined}>
            {busy && <span className="spinner" />}
          </span>,
          heading,
        )}
      {sidebar && createPortal(<div className="library-sidebar-tree">{node('')}</div>, sidebar)}
      {active && (
        <>
          {!trash && (
            <div className="folder-bar">
              <Icon name="folder" size={16} />
              <nav className="folder-crumbs" aria-label={t('Folder path')}>
                {crumbs.map((c, i) => (
                  <Fragment key={c.id}>
                    {i > 0 && <Icon name="chevronRight" size={12} />}
                    <button
                      className={'folder-crumb' + (current === c.id ? ' current' : '') + dropClass(c.id)}
                      onClick={() => onGo(c.id)}
                      {...dropProps(c.id)}
                    >
                      {c.name}
                    </button>
                  </Fragment>
                ))}
              </nav>
              <span className="spacer" />
              <button className="btn small primary" disabled={busy} onClick={createDocument}>
                <Icon name="plus" size={14} />
                {t('New document in the folder')}
              </button>
              <button className="btn small" disabled={busy} onClick={createFolder}>
                <Icon name="folder" size={14} />
                {t('New folder')}
              </button>
              <button className="btn small" disabled={busy} onClick={() => void refresh()}>
                <Icon name="refresh" size={14} />
                {t('Refresh')}
              </button>
              <button className="btn small" disabled={busy || !data || uploadBusy} onClick={() => onUpload(current)}>
                <Icon name="cloud" size={14} />
                {t('Upload to cloud')}
              </button>
            </div>
          )}
          {error && (
            <div className="docs-error" role="alert">
              {error}
            </div>
          )}
          {children.length > 0 && (
            <div className="folder-grid">
              {children.map((f) => {
                const item: CloudItem = { kind: 'folder', id: f.id },
                  key = 'folder:' + f.id,
                  preview = cloudFolderPreview(view.folders, view.documents, f.id);
                return (
                  <div
                    key={f.id}
                    className={'doc-card folder-card' + dropClass(f.id)}
                    draggable={!trash && !busy && renaming !== key}
                    onDragStart={(e) => dragStart(e, item, f.name)}
                    onDragEnd={dragEnd}
                    {...dropProps(f.id)}
                    onClick={() => renaming !== key && onGo(f.id)}
                    onContextMenu={(e) => renaming !== key && openCardMenu(e, key, folderMenu(f))}
                  >
                    <FolderPreview shown={preview.shown.map((d) => d.thumbnail)} more={preview.more} />
                    <FolderCardMeta name={f.name} count={preview.count}>
                      {renaming === key ? <RenameInput value={f.name} onDone={(value) => void rename(item, value)} /> : null}
                    </FolderCardMeta>
                    <CardMenuButton owner={key} items={() => folderMenu(f)} />
                  </div>
                );
              })}
            </div>
          )}
          <div className="docs-grid">
            {documents.map((d) => {
              const item: CloudItem = { kind: 'document', id: d.id },
                key = 'document:' + d.id;
              return (
                <div
                  key={d.id}
                  className="doc-card"
                  draggable={!trash && !busy && renaming !== key}
                  onDragStart={(e) => dragStart(e, item, d.name)}
                  onDragEnd={dragEnd}
                  onClick={() => !trash && renaming !== key && void open(d)}
                  onContextMenu={(e) => renaming !== key && openCardMenu(e, key, documentMenu(d))}
                >
                  <div className="doc-thumb">
                    {d.thumbnail ? (
                      <img src={d.thumbnail} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <Icon name="partStudio" size={40} />
                    )}
                  </div>
                  {(d.cloud || d.locals.some((l) => l.cloudSource)) && (
                    <span className="doc-folder" title={t('Cloud connected')}>
                      <Icon name="cloud" size={13} />
                    </span>
                  )}
                  <div className="doc-meta">
                    {renaming === key ? (
                      <RenameInput value={d.name} onDone={(value) => void rename(item, value)} />
                    ) : (
                      <div className="doc-name">{d.name}</div>
                    )}
                    <div className="doc-date">
                      {t('Modified')}: {documentTime(d.modified)}
                    </div>
                    <div className="doc-date library-document-state">
                      <Icon name={d.cloud ? 'cloud' : 'document'} size={12} />
                      {t(libraryDocumentStatus(d))}
                      {d.locals.length > 1 && ` · ${t('Local variants')}: ${d.locals.length}`}
                    </div>
                  </div>
                  {trash && (
                    <div className="doc-actions trash-actions">
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void changeTrash(d, false);
                        }}
                      >
                        <Icon name="undo" size={13} />
                        {t('Restore')}
                      </button>
                      {!d.cloud && !d.locals.some((l) => l.cloudSource) && (
                        <button
                          className="btn small danger"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirmDelete !== d.id) {
                              setConfirmDelete(d.id);
                              return;
                            }
                            void act(async () => {
                              for (const local of d.locals) await useDoc.getState().deleteDocument(local.id);
                              setConfirmDelete(null);
                              await refresh();
                            });
                          }}
                        >
                          {t(confirmDelete === d.id ? 'Click again to delete' : 'Delete permanently')}
                        </button>
                      )}
                    </div>
                  )}
                  <CardMenuButton owner={key} items={() => documentMenu(d)} />
                </div>
              );
            })}
          </div>
          {!children.length && !documents.length && !busy && (
            <div className="empty-state">
              <Icon name="folder" size={40} />
              <h3>{t(trash ? 'The trash is empty' : 'No WebCAD documents in this folder yet')}</h3>
              <div className="folder-hint">
                {!trash && t('Create a document or a folder here, or save one of your documents into the folder from its card.')}
              </div>
            </div>
          )}
          {moving && (
            <CloudMoveDialog
              folders={view.folders}
              documents={view.documents}
              item={moving}
              name={movingName ?? ''}
              onClose={() => setMoving(null)}
              onSave={(target) => finishMove(moving, target)}
            />
          )}
          {variants && (
            <div className="modal-backdrop" onPointerDown={() => setVariants(null)}>
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={t('Local variants…')}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="modal-header">{t('Local variants…')}</div>
                <div className="modal-body">
                  <div className="docs-hint">{t('Existing variants are kept. Choose which one to open.')}</div>
                  {variants.locals.map((local) => (
                    <button
                      key={local.id}
                      className="btn"
                      onClick={() => {
                        setVariants(null);
                        onOpen(local.id);
                      }}
                    >
                      {local.name} · {new Date(local.modified).toLocaleString()}
                    </button>
                  ))}
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setVariants(null)}>
                    {t('Close')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Resolve local folder aliases without flattening their hierarchy or moving connected documents. */
function uploadFolders(localFolders: LibraryFolder[], data: CloudList) {
  const folders = [...data.folders];
  const combined = unifiedLibrary(localFolders, [], data);
  const ensureTarget = async (id: string) => {
    let parent = '';
    for (const f of folderTrail(combined.folders, id)) {
      let found =
        folders.find((r) => r.id === combined.folders.find((v) => v.id === f.id)?.cloudId) ??
        folders.find((r) => r.parentId === parent && r.name.toLocaleLowerCase() === f.name.toLocaleLowerCase());
      if (!found) {
        found = { ...f, id: f.id, parentId: parent };
        await saveCloudFolder(found);
        folders.push(found);
      }
      if (localFolders.some((l) => l.id === f.id))
        await changeLibrary({ kind: 'folder', folder: { ...f, cloudSource: { userId: data.userId, folderId: found.id } } });
      parent = found.id;
    }
    return parent;
  };
  return { folders, ensureTarget };
}

function UploadProgress({
  progress,
  completed = 0,
  total = 1,
  name,
}: {
  progress: CloudUploadProgress | null;
  completed?: number;
  total?: number;
  name?: string;
}) {
  const fraction =
    progress?.phase === 'uploading' && progress.total
      ? Math.min(0.95, (progress.loaded / progress.total) * 0.9 + 0.05)
      : progress?.phase === 'committing'
        ? 0.98
        : 0;
  return (
    <div className="cloud-upload-progress" role="status">
      <span>
        {name}
        {total > 1 ? ` · ${completed + 1} / ${total}` : ''}
      </span>
      <progress aria-label={t('Upload progress')} max={total} value={completed + fraction} />
      <small>
        {t(progress?.phase === 'committing' ? 'Finishing upload…' : progress?.phase === 'uploading' ? 'Uploading…' : 'Preparing upload…')}
      </small>
    </div>
  );
}

/** A document action starts immediately; only a failed/conflicting upload offers explicit choices. */
export function CloudDirectUpload({
  id,
  onClose,
  onComplete,
  onResolve,
}: {
  id: string;
  onClose: () => void;
  onComplete: (folderId: string) => void;
  onResolve: () => void;
}) {
  const doc = useDoc((s) => s.docs.find((d) => d.id === id));
  const [progress, setProgress] = useState<CloudUploadProgress | null>(null);
  const [error, setError] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (!doc) throw new Error('Document not found');
        const [data, folders] = await Promise.all([listCloud(), listLibraryFolders()]);
        if (doc.cloudSource && doc.cloudSource.userId !== data.userId) throw new Error('Connect to organise cloud documents.');
        const existing = data.documents.find((d) => d.id === (doc.cloudSource?.documentId ?? doc.id));
        const target = existing?.folderId ?? (await uploadFolders(folders, data).ensureTarget(doc.folderId ?? ''));
        await uploadCloudDocument(doc, target, false, undefined, undefined, { onProgress: setProgress });
        onComplete(doc.folderId ?? '');
        onClose();
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, []);
  return (
    <div className="cloud-upload-notice" role="region" aria-label={t('Upload to cloud')}>
      <div className="cloud-upload-notice-heading">
        <Icon name="cloud" size={18} />
        <strong>{doc?.name}</strong>
      </div>
      {error ? (
        <>
          <div className="docs-error" role="alert">
            {error}
          </div>
          <div className="cloud-upload-notice-actions">
            <button className="btn" onClick={onResolve}>
              {t('Choose upload options…')}
            </button>
            <button className="btn" onClick={onClose}>
              {t('Close')}
            </button>
          </div>
        </>
      ) : (
        <UploadProgress progress={progress} name={doc?.name} />
      )}
    </div>
  );
}

function FolderCheckbox({
  checked,
  partial,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  partial: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      disabled={disabled}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function CloudUploadDialog({
  initial,
  initialFolder = '',
  onClose,
  onComplete,
}: {
  initial?: string[];
  initialFolder?: string;
  onClose: () => void;
  onComplete: (folderId: string) => void;
}) {
  const allDocs = useDoc((s) => s.docs);
  const diskLinks = useFolder((s) => s.links);
  const docs = recentDocuments(allDocs.filter((d) => !diskLinks[d.id]));
  const [selected, setSelected] = useState<string[]>(initial ?? []),
    [data, setData] = useState<CloudList | null>(null),
    [localFolders, setLocalFolders] = useState<LibraryFolder[]>([]);
  const [target, setTarget] = useState(initialFolder),
    [copy, setCopy] = useState(false),
    [keepFolders, setKeepFolders] = useState(!initialFolder),
    [replaceExisting, setReplaceExisting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState<CloudUploadProgress | null>(null),
    [currentName, setCurrentName] = useState(''),
    [completed, setCompleted] = useState(0),
    [expanded, setExpanded] = useState<string[]>([]),
    [destinationExpanded, setDestinationExpanded] = useState<string[]>([]);
  useEffect(() => {
    void Promise.all([listCloud(), listLibraryFolders()])
      .then(([cloud, folders]) => {
        setData(cloud);
        setLocalFolders(folders);
        const combined = unifiedLibrary(folders, [], cloud).folders;
        setDestinationExpanded(initialFolder ? folderTrail(combined, initialFolder).map((f) => f.id) : []);
        setExpanded([
          ...new Set(
            (initial ?? []).flatMap((id) => {
              const doc = docs.find((d) => d.id === id);
              return doc?.folderId ? folderTrail(folders, doc.folderId).map((f) => f.id) : [];
            }),
          ),
        ]);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  const needsReplacement =
    !!data &&
    docs.some(
      (d) =>
        selected.includes(d.id) &&
        data.documents.some(
          (remote) =>
            remote.id === (d.cloudSource?.documentId ?? d.id) &&
            (!d.cloudSource?.cloudModified ||
              d.cloudSource.revision !== remote.revision ||
              d.cloudSource.cloudModified !== remote.modified),
        ),
    );
  const upload = async () => {
    if (!data || busy) return;
    setBusy(true);
    setError('');
    const done: string[] = [];
    try {
      const { folders, ensureTarget } = uploadFolders(localFolders, data);
      const destination = await ensureTarget(target);
      for (const id of selected) {
        const doc = docs.find((d) => d.id === id);
        if (!doc) continue;
        setCompleted(done.length);
        setCurrentName(doc.name);
        setProgress(null);
        let folderId = destination;
        if (keepFolders && doc.folderId) {
          for (const f of folderTrail(localFolders, doc.folderId)) {
            let destination = folders.find((p) => p.parentId === folderId && p.name.toLowerCase() === f.name.toLowerCase());
            if (!destination) {
              destination = { id: f.id, name: f.name, parentId: folderId, created: Date.now(), modified: Date.now() };
              await saveCloudFolder(destination);
              folders.push(destination);
            }
            await changeLibrary({ kind: 'folder', folder: { ...f, cloudSource: { userId: data.userId, folderId: destination.id } } });
            folderId = destination.id;
          }
        }
        const existing = data.documents.find((d) => d.id === (doc.cloudSource?.documentId ?? doc.id));
        await uploadCloudDocument(
          doc,
          folderId,
          copy,
          replaceExisting ? existing?.revision : undefined,
          replaceExisting ? existing?.modified : undefined,
          { onProgress: setProgress },
        );
        done.push(id);
      }
      onComplete(target);
      onClose();
    } catch (e) {
      setSelected((current) => current.filter((id) => !done.includes(id)));
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const destinationFolders = unifiedLibrary(localFolders, [], data).folders;
  const sourceFolders = localFolders.filter((f) =>
    docs.some((d) => d.folderId === f.id || folderTrail(localFolders, d.folderId ?? '').some((p) => p.id === f.id)),
  );
  const renderSource = (parent: string, depth = 0): React.ReactNode => (
    <>
      {sourceFolders
        .filter((f) => f.parentId === parent)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => {
          const ids = docs
            .filter((d) => d.folderId === f.id || folderTrail(localFolders, d.folderId ?? '').some((p) => p.id === f.id))
            .map((d) => d.id);
          const count = ids.filter((id) => selected.includes(id)).length;
          const open = expanded.includes(f.id);
          return (
            <Fragment key={f.id}>
              <div className="upload-tree-row upload-source-folder" style={{ paddingLeft: 8 + depth * 18 }}>
                <button
                  type="button"
                  className="upload-tree-toggle"
                  aria-label={`${t('Expand folder')}: ${f.name}`}
                  aria-expanded={open}
                  onClick={() => setExpanded((s) => (open ? s.filter((id) => id !== f.id) : [...s, f.id]))}
                >
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
                </button>
                <FolderCheckbox
                  checked={count === ids.length}
                  partial={count > 0 && count < ids.length}
                  disabled={busy}
                  label={`${t('Select folder')}: ${f.name}`}
                  onChange={(checked) => setSelected((s) => (checked ? [...new Set([...s, ...ids])] : s.filter((id) => !ids.includes(id))))}
                />
                <Icon name="folder" size={18} />
                <span>{f.name}</span>
                <small>
                  {count} / {ids.length}
                </small>
              </div>
              {open && renderSource(f.id, depth + 1)}
            </Fragment>
          );
        })}
      {docs
        .filter((d) => (d.folderId && sourceFolders.some((f) => f.id === d.folderId) ? d.folderId : '') === parent)
        .map((d) => (
          <label className="upload-source-document" key={d.id} style={{ paddingLeft: 28 + depth * 18 }}>
            <input
              type="checkbox"
              disabled={busy}
              checked={selected.includes(d.id)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, d.id] : s.filter((id) => id !== d.id)))}
            />
            <span className="upload-source-thumbnail">
              {d.thumbnail ? <img src={d.thumbnail} alt="" loading="lazy" /> : <Icon name="partStudio" size={26} />}
            </span>
            <span className="upload-source-name">
              {d.name}
              <small>{d.cloudSource ? t('Cloud connected') : t('Only on this device')}</small>
            </span>
          </label>
        ))}
    </>
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busy) onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop">
      <form
        className="modal cloud-upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('Upload documents to cloud')}
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <div className="modal-header cloud-upload-heading">
          <Icon name="cloud" size={22} />
          {t('Upload documents to cloud')}
        </div>
        <div className="modal-body library-form">
          {data && (
            <>
              <div className="upload-section-title" id="upload-destination-label">
                {t('Destination folder')}
              </div>
              <div className="upload-destination-tree" role="group" aria-labelledby="upload-destination-label">
                {[
                  { id: '', name: t('Cloud'), depth: 0, parentId: '' },
                  ...cloudFolderRows(destinationFolders).map(({ folder, depth }) => ({ ...folder, depth: depth + 1 })),
                ]
                  .filter(
                    (f) => !f.parentId || folderTrail(destinationFolders, f.parentId).every((p) => destinationExpanded.includes(p.id)),
                  )
                  .map((f) => {
                    const children = destinationFolders.some((p) => p.parentId === f.id);
                    return (
                      <div key={f.id} className="upload-tree-row" style={{ paddingLeft: 8 + f.depth * 16 }}>
                        {f.id && children ? (
                          <button
                            type="button"
                            className="upload-tree-toggle"
                            aria-label={`${t('Expand folder')}: ${f.name}`}
                            aria-expanded={destinationExpanded.includes(f.id)}
                            onClick={() => setDestinationExpanded((s) => (s.includes(f.id) ? s.filter((id) => id !== f.id) : [...s, f.id]))}
                          >
                            <Icon name={destinationExpanded.includes(f.id) ? 'chevronDown' : 'chevronRight'} size={12} />
                          </button>
                        ) : (
                          <span className="upload-tree-toggle" />
                        )}
                        <label>
                          <input
                            type="radio"
                            name="upload-destination"
                            value={f.id}
                            checked={target === f.id}
                            disabled={busy}
                            onChange={() => setTarget(f.id)}
                          />
                          <Icon name={f.id ? 'folder' : 'cloud'} size={16} />
                          <span>{f.name}</span>
                        </label>
                      </div>
                    );
                  })}
              </div>
              <div className="docs-hint">{t('Choose documents to upload.')}</div>
              <div className="cloud-upload-list" role="group" aria-label={t('Documents to upload')}>
                {renderSource('')}
              </div>
              <div className="cloud-upload-options">
                <label className="library-check">
                  <input type="checkbox" checked={keepFolders} disabled={busy} onChange={(e) => setKeepFolders(e.target.checked)} />
                  {t('Preserve library folders')} <OptionHelp text="Create the same subfolders inside the destination folder." />
                </label>
                {needsReplacement && !copy && (
                  <label className="library-check">
                    <input
                      type="checkbox"
                      checked={replaceExisting}
                      disabled={busy || copy}
                      onChange={(e) => setReplaceExisting(e.target.checked)}
                    />
                    {t('Update existing cloud versions')}{' '}
                    <OptionHelp text="Replace the current cloud snapshot with the selected local version." />
                  </label>
                )}
                <label className="library-check">
                  <input type="checkbox" checked={copy} disabled={busy} onChange={(e) => setCopy(e.target.checked)} />
                  {t('Upload as separate copies')}{' '}
                  <OptionHelp text="Create independent cloud documents instead of updating connected documents." />
                </label>
              </div>
            </>
          )}
          {busy && <UploadProgress progress={progress} completed={completed} total={selected.length} name={currentName} />}
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

function OptionHelp({ text }: { text: string }) {
  return (
    <span className="upload-option-help" tabIndex={0} role="img" aria-label={t(text)} title={t(text)} onClick={(e) => e.preventDefault()}>
      <Icon name="help" size={14} />
    </span>
  );
}
