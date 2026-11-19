import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({
  snapshot: vi.fn(),
  mark: vi.fn(),
  list: vi.fn(),
  flush: vi.fn(),
  load: vi.fn(),
  compare: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  put: vi.fn(),
}));
vi.mock('./uploadProgress', () => ({ putCloudObject: fixtures.put }));
vi.mock('../store/persistence', () => ({
  cloudUploadSnapshot: fixtures.snapshot,
  markCloudCopy: fixtures.mark,
  listDocuments: fixtures.list,
  compareCloudSummary: fixtures.compare,
}));
vi.mock('../store/docStore', () => ({
  useDoc: {
    getState: () => ({
      doc: { id: 'other-open-document' },
      flushSave: fixtures.flush,
      loadList: fixtures.load,
      trashDocument: fixtures.trash,
      restoreDocument: fixtures.restore,
    }),
  },
}));
vi.mock('../store/folderStore', () => ({ projectText: JSON.stringify, readProject: JSON.parse }));
vi.mock('../store/versions', () => ({
  fileVersions: vi.fn(),
  importVersions: vi.fn(),
  copiedVersionIds: vi.fn(),
  withCopiedVersions: vi.fn(),
}));
vi.mock('./syncState', () => ({ useCloudSync: { getState: () => ({ accountId: 'u' }) } }));
vi.mock('./uploadLock', () => ({
  withCloudUploadLock: async (
    fn: (signal?: AbortSignal) => Promise<unknown>,
    o: {
      signal?: AbortSignal;
    },
  ) => fn(o?.signal),
  recordCloudUploadTime: vi.fn(),
}));
import { uploadCloudDocument, setDocumentTrash } from './client';
const options = { automatic: true, expectedUserId: 'u' };
let storage: Map<string, string>, fetcher: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const prepared = { userId: 'u', uploadId: 'r2', projectUrl: 'https://s3.invalid/project', thumbnailUrl: null };
const document = {
  id: 'a',
  name: 'Model',
  folderId: '',
  revision: 'r2',
  modified: 500,
  hash: '',
  created: 1,
  size: 1,
  thumbnailSize: 0,
  thumbnailHash: '',
};
function successfulCommit() {
  const pending = JSON.parse(storage.get('webcad.cloudPending.a')!);
  return json({ document: { ...document, hash: pending.hash } });
}
beforeEach(() => {
  vi.clearAllMocks();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  fixtures.snapshot.mockResolvedValue({
    doc: { id: 'a', name: 'Model', modified: 100, tabs: [] },
    summary: { id: 'a', name: 'Model', modified: 100, versionsModified: 99 },
    versions: [],
  });
  fixtures.list.mockResolvedValue([{ id: 'a', modified: 101 }]);
  fixtures.load.mockResolvedValue(undefined);
});
describe('snapshot upload and lost acknowledgements', () => {
  it('acknowledges the saved snapshot while edits during PUT stay dirty; never flushes another open document', async () => {
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith('/prepare') ? json(prepared) : url.includes('s3.invalid') ? new Response('') : successfulCommit(),
    );
    await uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 100 }, '', false, undefined, undefined, options);
    expect(fixtures.flush).not.toHaveBeenCalled();
    expect(fixtures.mark).toHaveBeenCalledWith('a', expect.objectContaining({ savedModified: 100, savedVersionsModified: 99 }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ auto: true, expectedUserId: 'u' });
  });
  it('recovers a committed upload after lost response without another PUT', async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/prepare')) return json(prepared);
      if (url.includes('s3.invalid')) return new Response('');
      throw new TypeError('Lost response');
    });
    await expect(
      uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 100 }, '', false, undefined, undefined, options),
    ).rejects.toThrow('Lost response');
    expect(storage.has('webcad.cloudPending.a')).toBe(true);
    fetcher.mockClear();
    fetcher.mockImplementation(async () => successfulCommit());
    await uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 101 }, '', false, undefined, undefined, options);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/commit');
    expect(storage.has('webcad.cloudPending.a')).toBe(false);
  });
  it('rejects an account switch before any signed PUT', async () => {
    fetcher.mockResolvedValue(json({ ...prepared, userId: 'other' }));
    await expect(
      uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 100 }, '', false, undefined, undefined, options),
    ).rejects.toMatchObject({ code: 'account_changed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fixtures.mark).not.toHaveBeenCalled();
  });
  it('does not adopt a lost acknowledgement when remote metadata differs', async () => {
    storage.set(
      'webcad.cloudPending.a',
      JSON.stringify({
        uploadId: 'r2',
        userId: 'u',
        documentId: 'a',
        name: 'Model',
        folderId: '',
        hash: 'hash',
        savedModified: 100,
        savedVersionsModified: 0,
        savedName: 'Model',
        savedFolderId: '',
      }),
    );
    fetcher.mockResolvedValue(json({ document: { ...document, hash: 'hash', name: 'Renamed remotely' } }));
    await expect(
      uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 100 }, '', false, undefined, undefined, options),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(fixtures.mark).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps recovery metadata when compensating trash fails after a confirmed commit', async () => {
    let reads = 0;
    fixtures.list.mockImplementation(async () =>
      ++reads === 1 ? [{ id: 'a', modified: 100 }] : [{ id: 'a', modified: 100, trashed: 101, cloudSource: { userId: 'u' } }],
    );
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/prepare')) return json(prepared);
      if (url.includes('s3.invalid')) return new Response('');
      if (url.endsWith('/commit')) return successfulCommit();
      throw new TypeError('Trash response lost');
    });
    await expect(
      uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 100 }, '', false, undefined, undefined, options),
    ).rejects.toThrow('Trash response lost');
    expect(storage.has('webcad.cloudPending.a')).toBe(true);
  });
  it('trashes using a fresh local ACK without replacing it with the stale UI baseline', async () => {
    const current = {
      id: 'a',
      name: 'Model',
      created: 1,
      modified: 200,
      cloudSource: { userId: 'u', documentId: 'a', revision: 'r2', savedModified: 200, cloudModified: 500 },
    };
    fixtures.list.mockResolvedValue([current]);
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith('/list')
        ? json({ userId: 'u', documents: [document], folders: [] })
        : json({ document: { ...document, modified: 600, trashed: 600 } }),
    );
    await setDocumentTrash({ ...current, cloudSource: { ...current.cloudSource, revision: 'r1', savedModified: 1 } }, true);
    expect(fixtures.compare).toHaveBeenCalledWith(
      current,
      { cloudSource: { ...current.cloudSource, cloudModified: 600 } },
      expect.any(Function),
    );
    expect(fixtures.mark).not.toHaveBeenCalled();
    expect(fixtures.trash).toHaveBeenCalledWith('a');
  });
  it('combines byte progress with the guarded saved-snapshot upload and commits only after PUT', async () => {
    const progress = vi.fn(),
      controller = new AbortController();
    fixtures.put.mockImplementation(async (_url: string, body: Blob, report: (loaded: number) => void, signal: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      report(Math.floor(body.size / 2));
      report(body.size);
      expect(fetcher.mock.calls.some((call) => String(call[0]).endsWith('/commit'))).toBe(false);
    });
    fetcher.mockImplementation(async (url: string) => (url.endsWith('/prepare') ? json(prepared) : successfulCommit()));
    await uploadCloudDocument({ id: 'a', name: 'Model', created: 1, modified: 100 }, '', false, undefined, undefined, {
      ...options,
      onProgress: progress,
      signal: controller.signal,
    });
    expect(fixtures.put).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const events = progress.mock.calls.map(([event]) => event);
    expect(events[0]).toMatchObject({ phase: 'preparing', loaded: 0 });
    expect(events.filter((event) => event.phase === 'uploading').map((event) => event.loaded)).toEqual(expect.arrayContaining([0]));
    const completed = events.at(-1);
    expect(completed.phase).toBe('committing');
    expect(completed.loaded).toBe(completed.total);
    expect(completed.total).toBeGreaterThan(0);
    expect(fixtures.mark).toHaveBeenCalledWith('a', expect.objectContaining({ savedModified: 100, savedVersionsModified: 99 }));
  });
});
