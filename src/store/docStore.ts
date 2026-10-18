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
  importDocument(doc: CadDocument): Promise<string>;

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

export const useDoc = create<DocState>()((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saving: true });
    saveTimer = setTimeout(save, 400);
  };
  const save = async () => {
    saveTimer = null;
    const d = get().doc;
    // never a version being viewed over the document
    if (d && !get().readOnly) await db.saveDocument(d);
    set({ saving: false });
  };

  return {
    docs: [],
    doc: null,
    past: [],
    future: [],
    saving: false,
    lastKey: null,
    readOnly: false,

    async flushSave() {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      await save();
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
      const doc = await db.loadDocument(id);
      if (!doc) return false;
      set({ doc, past: [], future: [], lastKey: null, readOnly: false });
      return true;
    },

    closeDocument() {
      set({ doc: null, past: [], future: [], readOnly: false });
      void get().loadList();
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

    async importDocument(doc) {
      const now = Date.now();
      const copy: CadDocument = { ...doc, id: docId(), modified: now };
      await db.saveDocument(copy);
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

export type { Feature };
