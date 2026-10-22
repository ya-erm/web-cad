// Local persistence in IndexedDB: no accounts, everything stays in the browser.

import type { CadDocument, DocumentSummary, DocumentVersion } from '../core/types';

const DB_NAME = 'webcad';
const DB_VERSION = 2;
const DOCS = 'documents';
const SUMMARIES = 'summaries';
/** Versions and history of the documents (`DocumentVersion`, by `docId`), and their snapshots apart (by version id). */
const VERSIONS = 'versions';
const VERSION_DATA = 'versionData';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DOCS)) d.createObjectStore(DOCS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(SUMMARIES)) d.createObjectStore(SUMMARIES, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(VERSIONS)) d.createObjectStore(VERSIONS, { keyPath: 'id' }).createIndex('docId', 'docId');
        if (!d.objectStoreNames.contains(VERSION_DATA)) d.createObjectStore(VERSION_DATA, { keyPath: 'id' });
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
        ...(prev?.trashed ? { trashed: prev.trashed } : {}),
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
  await tx([DOCS, SUMMARIES, VERSIONS, VERSION_DATA], 'readwrite', (t) => {
    t.objectStore(DOCS).delete(id);
    t.objectStore(SUMMARIES).delete(id);
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
  await tx([VERSIONS, VERSION_DATA], 'readwrite', (t) => {
    t.objectStore(VERSIONS).put(version);
    t.objectStore(VERSION_DATA).put({ id: version.id, doc });
  });
}

/** The snapshot of a version. */
export async function loadVersion(id: string): Promise<CadDocument | undefined> {
  const r = await tx<{ id: string; doc: CadDocument }>([VERSION_DATA], 'readonly', (t) => t.objectStore(VERSION_DATA).get(id));
  return r?.doc;
}

export async function deleteVersions(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx([VERSIONS, VERSION_DATA], 'readwrite', (t) => {
    for (const id of ids) {
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
