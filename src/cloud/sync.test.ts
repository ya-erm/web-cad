import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  list: vi.fn(),
  folders: vi.fn(),
  remember: vi.fn(),
  compare: vi.fn(),
  replace: vi.fn(),
  request: vi.fn(),
  upload: vi.fn(),
  recover: vi.fn(),
  hasPending: vi.fn(),
  active: null as { id: string } | null,
  documentListeners: new Set<() => void>(),
}));
vi.mock('../store/persistence', () => ({
  listDocuments: f.list,
  listLibraryFolders: f.folders,
  rememberLibraryFolders: f.remember,
  compareCloudSummary: f.compare,
  replaceCleanCloudDocument: f.replace,
}));
vi.mock('../store/docStore', () => ({
  useDoc: {
    getState: () => ({ doc: f.active, saving: false, docs: [] }),
    subscribe: (listener: () => void) => {
      f.documentListeners.add(listener);
      return () => f.documentListeners.delete(listener);
    },
  },
}));
vi.mock('../store/folderStore', () => ({ useFolder: { getState: () => ({ links: {} }), subscribe: () => () => {} } }));
vi.mock('../store/versions', () => ({
  useVersions: { subscribe: () => () => {} },
  copiedVersionIds: vi.fn(),
  withCopiedVersions: vi.fn(),
}));
vi.mock('./client', () => ({
  CloudFailure: class extends Error {},
  cloudRequest: f.request,
  uploadCloudDocument: f.upload,
  downloadCloudSnapshot: vi.fn(),
  recoverCloudAcknowledgement: f.recover,
  hasPendingCloudUpload: f.hasPending,
  pendingCloudUploads: () => [],
}));
vi.mock('./uploadLock', () => ({ withCloudUploadLock: async (fn: () => Promise<unknown>) => fn(), cloudUploadSlotAvailable: () => true }));
import { startCloudSync } from './sync';
import { useCloudSync } from './syncState';
import type { DocumentSummary } from '../core/types';
let stop: (() => void) | undefined, locals: DocumentSummary[];
const remote = {
  id: 'a',
  name: 'Model',
  folderId: '',
  revision: 'r2',
  modified: 100,
  created: 1,
  size: 1,
  thumbnailSize: 0,
  hash: 'hash',
  thumbnailHash: '',
};
beforeEach(() => {
  vi.clearAllMocks();
  f.active = null;
  f.documentListeners.clear();
  vi.useFakeTimers();
  vi.setSystemTime(200000);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal(
    'CustomEvent',
    class extends Event {
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        super(type);
        this.detail = init.detail;
      }
    },
  );
  locals = [
    {
      id: 'a',
      name: 'Model',
      created: 1,
      modified: 100,
      cloudSource: {
        userId: 'u',
        documentId: 'a',
        revision: 'r1',
        savedModified: 1,
        cloudModified: 1,
        savedName: 'Model',
        savedFolderId: '',
      },
    },
  ];
  f.list.mockImplementation(async () => structuredClone(locals));
  f.folders.mockResolvedValue([]);
  f.remember.mockResolvedValue(undefined);
  f.request.mockResolvedValue({ userId: 'u', folders: [], documents: [{ ...remote }] });
  f.hasPending.mockReturnValue(false);
  useCloudSync.setState({ enabled: true, accountId: 'u', phase: 'waiting', conflicts: [], remoteChanges: [], pending: 0, error: null });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('runtime reconciliation', () => {
  it('recovers a linked lost ACK before the fresh revision can become a permanent conflict', async () => {
    f.hasPending.mockReturnValue(true);
    f.recover.mockImplementation(async () => {
      locals[0].cloudSource = { ...locals[0].cloudSource!, revision: 'r2', savedModified: 100, cloudModified: 100 };
      return true;
    });
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    expect(f.recover).toHaveBeenCalledWith('a', expect.objectContaining({ revision: 'r2' }), 'u');
    expect(useCloudSync.getState()).toMatchObject({ phase: 'synced', conflicts: [], pending: 0 });
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('runs pending first-upload recovery even after that local document was trashed', async () => {
    locals = [{ id: 'a', name: 'Model', created: 1, modified: 100, trashed: 101 }];
    f.hasPending.mockReturnValue(true);
    f.recover.mockResolvedValue(true);
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    expect(f.recover).toHaveBeenCalledTimes(1);
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('invalidates a pending summary CAS when the account changes during reconciliation', async () => {
    locals[0].modified = 1;
    f.request.mockResolvedValue({ userId: 'u', folders: [], documents: [{ ...remote, revision: 'r1', trashed: 150 }] });
    let allowed = true;
    f.compare.mockImplementation(async (_expected: unknown, _patch: unknown, guard: () => boolean) => {
      useCloudSync.getState().setAccount('other');
      allowed = guard();
      return false;
    });
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    expect(f.compare).toHaveBeenCalledWith(expect.objectContaining({ modified: 1 }), { trashed: 150 }, expect.any(Function));
    expect(allowed).toBe(false);
    expect(locals[0].trashed).toBeUndefined();
  });
  it('backs off failed metadata polling and survives StrictMode stop/restart', async () => {
    f.request.mockRejectedValue(new TypeError('offline'));
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.request).toHaveBeenCalledTimes(1);
    stop();
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('never hides an active clean snapshot when another device trashes its cloud copy', async () => {
    locals[0].modified = 1;
    f.active = { id: 'a' };
    f.request.mockResolvedValue({ userId: 'u', folders: [], documents: [{ ...remote, revision: 'r1', trashed: 150 }] });
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    expect(f.compare).not.toHaveBeenCalled();
    expect(useCloudSync.getState().remoteChanges).toEqual([]);
  });
  it('rechecks the active document at the trash CAS boundary', async () => {
    locals[0].modified = 1;
    f.request.mockResolvedValue({ userId: 'u', folders: [], documents: [{ ...remote, revision: 'r1', trashed: 150 }] });
    let allowed = true;
    f.compare.mockImplementation(async (_expected: unknown, _patch: unknown, guard: () => boolean) => {
      f.active = { id: 'a' };
      allowed = guard();
      return false;
    });
    stop = startCloudSync();
    await vi.advanceTimersByTimeAsync(101);
    expect(f.compare).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(false);
  });
  it('does not postpone scheduled work while editing emits events faster than the wake delay', async () => {
    stop = startCloudSync();
    // Pointer movements and live edits can update Zustand many times per second.
    for (let elapsed = 0; elapsed < 500; elapsed += 50) {
      await vi.advanceTimersByTimeAsync(50);
      for (const listener of f.documentListeners) listener();
    }
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.list).toHaveBeenCalled();
  });
});
