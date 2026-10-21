// Autosave does not lose edits: a failed write is shown and tried again; the last edits of a document closed or
// switched away from right after them (the save still waiting for its pause) are written first.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '../core/types';

/** The browser's storage: documents written, and whether a write fails. */
const stored = new Map<string, CadDocument>();
let failWrites = 0;

vi.mock('./persistence', () => ({
  saveDocument: vi.fn(async (doc: CadDocument) => {
    if (failWrites > 0) {
      failWrites--;
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    }
    stored.set(doc.id, structuredClone(doc));
  }),
  loadDocument: vi.fn(async (id: string) => structuredClone(stored.get(id))),
  listDocuments: vi.fn(async () => []),
}));

const { newDocument, useDoc } = await import('./docStore');

/** Let the store's promises run (and timers, with fake ones). */
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  stored.clear();
  failWrites = 0;
  useDoc.setState({ doc: null, past: [], future: [], saving: false, saveError: null, readOnly: false });
});

const open = async (name: string) => {
  const d = newDocument(name);
  stored.set(d.id, d);
  await useDoc.getState().openDocument(d.id);
  return d.id;
};
const rename = (name: string) => useDoc.getState().update((d) => void (d.name = name));

describe('autosave', () => {
  it('saves after a short pause', async () => {
    const id = await open('A');
    rename('A1');
    expect(useDoc.getState().saving).toBe(true);
    expect(stored.get(id)!.name).toBe('A');
    await settle(500);
    expect(stored.get(id)!.name).toBe('A1');
    expect(useDoc.getState().saving).toBe(false);
  });

  it('shows a failed save and tries again until it goes through', async () => {
    const id = await open('A');
    failWrites = 2;
    rename('A1');
    await settle(500);
    expect(useDoc.getState().saveError).toBe('The browser storage is full');
    expect(stored.get(id)!.name).toBe('A');
    // the second try fails too, the third one goes through
    await settle(2000);
    expect(useDoc.getState().saveError).not.toBeNull();
    await settle(4000);
    expect(useDoc.getState().saveError).toBeNull();
    expect(stored.get(id)!.name).toBe('A1');
  });

  it('a click on "Not saved" (flushSave) saves again at once', async () => {
    const id = await open('A');
    failWrites = 1;
    rename('A1');
    await settle(500);
    expect(useDoc.getState().saveError).not.toBeNull();
    await useDoc.getState().flushSave();
    expect(useDoc.getState().saveError).toBeNull();
    expect(stored.get(id)!.name).toBe('A1');
  });

  it('writes the last edits of a document closed right after them', async () => {
    const id = await open('A');
    rename('A1');
    useDoc.getState().closeDocument();
    await settle(0);
    expect(useDoc.getState().doc).toBeNull();
    expect(stored.get(id)!.name).toBe('A1');
  });

  it('writes the last edits of a document before another one opens', async () => {
    const a = await open('A');
    rename('A1');
    const b = newDocument('B');
    stored.set(b.id, b);
    await useDoc.getState().openDocument(b.id);
    await settle(500);
    expect(stored.get(a)!.name).toBe('A1');
    expect(stored.get(b.id)!.name).toBe('B');
    expect(useDoc.getState().doc!.id).toBe(b.id);
  });
});
