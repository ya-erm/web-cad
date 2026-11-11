import { Fragment, useEffect, useRef, useState } from 'react';
import { useDoc } from '../store/docStore';
import {
  addFolder,
  allowFolder,
  createInFolder,
  createSubfolder,
  moveFolderDir,
  moveFolderDoc,
  openFolderFile,
  readProject,
  refreshFolder,
  removeFolder,
  renameFolderDoc,
  saveToFolder,
  subfoldersOf,
  syncLinked,
  useFolder,
  type Folder,
} from '../store/folderStore';
import { copiedVersionIds, importVersions, withCopiedVersions } from '../store/versions';
import { baseOf, dirOf, folderSupported, within, type FileLink } from '../store/localFolder';
import { useEditor, type ContextMenuItem } from '../store/editorStore';
import { Icon } from './icons';
import { ContextMenu } from './Overlays';
import { AppSettingsButton, LangSwitch } from './AppSettings';
import { t, getLang } from '../i18n';
import { openHelp } from '../help/context';
import { APP_VERSION, appVersionTitle } from './version';

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

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** Run an action of the folder pages, showing what went wrong. */
function useRun() {
  const [error, setError] = useState<string | null>(null);
  const run: Run = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { error, run };
}

// --- moving files and subfolders: dragging them onto a subfolder, or the "Move to folder" window ---------------

/** A file of a folder or a subfolder to move. */
type Moving = { kind: 'file'; folder: string; name: string } | { kind: 'dir'; folder: string; path: string };
/** What is being dragged on the page: a file or a subfolder of a folder, a document of the browser. */
type Dragged = Moving | { kind: 'doc'; id: string };

let dragged: Dragged | null = null;

function startDrag(e: React.DragEvent, d: Dragged, label: string) {
  dragged = d;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', label);
}
const endDrag = () => (dragged = null);

/** What moving the file or subfolder into the subfolder `dir` of a folder does, or null when it cannot go there. */
function moveAction(m: Moving, f: Folder, dir: string): (() => Promise<unknown>) | null {
  if (!f.access) return null;
  if (m.kind === 'dir') return m.folder === f.id && !within(dir, m.path) && dirOf(m.path) !== dir ? () => moveFolderDir(f.id, m.path, dir) : null;
  return m.folder === f.id && dirOf(m.name) === dir ? null : () => moveFolderDoc(m.folder, m.name, f.id, dir);
}

/**
 * What dropping the dragged thing into the subfolder `dir` of a folder does: a file or a subfolder moves there, a
 * document of the browser is saved there (one that is a file already — its file moves). Null: it cannot go there.
 */
function dropAction(d: Dragged | null, f: Folder, dir: string, links: Record<string, FileLink>, folders: Folder[]) {
  if (!d) return null;
  if (d.kind !== 'doc') return moveAction(d, f, dir);
  const l = links[d.id];
  if (!l) return f.access ? () => saveToFolder(d.id, f.id, dir) : null;
  return folders.some((x) => x.id === l.folder && x.access) ? moveAction({ kind: 'file', folder: l.folder, name: l.name }, f, dir) : null;
}

/** The subfolders as drop targets: the handlers of each and whether the dragged thing is over it now. */
function useDropTargets(run: Run) {
  const folders = useFolder((s) => s.folders);
  const links = useFolder((s) => s.links);
  const [over, setOver] = useState<string | null>(null);
  const props = (f: Folder, dir: string) => {
    const key = `${f.id}:${dir}`;
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dropAction(dragged, f, dir, links, folders)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dragged?.kind === 'doc' && !links[dragged.id] ? 'copy' : 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver((o) => (o === key ? null : o)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(null);
        const action = dropAction(dragged, f, dir, links, folders);
        dragged = null;
        if (action) void run(action);
      },
    };
  };
  return { props, over: (f: Folder, dir: string) => (over === `${f.id}:${dir}` ? ' drop-over' : '') };
}

type DropTargets = ReturnType<typeof useDropTargets>;

/** Choose the subfolder (of any folder for a file, of its own for a subfolder) to move a file or a subfolder into. */
function MoveDialog({ what, onClose, run }: { what: Moving; onClose: () => void; run: Run }) {
  const folders = useFolder((s) => s.folders).filter((f) => f.access && (what.kind === 'file' || f.id === what.folder));
  const [target, setTarget] = useState<{ folder: string; dir: string } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const name = what.kind === 'file' ? baseOf(what.name).replace(/\.webcad\.json$/i, '') : baseOf(what.path);
  const chosen = target && folders.find((f) => f.id === target.folder);
  const action = chosen ? moveAction(what, chosen, target.dir) : null;
  // the window closes first: what went wrong shows on the page
  const move = (a: (() => Promise<unknown>) | null) =>
    a &&
    void run(async () => {
      onClose();
      await a();
    });
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal move-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="folder" /> &nbsp;{t('Move to folder')}
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="move-what">
            <Icon name={what.kind === 'file' ? 'partStudio' : 'folder'} size={16} /> {name}
          </div>
          <div className="move-tree">
            {folders.flatMap((f) =>
              ['', ...f.dirs].map((dir) => {
                const can = !!moveAction(what, f, dir);
                const on = target?.folder === f.id && target.dir === dir;
                return (
                  <button
                    key={`${f.id}:${dir}`}
                    className={'move-row' + (on ? ' on' : '')}
                    style={{ paddingLeft: 8 + (dir ? dir.split('/').length : 0) * 16 }}
                    disabled={!can}
                    title={can ? undefined : t('It is here already, or it cannot go there')}
                    onClick={() => setTarget({ folder: f.id, dir })}
                    onDoubleClick={() => move(moveAction(what, f, dir))}
                  >
                    <Icon name="folder" size={16} /> <span className="docs-nav-name">{dir ? baseOf(dir) : f.dir.name}</span>
                  </button>
                );
              }),
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={!action} onClick={() => move(action)}>
            {t('Move')}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- folders on the computer ---------------------------------------------------------------------------------

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

/** The name being edited on a card (a file's or a subfolder's): Enter or leaving the field keeps it, Esc does not. */
function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  return (
    <input
      className="tree-rename"
      autoFocus
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const v = e.target.value.trim();
        onDone(v && v !== value ? v : null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

/**
 * A subfolder of a folder on the computer (Chrome / Edge; "" — the folder itself): the way to it, its subfolders and
 * project files as cards, a new document or subfolder in it. Without access (after the browser restarted) — a
 * button to allow it again.
 */
function FolderView({
  folder,
  path,
  onGo,
  onOpen,
  onRemoved,
  onMove,
  run,
  drop,
}: {
  folder: Folder;
  path: string;
  onGo: (path: string) => void;
  onOpen: (id: string) => void;
  onRemoved: () => void;
  onMove: (what: Moving) => void;
  run: Run;
  drop: DropTargets;
}) {
  const links = useFolder((s) => s.links);
  const docs = useDoc((s) => s.docs);
  /** The card being renamed: `file:<path>` or `dir:<path>`. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const { id: folderId, dir, access } = folder;
  const files = folder.files.filter((f) => dirOf(f.name) === path);
  const subs = subfoldersOf(folder, path);
  const open = (name: string) =>
    run(async () => {
      try {
        onOpen(await openFolderFile(folderId, name));
      } catch (e) {
        throw new Error(`${baseOf(name)}: ${t('Invalid project file')}`, { cause: e });
      }
    });
  const create = () =>
    run(async () => {
      const id = await createInFolder(folderId, t('Untitled document'), path);
      if (id) onOpen(id);
    });
  // a new subfolder gets its name right away
  const newFolder = () =>
    run(async () => {
      const p = await createSubfolder(folderId, path, t('New folder'));
      if (p) setRenaming(`dir:${p}`);
    });
  // the picture of its document in the browser, else the one the file keeps (a file not opened here yet)
  const thumb = (name: string) => {
    const id = Object.keys(links).find((k) => links[k].folder === folderId && links[k].name === name);
    return (id ? docs.find((d) => d.id === id)?.thumbnail : undefined) ?? files.find((f) => f.name === name)?.thumbnail;
  };
  const levels = path ? path.split('/') : [];
  const crumbs = ['', ...levels.map((_, i) => levels.slice(0, i + 1).join('/'))];
  return (
    <>
      <div className="folder-bar">
        <Icon name="folder" size={16} />
        <nav className="folder-crumbs">
          {crumbs.map((c, i) => (
            <Fragment key={c}>
              {i > 0 && <Icon name="chevronRight" size={12} />}
              <button className={'folder-crumb' + (c === path ? ' current' : '') + drop.over(folder, c)} onClick={() => onGo(c)} {...drop.props(folder, c)}>
                {c ? baseOf(c) : dir.name}
              </button>
            </Fragment>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        {access && (
          <>
            <button className="btn small primary" onClick={() => void create()}>
              <Icon name="plus" size={14} /> {t('New document in the folder')}
            </button>
            <button className="btn small" onClick={() => void newFolder()}>
              <Icon name="folder" size={14} /> {t('New folder')}
            </button>
            <button className="btn small" onClick={() => void run(() => refreshFolder(folderId))}>
              {t('Refresh')}
            </button>
          </>
        )}
        {!path && (
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
        )}
      </div>
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
      ) : files.length === 0 && subs.length === 0 ? (
        <div className="empty-state">
          <Icon name="folder" size={40} />
          <h3>{t('No WebCAD documents in this folder yet')}</h3>
          <div className="folder-hint">{t('Create a document or a folder here, or save one of your documents into the folder from its card.')}</div>
        </div>
      ) : (
        <>
          {subs.length > 0 && (
            <div className="folder-grid">
              {subs.map((p) => {
                const key = `dir:${p}`;
                const count = folder.files.filter((f) => within(f.name, p)).length;
                const menu = (): ContextMenuItem[] => [
                  { label: t('Open'), icon: 'folder', action: () => onGo(p) },
                  { label: t('Rename'), icon: 'rename', action: () => setRenaming(key) },
                  { label: t('Move to folder…'), icon: 'folder', action: () => onMove({ kind: 'dir', folder: folderId, path: p }) },
                ];
                return (
                  <div
                    key={p}
                    className={'doc-card folder-card' + drop.over(folder, p)}
                    title={p}
                    draggable={renaming !== key}
                    onDragStart={(e) => startDrag(e, { kind: 'dir', folder: folderId, path: p }, baseOf(p))}
                    onDragEnd={endDrag}
                    onClick={() => renaming !== key && onGo(p)}
                    onContextMenu={(e) => renaming !== key && openCardMenu(e, `${folderId}:${key}`, menu())}
                    {...drop.props(folder, p)}
                  >
                    <Icon name="folder" size={24} />
                    <div className="doc-meta">
                      {renaming === key ? (
                        // everything in it stays, its documents stay linked to their files
                        <RenameInput
                          value={baseOf(p)}
                          onDone={(v) => {
                            setRenaming(null);
                            if (v) void run(() => moveFolderDir(folderId, p, path, v));
                          }}
                        />
                      ) : (
                        <div className="doc-name">{baseOf(p)}</div>
                      )}
                      <div className="doc-date">{count ? `${t('Documents')}: ${count}` : t('Empty folder')}</div>
                    </div>
                    <CardMenuButton owner={`${folderId}:${key}`} items={menu} />
                  </div>
                );
              })}
            </div>
          )}
          {files.length > 0 && (
            <div className="docs-grid">
              {files.map((f) => {
                const key = `file:${f.name}`;
                const src = thumb(f.name);
                const menu = (): ContextMenuItem[] => [
                  { label: t('Rename'), icon: 'rename', action: () => setRenaming(key) },
                  { label: t('Move to folder…'), icon: 'folder', action: () => onMove({ kind: 'file', folder: folderId, name: f.name }) },
                ];
                return (
                  <div
                    key={f.name}
                    className="doc-card"
                    title={f.name}
                    draggable={renaming !== key}
                    onDragStart={(e) => startDrag(e, { kind: 'file', folder: folderId, name: f.name }, f.title)}
                    onDragEnd={endDrag}
                    onClick={() => renaming !== key && void open(f.name)}
                    onContextMenu={(e) => renaming !== key && openCardMenu(e, `${folderId}:${key}`, menu())}
                  >
                    <div className="doc-thumb">{src ? <img src={src} alt="" draggable={false} /> : <Icon name="partStudio" size={40} />}</div>
                    <div className="doc-meta">
                      {renaming === key ? (
                        // the file and its document get the new name
                        <RenameInput
                          value={f.title}
                          onDone={(v) => {
                            setRenaming(null);
                            if (v) void run(() => renameFolderDoc(folderId, f.name, v));
                          }}
                        />
                      ) : (
                        <div className="doc-name">{f.title}</div>
                      )}
                      <div className="doc-date">
                        {t('Modified')}: {fmtDate(f.modified)} · {fmtSize(f.size)}
                      </div>
                    </div>
                    <CardMenuButton owner={`${folderId}:${key}`} items={menu} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** A folder and its subfolders in the side list: a tree whose branches open with their arrows. */
function FolderNav({
  folder,
  shown,
  expanded,
  onToggle,
  onGo,
  drop,
}: {
  folder: Folder;
  /** The subfolder shown now when it is of this folder. */
  shown: string | null;
  expanded: string[];
  onToggle: (key: string) => void;
  onGo: (path: string) => void;
  drop: DropTargets;
}) {
  const node = (path: string, depth: number): React.ReactNode => {
    const kids = subfoldersOf(folder, path);
    const key = `${folder.id}:${path}`;
    const open = expanded.includes(key);
    const name = path ? baseOf(path) : folder.dir.name;
    return (
      <Fragment key={key}>
        <button
          className={'docs-nav-item folder-nav' + (shown === path ? ' active' : '') + drop.over(folder, path)}
          style={{ paddingLeft: 4 + depth * 14 }}
          title={folder.access ? (path ? `${folder.dir.name}/${path}` : name) : `${name}: ${t('The browser asks again for access to the folder')}`}
          onClick={() => onGo(path)}
          {...drop.props(folder, path)}
        >
          <span
            className="tree-toggle"
            title={kids.length ? t(open ? 'Collapse' : 'Expand') : undefined}
            onClick={(e) => {
              if (!kids.length) return;
              e.stopPropagation();
              onToggle(key);
            }}
          >
            {kids.length > 0 && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />}
          </span>
          <Icon name={folder.access ? 'folder' : 'lock'} size={16} /> <span className="docs-nav-name">{name}</span>
        </button>
        {open && kids.map((k) => node(k, depth + 1))}
      </Fragment>
    );
  };
  return node('', 0);
}

// --- the page ------------------------------------------------------------------------------------------------

/** The page shown last in this browser tab (a folder — with its subfolder): the same on coming back from a document. */
const VIEW_KEY = 'webcad.docsView';
/** The branches of the folders' tree that are open (kept in this browser). */
const TREE_KEY = 'webcad.folderTree';

function loadJson<T>(storage: () => Storage, key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const v: unknown = JSON.parse(storage().getItem(key) ?? 'null');
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(storage: () => Storage, key: string, v: unknown) {
  try {
    storage().setItem(key, JSON.stringify(v));
  } catch {
    // not kept: no storage
  }
}

const isView = (v: unknown): v is { view: string; path: string } =>
  !!v && typeof (v as { view?: unknown }).view === 'string' && typeof (v as { path?: unknown }).path === 'string';
const isKeys = (v: unknown): v is string[] => Array.isArray(v) && v.every((k) => typeof k === 'string');

export function DocumentsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const all = useDoc((s) => s.docs);
  const { loadList, createDocument, deleteDocument, renameDocument, duplicateDocument, importDocument, trashDocument, restoreDocument, emptyTrash } =
    useDoc.getState();
  const folders = useFolder((s) => s.folders);
  const links = useFolder((s) => s.links);
  const ready = useFolder((s) => s.ready);
  /** Folders a document can be saved into now. */
  const writable = folders.filter((f) => f.access);
  const [renaming, setRenaming] = useState<string | null>(null);
  const saved = useState(() => loadJson(() => sessionStorage, VIEW_KEY, isView, { view: 'docs', path: '' }))[0];
  /** Documents, the trash, a folder on the computer (`folder:<id>`) or the page about folders (`folders`). */
  const [view, setView] = useState<string>(saved.view);
  /** The subfolder of the folder shown ("" — the folder itself). */
  const [path, setPath] = useState(saved.path);
  /** The open branches of the folders' tree: `<folder id>:<subfolder>`. */
  const [expanded, setExpanded] = useState(() => loadJson(() => localStorage, TREE_KEY, isKeys, []));
  /** The file or subfolder whose "Move to folder" window is open. */
  const [moving, setMoving] = useState<Moving | null>(null);
  const { error, run } = useRun();
  const drop = useDropTargets(run);
  const shownFolder = view.startsWith('folder:') ? folders.find((f) => `folder:${f.id}` === view) : undefined;
  // a subfolder that is gone (removed or renamed by another program): the nearest one above it that is still there
  let shownPath = shownFolder ? path : '';
  while (shownFolder?.access && shownPath && !shownFolder.dirs.includes(shownPath)) shownPath = dirOf(shownPath);
  useEffect(() => saveJson(() => sessionStorage, VIEW_KEY, { view, path }), [view, path]);
  useEffect(() => saveJson(() => localStorage, TREE_KEY, expanded), [expanded]);
  // the folder shown last is no longer in the list
  useEffect(() => {
    if (ready && view.startsWith('folder:') && !shownFolder) setView('docs');
  }, [ready, view, shownFolder]);
  /** Show a subfolder of a folder: its branch of the tree opens down to it. */
  const go = (folderId: string, to: string) => {
    setView(`folder:${folderId}`);
    setPath(to);
    const above = to ? to.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')) : [];
    const keys = (to ? ['', ...above] : []).map((p) => `${folderId}:${p}`);
    setExpanded((x) => (keys.every((k) => x.includes(k)) ? x : [...new Set([...x, ...keys])]));
  };
  const linkTitle = (id: string) => {
    const l = links[id];
    const f = l && folders.find((x) => x.id === l.folder);
    return f ? `${t('A file of the folder on this computer')}: ${f.dir.name}/${l.name}` : undefined;
  };
  const add = async () => {
    if (!folderSupported()) return setView('folders');
    const id = await addFolder().catch(() => null);
    if (id) go(id, '');
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
  const docMenu = (d: (typeof all)[number]): ContextMenuItem[] => {
    const l = links[d.id];
    return d.trashed
      ? [
          { label: t('Restore'), icon: 'undo', action: () => void restoreDocument(d.id) },
          { separator: true, label: '' },
          { label: t('Delete permanently'), icon: 'trash', danger: true, action: () => setConfirming(d.id) },
        ]
      : [
          { label: t('Rename'), icon: 'rename', action: () => setRenaming(d.id) },
          { label: t('Duplicate'), icon: 'copy', action: () => void duplicateDocument(d.id) },
          // a file of a folder: where it is; a document of the browser goes into a folder: one item per folder
          ...(l
            ? folders.some((f) => f.id === l.folder)
              ? [{ label: t('Show in the folder'), icon: 'folder', action: () => go(l.folder, dirOf(l.name)) }]
              : []
            : writable.map((f) => ({ label: `${t('Save to the folder')} «${f.dir.name}»`, icon: 'folder', action: () => void run(() => saveToFolder(d.id, f.id)) }))),
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
          <div
            key={d.id}
            className={'doc-card' + (d.trashed ? ' trashed' : '')}
            // onto a folder of the side list: saved there (a file of a folder — moved there)
            draggable={!d.trashed && renaming !== d.id && writable.length > 0}
            onDragStart={(e) => startDrag(e, { kind: 'doc', id: d.id }, d.name)}
            onDragEnd={endDrag}
            onClick={() => !d.trashed && renaming !== d.id && onOpen(d.id)}
            onContextMenu={(e) => renaming !== d.id && openCardMenu(e, d.id, docMenu(d))}
          >
            <div className="doc-thumb">{d.thumbnail ? <img src={d.thumbnail} alt="" draggable={false} /> : <Icon name="partStudio" size={40} />}</div>
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
          <span className="brand-version" title={appVersionTitle()}>
            {APP_VERSION}
          </span>
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
        <LangSwitch />
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
                const { doc, versions, thumbnail } = readProject(JSON.parse(await f.text()), f.name.replace(/(\.webcad)?\.json$/i, ''));
                // a copy: its versions come as copies too (its Derived features that use them — with them); its picture
                const copies = copiedVersionIds(versions);
                const id = await importDocument(withCopiedVersions(doc, copies), thumbnail);
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
          <div className="docs-nav folders-nav">
            <div className="docs-nav-head">{t('Folders on this computer')}</div>
            {folders.map((f) => (
              <FolderNav
                key={f.id}
                folder={f}
                shown={shownFolder?.id === f.id ? shownPath : null}
                expanded={expanded}
                onToggle={(key) => setExpanded((x) => (x.includes(key) ? x.filter((k) => k !== key) : [...x, key]))}
                onGo={(p) => go(f.id, p)}
                drop={drop}
              />
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
          {error && <div className="docs-error">{error}</div>}
          {shownFolder ? (
            <FolderView
              key={shownFolder.id}
              folder={shownFolder}
              path={shownPath}
              onGo={(p) => go(shownFolder.id, p)}
              onOpen={onOpen}
              onRemoved={() => setView('docs')}
              onMove={setMoving}
              run={run}
              drop={drop}
            />
          ) : view === 'docs' || view === 'trash' ? (
            list
          ) : view === 'folders' ? (
            <FolderIntro onAdded={(id) => go(id, '')} />
          ) : null}
        </div>
      </div>
      {moving && <MoveDialog what={moving} onClose={() => setMoving(null)} run={run} />}
      <ContextMenu />
    </div>
  );
}
