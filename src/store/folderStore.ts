// Documents in a folder on the computer (Chrome / Edge): the folder's project files open as documents linked to
// their files; every save of a linked document writes its file too. The file is the document's main copy — opened
// from the folder, the newer of the file and the copy in the browser wins.

import { create } from 'zustand';
import type { CadDocument } from '../core/types';
import { uid } from '../core/ids';
import * as db from './persistence';
import { useDoc } from './docStore';
import { folderAccess, folderLinks, folderSupported, forgetFolder, freeFileName, linkFile, listFolder, pickFolder, readFolderFile, savedFolder, writeFolderFile, type FolderFile } from './localFolder';

interface FolderState {
  /** The chosen folder (null: none). */
  dir: FileSystemDirectoryHandle | null;
  /** Whether it may be read and written now (after a browser restart it has to be allowed again). */
  access: boolean;
  files: FolderFile[];
  /** Documents that are files of the folder: id → file name. */
  links: Record<string, string>;
  /** The last write of a linked document failed (no access, the file is busy…). */
  writeError: string | null;
}

export const useFolder = create<FolderState>(() => ({ dir: null, access: false, files: [], links: {}, writeError: null }));

/** The text of a project file: the document as JSON (indented, so that it reads and compares well). */
export const projectText = (doc: CadDocument) => JSON.stringify(doc, null, 1);

/** A document from the text of a project file; throws on anything else. */
export function parseProject(text: string, title: string): CadDocument {
  const doc = JSON.parse(text) as CadDocument;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.tabs) || !doc.units) throw new Error('Invalid project file');
  const now = Date.now();
  return { ...doc, id: typeof doc.id === 'string' && doc.id ? doc.id : uid('doc'), name: doc.name || title, created: doc.created ?? now, modified: doc.modified ?? now, version: 1 };
}

/** Read the folder's file list again. */
export async function refreshFolder() {
  const { dir, access } = useFolder.getState();
  if (!dir || !access) return useFolder.setState({ files: [] });
  try {
    useFolder.setState({ files: await listFolder(dir) });
  } catch {
    // the folder was moved or deleted
    useFolder.setState({ access: false, files: [] });
  }
}

let started = false;

/** Load the remembered folder and start writing linked documents to their files. */
export async function startFolder() {
  if (started || !folderSupported()) return;
  started = true;
  const dir = (await savedFolder()) ?? null;
  useFolder.setState({ dir, access: dir ? await folderAccess(dir).catch(() => false) : false, links: await folderLinks() });
  await refreshFolder();
  // after every save of the open document in the browser: its file too
  useDoc.subscribe((s, prev) => {
    if (prev.saving && !s.saving && s.doc) void writeLinked(s.doc);
  });
}

/** Choose a folder (the system dialog). */
export async function chooseFolder() {
  const dir = await pickFolder();
  if (!dir) return;
  useFolder.setState({ dir, access: true, links: await folderLinks(), writeError: null });
  await refreshFolder();
}

/** Allow the remembered folder again (asks the user; from a click). */
export async function allowFolder() {
  const { dir } = useFolder.getState();
  if (!dir) return;
  useFolder.setState({ access: await folderAccess(dir, true).catch(() => false), writeError: null });
  await refreshFolder();
  // what the open document could not write meanwhile
  const doc = useDoc.getState().doc;
  if (doc) await writeLinked(doc);
}

export async function leaveFolder() {
  await forgetFolder();
  useFolder.setState({ dir: null, access: false, files: [], links: {}, writeError: null });
}

/** Write a document to its file in the folder (if it is linked and the folder is allowed). */
export async function writeLinked(doc: CadDocument) {
  const { dir, access, links } = useFolder.getState();
  const name = links[doc.id];
  if (!dir || !name) return;
  if (!access) return useFolder.setState({ writeError: name });
  try {
    await writeFolderFile(dir, name, projectText(doc));
    if (useFolder.getState().writeError) useFolder.setState({ writeError: null });
  } catch {
    useFolder.setState({ writeError: name, access: await folderAccess(dir).catch(() => false) });
  }
}

/**
 * Open a project file of the folder as a document: the same document again when it is linked to this file (the
 * newer of the file and the browser's copy wins); a new one otherwise. Returns its id.
 */
export async function openFolderFile(name: string): Promise<string> {
  const { dir, links } = useFolder.getState();
  if (!dir) throw new Error('No folder');
  const file = useFolder.getState().files.find((f) => f.name === name);
  const fromFile = parseProject(await readFolderFile(dir, name), name.replace(/\.webcad\.json$/i, ''));
  const linkedId = Object.keys(links).find((id) => links[id] === name);
  const local = linkedId ? await db.loadDocument(linkedId) : undefined;
  let doc: CadDocument;
  if (local && file && local.modified > file.modified + 1000) {
    // changed here while the folder could not be written: the browser's copy goes to the file
    doc = local;
    await writeFolderFile(dir, name, projectText(doc));
  } else {
    // the file is the main copy. Not linked yet: a document with its id that is already in the browser (of another
    // file, or the browser's own) is not overwritten — this one gets a new id
    const taken = !linkedId && (!!(await db.loadDocument(fromFile.id)) || links[fromFile.id] !== undefined);
    doc = { ...fromFile, id: linkedId ?? (taken ? uid('doc') : fromFile.id) };
    await db.saveDocument(doc);
  }
  // a document of the folder is never in the browser's trash
  if (useDoc.getState().docs.find((d) => d.id === doc.id)?.trashed) await db.setTrashed(doc.id, null);
  await linkFile(doc.id, name);
  useFolder.setState((s) => ({ links: { ...s.links, [doc.id]: name } }));
  await useDoc.getState().loadList();
  return doc.id;
}

/** Save a browser document into the folder as a new file and link them. */
export async function saveToFolder(docId: string): Promise<string | null> {
  const { dir, access, files } = useFolder.getState();
  const doc = await db.loadDocument(docId);
  if (!dir || !access || !doc) return null;
  const name = freeFileName(doc.name, files.map((f) => f.name));
  await writeFolderFile(dir, name, projectText(doc));
  await linkFile(doc.id, name);
  useFolder.setState((s) => ({ links: { ...s.links, [doc.id]: name } }));
  await refreshFolder();
  return name;
}

/** A new document as a file of the folder. Returns its id. */
export async function createInFolder(name: string): Promise<string | null> {
  const id = await useDoc.getState().createDocument(name);
  return (await saveToFolder(id)) ? id : null;
}
