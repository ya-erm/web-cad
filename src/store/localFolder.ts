// A folder on the computer as a place for documents (Chrome / Edge: File System Access API): the chosen folder is
// remembered between sessions (its handle in IndexedDB), its project files (`*.webcad.json`) are listed, read and
// written in place.

/** Parts of the File System Access API that TypeScript's DOM library does not describe yet. */
type PermissionMode = { mode: 'read' | 'readwrite' };
type Permissioned = FileSystemHandle & {
  queryPermission(d: PermissionMode): Promise<PermissionState>;
  requestPermission(d: PermissionMode): Promise<PermissionState>;
};
type DirectoryPicker = (o?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle | string }) => Promise<FileSystemDirectoryHandle>;

/** Project files of a folder end with this. */
export const PROJECT_EXT = '.webcad.json';

/** Whether this browser can work with a folder (Chrome, Edge; not Firefox or Safari). */
export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// --- the remembered folder (its handle survives reloads in IndexedDB) -------------------------------------

const DB = 'webcad-folders';
/** `handles`: folder id → its handle; `links`: document id → its file (`FileLink`). */
const STORES = ['handles', 'links'] as const;

/** Where a document's file is: the folder (by id) and the file name in it. */
export interface FileLink {
  folder: string;
  name: string;
  /** The document's name when the file got its name: renaming the document renames the file. */
  title?: string;
}

/** The id the single folder of the first version was kept under (its links were just file names). */
const OLD_FOLDER = 'folder';

let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => STORES.forEach((s) => r.result.createObjectStore(s));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

async function idb<T>(store: (typeof STORES)[number], mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

/** Every entry of a store: key → value. */
async function entries<T>(store: (typeof STORES)[number]): Promise<[string, T][]> {
  const d = await db();
  return new Promise<[string, T][]>((resolve, reject) => {
    const out: [string, T][] = [];
    const r = d.transaction(store).objectStore(store).openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve(out);
      out.push([String(c.key), c.value as T]);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  }).catch(() => []);
}

/** The folders added so far, in the order they were added (permission may have to be asked again). */
export async function savedFolders(): Promise<{ id: string; dir: FileSystemDirectoryHandle }[]> {
  return (await entries<FileSystemDirectoryHandle>('handles')).map(([id, dir]) => ({ id, dir }));
}

/**
 * Ask the user for a folder (read and write) and remember it with the others; a folder added before keeps its id.
 * Null when the dialog was cancelled.
 */
export async function pickFolder(): Promise<{ id: string; dir: FileSystemDirectoryHandle } | null> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker({ id: 'webcad', mode: 'readwrite' });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
  for (const f of await savedFolders()) if (await f.dir.isSameEntry(dir).catch(() => false)) return f;
  // ids in the order of adding
  const id = `fo${Date.now().toString(36)}`;
  await idb('handles', 'readwrite', (s) => s.put(dir, id));
  return { id, dir };
}

/** Forget a folder and which documents were its files (the files and the documents stay). */
export async function forgetFolder(id: string) {
  await idb('handles', 'readwrite', (s) => s.delete(id));
  for (const [docId, link] of await entries<FileLink>('links')) if (link.folder === id) await idb('links', 'readwrite', (s) => s.delete(docId));
}

/** Which documents are files of the folders: document id → its file. */
export async function folderLinks(): Promise<Record<string, FileLink>> {
  return Object.fromEntries(
    (await entries<FileLink | string>('links')).flatMap(([id, l]): [string, FileLink][] =>
      typeof l === 'string' ? [[id, { folder: OLD_FOLDER, name: l }]] : l?.folder ? [[id, l]] : [],
    ),
  );
}

export const linkFile = (docId: string, link: FileLink) => idb('links', 'readwrite', (s) => s.put(link, docId));

/**
 * Whether the folder may be read and written now; with `ask` the browser asks the user (only from a click or
 * a key press — a remembered folder needs it again after the browser restarts).
 */
export async function folderAccess(dir: FileSystemDirectoryHandle, ask = false): Promise<boolean> {
  const h = dir as unknown as Permissioned;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

// --- project files -----------------------------------------------------------------------------------------

export interface FolderFile {
  /** File name in the folder (`Bracket.webcad.json`). */
  name: string;
  /** Document name: the file name without the extension. */
  title: string;
  modified: number;
  size: number;
}

/** The project files of the folder, the latest changed first. */
export async function listFolder(dir: FileSystemDirectoryHandle): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  for await (const h of dir.values()) {
    if (h.kind !== 'file' || !h.name.toLowerCase().endsWith(PROJECT_EXT)) continue;
    const f = await (h as FileSystemFileHandle).getFile();
    out.push({ name: h.name, title: h.name.slice(0, -PROJECT_EXT.length), modified: f.lastModified, size: f.size });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export async function readFolderFile(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  return (await (await dir.getFileHandle(name)).getFile()).text();
}

export async function writeFolderFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

/**
 * Rename a file of the folder (its content stays): `move` where the browser has it, otherwise a copy under the new
 * name and the old one removed. Returns the name it has now — the old one when only the letter case would change
 * and the browser cannot move files (the copy would land on the same file).
 */
export async function renameFolderFile(dir: FileSystemDirectoryHandle, from: string, to: string): Promise<string> {
  if (from === to) return from;
  const h = (await dir.getFileHandle(from)) as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
  if (h.move)
    try {
      await h.move(to);
      return to;
    } catch {
      // not for this file system: copy
    }
  if (from.toLowerCase() === to.toLowerCase()) return from;
  await writeFolderFile(dir, to, await (await h.getFile()).text());
  await dir.removeEntry(from);
  return to;
}

/** A file name for a document that is not taken in the folder: "Bracket.webcad.json", "Bracket (2).webcad.json"… */
export function freeFileName(title: string, taken: string[]): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Document';
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  let name = `${base}${PROJECT_EXT}`;
  for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${base} (${n})${PROJECT_EXT}`;
  return name;
}
