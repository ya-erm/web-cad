import { afterEach, describe, expect, it, vi } from 'vitest';
import { retireSnapshot, retiredCandidates, cleanedSnapshotMetadata, RETIRED_GRACE_MS } from './cloud-store.mjs';
import { collectRetired } from './cloud.mjs';
import { createCloudStorage } from './cloud-storage.mjs';

afterEach(() => vi.restoreAllMocks());
const entry = (revision: string, retiredAt = 0, thumbnailSize = 0) => ({ revision, retiredAt, thumbnailSize });
const document = (id = 'doc') => ({
  id,
  revision: 'current',
  name: 'Name',
  modified: 10,
  thumbnailSize: 5,
  retired: [entry('previous'), entry('old-one', 0, 20), entry('old-two'), entry('old-three')],
});

describe('bounded immutable snapshot retention', () => {
  it('records the displaced current snapshot once and preserves the predecessor chain', () => {
    const old = document();
    const before = structuredClone(old);
    const retired = retireSnapshot(old, 100);
    expect(retired.map((r) => r.revision)).toEqual(['current', 'previous', 'old-one', 'old-two', 'old-three']);
    expect(retired[0]).toEqual(entry('current', 100, 5));
    expect(old).toEqual(before);
    expect(
      retireSnapshot({ ...old, retired: [entry('current'), ...old.retired] }, 100).filter((r) => r.revision === 'current'),
    ).toHaveLength(1);
  });
  it('always protects current and newest previous, honors grace and bounds cleanup', () => {
    const doc = {
      ...document(),
      retired: [
        entry('previous'),
        entry('current'),
        entry('old-one'),
        entry('old-one'),
        entry('newer', RETIRED_GRACE_MS - 1),
        entry('old-two'),
        entry('old-three'),
        entry('../unsafe'),
      ],
    };
    expect(retiredCandidates(doc, RETIRED_GRACE_MS).map((r) => r.revision)).toEqual(['old-one', 'old-two']);
    expect(retiredCandidates(doc, RETIRED_GRACE_MS - 1)).toEqual([]);
    expect(retiredCandidates(doc, RETIRED_GRACE_MS, 1).map((r) => r.revision)).toEqual(['old-one']);
    expect(retiredCandidates(doc, RETIRED_GRACE_MS, 100)).toHaveLength(2);
    expect(retiredCandidates({ ...doc, retired: [entry('previous'), entry('old', NaN)] }, RETIRED_GRACE_MS)).toEqual([]);
  });
  it.each([null, {}, entry('../unsafe'), entry('previous', NaN), entry('current')])(
    'fails closed when the first predecessor is malformed (%j)',
    (first) => {
      const doc = { ...document(), retired: [first, entry('valid-previous'), entry('current'), entry('older')] };
      expect(retiredCandidates(doc, RETIRED_GRACE_MS)).toEqual([]);
    },
  );
  it('acknowledges cleanup against the latest metadata without reverting a concurrent save or rename', () => {
    const latest = {
      ...document(),
      revision: 'new-current',
      name: 'Concurrent rename',
      folderId: 'new-folder',
      modified: 99,
      retired: [entry('current'), ...document().retired],
    };
    const result = cleanedSnapshotMetadata(latest, ['old-one', 'new-current', 'current']);
    expect(result).toEqual({ ...latest, retired: latest.retired.filter((r) => r.revision !== 'old-one') });
    expect(latest.retired.some((r) => r.revision === 'old-one')).toBe(true);
  });
  it('rechecks candidates and cleans at most two revisions across the entire request', async () => {
    const docs = new Map([
      ['a', document('a')],
      ['b', document('b')],
    ]);
    const db = {
      document: vi.fn(async (_user: string, id: string) => docs.get(id)),
      cleaned: vi.fn(async (_user: string, id: string, ids: string[]) => docs.set(id, cleanedSnapshotMetadata(docs.get(id), ids))),
    };
    const objects = { removeRetired: vi.fn(async () => {}) };
    await collectRetired(db as never, objects as never, 'owner', [...docs.values()], AbortSignal.timeout(3000));
    expect(objects.removeRetired).toHaveBeenCalledTimes(2);
    expect(objects.removeRetired.mock.calls.map((args: unknown[]) => (args[2] as { revision: string }).revision)).toEqual([
      'old-one',
      'old-two',
    ]);
    expect(db.cleaned).toHaveBeenCalledTimes(2);
    expect(docs.get('b')!.retired).toHaveLength(4);
  });
  it('ends optional cleanup when its shared 1.5 second budget expires', async () => {
    const timeout = new AbortController();
    const factory = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const db = { document: vi.fn(async () => document()), cleaned: vi.fn(async () => {}) };
    const objects = {
      removeRetired: vi.fn(
        async (_u: unknown, _d: unknown, _r: unknown, signal: AbortSignal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            queueMicrotask(() => timeout.abort());
          }),
      ),
    };
    await expect(
      collectRetired(db as never, objects as never, 'owner', [document()], new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledWith(1500);
    expect(objects.removeRetired).toHaveBeenCalledTimes(1);
    expect(db.cleaned).not.toHaveBeenCalled();
  });
  it('does not delete a revision protected by newer metadata or acknowledge failed deletion', async () => {
    const stale = document();
    const fresh = { ...stale, revision: 'old-one', retired: [entry('old-two')] };
    const db = { document: vi.fn(async () => fresh), cleaned: vi.fn(async () => {}) };
    const objects = { removeRetired: vi.fn(async () => {}) };
    await collectRetired(db as never, objects as never, 'owner', [stale], AbortSignal.timeout(3000));
    expect(objects.removeRetired).not.toHaveBeenCalled();
    db.document.mockResolvedValue(stale);
    objects.removeRetired.mockRejectedValue(new Error('private storage failure'));
    await expect(collectRetired(db as never, objects as never, 'owner', [stale], AbortSignal.timeout(3000))).resolves.toBeUndefined();
    expect(db.cleaned).not.toHaveBeenCalled();
  });
});

describe('retired object removal uses direct owner-scoped DELETE only', () => {
  it('deletes the two exact known objects without LIST, and treats absence as success', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const objects = createCloudStorage('test-bucket', 'fake-iam', AbortSignal.timeout(3000));
    try {
      await objects.removeRetired('owner', document(), entry('old-one', 0, 20), AbortSignal.timeout(2000));
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.map(([url]) => String(url))).toEqual([
        'https://storage.yandexcloud.net/test-bucket/documents/owner/doc/old-one/project.gz',
        'https://storage.yandexcloud.net/test-bucket/documents/owner/doc/old-one/thumbnail',
      ]);
      for (const [, options] of request.mock.calls) {
        expect(options?.method).toBe('DELETE');
        expect(options?.redirect).toBe('error');
        expect(options?.headers).toEqual({ Authorization: 'Bearer fake-iam' });
      }
    } finally {
      objects.close();
    }
  });
  it('refuses current, newest previous, unsafe owner IDs and arbitrary revision paths before any request', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    const objects = createCloudStorage('test-bucket', 'fake-iam', AbortSignal.timeout(3000));
    try {
      for (const revision of ['current', 'previous', '../other'])
        await expect(objects.removeRetired('owner', document(), entry(revision), AbortSignal.timeout(2000))).rejects.toThrow(
          'invalid_cleanup_snapshot',
        );
      await expect(objects.removeRetired('../other', document(), entry('old-one'), AbortSignal.timeout(2000))).rejects.toThrow(
        'invalid_cleanup_snapshot',
      );
      expect(request).not.toHaveBeenCalled();
    } finally {
      objects.close();
    }
  });
});
