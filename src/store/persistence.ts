// Local persistence in IndexedDB: no accounts, everything stays in the browser.

import type { CadDocument, DocumentSummary, DocumentVersion, ProjectVersion } from '../core/types';
import { validateLibraryChange, type LibraryFolder, type LibraryChange } from './library';
import type { BuildResult } from '../kernel/protocol';
import { embedMode, storageBlocked } from '../embed/mode';

const DB_NAME = 'webcad';
const DB_VERSION = 4;
const FOLDERS = 'libraryFolders';
const DOCS = 'documents';
const SUMMARIES = 'summaries';
/** Versions and history of the documents (`DocumentVersion`, by `docId`), and their snapshots apart (by version id). */
const VERSIONS = 'versions';
const VERSION_DATA = 'versionData';
const PREVIEWS = 'renderPreviews';

export interface RenderPreview {
  id: string;
  docId: string;
  signature: string;
  used: number;
  build: BuildResult;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  // the embedded viewer neither reads nor writes the documents of this browser
  if (embedMode()) return Promise.reject(storageBlocked());
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(FOLDERS)) d.createObjectStore(FOLDERS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(DOCS)) d.createObjectStore(DOCS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(SUMMARIES)) d.createObjectStore(SUMMARIES, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(VERSIONS)) d.createObjectStore(VERSIONS, { keyPath: 'id' }).createIndex('docId', 'docId');
        if (!d.objectStoreNames.contains(VERSION_DATA)) d.createObjectStore(VERSION_DATA, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(PREVIEWS)) d.createObjectStore(PREVIEWS, { keyPath: 'id' }).createIndex('used', 'used');
      };
      req.onsuccess = () => {
        // a newer version of the app opened in another tab: let it upgrade the database (reopened when needed)
        req.result.onversionchange = () => {
          req.result.close();
          dbPromise = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(stores, mode);
        let result: T | undefined;
        const r = fn(t);
        if (r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const all = await tx<DocumentSummary[]>([SUMMARIES], 'readonly', (t) => t.objectStore(SUMMARIES).getAll());
  return (all ?? []).sort((a, b) => b.modified - a.modified);
}

export async function loadDocument(id: string): Promise<CadDocument | undefined> {
  return tx<CadDocument>([DOCS], 'readonly', (t) => t.objectStore(DOCS).get(id));
}

/** Disposable display data, separate from documents and their backups. Keep only eight recent tab previews. */
export async function loadRenderPreview(id: string): Promise<RenderPreview | undefined> {
  return tx<RenderPreview>([PREVIEWS], 'readonly', (t) => t.objectStore(PREVIEWS).get(id));
}

export async function saveRenderPreview(preview: RenderPreview): Promise<void> {
  await tx([PREVIEWS], 'readwrite', (t) => {
    const s = t.objectStore(PREVIEWS);
    s.put(preview);
    let count = 0;
    const cursor = s.index('used').openKeyCursor(null, 'prev');
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      if (++count > 8) s.delete(c.primaryKey);
      c.continue();
    };
  });
}

export async function saveDocument(doc: CadDocument, thumbnail?: string): Promise<void> {
  await tx([DOCS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(DOCS).put(doc);
    const summaries = t.objectStore(SUMMARIES);
    const get = summaries.get(doc.id);
    get.onsuccess = () => {
      const prev = get.result as DocumentSummary | undefined;
      summaries.put({
        id: doc.id,
        name: doc.name,
        created: doc.created,
        modified: doc.modified,
        thumbnail: thumbnail ?? prev?.thumbnail,
        ...(prev?.folderId ? { folderId: prev.folderId } : {}),
        ...(prev?.cloudSource ? { cloudSource: prev.cloudSource } : {}),
        ...(prev?.trashed ? { trashed: prev.trashed } : {}),
        ...(prev?.versionsModified ? { versionsModified: prev.versionsModified } : {}),
      } satisfies DocumentSummary);
    };
  });
}

/** Move to the trash (`trashed` = time) or restore from it (`trashed` = null). */
export async function setTrashed(id: string, trashed: number | null): Promise<void> {
  await tx([SUMMARIES], 'readwrite', (t) => {
    const s = t.objectStore(SUMMARIES);
    const get = s.get(id);
    get.onsuccess = () => {
      const cur = get.result as DocumentSummary | undefined;
      if (!cur) return;
      const next: DocumentSummary = { ...cur };
      if (trashed === null) delete next.trashed;
      else next.trashed = trashed;
      s.put(next);
    };
  });
}

/** Permanent deletion (with its versions and history). */
export async function deleteDocument(id: string): Promise<void> {
  const versions = await listVersions(id);
  await tx([DOCS, SUMMARIES, VERSIONS, VERSION_DATA, PREVIEWS], 'readwrite', (t) => {
    t.objectStore(DOCS).delete(id);
    t.objectStore(SUMMARIES).delete(id);
    const previews = t.objectStore(PREVIEWS).openCursor();
    previews.onsuccess = () => {
      const c = previews.result;
      if (!c) return;
      if ((c.value as RenderPreview).docId === id) c.delete();
      c.continue();
    };
    for (const v of versions) {
      t.objectStore(VERSIONS).delete(v.id);
      t.objectStore(VERSION_DATA).delete(v.id);
    }
  });
}

/** The versions and history of a document, newest first (without their snapshots). */
export async function listVersions(docId: string): Promise<DocumentVersion[]> {
  const all = await tx<DocumentVersion[]>([VERSIONS], 'readonly', (t) => t.objectStore(VERSIONS).index('docId').getAll(docId));
  return (all ?? []).sort((a, b) => b.created - a.created);
}

export async function saveVersion(version: DocumentVersion, doc: CadDocument): Promise<void> {
  await tx([VERSIONS, VERSION_DATA, SUMMARIES], 'readwrite', (t) => {
    if (version.kind !== 'auto') touchVersions(t, version.docId);
    t.objectStore(VERSIONS).put(version);
    t.objectStore(VERSION_DATA).put({ id: version.id, doc });
  });
}

/** The snapshot of a version. */
export async function loadVersion(id: string): Promise<CadDocument | undefined> {
  const r = await tx<{ id: string; doc: CadDocument }>([VERSION_DATA], 'readonly', (t) => t.objectStore(VERSION_DATA).get(id));
  return r?.doc;
}

function touchVersions(t: IDBTransaction, docId: string) {
  const store = t.objectStore(SUMMARIES),
    request = store.get(docId);
  request.onsuccess = () => {
    const current = request.result as DocumentSummary | undefined;
    if (current) store.put({ ...current, versionsModified: Math.max(Date.now(), (current.versionsModified ?? 0) + 1) });
  };
}
export async function deleteVersions(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx([VERSIONS, VERSION_DATA, SUMMARIES], 'readwrite', (t) => {
    for (const id of ids) {
      const request = t.objectStore(VERSIONS).get(id);
      request.onsuccess = () => {
        const old = request.result as DocumentVersion | undefined;
        if (old && old.kind !== 'auto') touchVersions(t, old.docId);
      };
      t.objectStore(VERSIONS).delete(id);
      t.objectStore(VERSION_DATA).delete(id);
    }
  });
}

/** A document's thumbnail (its card's picture), if it has one. */
export async function getThumbnail(id: string): Promise<string | undefined> {
  const s = await tx<DocumentSummary | undefined>([SUMMARIES], 'readonly', (t) => t.objectStore(SUMMARIES).get(id));
  return s?.thumbnail || undefined;
}

export async function saveThumbnail(id: string, thumbnail: string): Promise<void> {
  await tx([SUMMARIES], 'readwrite', (t) => {
    const s = t.objectStore(SUMMARIES);
    const get = s.get(id);
    get.onsuccess = () => {
      if (get.result) s.put({ ...(get.result as DocumentSummary), thumbnail });
    };
  });
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

/** Folders in this browser, independent of files on disk. */
export async function listLibraryFolders(): Promise<LibraryFolder[]> {
  return (await tx<LibraryFolder[]>([FOLDERS], 'readonly', (t) => t.objectStore(FOLDERS).getAll())) ?? [];
}

/** Validate and apply against one atomic snapshot, including changes from other tabs. */
export async function changeLibrary(change: LibraryChange): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction([FOLDERS, SUMMARIES], 'readwrite');
    const fs = t.objectStore(FOLDERS),
      ds = t.objectStore(SUMMARIES);
    const folders = fs.getAll(),
      docs = ds.getAll();
    let remaining = 2,
      error: unknown;
    const apply = () => {
      if (--remaining) return;
      try {
        validateLibraryChange(folders.result, docs.result, change);
        if (change.kind === 'folder') fs.put({ ...change.folder, name: change.folder.name.trim() });
        else if (change.kind === 'remove') fs.delete(change.id);
        else ds.put({ ...docs.result.find((v: DocumentSummary) => v.id === change.id), folderId: change.folderId });
      } catch (e) {
        error = e;
        t.abort();
      }
    };
    folders.onsuccess = apply;
    docs.onsuccess = apply;
    t.oncomplete = () => resolve();
    t.onabort = t.onerror = () => reject(error ?? t.error);
  });
}

/** Remember a cloud download as a local cache, never overwriting another local document. */
export async function markCloudCopy(id: string, cloudSource: NonNullable<DocumentSummary['cloudSource']>): Promise<void> {
  await tx([SUMMARIES], 'readwrite', (t) => {
    const s = t.objectStore(SUMMARIES),
      request = s.get(id);
    request.onsuccess = () => {
      if (request.result) s.put({ ...request.result, cloudSource });
    };
  });
}

/** Adopt metadata only if the persisted baseline did not change since the remote request. */
export async function compareCloudSummary(
  expected: DocumentSummary,
  patch: Partial<DocumentSummary>,
  canApply: () => boolean,
): Promise<boolean> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SUMMARIES], 'readwrite'),
      store = transaction.objectStore(SUMMARIES),
      request = store.get(expected.id);
    let applied = false;
    request.onsuccess = () => {
      const current = request.result as DocumentSummary | undefined;
      if (
        !current ||
        !canApply() ||
        current.modified !== expected.modified ||
        current.name !== expected.name ||
        current.folderId !== expected.folderId ||
        current.trashed !== expected.trashed ||
        current.versionsModified !== expected.versionsModified ||
        JSON.stringify(current.cloudSource) !== JSON.stringify(expected.cloudSource)
      )
        return;
      store.put({ ...current, ...patch });
      applied = true;
    };
    transaction.oncomplete = () => resolve(applied);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

/** Mirror folder metadata without removing local folders or touching document content. */
export async function rememberLibraryFolders(
  folders: LibraryFolder[],
  locations: Record<string, string>,
  canApply: () => boolean = () => true,
): Promise<void> {
  await tx([FOLDERS, SUMMARIES], 'readwrite', (t) => {
    if (!canApply()) return;
    const fs = t.objectStore(FOLDERS),
      ds = t.objectStore(SUMMARIES);
    for (const folder of folders) fs.put(folder);
    for (const [id, folderId] of Object.entries(locations)) {
      const request = ds.get(id);
      request.onsuccess = () => {
        if (request.result && canApply()) ds.put({ ...request.result, folderId });
      };
    }
  });
}

/** First download can keep the logical ID. Existing local content is never overwritten. */
export async function addDocumentIfAbsent(doc: CadDocument): Promise<boolean> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction([DOCS, SUMMARIES], 'readwrite');
    let added = false;
    const request = t.objectStore(DOCS).get(doc.id);
    request.onsuccess = () => {
      if (request.result) return;
      t.objectStore(DOCS).add(doc);
      t.objectStore(SUMMARIES).add({ id: doc.id, name: doc.name, created: doc.created, modified: doc.modified });
      added = true;
    };
    t.oncomplete = () => resolve(added);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

/** A consistent model, named versions and summary, read in one IndexedDB transaction. */
export async function cloudUploadSnapshot(id: string): Promise<{ doc: CadDocument; summary: DocumentSummary; versions: ProjectVersion[] }> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DOCS, SUMMARIES, VERSIONS, VERSION_DATA], 'readonly');
    let doc: CadDocument | undefined, summary: DocumentSummary | undefined;
    const versions: ProjectVersion[] = [];
    const d = transaction.objectStore(DOCS).get(id),
      s = transaction.objectStore(SUMMARIES).get(id),
      v = transaction.objectStore(VERSIONS).index('docId').getAll(id);
    d.onsuccess = () => {
      doc = d.result;
    };
    s.onsuccess = () => {
      summary = s.result;
    };
    v.onsuccess = () => {
      const records = (v.result as DocumentVersion[])
        .filter((r) => r.kind !== 'auto')
        .sort((a, b) => Number(a.kind === 'workspace') - Number(b.kind === 'workspace') || a.created - b.created);
      for (const record of records) {
        const data = transaction.objectStore(VERSION_DATA).get(record.id);
        data.onsuccess = () => {
          const snap = data.result?.doc as CadDocument | undefined;
          if (snap)
            versions.push({
              id: record.kind === 'workspace' ? record.id.slice(id.length + 1) : record.id,
              ...(record.kind === 'workspace' ? { kind: 'workspace' as const, ...(record.base ? { base: record.base } : {}) } : {}),
              name: record.name,
              ...(record.description ? { description: record.description } : {}),
              created: record.created,
              units: snap.units,
              tabs: snap.tabs,
              activeTab: snap.activeTab,
            });
        };
      }
    };
    transaction.oncomplete = () => (doc && summary ? resolve({ doc, summary, versions }) : reject(new Error('Document not found')));
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

/** Update a closed, unchanged cloud cache atomically; keep a local recovery snapshot and old version data. */
export async function replaceCleanCloudDocument(
  expected: DocumentSummary,
  doc: CadDocument,
  versions: ProjectVersion[],
  cloudSource: NonNullable<DocumentSummary['cloudSource']>,
  folderId: string,
  canApply: () => boolean,
): Promise<boolean> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DOCS, SUMMARIES, VERSIONS, VERSION_DATA], 'readwrite');
    let applied = false;
    const s = transaction.objectStore(SUMMARIES).get(expected.id),
      d = transaction.objectStore(DOCS).get(expected.id),
      v = transaction.objectStore(VERSIONS).index('docId').getAll(expected.id);
    let ready = 0;
    const apply = () => {
      if (++ready !== 3) return;
      const current = s.result as DocumentSummary | undefined;
      if (
        !current ||
        !canApply() ||
        current.trashed ||
        current.modified !== expected.modified ||
        current.name !== expected.name ||
        current.folderId !== expected.folderId ||
        current.versionsModified !== expected.versionsModified ||
        JSON.stringify(current.cloudSource) !== JSON.stringify(expected.cloudSource)
      )
        return;
      const source = current.cloudSource;
      if (!source || source.savedModified !== current.modified || (current.versionsModified ?? 0) !== (source.savedVersionsModified ?? 0))
        return;
      const backup = 'cloud-backup-' + crypto.randomUUID();
      transaction
        .objectStore(VERSIONS)
        .put({ id: backup, docId: doc.id, kind: 'auto', name: '', created: Date.now(), hash: '' } satisfies DocumentVersion);
      transaction.objectStore(VERSION_DATA).put({ id: backup, doc: d.result });
      for (const old of v.result as DocumentVersion[]) if (old.kind !== 'auto') transaction.objectStore(VERSIONS).delete(old.id);
      for (const version of versions) {
        const id = version.kind === 'workspace' ? doc.id + ':' + version.id : version.id;
        const snap: CadDocument = { ...doc, name: '', units: version.units, tabs: version.tabs, activeTab: version.activeTab };
        transaction
          .objectStore(VERSIONS)
          .put({
            id,
            docId: doc.id,
            kind: version.kind ?? 'version',
            name: version.name,
            created: version.created,
            hash: '',
            ...(version.description ? { description: version.description } : {}),
            ...(version.base ? { base: version.base } : {}),
          } satisfies DocumentVersion);
        transaction.objectStore(VERSION_DATA).put({ id, doc: snap });
      }
      transaction.objectStore(DOCS).put(doc);
      transaction
        .objectStore(SUMMARIES)
        .put({
          ...current,
          name: doc.name,
          modified: doc.modified,
          folderId,
          versionsModified: cloudSource.savedVersionsModified ?? 0,
          cloudSource,
        });
      applied = true;
    };
    s.onsuccess = apply;
    d.onsuccess = apply;
    v.onsuccess = apply;
    transaction.oncomplete = () => resolve(applied);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
