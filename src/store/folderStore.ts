// Documents in folders on the computer (Chrome / Edge): a folder's project files open as documents linked to their
// files; every save of a linked document writes its file too. The file is the document's main copy — opened from
// the folder, the newer of the file and the copy in the browser wins. Several folders can be added.

import { create } from 'zustand';
import type { CadDocument, ProjectVersion } from '../core/types';
import { docId } from '../core/ids';
import * as db from './persistence';
import { useDoc } from './docStore';
import { fileVersions, importVersions, useVersions } from './versions';
import {
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
  savedFolders,
  writeFolderFile,
  type FileLink,
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
 * versions (`versions`, oldest first; the history stays in the browser).
 */
export const projectText = (doc: CadDocument, versions: ProjectVersion[] = []) => JSON.stringify(versions.length ? { ...doc, versions } : doc, null, 1);

/** A document and its versions from a project file (already parsed JSON); throws on anything else. */
export function readProject(raw: unknown, title: string): { doc: CadDocument; versions: ProjectVersion[] } {
  const { versions, ...doc } = (raw ?? {}) as CadDocument & { versions?: ProjectVersion[] };
  if (!raw || typeof raw !== 'object' || !Array.isArray(doc.tabs) || !doc.units) throw new Error('Invalid project file');
  const now = Date.now();
  return {
    doc: { ...doc, id: typeof doc.id === 'string' && doc.id ? doc.id : docId(), name: doc.name || title, created: doc.created ?? now, modified: doc.modified ?? now, version: 1 },
    versions: Array.isArray(versions) ? versions : [],
  };
}

/** A document from the text of a project file (without its versions); throws on anything else. */
export const parseProject = (text: string, title: string): CadDocument => readProject(JSON.parse(text), title).doc;

/** Read a folder's file list again. */
export async function refreshFolder(id: string) {
  const f = folderOf(id);
  if (!f) return;
  if (!f.access) return setFolder(id, { files: [] });
  try {
    setFolder(id, { files: await listFolder(f.dir) });
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
  // a version made or deleted: the file keeps the versions too
  const named = (s: { versions: { id: string; kind: string }[] }) => s.versions.flatMap((v) => (v.kind === 'version' ? [v.id] : [])).join();
  useVersions.subscribe((s, prev) => {
    if (s.docId && s.docId === prev.docId && prev.loaded && named(s) !== named(prev)) void syncLinked(s.docId);
  });
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
    let name = l.name;
    if (l.title !== doc.name) {
      if (l.title !== undefined) name = await renameFolderFile(f.dir, l.name, freeFileName(doc.name, f.files.map((x) => x.name).filter((n) => n !== l.name)));
      await link(doc.id, { ...l, name, title: doc.name });
    }
    await writeFolderFile(f.dir, name, projectText(doc, await fileVersions(doc.id)));
    if (name !== l.name) await refreshFolder(f.id);
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
  const { doc: fromFile, versions } = readProject(JSON.parse(await readFolderFile(f.dir, name)), title);
  const local = docId ? await db.loadDocument(docId) : undefined;
  const file = f.files.find((x) => x.name === name);
  const doc = { ...(local && file && local.modified > file.modified ? local : fromFile), name: title };
  const to = await renameFolderFile(f.dir, name, freeFileName(title, f.files.map((x) => x.name).filter((n) => n !== name)));
  // its versions: the browser's (with the file's), or the file's own when it is not open here
  if (docId) await importVersions(docId, versions, true);
  await writeFolderFile(f.dir, to, projectText(doc, docId ? await fileVersions(docId) : versions));
  if (docId) {
    await link(docId, { folder: folderId, name: to, title });
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
  const { doc: fromFile, versions } = readProject(JSON.parse(await readFolderFile(f.dir, name)), name.replace(/\.webcad\.json$/i, ''));
  const linkedId = Object.keys(links).find((id) => links[id].folder === folderId && links[id].name === name);
  const local = linkedId ? await db.loadDocument(linkedId) : undefined;
  let doc: CadDocument;
  if (local && file && local.modified > file.modified + 1000) {
    // changed here while the folder could not be written: the browser's copy goes to the file (versions of both)
    doc = local;
    await importVersions(doc.id, versions, true);
    await writeFolderFile(f.dir, name, projectText(doc, await fileVersions(doc.id)));
  } else {
    // the file is the main copy. Not linked yet: a document with its id that is already in the browser (of another
    // file, or the browser's own) is not overwritten — this one gets a new id
    const taken = !linkedId && (!!(await db.loadDocument(fromFile.id)) || links[fromFile.id] !== undefined);
    doc = { ...fromFile, id: linkedId ?? (taken ? docId() : fromFile.id) };
    await db.saveDocument(doc);
    // its versions: the file's own document keeps their ids, a new one gets copies
    await importVersions(doc.id, versions, doc.id === fromFile.id || doc.id === linkedId);
  }
  // a document of a folder is never in the browser's trash
  if (useDoc.getState().docs.find((d) => d.id === doc.id)?.trashed) await db.setTrashed(doc.id, null);
  // the file keeps its name (it may differ from the document's) until the document is renamed
  await link(doc.id, { folder: folderId, name, title: doc.name });
  await useDoc.getState().loadList();
  return doc.id;
}

/** Save a browser document into a folder as a new file and link them. The file name, or null. */
export async function saveToFolder(docId: string, folderId: string): Promise<string | null> {
  const f = folderOf(folderId);
  const doc = await db.loadDocument(docId);
  if (!f?.access || !doc) return null;
  const name = freeFileName(doc.name, f.files.map((x) => x.name));
  await writeFolderFile(f.dir, name, projectText(doc, await fileVersions(doc.id)));
  await link(doc.id, { folder: folderId, name, title: doc.name });
  await refreshFolder(folderId);
  return name;
}

/** A new document as a file of a folder. Returns its id. */
export async function createInFolder(folderId: string, name: string): Promise<string | null> {
  const id = await useDoc.getState().createDocument(name);
  return (await saveToFolder(id, folderId)) ? id : null;
}
