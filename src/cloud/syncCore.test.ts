import { describe, it, expect } from 'vitest';
import type { DocumentSummary } from '../core/types';
import { dirtyDocument, SyncQueue } from './syncCore';
const doc = (id = 'a', modified = 100000): DocumentSummary => ({ id, name: id, created: 1, modified });
const linked = (id = 'a', modified = 100000): DocumentSummary => ({
  ...doc(id, modified),
  cloudSource: { userId: 'u', documentId: 'logical', revision: 'r1', savedModified: 1, cloudModified: 1, savedName: id, savedFolderId: '' },
});
const update = (q: SyncQueue, docs: DocumentSummary[], at: number) => q.update(docs, 'u', new Set(), at);
describe('persisted cloud queue', () => {
  it('recovers old browser documents after restart and excludes foreign/disk/trash', () => {
    const q = new SyncQueue(),
      docs = [
        doc(),
        { ...linked('foreign'), cloudSource: { ...linked().cloudSource!, userId: 'other' } },
        { ...doc('trash'), trashed: 1 },
        doc('disk'),
      ];
    const work = q.update(docs, 'u', new Set(['disk']), 200000);
    expect(work.pending.map((d) => d.id)).toEqual(['a']);
    expect(q.ready(work.pending, 200000)?.id).toBe('a');
    expect(new SyncQueue().ready(update(new SyncQueue(), [], 200000).pending, 200000)).toBeUndefined();
    const restarted = new SyncQueue();
    expect(restarted.ready(update(restarted, [doc()], 200000).pending, 200000)?.id).toBe('a');
  });
  it('coalesces saved edits but bounds continuous editing by max wait', () => {
    const q = new SyncQueue();
    let current = doc();
    let pending = update(q, [current], 100000).pending;
    expect(q.ready(pending, 129999)).toBeUndefined();
    for (let now = 120000; now <= 200000; now += 20000) {
      current = { ...current, modified: now };
      pending = update(q, [current], now).pending;
      expect(q.ready(pending, now)).toBeUndefined();
    }
    current = { ...current, modified: 220000 };
    pending = update(q, [current], 220000).pending;
    expect(q.ready(pending, 220000)?.id).toBe('a');
  });
  it('enforces a global gap and per-document minimum even during edits', () => {
    const q = new SyncQueue();
    q.succeeded('a', 200000);
    const pending = update(q, [doc('a', 200001), doc('b', 1)], 230001).pending;
    expect(q.ready(pending, 214999)).toBeUndefined();
    expect(q.ready(pending, 230001)?.id).toBe('b');
    expect(
      q.ready(
        pending.filter((d) => d.id === 'a'),
        259999,
      ),
    ).toBeUndefined();
    expect(q.ready(pending, 260000)?.id).toBe('a');
  });
  it('retains edits made while uploading after acknowledgement of the exact old snapshot', () => {
    const local = { ...linked(), modified: 110000, cloudSource: { ...linked().cloudSource!, savedModified: 100000 } };
    expect(dirtyDocument(local)).toBe(true);
    const q = new SyncQueue();
    q.succeeded(local.id, 120000);
    expect(update(q, [local], 140000).pending).toHaveLength(1);
    expect(dirtyDocument({ ...local, modified: 100000 })).toBe(false);
  });
  it('blocks 409 until baseline changes or explicit retry, rather than retrying each poll', () => {
    const q = new SyncQueue(),
      local = linked();
    q.failed(local, 'conflict', 200000);
    expect(update(q, [{ ...local, modified: 300000 }], 400000).conflicts).toEqual(['a']);
    expect(update(q, [{ ...local, cloudSource: { ...local.cloudSource!, revision: 'r2' } }], 400000).conflicts).toEqual([]);
    q.failed(local, 'conflict', 500000);
    q.retry('a');
    expect(update(q, [local], 600000).conflicts).toEqual([]);
  });
  it('backs off transient errors and never uploads two diverging local variants', () => {
    const q = new SyncQueue(),
      local = linked();
    q.failed(local, 'error', 200000);
    let work = update(q, [local], 200000);
    expect(q.ready(work.pending, 214999)).toBeUndefined();
    expect(q.ready(work.pending, 215000)?.id).toBe('a');
    q.failed(local, 'error', 215000);
    work = update(q, [local], 230000);
    expect(q.ready(work.pending, 244999)).toBeUndefined();
    expect(q.ready(work.pending, 245000)?.id).toBe('a');
    expect(update(q, [local, linked('b')], 300000)).toMatchObject({ pending: [], conflicts: ['a', 'b'] });
  });
  it('treats named versions and metadata changes as dirty', () => {
    const local = { ...linked(), modified: 1 };
    expect(dirtyDocument(local)).toBe(false);
    expect(dirtyDocument({ ...local, versionsModified: 2 })).toBe(true);
    expect(dirtyDocument({ ...local, name: 'renamed' })).toBe(true);
    expect(dirtyDocument({ ...local, folderId: 'moved' })).toBe(true);
  });
});
