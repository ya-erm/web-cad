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
/** `handles`: the folder; `links`: document id → its file name in the folder. */
const STORES = ['handles', 'links'] as const;
const KEY = 'folder';

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

/** The folder chosen last time (permission may have to be asked again). */
export const savedFolder = () => idb<FileSystemDirectoryHandle | undefined>('handles', 'readonly', (s) => s.get(KEY)).catch(() => undefined);

/** Forget the folder and which documents were its files (the files and the documents stay). */
export async function forgetFolder() {
  await idb('handles', 'readwrite', (s) => s.delete(KEY));
  await idb('links', 'readwrite', (s) => s.clear());
}

/** Ask the user for a folder (read and write) and remember it. Null when the dialog was cancelled. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dir = await (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker({ id: 'webcad', mode: 'readwrite' });
    // another folder: the documents are no longer linked to files of the previous one
    const prev = await savedFolder();
    if (!prev || !(await prev.isSameEntry(dir))) await idb('links', 'readwrite', (s) => s.clear());
    await idb('handles', 'readwrite', (s) => s.put(dir, KEY));
    return dir;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** Which documents are files of the folder: document id → file name. */
export async function folderLinks(): Promise<Record<string, string>> {
  const d = await db();
  return new Promise<Record<string, string>>((resolve, reject) => {
    const out: Record<string, string> = {};
    const r = d.transaction('links').objectStore('links').openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve(out);
      out[String(c.key)] = String(c.value);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  }).catch(() => ({}));
}

export const linkFile = (docId: string, name: string) => idb('links', 'readwrite', (s) => s.put(name, docId));

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

/** A file name for a document that is not taken in the folder: "Bracket.webcad.json", "Bracket (2).webcad.json"… */
export function freeFileName(title: string, taken: string[]): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Document';
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  let name = `${base}${PROJECT_EXT}`;
  for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${base} (${n})${PROJECT_EXT}`;
  return name;
}
