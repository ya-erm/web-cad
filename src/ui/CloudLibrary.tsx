import { Fragment, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { documentTime } from './documentTime';
import { Icon } from './icons';
import { createPortal } from 'react-dom';
import { CardMenuButton, openCardMenu, RenameInput, FolderPreview } from './DocumentCards';
import { CloudMoveDialog } from './CloudMoveDialog';
import { canMoveCloudItem, cloudFolderPreview, type CloudItem } from '../cloud/folders';
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

export function CloudLibrary({
  onOpen,
  onUpload,
  path,
  onGo,
  sidebar,
  heading,
  trash = false,
}: {
  onOpen: (id: string) => void;
  onUpload: (folderId: string, ids?: string[]) => void;
  path: string;
  onGo: (id: string) => void;
  sidebar?: HTMLElement | null;
  heading?: HTMLElement | null;
  trash?: boolean;
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
    [expanded, setExpanded] = useState<string[]>([]);
  const epoch = useRef(0),
    working = useRef(false);
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
    { label: t('Rename'), icon: 'rename', disabled: busy, action: () => setRenaming('folder:' + f.id) },
    { label: t('Move to folder…'), icon: 'folder', disabled: busy, action: () => setMoving({ kind: 'folder', id: f.id }) },
    {
      label: t('Delete empty folder'),
      icon: 'trash',
      danger: true,
      disabled: busy,
      action: () =>
        void act(async () => {
          await ensureLocal();
          const preview = cloudFolderPreview(view.folders, view.documents, f.id);
          if (preview.count || view.folders.some((c) => c.parentId === f.id)) throw new Error('Only empty folders can be deleted');
          validateLibraryChange(view.folders, localDocs, { kind: 'remove', id: f.id });
          if (f.cloudId) await deleteCloudFolder(f.cloudId);
          await changeLibrary({ kind: 'remove', id: f.id });
          await refresh();
        }),
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
            ? [{ label: t('Upload to cloud'), icon: 'cloud', action: () => onUpload(d.folderId, [d.locals[0].id]) }]
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
              className={'docs-nav-item folder-nav' + (current === f.id ? ' active' : '') + dropClass(f.id)}
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
      {heading &&
        createPortal(
          <span className="library-loading" role={busy ? 'status' : undefined} aria-label={busy ? t('Loading…') : undefined}>
            {busy && <span className="spinner" />}
          </span>,
          heading,
        )}
      {sidebar && createPortal(<div className="library-sidebar-tree">{node('')}</div>, sidebar)}
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
          <button className="btn small" disabled={busy || !data} onClick={() => onUpload(current)}>
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
                <div className="doc-meta">
                  {renaming === key ? (
                    <RenameInput value={f.name} onDone={(value) => void rename(item, value)} />
                  ) : (
                    <div className="doc-name">
                      <Icon name="folder" size={14} /> {f.name}
                    </div>
                  )}
                  <div className="doc-date">{preview.count ? `${t('Documents')}: ${preview.count}` : t('Empty folder')}</div>
                </div>
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
  const links = useFolder((s) => s.links);
  const [selected, setSelected] = useState<string[]>(initial ?? []),
    [data, setData] = useState<CloudList | null>(null),
    [localFolders, setLocalFolders] = useState<LibraryFolder[]>([]);
  const [target, setTarget] = useState(initialFolder),
    [copy, setCopy] = useState(false),
    [keepFolders, setKeepFolders] = useState(!initialFolder),
    [replaceExisting, setReplaceExisting] = useState(false),
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
      const destination = await ensureTarget(target);
      for (const id of selected) {
        const doc = docs.find((d) => d.id === id);
        if (!doc) continue;
        setProgress(`${done.length + 1} / ${selected.length}: ${doc.name}`);
        let folderId = destination;
        if (keepFolders && !links[id] && doc.folderId) {
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
          {data && (
            <>
              <label>
                {t('Destination folder')}
                <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">{t('Cloud')}</option>
                  {unifiedLibrary(localFolders, [], data).folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {folderTrail(unifiedLibrary(localFolders, [], data).folders, f.id)
                        .map((p) => p.name)
                        .join(' / ')}
                    </option>
                  ))}
                </select>
              </label>
              <div className="docs-hint">{t('Choose documents to upload.')}</div>
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
                      <small>{links[d.id] ? links[d.id].name : d.cloudSource ? t('Cloud connected') : t('Only on this device')}</small>
                    </span>
                  </label>
                ))}
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

function OptionHelp({ text }: { text: string }) {
  return (
    <span className="upload-option-help" tabIndex={0} role="img" aria-label={t(text)} title={t(text)} onClick={(e) => e.preventDefault()}>
      <Icon name="help" size={14} />
    </span>
  );
}
