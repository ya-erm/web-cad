// Document store: the open document, undo/redo history and persistence.

import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { AssemblyTab, CadDocument, DocumentSummary, DrawingTab, Feature, PartStudioTab } from '../core/types';
import { docId, uid } from '../core/ids';
import * as db from './persistence';

const MAX_HISTORY = 200;

export interface DocState {
  docs: DocumentSummary[];
  doc: CadDocument | null;
  past: CadDocument[];
  future: CadDocument[];
  saving: boolean;
  /** The last save failed (why, for people): the edits are only in memory until a save goes through. */
  saveError: string | null;
  /** Coalesces consecutive edits with the same key into one undo step. */
  lastKey: string | null;
  /** A version is open for viewing: no edits (switching tabs and options is fine) and nothing is saved. */
  readOnly: boolean;
  /** Save now what is waiting to be saved. */
  flushSave(): Promise<void>;

  loadList(): Promise<void>;
  createDocument(name?: string): Promise<string>;
  openDocument(id: string): Promise<boolean>;
  closeDocument(): void;
  /** Permanent deletion (from the trash). */
  deleteDocument(id: string): Promise<void>;
  trashDocument(id: string): Promise<void>;
  restoreDocument(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  renameDocument(id: string, name: string): Promise<void>;
  duplicateDocument(id: string): Promise<void>;
  /** A copy of a document (a project file's) in the browser, with its card's picture if the file has one. */
  importDocument(doc: CadDocument, thumbnail?: string): Promise<string>;

  update(fn: (d: Draft<CadDocument>) => void, opts?: { undoable?: boolean; key?: string }): void;
  undo(): void;
  redo(): void;
}

export function newPartStudio(name = 'Part Studio 1'): PartStudioTab {
  return { id: uid('ps'), type: 'partStudio', name, features: [], rollback: null, parts: {} };
}

export function newDrawingTab(name = 'Drawing 1', title = ''): DrawingTab {
  return {
    id: uid('dw'),
    type: 'drawing',
    name,
    drawing: { sheet: 'A3', landscape: true, views: [], dimensions: [], notes: [], title, author: '' },
  };
}

export function newAssemblyTab(name = 'Assembly 1'): AssemblyTab {
  return { id: uid('as'), type: 'assembly', name, instances: [] };
}

export function newDocument(name: string): CadDocument {
  const ps = newPartStudio();
  const now = Date.now();
  return {
    id: docId(),
    name,
    created: now,
    modified: now,
    units: { length: 'mm', angle: 'deg' },
    tabs: [ps],
    activeTab: ps.id,
    version: 1,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Saving again after a failure: soon, then less often. */
let retryDelay = 2000;

/** Why a save failed, for people: the browser's storage is full or not available. */
export function saveErrorText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return 'The browser storage is full';
  if (name === 'InvalidStateError' || name === 'UnknownError' || name === 'AbortError') return 'The browser storage is not available';
  return (e as Error | null)?.message || String(e);
}

export const useDoc = create<DocState>()((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saving: true });
    saveTimer = setTimeout(() => void save(get().doc), 400);
  };
  /** Write `d` (the document as it is when the save starts); a failure is shown and tried again later. */
  const save = async (d: CadDocument | null) => {
    saveTimer = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    // never a version being viewed over the document
    if (!d || get().readOnly) return set({ saving: false });
    try {
      await db.saveDocument(d);
      retryDelay = 2000;
      // edits made meanwhile have a save of their own waiting
      set({ saving: !!saveTimer, ...(get().saveError ? { saveError: null } : {}) });
    } catch (e) {
      console.error('Saving the document failed', e);
      set({ saving: false, saveError: saveErrorText(e) });
      // the open one again in a while (it is still in memory, with all its edits)
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!saveTimer && get().doc?.id === d.id) void save(get().doc);
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  };
  /** A save waiting for its moment: now (before the document goes away). */
  const saveWaiting = async () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    await save(get().doc);
  };

  return {
    docs: [],
    doc: null,
    past: [],
    future: [],
    saving: false,
    saveError: null,
    lastKey: null,
    readOnly: false,

    async flushSave() {
      // waiting for its moment, or failed before: now
      if (saveTimer || (get().saveError && get().doc)) {
        if (saveTimer) clearTimeout(saveTimer);
        await save(get().doc);
      }
    },

    async loadList() {
      set({ docs: await db.listDocuments() });
    },

    async createDocument(name = 'Untitled document') {
      const doc = newDocument(name);
      await db.saveDocument(doc);
      await get().loadList();
      return doc.id;
    },

    async openDocument(id) {
      // the last edits of the one open now first (a save still waiting would write the new one instead)
      await saveWaiting();
      const doc = await db.loadDocument(id);
      if (!doc) return false;
      set({ doc, past: [], future: [], lastKey: null, readOnly: false, saveError: null });
      return true;
    },

    closeDocument() {
      // its last edits (still waiting for their save) go to the browser before it closes
      const saved = saveWaiting();
      set({ doc: null, past: [], future: [], readOnly: false });
      void saved.then(() => get().loadList());
    },

    async deleteDocument(id) {
      await db.deleteDocument(id);
      await get().loadList();
    },

    async trashDocument(id) {
      if (get().doc?.id === id) get().closeDocument();
      await db.setTrashed(id, Date.now());
      await get().loadList();
    },

    async restoreDocument(id) {
      await db.setTrashed(id, null);
      await get().loadList();
    },

    async emptyTrash() {
      for (const d of get().docs) if (d.trashed) await db.deleteDocument(d.id);
      await get().loadList();
    },

    async renameDocument(id, name) {
      const cur = get().doc;
      if (cur && cur.id === id) {
        get().update((d) => {
          d.name = name;
        });
        return;
      }
      const doc = await db.loadDocument(id);
      if (!doc) return;
      await db.saveDocument({ ...doc, name, modified: Date.now() });
      await get().loadList();
    },

    async duplicateDocument(id) {
      const doc = await db.loadDocument(id);
      if (!doc) return;
      const now = Date.now();
      await db.saveDocument({ ...doc, id: docId(), name: `${doc.name} (copy)`, created: now, modified: now });
      await get().loadList();
    },

    async importDocument(doc, thumbnail) {
      const now = Date.now();
      const copy: CadDocument = { ...doc, id: docId(), modified: now };
      await db.saveDocument(copy, thumbnail);
      await get().loadList();
      return copy.id;
    },

    update(fn, opts = {}) {
      const { doc, past, lastKey, readOnly } = get();
      if (!doc) return;
      const undoable = opts.undoable !== false;
      if (readOnly && undoable) {
        // a version being viewed: say why nothing happens
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('webcad:read-only'));
        return;
      }
      const next = produce(doc, (d) => {
        fn(d);
        if (!readOnly) d.modified = Date.now();
      });
      if (next === doc) return;
      const coalesce = undoable && opts.key && opts.key === lastKey;
      set({
        doc: next,
        past: undoable && !coalesce ? [...past, doc].slice(-MAX_HISTORY) : past,
        future: undoable ? [] : get().future,
        lastKey: opts.key ?? null,
      });
      if (!readOnly) scheduleSave();
    },

    undo() {
      const { doc, past, future, readOnly } = get();
      if (!doc || !past.length || readOnly) return;
      const prev = past[past.length - 1];
      set({ doc: { ...prev, activeTab: doc.activeTab }, past: past.slice(0, -1), future: [doc, ...future], lastKey: null });
      scheduleSave();
    },

    redo() {
      const { doc, past, future, readOnly } = get();
      if (!doc || !future.length || readOnly) return;
      const next = future[0];
      set({ doc: { ...next, activeTab: doc.activeTab }, past: [...past, doc], future: future.slice(1), lastKey: null });
      scheduleSave();
    },
  };
});

// ---------------------------------------------------------------------------
// Selectors & helpers
// ---------------------------------------------------------------------------

export function activeTab(doc: CadDocument | null) {
  if (!doc) return null;
  return doc.tabs.find((t) => t.id === doc.activeTab) ?? doc.tabs[0] ?? null;
}

export function activeStudio(doc: CadDocument | null): PartStudioTab | null {
  const t = activeTab(doc);
  return t && t.type === 'partStudio' ? t : null;
}

export function studioById(doc: CadDocument | null, id: string): PartStudioTab | null {
  const t = doc?.tabs.find((x) => x.id === id);
  return t && t.type === 'partStudio' ? t : null;
}

export function activeAssembly(doc: CadDocument | null): AssemblyTab | null {
  const t = activeTab(doc);
  return t && t.type === 'assembly' ? t : null;
}

/** Mutate the active assembly inside an update(). */
export function withAssembly(d: Draft<CadDocument>, fn: (a: Draft<AssemblyTab>) => void) {
  const t = d.tabs.find((x) => x.id === d.activeTab);
  if (t && t.type === 'assembly') fn(t);
}

/** Mutate the active part studio inside an update(). */
export function withStudio(d: Draft<CadDocument>, fn: (s: Draft<PartStudioTab>) => void) {
  const t = d.tabs.find((x) => x.id === d.activeTab);
  if (t && t.type === 'partStudio') fn(t);
}

export function featureIndex(studio: PartStudioTab, id: string) {
  return studio.features.findIndex((f) => f.id === id);
}

export function effectiveRollback(studio: PartStudioTab) {
  return studio.rollback === null ? studio.features.length : Math.min(studio.rollback, studio.features.length);
}

let guarded = false;

/**
 * The last edits are not lost with the page: saved at once when the tab is hidden or left (the browser may not wait
 * for the usual pause), and closing the tab with edits not saved yet (or a failed save) asks first.
 */
export function startSaveGuards() {
  if (guarded) return;
  guarded = true;
  const flush = () => void useDoc.getState().flushSave();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', (e) => {
    const s = useDoc.getState();
    if (!s.doc || (!s.saving && !s.saveError)) return;
    flush();
    e.preventDefault();
    e.returnValue = '';
  });
}

export type { Feature };
