// Local persistence in IndexedDB: no accounts, everything stays in the browser.

import type { CadDocument, DocumentSummary } from '../core/types';

const DB_NAME = 'webcad';
const DB_VERSION = 1;
const DOCS = 'documents';
const SUMMARIES = 'summaries';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DOCS)) d.createObjectStore(DOCS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(SUMMARIES)) d.createObjectStore(SUMMARIES, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
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

/** Permanent deletion. */
export async function deleteDocument(id: string): Promise<void> {
  await tx([DOCS, SUMMARIES], 'readwrite', (t) => {
    t.objectStore(DOCS).delete(id);
    t.objectStore(SUMMARIES).delete(id);
  });
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
