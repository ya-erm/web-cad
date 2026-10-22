// Documents in folders on the computer (Chrome / Edge): a folder's project files open as documents linked to their
// files; every save of a linked document writes its file too. The file is the document's main copy — opened from
// the folder, the newer of the file and the copy in the browser wins. Several folders can be added.

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
  fileStamp,
  folderAccess,
  folderLinks,
  folderSupported,
  forgetFolder,
  freeFileName,
  linkFile,
  listFolder,
  pickFolder,
  readFolderFile,
  renameFolderFile,
  sameStamp,
  savedFolders,
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
  files: FolderFile[];
}

interface FolderState {
  folders: Folder[];
  /** Documents that are files of the folders: id → the file. */
  links: Record<string, FileLink>;
  /** The document whose last write to its file failed (no access, the file is busy…). */
  writeError: string | null;
}

export const useFolder = create<FolderState>(() => ({ folders: [], links: {}, writeError: null }));

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

/** The pictures of a folder's files by `name|modified|size` (a file read again only when it changed). */
const fileThumbs = new Map<string, string | null>();

/** A folder's files with their pictures (read from the files: their documents may not be in the browser yet). */
async function withThumbnails(dir: FileSystemDirectoryHandle, files: FolderFile[]): Promise<FolderFile[]> {
  return Promise.all(
    files.map(async (f) => {
      const key = `${f.name}|${f.modified}|${f.size}`;
      if (!fileThumbs.has(key)) {
        try {
          fileThumbs.set(key, readProject(JSON.parse(await readFolderFile(dir, f.name)), f.title).thumbnail ?? null);
        } catch {
          fileThumbs.set(key, null);
        }
      }
      const thumbnail = fileThumbs.get(key);
      return thumbnail ? { ...f, thumbnail } : f;
    }),
  );
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

/** Read a folder's file list again. */
export async function refreshFolder(id: string) {
  const f = folderOf(id);
  if (!f) return;
  if (!f.access) return setFolder(id, { files: [] });
  try {
    setFolder(id, { files: await withThumbnails(f.dir, await listFolder(f.dir)) });
  } catch {
    // the folder was moved or deleted
    setFolder(id, { access: false, files: [] });
  }
}

let started = false;

/** Load the folders added before and start writing linked documents to their files. */
export async function startFolder() {
  if (started || !folderSupported()) return;
  started = true;
  const saved = await savedFolders();
  const folders = await Promise.all(saved.map(async ({ id, dir }) => ({ id, dir, access: await folderAccess(dir).catch(() => false), files: [] })));
  useFolder.setState({ folders, links: await folderLinks() });
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
  else useFolder.setState((s) => ({ folders: [...s.folders, { ...picked, access: true, files: [] }] }));
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
    let kept = '';
    if (was && now && !sameStamp(was, now)) {
      kept = freeFileName(`${l.title ?? doc.name} (${t('changed outside')})`, f.files.map((x) => x.name));
      await writeFolderFile(f.dir, kept, await readFolderFile(f.dir, l.name));
    }
    let name = l.name;
    if (l.title !== doc.name) {
      if (l.title !== undefined) name = await renameFolderFile(f.dir, l.name, freeFileName(doc.name, f.files.map((x) => x.name).filter((n) => n !== l.name)));
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

/**
 * Rename a project file of a folder: the file and the document in it get the new name (its document in the
 * browser too). Its content comes from the newer of the file and the browser's copy.
 */
export async function renameFolderDoc(folderId: string, name: string, title: string) {
  const f = folderOf(folderId);
  title = title.trim();
  if (!f?.access || !title) return;
  const { links } = useFolder.getState();
  const docId = Object.keys(links).find((id) => links[id].folder === folderId && links[id].name === name);
  const { doc: fromFile, versions, thumbnail } = readProject(JSON.parse(await readFolderFile(f.dir, name)), title);
  const local = docId ? await db.loadDocument(docId) : undefined;
  const file = f.files.find((x) => x.name === name);
  const doc = { ...(local && file && local.modified > file.modified ? local : fromFile), name: title };
  const to = await renameFolderFile(f.dir, name, freeFileName(title, f.files.map((x) => x.name).filter((n) => n !== name)));
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
  const { doc: fromFile, versions, thumbnail } = readProject(JSON.parse(await readFolderFile(f.dir, name)), name.replace(/\.webcad\.json$/i, ''));
  const linkedId = Object.keys(links).find((id) => links[id].folder === folderId && links[id].name === name);
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

/** Save a browser document into a folder as a new file and link them. The file name, or null. */
export async function saveToFolder(docId: string, folderId: string): Promise<string | null> {
  const f = folderOf(folderId);
  const doc = await db.loadDocument(docId);
  if (!f?.access || !doc) return null;
  const name = freeFileName(doc.name, f.files.map((x) => x.name));
  await writeFolderFile(f.dir, name, await fileText(doc));
  await link(doc.id, { folder: folderId, name, title: doc.name });
  await remember(doc.id, f.dir, name);
  await refreshFolder(folderId);
  return name;
}

/** A new document as a file of a folder. Returns its id. */
export async function createInFolder(folderId: string, name: string): Promise<string | null> {
  const id = await useDoc.getState().createDocument(name);
  return (await saveToFolder(id, folderId)) ? id : null;
}
