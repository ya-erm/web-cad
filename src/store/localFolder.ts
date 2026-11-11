// A folder on the computer as a place for documents (Chrome / Edge: File System Access API): the chosen folder is
// remembered between sessions (its handle in IndexedDB), its project files (`*.webcad.json`) — at every level of
// its subfolders — are listed, read and written in place; subfolders are made, renamed and moved.

import { t } from '../i18n';

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

/** Where a document's file is: the folder (by id) and the file's path in it. */
export interface FileLink {
  folder: string;
  /** `Bracket.webcad.json` at the top of the folder, `Parts/Bracket.webcad.json` in a subfolder. */
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

// --- paths inside a folder: "Parts/Brackets/Bracket.webcad.json", "" for the folder itself ---------------------

/** A file or a subfolder `name` in the subfolder `dir`. */
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
/** The subfolder a path is in ("" — the folder itself). */
export const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
/** The last part of a path: the file's or the subfolder's own name. */
export const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** Whether `path` is `dir` or inside it. */
export const within = (path: string, dir: string) => !dir || path === dir || path.startsWith(`${dir}/`);
/** `path` inside `from` moved to `to` (the same subfolder renamed or put elsewhere). */
export const movedPath = (path: string, from: string, to: string) => (path === from ? to : `${to}${path.slice(from.length)}`);

const parts = (path: string) => path.split('/').filter(Boolean);

/** The handle of a subfolder (with `create`, the missing levels are made). */
async function subdir(root: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let d = root;
  for (const p of parts(path)) d = await d.getDirectoryHandle(p, { create });
  return d;
}

async function fileHandle(root: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemFileHandle> {
  return (await subdir(root, dirOf(path), create)).getFileHandle(baseOf(path), { create });
}

/** Whether there is a file or a folder at the path (another program's too: not only those listed). */
async function taken(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const d = await subdir(root, dirOf(path)).catch(() => null);
  if (!d) return false;
  for (const get of [() => d.getDirectoryHandle(baseOf(path)), () => d.getFileHandle(baseOf(path))])
    try {
      await get();
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'TypeMismatchError') return true;
    }
  return false;
}

// --- project files -----------------------------------------------------------------------------------------

export interface FolderFile {
  /** Its path in the folder: `Bracket.webcad.json` at the top, `Parts/Bracket.webcad.json` in a subfolder. */
  name: string;
  /** Document name: the file name without the extension. */
  title: string;
  modified: number;
  size: number;
  /** Its card's picture, kept in the file (`thumbnail` of the project file). */
  thumbnail?: string;
}

/** A folder's project files at every level and its subfolders (their paths). */
export interface FolderTree {
  /** The latest changed first. */
  files: FolderFile[];
  /** Every subfolder, the empty ones too (a parent before its children). */
  dirs: string[];
}

/** Subfolders not looked into: hidden ones (`.git`, `.vscode`…) and installed packages. */
const skipDir = (name: string) => name.startsWith('.') || name === 'node_modules';

/** How deep subfolders are looked into. */
export const MAX_DEPTH = 16;

/** The project files of the folder and of its subfolders, at every level. */
export async function listFolder(root: FileSystemDirectoryHandle): Promise<FolderTree> {
  const files: FolderFile[] = [];
  const dirs: string[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, path: string, depth: number) => {
    const subs: FileSystemDirectoryHandle[] = [];
    for await (const h of dir.values()) {
      if (h.kind === 'directory') {
        if (!skipDir(h.name) && depth < MAX_DEPTH) subs.push(h as FileSystemDirectoryHandle);
        continue;
      }
      if (!h.name.toLowerCase().endsWith(PROJECT_EXT)) continue;
      const f = await (h as FileSystemFileHandle).getFile();
      files.push({ name: joinPath(path, h.name), title: h.name.slice(0, -PROJECT_EXT.length), modified: f.lastModified, size: f.size });
    }
    for (const s of subs) dirs.push(joinPath(path, s.name));
    // a subfolder that cannot be read (removed just now, no access) is listed empty, the rest as they are
    await Promise.all(subs.map((s) => walk(s, joinPath(path, s.name), depth + 1).catch(() => undefined)));
  };
  await walk(root, '', 0);
  return { files: files.sort((a, b) => b.modified - a.modified), dirs: dirs.sort(byPath) };
}

/** Paths in the order of a tree: level by level, names as people sort them ("Part 2" before "Part 10"). */
export function byPath(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i].localeCompare(y[i], undefined, { numeric: true, sensitivity: 'base' });
    if (c) return c;
  }
  return x.length - y.length;
}

export async function readFolderFile(dir: FileSystemDirectoryHandle, path: string): Promise<string> {
  return (await (await fileHandle(dir, path)).getFile()).text();
}

/** How a file is now: when it was last changed and its size (another program's change shows in them). */
export interface FileStamp {
  modified: number;
  size: number;
}

export async function fileStamp(dir: FileSystemDirectoryHandle, path: string): Promise<FileStamp> {
  const f = await (await fileHandle(dir, path)).getFile();
  return { modified: f.lastModified, size: f.size };
}

export const sameStamp = (a: FileStamp, b: FileStamp) => a.modified === b.modified && a.size === b.size;

/** Write a file of the folder (its subfolder is made if it is not there). */
export async function writeFolderFile(dir: FileSystemDirectoryHandle, path: string, text: string): Promise<void> {
  const w = await (await fileHandle(dir, path, true)).createWritable();
  await w.write(text);
  await w.close();
}

/** `move` of the File System Access API: to another name, or into another folder (not every browser has it). */
type Movable = { move?: (a: FileSystemDirectoryHandle | string, b?: string) => Promise<void> };

/**
 * Rename a file of the folder or move it into another subfolder — of this folder or of another one (`toRoot`); its
 * content stays: `move` where the browser has it, otherwise a copy at the new place and the old one removed.
 * Returns the path it has now — the old one when only the letter case of its name would change and the browser
 * cannot move files (the copy would land on the same file).
 */
export async function moveFolderFile(root: FileSystemDirectoryHandle, from: string, to: string, toRoot = root): Promise<string> {
  const sameRoot = toRoot === root || (await toRoot.isSameEntry(root).catch(() => false));
  if (sameRoot && from === to) return from;
  const h = (await fileHandle(root, from)) as FileSystemFileHandle & Movable;
  const sameDir = sameRoot && dirOf(from) === dirOf(to);
  if (h.move)
    try {
      if (sameDir) await h.move(baseOf(to));
      else await h.move(await subdir(toRoot, dirOf(to), true), baseOf(to));
      return to;
    } catch {
      // not for this file system: copy
    }
  if (sameRoot && from.toLowerCase() === to.toLowerCase()) return from;
  await writeFolderFile(toRoot, to, await (await h.getFile()).text());
  await (await subdir(root, dirOf(from))).removeEntry(baseOf(from));
  return to;
}

/** Make a subfolder (and the levels above it that are missing). */
export async function makeSubfolder(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  await subdir(root, path, true);
}

/** Copy a folder's content, every level (the files as they are, not only the project files). */
async function copyDir(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle) {
  for await (const h of from.values()) {
    if (h.kind === 'directory') await copyDir(h as FileSystemDirectoryHandle, await to.getDirectoryHandle(h.name, { create: true }));
    else {
      const w = await (await to.getFileHandle(h.name, { create: true })).createWritable();
      await w.write(await (h as FileSystemFileHandle).getFile());
      await w.close();
    }
  }
}

/**
 * Rename a subfolder or move it into another one (of the same folder), with everything in it: `move` where the
 * browser has it for folders, otherwise a copy at the new place and the old one removed (a copy that fails half
 * way is removed, the subfolder stays). Returns the path it has now (the old one, when only the letter case would
 * change and the browser cannot move folders). Throws when there is something at the new place already or the
 * subfolder would go into itself.
 */
export async function moveSubfolder(root: FileSystemDirectoryHandle, from: string, to: string): Promise<string> {
  if (!from || from === to) return from;
  if (within(to, from)) throw new Error(t('A folder cannot be moved into itself'));
  const caseOnly = from.toLowerCase() === to.toLowerCase();
  if (!caseOnly && (await taken(root, to))) throw new Error(t('There is already a file or a folder with this name'));
  const h = (await subdir(root, from)) as FileSystemDirectoryHandle & Movable;
  if (h.move)
    try {
      if (dirOf(from) === dirOf(to)) await h.move(baseOf(to));
      else await h.move(await subdir(root, dirOf(to), true), baseOf(to));
      return to;
    } catch {
      // not for this file system: copy
    }
  if (caseOnly) return from;
  const parent = await subdir(root, dirOf(to), true);
  const copy = await parent.getDirectoryHandle(baseOf(to), { create: true });
  try {
    await copyDir(h, copy);
  } catch (e) {
    await parent.removeEntry(baseOf(to), { recursive: true }).catch(() => undefined);
    throw e;
  }
  await (await subdir(root, dirOf(from))).removeEntry(baseOf(from), { recursive: true });
  return to;
}

/** A name not taken among `taken` (case does not count): "Name", "Name (2)"… */
function freeName(base: string, ext: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  let name = `${base}${ext}`;
  for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
  return name;
}

/** A file name for a document that is not taken in the folder: "Bracket.webcad.json", "Bracket (2).webcad.json"… */
export function freeFileName(title: string, taken: string[]): string {
  return freeName(title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Document', PROJECT_EXT, taken);
}

/**
 * A subfolder name that is not taken among the names in its folder: not hidden (no leading dot — such folders are
 * not listed), "New folder", "New folder (2)"…
 */
export function freeFolderName(name: string, taken: string[], fallback = 'Folder'): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '_').trim().replace(/^\.+/, '').trim();
  return freeName(base && base !== 'node_modules' ? base : fallback, '', taken);
}
