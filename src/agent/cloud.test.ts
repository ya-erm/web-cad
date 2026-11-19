import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary } from '../core/types';
const f = vi.hoisted(() => ({
  request: vi.fn(),
  listCloud: vi.fn(),
  download: vi.fn(),
  open: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  folders: vi.fn(),
  remember: vi.fn(),
  add: vi.fn(),
  mark: vi.fn(),
  thumbnail: vi.fn(),
  versions: vi.fn(),
  load: vi.fn(),
  locks: vi.fn(),
  current: null as { id: string } | null,
  docs: [] as DocumentSummary[],
}));
vi.mock('../cloud/client', () => ({
  cloudRequest: f.request,
  listCloud: f.listCloud,
  downloadCloudSnapshot: f.download,
  openCloudDocument: f.open,
  uploadCloudDocument: f.upload,
}));
vi.mock('../store/persistence', () => ({
  listDocuments: f.list,
  listLibraryFolders: f.folders,
  rememberLibraryFolders: f.remember,
  addDocumentIfAbsent: f.add,
  markCloudCopy: f.mark,
  saveThumbnail: f.thumbnail,
}));
vi.mock('../store/docStore', () => ({ useDoc: { getState: () => ({ doc: f.current, loadList: f.load }) } }));
vi.mock('../store/folderStore', () => ({
  useFolder: { getState: () => ({ links: {} }) },
  readProject: (raw: any) => {
    if (!raw || !raw.units || !Array.isArray(raw.tabs)) throw new Error('Invalid project file');
    const { versions = [], workspaces = [], thumbnail, ...doc } = raw;
    return { doc, versions: [...versions, ...workspaces.map((w: any) => ({ ...w, kind: 'workspace' }))], thumbnail };
  },
  projectText: (doc: unknown, versions: any[], thumbnail?: string) =>
    JSON.stringify({
      ...(doc as object),
      versions: versions.filter((v) => v.kind !== 'workspace'),
      workspaces: versions.filter((v) => v.kind === 'workspace'),
      ...(thumbnail ? { thumbnail } : {}),
    }),
}));
vi.mock('../store/versions', () => ({
  copiedVersionIds: (versions: any[]) => new Map(versions.filter((v) => v.kind !== 'workspace').map((v) => [v.id, 'copied-' + v.id])),
  withCopiedVersions: (doc: unknown, copies: Map<string, string>) => ({ ...(doc as object), copies: [...copies] }),
  importVersions: f.versions,
}));
vi.mock('../cloud/uploadLock', () => ({
  withCloudUploadLock: async (fn: (signal?: AbortSignal) => unknown, options: { signal?: AbortSignal } = {}) => {
    f.locks();
    return fn(options.signal);
  },
}));
import { useCloudSync } from '../cloud/syncState';
import { cloudStatus, cloudList, cloudUpload, cloudDownload, cloudOpen, cloudUploadFile, cloudSync, cloudCreateFolder } from './cloud';
const remote = {
  id: 'remote',
  name: 'Model',
  folderId: 'cloud-folder',
  revision: 'r2',
  created: 1,
  modified: 200,
  size: 100,
  thumbnailSize: 0,
  hash: 'hash',
  thumbnailHash: '',
  thumbnailUrl: 'https://private.invalid/signed?secret=value',
};
const account = { id: 'u', displayName: 'Test account', email: 'private@example.invalid', avatarUrl: 'https://private.invalid/avatar' };
const model = {
  id: 'existing-id',
  name: 'Imported model',
  created: 1,
  modified: 1,
  version: 1,
  units: { length: 'mm', angle: 'deg' },
  tabs: [],
  activeTab: '',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window',new EventTarget());
  vi.stubGlobal('CustomEvent',class extends Event{detail:unknown;constructor(name:string,options:{detail:unknown}){super(name);this.detail=options.detail;}});
  f.current = { id: 'local' };
  f.docs = [
    {
      id: 'local',
      name: 'Model',
      created: 1,
      modified: 100,
      cloudSource: { userId: 'u', documentId: 'remote', revision: 'r1', cloudModified: 100, savedModified: 100 },
    },
  ];
  f.request.mockImplementation(async (path: string, body: any) =>
    path === '/auth/session'
      ? { user: account }
      : { folder: { id: body.id, name: body.name, parentId: body.parentId, created: 1, modified: 1 } },
  );
  f.listCloud.mockResolvedValue({
    userId: 'u',
    folders: [{ id: 'cloud-folder', name: 'Cloud folder', parentId: '', created: 1, modified: 1 }],
    documents: [remote],
  });
  f.list.mockImplementation(async () => structuredClone(f.docs));
  f.folders.mockResolvedValue([]);
  f.remember.mockResolvedValue(undefined);
  f.upload.mockResolvedValue(remote);
  f.open.mockResolvedValue('local');
  f.download.mockResolvedValue({
    doc: model,
    versions: [
      { id: 'v1', name: 'Version', tabs: [], units: model.units, created: 1, activeTab: '' },
      { id: 'branch', kind: 'workspace', name: 'Branch', tabs: [], units: model.units, created: 1, activeTab: '' },
    ],
    document: remote,
  });
  f.add.mockImplementation(async (doc: any) => {
    f.docs.push({ id: doc.id, name: doc.name, created: doc.created, modified: doc.modified });
    return true;
  });
  f.mark.mockImplementation(async (id: string, source: any) => {
    const found = f.docs.find((d) => d.id === id);
    if (found) found.cloudSource = source;
  });
  f.versions.mockResolvedValue(1);
  useCloudSync.setState({
    enabled: true,
    accountId: 'u',
    phase: 'synced',
    pending: 0,
    error: null,
    conflicts: [],
    remoteChanges: [],
    currentDocId: null,
    lastSyncedAt: 100,
  });
});
afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals();});
describe('agent cloud operations', () => {
  it('returns safe status/list metadata without credentials, email, avatars or signed URLs', async () => {
    const status = await cloudStatus();
    expect(status.account).toEqual({ id: 'u', displayName: 'Test account' });
    expect(JSON.stringify(status)).not.toContain('private');
    const list = await cloudList();
    expect(list.documents[0]).not.toHaveProperty('thumbnailUrl');
    expect(JSON.stringify(list)).not.toContain('https://');
  });
  it('requires a signed-in session and rejects ambiguous names before writes', async () => {
    f.request.mockResolvedValueOnce({ user: null });
    await expect(cloudUpload()).rejects.toThrow('Sign in');
    expect(f.upload).not.toHaveBeenCalled();
    f.docs.push({ ...f.docs[0], id: 'variant' });
    await expect(cloudUpload('Model')).rejects.toThrow('Ambiguous');
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('preserves a connected cloud folder and forwards only explicit CAS baselines through the upload lane', async () => {
    const result = await cloudUpload('local', { expectedRevision: 'r2', expectedModified: 200 });
    expect(f.upload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'local' }),
      'cloud-folder',
      false,
      'r2',
      200,
      expect.objectContaining({ expectedUserId: 'u', lockHeld: true, signal: expect.any(AbortSignal) }),
    );
    expect(result.document).not.toHaveProperty('thumbnailUrl');
    await expect(cloudUpload('local', { expectedRevision: 'r2' })).rejects.toThrow('together');
    await expect(cloudUpload('local', { asCopy: true, expectedRevision: 'r2', expectedModified: 200 })).rejects.toThrow('separate copy');
  });
  it('rejects foreign local ownership and account changes during awaited metadata reads', async () => {
    f.docs[0].cloudSource!.userId = 'other';
    await expect(cloudUpload('local')).rejects.toThrow('another cloud account');
    expect(f.upload).not.toHaveBeenCalled();
    f.docs[0].cloudSource!.userId = 'u';
    f.listCloud.mockImplementation(async () => {
      useCloudSync.getState().setAccount(null);
      useCloudSync.getState().setAccount('u');
      return { userId: 'u', folders: [], documents: [] };
    });
    await expect(cloudUpload('local')).rejects.toBeDefined();
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('mirrors new nested browser folders using canonical server ids and no document move', async () => {
    delete f.docs[0].cloudSource;
    f.docs[0].folderId = 'child';
    f.folders.mockResolvedValue([
      { id: 'parent', name: 'Projects', parentId: '', created: 1, modified: 1 },
      { id: 'child', name: 'Parts', parentId: 'parent', created: 1, modified: 1 },
    ]);
    await cloudUpload('local');
    const creates = f.request.mock.calls.filter(([path]) => path === '/cloud/folder');
    expect(creates).toHaveLength(2);
    expect(creates[1][1].parentId).toBe(creates[0][1].id);
    expect(f.upload.mock.calls[0][1]).toBe(creates[1][1].id);
    expect(f.remember).toHaveBeenCalledTimes(2);
  });
  it('downloads versions and workspaces read-only as a complete JSON file', async () => {
    const result = await cloudDownload('remote'),
      file = JSON.parse(atob(result.base64));
    expect(result.fileName).toBe('Model.webcad.json');
    expect(file.versions).toHaveLength(1);
    expect(file.workspaces).toHaveLength(1);
    expect(f.download).toHaveBeenCalledWith('remote', expect.any(AbortSignal), 'u');
    expect(f.add).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });
  it('opens only through the guarded non-destructive materialization helper', async () => {
    const result = await cloudOpen('remote');
    expect(result.localId).toBe('local');
    expect(f.open).toHaveBeenCalledWith('remote', expect.objectContaining({ expectedUserId: 'u', signal: expect.any(AbortSignal) }));
    expect(f.add).not.toHaveBeenCalled();
    expect(f.current?.id).toBe('local');
  });
  it('imports uploads as new independent local copies with remapped versions; keeps copies after upload failure', async () => {
    f.upload.mockRejectedValue(new Error('Upload unavailable'));
    const raw = { ...model, versions: [{ id: 'v1', name: 'V1', units: model.units, tabs: [], created: 1, activeTab: '' }] };
    await expect(cloudUploadFile(raw)).rejects.toThrow('Local copy');
    const created = f.add.mock.calls[0][0];
    expect(created.id).not.toBe(model.id);
    expect(f.current?.id).toBe('local');
    expect(f.versions).toHaveBeenCalledWith(created.id, expect.any(Array), false, new Map([['v1', 'copied-v1']]));
    expect(f.docs.some((d) => d.id === created.id)).toBe(true);
    expect(f.mark).toHaveBeenCalledWith(created.id, expect.objectContaining({ userId: 'u', revision: '' }));
  });
  it('validates import/folder/sync arguments before any local or remote write', async () => {
    await expect(cloudUploadFile({ invalid: true })).rejects.toThrow('Invalid project');
    await expect(cloudCreateFolder('../bad')).rejects.toThrow('folder');
    await expect(cloudSync({ waitMs: 120001 })).rejects.toThrow('waitMs');
    expect(f.add).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });
  it('does not implicitly enable paused synchronization and reports blocked/incomplete queues', async () => {
    useCloudSync.getState().setEnabled(false);
    const paused = await cloudSync({ waitMs: 100 });
    expect(paused).toMatchObject({ enabled: false, completed: false, phase: 'paused' });
    const enabled = await cloudSync({ enabled: true, waitMs: 0 });
    expect(enabled.enabled).toBe(true);
    expect(enabled.completed).toBe(false);
    useCloudSync.setState({ phase: 'conflict', pending: 1, conflicts: ['local'] });
    expect(await cloudSync({ waitMs: 100 })).toMatchObject({ completed: false, conflicts: ['local'] });
  });
  it('does not report a just-saved dirty browser document complete before the queue notices it', async () => {
    delete f.docs[0].cloudSource;
    useCloudSync.setState({ phase: 'synced', pending: 0 });
    expect(await cloudSync({ retry: false })).toMatchObject({ phase: 'synced', pending: 0, completed: false });
  });
  it('waits for the existing queue acknowledgement, respects the timeout and aborts on an account epoch change', async () => {
    vi.useFakeTimers();
    useCloudSync.setState({ phase: 'waiting', pending: 1 });
    const finished = cloudSync({ waitMs: 1000 });
    setTimeout(() => {
      f.docs[0].cloudSource = { ...f.docs[0].cloudSource!, savedModified: 100 };
      useCloudSync.setState({ phase: 'synced', pending: 0 });
    }, 200);
    await vi.advanceTimersByTimeAsync(250);
    expect(await finished).toMatchObject({ completed: true, pending: 0 });
    useCloudSync.setState({ phase: 'waiting', pending: 1 });
    const timeout = cloudSync({ waitMs: 200 });
    await vi.advanceTimersByTimeAsync(200);
    expect(await timeout).toMatchObject({ completed: false, pending: 1 });
    const changed = cloudSync({ waitMs: 1000 }),
      rejected = expect(changed).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    useCloudSync.getState().setAccount('other');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  });
  it('publishes confirmed document and folder metadata without fetching another list', async () => {
    const events: any[] = [];
    window.addEventListener('webcad:cloud-changed', (event) => events.push((event as CustomEvent).detail));
    await cloudUpload('local');
    expect(f.listCloud).toHaveBeenCalledTimes(1);
    expect(events.at(-1).documents.find((doc: any) => doc.id === 'remote').revision).toBe('r2');
    await cloudCreateFolder('New folder');
    expect(f.listCloud).toHaveBeenCalledTimes(2);
    expect(events.at(-1).folders.some((folder: any) => folder.name === 'New folder')).toBe(true);
  });
});
