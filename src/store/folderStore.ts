// Documents in folders on the computer (Chrome / Edge): a folder's project files — at every level of its
// subfolders — open as documents linked to their files; every save of a linked document writes its file too. The
// file is the document's main copy — opened from the folder, the newer of the file and the copy in the browser
// wins. Several folders can be added; subfolders are made, renamed and moved, files are moved between them.

import { create } from 'zustand';
import type { CadDocument, ProjectVersion } from '../core/types';
import { docId } from '../core/ids';
import * as db from './persistence';
import { useDoc } from './docStore';
import { fileVersions, importVersions, useVersions } from './versions';
import { useEditor } from './editorStore';
import { getEngine } from '../viewport/engineRef';
import { t } from '../i18n';
import {
  baseOf,
  dirOf,
  fileStamp,
  folderAccess,
  folderLinks,
  folderSupported,
  forgetFolder,
  freeFileName,
  freeFolderName,
  joinPath,
  linkFile,
  listFolder,
  makeSubfolder,
  moveFolderFile,
  movedPath,
  moveSubfolder,
  pickFolder,
  readFolderFile,
  sameStamp,
  savedFolders,
  within,
  writeFolderFile,
  type FileLink,
  type FileStamp,
  type FolderFile,
} from './localFolder';

export interface Folder {
  id: string;
  dir: FileSystemDirectoryHandle;
  /** Whether it may be read and written now (after a browser restart it has to be allowed again). */
  access: boolean;
  /** Its project files at every level (`name` — the path in the folder). */
  files: FolderFile[];
  /** Its subfolders at every level (paths), a parent before its children. */
  dirs: string[];
}

/** The names of what is right in a subfolder of a folder: its project files and subfolders. */
export function namesIn(f: Pick<Folder, 'files' | 'dirs'>, dir: string): string[] {
  return [...f.files.map((x) => x.name), ...f.dirs].flatMap((name) => (dirOf(name) === dir ? [baseOf(name)] : []));
}

/** The subfolders right inside a subfolder (paths). */
export const subfoldersOf = (f: Pick<Folder, 'dirs'>, dir: string) => f.dirs.filter((d) => dirOf(d) === dir);

interface FolderState {
  folders: Folder[];
  /** Documents that are files of the folders: id → the file. */
  links: Record<string, FileLink>;
  /** The document whose last write to its file failed (no access, the file is busy…). */
  writeError: string | null;
  /** The folders added before are in `folders` (until then a folder of the list may still be missing). */
  ready: boolean;
}

export const useFolder = create<FolderState>(() => ({ folders: [], links: {}, writeError: null, ready: false }));

const folderOf = (id: string) => useFolder.getState().folders.find((f) => f.id === id);
const setFolder = (id: string, patch: Partial<Folder>) => useFolder.setState((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

/**
 * The text of a project file: the document as JSON (indented, so that it reads and compares well), with its
 * versions (`versions`, oldest first; the history stays in the browser), the workspaces it is not in
 * (`workspaces`: the ones `versions` has with `kind: 'workspace'`) and its card's picture (`thumbnail`, last: a
 * folder shows it before the file is opened in the browser).
 */
export function projectText(doc: CadDocument, versions: ProjectVersion[] = [], thumbnail?: string): string {
  const named = versions.filter((v) => v.kind !== 'workspace');
  const workspaces = versions.flatMap(({ kind, ...w }) => (kind === 'workspace' ? [w] : []));
  return JSON.stringify({ ...doc, ...(named.length ? { versions: named } : {}), ...(workspaces.length ? { workspaces } : {}), ...(thumbnail ? { thumbnail } : {}) }, null, 1);
}

/**
 * A document, its versions (and workspaces: `kind: 'workspace'`) and its card's picture from a project file
 * (already parsed JSON); throws on anything else.
 */
export function readProject(raw: unknown, title: string): { doc: CadDocument; versions: ProjectVersion[]; thumbnail?: string } {
  const { versions, workspaces, thumbnail, ...doc } = (raw ?? {}) as CadDocument & { versions?: ProjectVersion[]; workspaces?: ProjectVersion[]; thumbnail?: unknown };
  if (!raw || typeof raw !== 'object' || !Array.isArray(doc.tabs) || !doc.units) throw new Error('Invalid project file');
  const now = Date.now();
  return {
    doc: { ...doc, id: typeof doc.id === 'string' && doc.id ? doc.id : docId(), name: doc.name || title, created: doc.created ?? now, modified: doc.modified ?? now, version: 1 },
    versions: [...(Array.isArray(versions) ? versions : []), ...(Array.isArray(workspaces) ? workspaces.map((w) => ({ ...w, kind: 'workspace' as const })) : [])],
    ...(typeof thumbnail === 'string' && thumbnail.startsWith('data:image/') ? { thumbnail } : {}),
  };
}

/** A document's project file text as the browser has it: with its versions and its card's picture. */
async function fileText(doc: CadDocument): Promise<string> {
  return projectText(doc, await fileVersions(doc.id), await db.getThumbnail(doc.id));
}

/**
 * The open document's project file (to export): with its versions and its picture — made now from the graphics
 * area when it shows the document's model (a Part Studio, an assembly), else the one it has.
 */
export async function exportProjectText(doc: CadDocument): Promise<string> {
  const open = useDoc.getState().doc;
  const shows = open?.id === doc.id && open.tabs.find((x) => x.id === open.activeTab)?.type !== 'drawing';
  const fresh = shows && !useDoc.getState().readOnly ? getEngine()?.thumbnail() : '';
  if (fresh) await db.saveThumbnail(doc.id, fresh);
  return fileText(doc);
}

/** The pictures of a folder's files by `path|modified|size` (a file read again only when it changed). */
const fileThumbs = new Map<string, string | null>();

const thumbKey = (f: FolderFile) => `${f.name}|${f.modified}|${f.size}`;

/** A folder's files with the pictures read before (those not read yet — without). */
const withKnownThumbnails = (files: FolderFile[]) =>
  files.map((f) => {
    const thumbnail = fileThumbs.get(thumbKey(f));
    return thumbnail ? { ...f, thumbnail } : f;
  });

/** A folder's files with their pictures (read from the files: their documents may not be in the browser yet). */
async function withThumbnails(dir: FileSystemDirectoryHandle, files: FolderFile[]): Promise<FolderFile[]> {
  // a few files at a time: a folder with many subfolders is not read all at once
  const queue = files.filter((f) => !fileThumbs.has(thumbKey(f)));
  const read = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        fileThumbs.set(thumbKey(f), readProject(JSON.parse(await readFolderFile(dir, f.name)), f.title).thumbnail ?? null);
      } catch {
        fileThumbs.set(thumbKey(f), null);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, read));
  return withKnownThumbnails(files);
}

/** A document from the text of a project file (without its versions); throws on anything else. */
export const parseProject = (text: string, title: string): CadDocument => readProject(JSON.parse(text), title).doc;

/** Whether two copies of a document have the same content (not counting when they were saved, the tab open). */
export const sameContent = (a: CadDocument, b: CadDocument) => {
  const content = (d: CadDocument) => JSON.stringify({ ...d, modified: 0, version: 0, activeTab: '' });
  return content(a) === content(b);
};

/** The linked files as this tab last wrote or read them: document id → the file's stamp (another program's change shows). */
const stamps = new Map<string, FileStamp>();

/** Remember a linked file as it is now (just written or read by this tab). */
async function remember(docId: string, dir: FileSystemDirectoryHandle, name: string) {
  try {
    stamps.set(docId, await fileStamp(dir, name));
  } catch {
    stamps.delete(docId);
  }
}

let checking = false;

/**
 * The open document's file changed by another program (an editor, git, a cloud folder's sync, WebCAD in another
 * tab): the document is read again from it. Not while it is being edited (a sketch or a feature open, a save on
 * its way) — then at the next check; and if the document is written first, the other program's file is kept beside.
 */
export async function checkLinked() {
  const { doc, readOnly } = useDoc.getState();
  const l = doc && useFolder.getState().links[doc.id];
  const f = l && folderOf(l.folder);
  if (checking || !doc || !l || !f?.access || readOnly) return;
  checking = true;
  try {
    const was = stamps.get(doc.id);
    const now = await fileStamp(f.dir, l.name);
    if (!was) return void stamps.set(doc.id, now);
    const busy = () => useDoc.getState().saving || !!useEditor.getState().editing || useDoc.getState().doc !== doc;
    if (sameStamp(was, now) || busy()) return;
    const { doc: fromFile, versions } = readProject(JSON.parse(await readFolderFile(f.dir, l.name)), doc.name);
    // edited meanwhile: the next check
    if (busy()) return;
    stamps.set(doc.id, now);
    if (sameContent(fromFile, doc)) return;
    // the tab open stays open if the file still has it
    const next = { ...fromFile, id: doc.id, activeTab: fromFile.tabs.some((x) => x.id === doc.activeTab) ? doc.activeTab : fromFile.activeTab };
    await db.saveDocument(next);
    await importVersions(doc.id, versions, true);
    await useDoc.getState().openDocument(doc.id);
    useEditor.getState().showToast(t('The file was changed by another program: the document is read again'), 'info');
  } catch {
    // the file is gone or busy just now: at the next check
  } finally {
    checking = false;
  }
}

/** The last reading of each folder's list: an earlier one that ends later does not put back what it read. */
const readings = new Map<string, number>();

/** Read a folder's files and subfolders again: the list at once, then the pictures of the files not read before. */
export async function refreshFolder(id: string) {
  const f = folderOf(id);
  if (!f) return;
  if (!f.access) return setFolder(id, { files: [], dirs: [] });
  const reading = (readings.get(id) ?? 0) + 1;
  readings.set(id, reading);
  const latest = () => readings.get(id) === reading;
  try {
    const { files, dirs } = await listFolder(f.dir);
    if (!latest()) return;
    setFolder(id, { files: withKnownThumbnails(files), dirs });
    if (files.some((x) => !fileThumbs.has(thumbKey(x)))) {
      const pictured = await withThumbnails(f.dir, files);
      if (latest()) setFolder(id, { files: pictured });
    }
  } catch {
    // the folder was moved or deleted
    if (latest()) setFolder(id, { access: false, files: [], dirs: [] });
  }
}

let started = false;

/** Load the folders added before and start writing linked documents to their files. */
export async function startFolder() {
  if (started || !folderSupported()) return;
  started = true;
  const saved = await savedFolders();
  const folders = await Promise.all(saved.map(async ({ id, dir }) => ({ id, dir, access: await folderAccess(dir).catch(() => false), files: [], dirs: [] })));
  useFolder.setState({ folders, links: await folderLinks(), ready: true });
  await Promise.all(folders.map((f) => refreshFolder(f.id)));
  // after every save of the open document in the browser: its file too
  useDoc.subscribe((s, prev) => {
    if (prev.saving && !s.saving && s.doc) void writeLinked(s.doc);
  });
  // a version made or deleted, a workspace kept or opened: the file keeps the versions and workspaces too
  const named = (s: { versions: { id: string; kind: string; created: number }[] }) =>
    s.versions.flatMap((v) => (v.kind === 'version' ? [v.id] : v.kind === 'workspace' ? [`${v.id}@${v.created}`] : [])).join();
  useVersions.subscribe((s, prev) => {
    if (s.docId && s.docId === prev.docId && prev.loaded && named(s) !== named(prev)) void syncLinked(s.docId);
  });
  // the open document's file changed by another program: read again (every few seconds, and on coming back)
  setInterval(() => document.visibilityState === 'visible' && void checkLinked(), 3000);
  window.addEventListener('focus', () => void checkLinked());
}

/** Add a folder (the system dialog); a folder added before is just allowed again. Its id, or null if cancelled. */
export async function addFolder(): Promise<string | null> {
  const picked = await pickFolder();
  if (!picked) return null;
  const known = folderOf(picked.id);
  if (known) setFolder(picked.id, { dir: picked.dir, access: true });
  else useFolder.setState((s) => ({ folders: [...s.folders, { ...picked, access: true, files: [], dirs: [] }] }));
  await refreshFolder(picked.id);
  return picked.id;
}

/** Allow a folder again (asks the user; from a click), then write what the open document could not meanwhile. */
export async function allowFolder(id: string) {
  const f = folderOf(id);
  if (!f) return;
  setFolder(id, { access: await folderAccess(f.dir, true).catch(() => false) });
  useFolder.setState({ writeError: null });
  await refreshFolder(id);
  const doc = useDoc.getState().doc;
  if (doc) await writeLinked(doc);
}

/** Forget a folder: its files and their documents stay, no longer linked. */
export async function removeFolder(id: string) {
  await forgetFolder(id);
  useFolder.setState((s) => ({
    folders: s.folders.filter((f) => f.id !== id),
    links: Object.fromEntries(Object.entries(s.links).filter(([, l]) => l.folder !== id)),
  }));
}

/**
 * Write a document to its file (if it is linked and its folder is allowed). A document renamed since its file got
 * its name renames the file too.
 */
export async function writeLinked(doc: CadDocument) {
  const l = useFolder.getState().links[doc.id];
  const f = l && folderOf(l.folder);
  if (!l || !f) return;
  if (!f.access) return useFolder.setState({ writeError: doc.id });
  try {
    // changed by another program since this tab wrote or read it (not read again: the document was being edited) —
    // that file is kept beside this one, not overwritten
    const was = stamps.get(doc.id);
    const now = was && (await fileStamp(f.dir, l.name).catch(() => undefined));
    // beside its file: in the same subfolder
    const dir = dirOf(l.name);
    let kept = '';
    if (was && now && !sameStamp(was, now)) {
      kept = freeFileName(`${l.title ?? doc.name} (${t('changed outside')})`, namesIn(f, dir));
      await writeFolderFile(f.dir, joinPath(dir, kept), await readFolderFile(f.dir, l.name));
    }
    let name = l.name;
    if (l.title !== doc.name) {
      if (l.title !== undefined)
        name = await moveFolderFile(f.dir, l.name, joinPath(dir, freeFileName(doc.name, namesIn(f, dir).filter((n) => n !== baseOf(l.name)))));
      await link(doc.id, { ...l, name, title: doc.name });
    }
    const thumbnail = await db.getThumbnail(doc.id);
    await writeFolderFile(f.dir, name, projectText(doc, await fileVersions(doc.id), thumbnail));
    writtenThumbs.set(doc.id, thumbnail);
    await remember(doc.id, f.dir, name);
    if (kept) useEditor.getState().showToast(`${t('Another program changed the file at the same time: its version is kept as')} «${kept}»`, 'info');
    if (name !== l.name || kept) await refreshFolder(f.id);
    if (useFolder.getState().writeError) useFolder.setState({ writeError: null });
  } catch {
    useFolder.setState({ writeError: doc.id });
    setFolder(f.id, { access: await folderAccess(f.dir).catch(() => false) });
  }
}

/** Write a document of the browser to its file, if it has one (after it changed outside the editor). */
export async function syncLinked(docId: string) {
  if (!useFolder.getState().links[docId]) return;
  const doc = await db.loadDocument(docId);
  if (doc) await writeLinked(doc);
}

/** The picture each linked document's file was last written with (by this tab). */
const writtenThumbs = new Map<string, string | undefined>();

/** A document's picture made anew: its file too, when it has another one (the model changed since it was written). */
export async function syncThumbnail(docId: string) {
  if (!useFolder.getState().links[docId] || useDoc.getState().saving) return;
  if (writtenThumbs.has(docId) && writtenThumbs.get(docId) === (await db.getThumbnail(docId))) return;
  await syncLinked(docId);
}

async function link(docId: string, l: FileLink) {
  await linkFile(docId, l);
  useFolder.setState((s) => ({ links: { ...s.links, [docId]: l } }));
}

/** The document linked to a file of a folder (by its path), if there is one. */
const linkedTo = (folderId: string, name: string) => {
  const { links } = useFolder.getState();
  return Object.keys(links).find((id) => links[id].folder === folderId && links[id].name === name);
};

/**
 * Rename a project file of a folder: the file and the document in it get the new name (its document in the
 * browser too). Its content comes from the newer of the file and the browser's copy.
 */
export async function renameFolderDoc(folderId: string, name: string, title: string) {
  const f = folderOf(folderId);
  title = title.trim();
  if (!f?.access || !title) return;
  const docId = linkedTo(folderId, name);
  const { doc: fromFile, versions, thumbnail } = readProject(JSON.parse(await readFolderFile(f.dir, name)), title);
  const local = docId ? await db.loadDocument(docId) : undefined;
  const file = f.files.find((x) => x.name === name);
  const doc = { ...(local && file && local.modified > file.modified ? local : fromFile), name: title };
  const dir = dirOf(name);
  const to = await moveFolderFile(f.dir, name, joinPath(dir, freeFileName(title, namesIn(f, dir).filter((n) => n !== baseOf(name)))));
  // its versions and picture: the browser's (with the file's versions), or the file's own when it is not open here
  if (docId) await importVersions(docId, versions, true);
  await writeFolderFile(f.dir, to, docId ? await fileText({ ...doc, id: docId }) : projectText(doc, versions, thumbnail));
  if (docId) {
    await link(docId, { folder: folderId, name: to, title });
    await remember(docId, f.dir, to);
    await useDoc.getState().renameDocument(docId, title);
  }
  await refreshFolder(folderId);
}

/**
 * Open a project file of a folder as a document: the same document again when it is linked to this file (the
 * newer of the file and the browser's copy wins); a new one otherwise. Returns its id.
 */
export async function openFolderFile(folderId: string, name: string): Promise<string> {
  const f = folderOf(folderId);
  if (!f) throw new Error('No folder');
  const { links } = useFolder.getState();
  const file = f.files.find((x) => x.name === name);
  const { doc: fromFile, versions, thumbnail } = readProject(JSON.parse(await readFolderFile(f.dir, name)), baseOf(name).replace(/\.webcad\.json$/i, ''));
  const linkedId = linkedTo(folderId, name);
  const local = linkedId ? await db.loadDocument(linkedId) : undefined;
  let doc: CadDocument;
  if (local && file && local.modified > file.modified + 1000) {
    // changed here while the folder could not be written: the browser's copy goes to the file (versions of both)
    doc = local;
    await importVersions(doc.id, versions, true);
    await writeFolderFile(f.dir, name, await fileText(doc));
  } else {
    // the file is the main copy. Not linked yet: a document with its id that is already in the browser (of another
    // file, or the browser's own) is not overwritten — this one gets a new id
    const taken = !linkedId && (!!(await db.loadDocument(fromFile.id)) || links[fromFile.id] !== undefined);
    doc = { ...fromFile, id: linkedId ?? (taken ? docId() : fromFile.id) };
    // the file's picture, until the document makes its own here
    await db.saveDocument(doc, (await db.getThumbnail(doc.id)) ? undefined : thumbnail);
    // its versions: the file's own document keeps their ids, a new one gets copies
    await importVersions(doc.id, versions, doc.id === fromFile.id || doc.id === linkedId);
  }
  // a document of a folder is never in the browser's trash
  if (useDoc.getState().docs.find((d) => d.id === doc.id)?.trashed) await db.setTrashed(doc.id, null);
  // the file keeps its name (it may differ from the document's) until the document is renamed
  await link(doc.id, { folder: folderId, name, title: doc.name });
  await remember(doc.id, f.dir, name);
  await useDoc.getState().loadList();
  return doc.id;
}

/**
 * Save a browser document into a folder (at its top, or into the subfolder `dir`) as a new file and link them. The
 * file's path, or null.
 */
export async function saveToFolder(docId: string, folderId: string, dir = ''): Promise<string | null> {
  const f = folderOf(folderId);
  const doc = await db.loadDocument(docId);
  if (!f?.access || !doc) return null;
  const name = joinPath(dir, freeFileName(doc.name, namesIn(f, dir)));
  await writeFolderFile(f.dir, name, await fileText(doc));
  await link(doc.id, { folder: folderId, name, title: doc.name });
  await remember(doc.id, f.dir, name);
  await refreshFolder(folderId);
  return name;
}

/** A new document as a file of a folder (of its subfolder `dir`). Returns its id. */
export async function createInFolder(folderId: string, name: string, dir = ''): Promise<string | null> {
  const id = await useDoc.getState().createDocument(name);
  return (await saveToFolder(id, folderId, dir)) ? id : null;
}

/** A new subfolder in the subfolder `parent` of a folder ("New folder", "New folder (2)"… when taken). Its path. */
export async function createSubfolder(folderId: string, parent: string, name: string): Promise<string | null> {
  const f = folderOf(folderId);
  if (!f?.access) return null;
  const path = joinPath(parent, freeFolderName(name, namesIn(f, parent), t('New folder')));
  await makeSubfolder(f.dir, path);
  await refreshFolder(folderId);
  return path;
}

/** The documents linked to the files under `from` (a file or a subfolder of a folder) now under `to`: their links. */
async function relink(folderId: string, from: string, to: string, toFolderId = folderId) {
  const g = folderOf(toFolderId);
  const { links } = useFolder.getState();
  for (const [id, l] of Object.entries(links))
    if (l.folder === folderId && within(l.name, from)) {
      const name = movedPath(l.name, from, to);
      await link(id, { ...l, folder: toFolderId, name });
      // its stamp anew: a copy (where the browser cannot move files) is a file of another time, not another program's change
      if (g) await remember(id, g.dir, name);
    }
}

/**
 * Move a subfolder of a folder (with everything in it) into another subfolder of it (`toDir`, "" — the top) and,
 * with `name`, rename it. Its documents stay linked to their files. The path it has now.
 */
export async function moveFolderDir(folderId: string, path: string, toDir: string, name = baseOf(path)): Promise<string> {
  const f = folderOf(folderId);
  name = name.trim();
  if (!f?.access || !path || !name) return path;
  if (within(toDir, path)) throw new Error(t('A folder cannot be moved into itself'));
  if (toDir === dirOf(path) && name === baseOf(path)) return path;
  const sameName = (n: string) => n.toLowerCase() === baseOf(path).toLowerCase();
  // only the letter case of its name changes: not a name taken by itself
  const others = namesIn(f, toDir).filter((n) => !(toDir === dirOf(path) && sameName(n)));
  const to = await moveSubfolder(f.dir, path, joinPath(toDir, freeFolderName(name, others, t('New folder'))));
  await relink(folderId, path, to);
  await refreshFolder(folderId);
  return to;
}

/**
 * Move a project file of a folder into a subfolder (`toDir`, "" — the top) of this folder or of another one
 * (`toFolderId`); a name taken there gets a number. Its document stays linked to it. The path it has now.
 */
export async function moveFolderDoc(folderId: string, name: string, toFolderId: string, toDir: string): Promise<string> {
  const f = folderOf(folderId);
  const g = folderOf(toFolderId);
  if (!f?.access || !g?.access) return name;
  if (toFolderId === folderId && dirOf(name) === toDir) return name;
  const file = f.files.find((x) => x.name === name);
  const to = await moveFolderFile(f.dir, name, joinPath(toDir, freeFileName(file?.title ?? baseOf(name).replace(/\.webcad\.json$/i, ''), namesIn(g, toDir))), g.dir);
  await relink(folderId, name, to, toFolderId);
  await refreshFolder(folderId);
  if (toFolderId !== folderId) await refreshFolder(toFolderId);
  return to;
}
