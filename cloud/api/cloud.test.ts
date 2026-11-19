import { describe, it, expect, vi } from 'vitest';
import { createCloudHandler } from './cloud.mjs';
import { CloudError } from './cloud-store.mjs';
import { APP_ORIGIN, SESSION_COOKIE } from './auth.mjs';
const ctx = { token: { access_token: 'private-iam-token' } };
function setup() {
  const db = {
    authenticate: vi.fn(async () => 'owner'),
    list: vi.fn(async () => ({ folders: [], documents: [] })),
    document: vi.fn(async () => null),
    folder: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    pending: vi.fn(async () => ({ id: 'upload', documentId: 'doc', expectedRevision: '' })),
    commit: vi.fn(async () => ({ id: 'doc', revision: 'upload' })),
    move: vi.fn(async () => {}),
    cleaned: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const objects = {
    prepare: vi.fn(async () => ({ projectUrl: 'signed-upload', thumbnailUrl: null })),
    seal: vi.fn(async () => {}),
    removeRetired: vi.fn(async () => {}),
    download: vi.fn(async () => 'signed-download'),
    close: vi.fn(),
  };
  const store = vi.fn(async () => db);
  // The mock models only the fields used by each test.
  const handle = createCloudHandler({ store: store as never, storage: (() => objects) as never });
  const request = (path: string, body?: object, origin = APP_ORIGIN) =>
    handle(
      {
        path,
        httpMethod: body ? 'POST' : 'GET',
        headers: { Origin: origin, Cookie: `${SESSION_COOKIE}=${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      },
      ctx,
    );
  return { db, objects, store, handle, request };
}
describe('cloud API ownership and publication', () => {
  it('rejects anonymous requests before touching data', async () => {
    const s = setup();
    expect((await s.handle({ path: '/cloud/list', httpMethod: 'GET' }, ctx)).statusCode).toBe(401);
    expect(s.store).not.toHaveBeenCalled();
  });
  it.each(['https://evil.test', ''])('requires the application Origin for mutations (%s)', async (origin) => {
    const s = setup();
    expect((await s.request('/cloud/folder', { id: 'folder', name: 'Parts', parentId: '' }, origin)).statusCode).toBe(403);
    expect(s.store).not.toHaveBeenCalled();
  });
  it('uses the session owner, ignoring any user ID supplied by a client', async () => {
    const s = setup();
    expect((await s.request('/cloud/folder', { id: 'folder', name: 'Parts', parentId: '', userId: 'victim' })).statusCode).toBe(200);
    expect(s.db.folder.mock.calls[0][0]).toBe('owner');
  });
  it('returns 404 for a document outside the owner partition', async () => {
    const s = setup();
    expect((await s.request('/cloud/open', { id: 'foreign' })).statusCode).toBe(404);
    expect(s.objects.download).not.toHaveBeenCalled();
  });
  it('validates file limits before granting an upload URL', async () => {
    const s = setup();
    const body = {
      documentId: 'doc',
      name: 'Doc',
      folderId: '',
      expectedRevision: '',
      size: 20 * 1024 * 1024 + 1,
      thumbnailSize: 0,
      hash: 'a'.repeat(64),
    };
    expect((await s.request('/cloud/prepare', body)).statusCode).toBe(400);
    expect(s.objects.prepare).not.toHaveBeenCalled();
  });
  it('does not publish incomplete uploads', async () => {
    const s = setup();
    s.objects.seal.mockRejectedValue(new CloudError(409, 'upload_incomplete'));
    expect((await s.request('/cloud/commit', { uploadId: 'upload' })).statusCode).toBe(409);
    expect(s.db.commit).not.toHaveBeenCalled();
  });
  it('publishes only after sealing objects out of the writable upload prefix', async () => {
    const s = setup();
    expect((await s.request('/cloud/commit', { uploadId: 'upload' })).statusCode).toBe(200);
    expect(s.objects.seal.mock.invocationCallOrder[0]).toBeLessThan(s.db.commit.mock.invocationCallOrder[0]);
  });
  it('rejects expired sessions and redacts storage errors', async () => {
    const s = setup();
    s.db.authenticate.mockResolvedValueOnce(null as never);
    expect((await s.request('/cloud/list')).statusCode).toBe(401);
    s.db.list.mockRejectedValueOnce(new Error('SECRET-SIGNED-URL'));
    const r = await s.request('/cloud/list');
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('SECRET');
    expect(s.db.close).toHaveBeenCalled();
  });
  it('requires a metadata baseline when updating an existing snapshot', async () => {
    const s = setup();
    const r = await s.request('/cloud/prepare', {
      documentId: 'doc',
      name: 'Doc',
      folderId: '',
      expectedRevision: 'r1',
      size: 10,
      thumbnailSize: 0,
      hash: 'a'.repeat(64),
      thumbnailHash: '',
    });
    expect(r.statusCode).toBe(400);
    expect(s.objects.prepare).not.toHaveBeenCalled();
  });
  it('does not publish a snapshot over a concurrent rename or move', async () => {
    const s = setup();
    s.db.document.mockResolvedValue({ id: 'doc', revision: 'r1', modified: 20 } as never);
    s.db.pending.mockResolvedValue({ id: 'upload', documentId: 'doc', expectedRevision: 'r1', expectedModified: 19 } as never);
    expect((await s.request('/cloud/commit', { uploadId: 'upload' })).statusCode).toBe(409);
    expect(s.objects.seal).not.toHaveBeenCalled();
  });
  it('rejects invalid document names before changing metadata', async () => {
    const s = setup();
    expect((await s.request('/cloud/document', { id: 'doc', revision: 'r1', modified: 1, folderId: '', name: '../name' })).statusCode).toBe(
      400,
    );
    expect(s.db.move).not.toHaveBeenCalled();
  });
});

describe('cloud trash contract', () => {
  it('does not issue a download URL for a trashed snapshot', async () => {
    const s = setup();
    s.db.document.mockResolvedValue({ id: 'doc', trashed: 1 } as never);
    expect((await s.request('/cloud/open', { id: 'doc' })).statusCode).toBe(410);
    expect(s.objects.download).not.toHaveBeenCalled();
  });
  it('requires a boolean trash flag and keeps CAS and owner scoping for restore', async () => {
    const s = setup();
    const body = { id: 'doc', folderId: '', revision: 'revision', modified: 1 };
    expect((await s.request('/cloud/document', { ...body, trashed: 'yes' })).statusCode).toBe(400);
    expect(s.db.move).not.toHaveBeenCalled();
    expect((await s.request('/cloud/document', { ...body, trashed: false })).statusCode).toBe(200);
    expect(s.db.move.mock.calls[0]).toEqual(['owner', { ...body, trashed: false }]);
  });
});

describe('automatic upload ownership and cleanup budget', () => {
  const body = {
    documentId: 'doc',
    name: 'Doc',
    folderId: '',
    expectedRevision: '',
    size: 10,
    thumbnailSize: 0,
    hash: 'a'.repeat(64),
    thumbnailHash: '',
  };
  it('rejects a changed account before granting direct upload links', async () => {
    const s = setup();
    expect((await s.request('/cloud/prepare', { ...body, auto: true, expectedUserId: 'other-owner' })).statusCode).toBe(409);
    expect(s.db.prepare).not.toHaveBeenCalled();
    expect(s.objects.prepare).not.toHaveBeenCalled();
  });
  it.each(['/cloud/folder', '/cloud/document'])('also guards session changes before %s mutations', async (path) => {
    const s = setup();
    const response = await s.request(path, {
      id: 'folder',
      name: 'Name',
      parentId: '',
      folderId: '',
      revision: 'r',
      modified: 1,
      expectedUserId: 'other-owner',
    });
    expect(response.statusCode).toBe(409);
    expect(s.db.folder).not.toHaveBeenCalled();
    expect(s.db.move).not.toHaveBeenCalled();
  });
  it.each([{ auto: 'yes' }, { expectedUserId: 12 }])('rejects invalid automatic upload fields (%j)', async (extra) => {
    const s = setup();
    expect((await s.request('/cloud/prepare', { ...body, ...extra })).statusCode).toBe(400);
    expect(s.objects.prepare).not.toHaveBeenCalled();
  });
  it('returns the canonical folder record without changing delete responses', async () => {
    const s = setup();
    const canonical = { id: 'folder', name: 'Parts', parentId: '', created: 1, modified: 2 };
    s.db.folder.mockResolvedValueOnce(canonical as never);
    const saved = await s.request('/cloud/folder', { id: 'folder', name: 'Parts', parentId: '', expectedUserId: 'owner' });
    expect(JSON.parse(saved.body)).toEqual({ ok: true, folder: canonical });
    const removed = await s.request('/cloud/folder', { id: 'folder', remove: true, expectedUserId: 'owner' });
    expect(JSON.parse(removed.body)).toEqual({ ok: true });
  });
  it('gives a finite retry hint when cleanup backlog blocks automatic upload', async () => {
    const s = setup();
    s.db.prepare.mockRejectedValue(new CloudError(429, 'storage_cleanup_pending'));
    const response = await s.request('/cloud/prepare', { ...body, auto: true, expectedUserId: 'owner' });
    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('60');
    expect(JSON.parse(response.body).retryAfter).toBe(60);
  });
  it('returns successful lists even when cleanup fails and keeps internal history private', async () => {
    const s = setup();
    const doc = {
      id: 'doc',
      revision: 'current',
      thumbnailSize: 0,
      retired: [
        { revision: 'previous', retiredAt: 0 },
        { revision: 'old', retiredAt: 0 },
      ],
    };
    s.db.list.mockResolvedValue({ folders: [], documents: [doc] } as never);
    s.db.document.mockResolvedValue(doc as never);
    s.objects.removeRetired.mockRejectedValue(new Error('secret object URL'));
    const response = await s.request('/cloud/list');
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).documents[0].retired).toBeUndefined();
    expect(s.db.cleaned).not.toHaveBeenCalled();
    expect(response.body).not.toContain('secret');
  });
});
