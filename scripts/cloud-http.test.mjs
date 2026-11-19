import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createCloudHttp, runHeadlessCloudCommand, readApiToken } from './cloud-http.mjs';
const owner = '11111111-1111-4111-8111-111111111111',
  token = `wcad_pat_v1.${owner}.22222222-2222-4222-8222-222222222222.${'x'.repeat(43)}`;
const hash = (b) => createHash('sha256').update(b).digest('hex');
const bytes = (name) =>
  Buffer.from(
    JSON.stringify({
      id: 'original',
      name,
      units: { length: 'mm', angle: 'deg' },
      tabs: [],
      versions: [{ id: 'v1', name: 'V1', doc: { tabs: [] } }],
    }),
  );
function fixture() {
  const documents = [],
    folders = [],
    pending = new Map(),
    objects = new Map(),
    calls = [];
  let sequence = 0,
    failPut = false;
  const fetcher = vi.fn(async (url, options = {}) => {
    calls.push({ url, options });
    const u = new URL(url),
      b = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : null;
    if (u.hostname === 'api.cad.ya-erm.ru') {
      expect(options.headers.Authorization).toBe('Bearer ' + token);
      expect(options.redirect).toBe('error');
      if (u.pathname === '/cloud/list') return Response.json({ userId: owner, folders, documents });
      expect(b.expectedUserId).toBe(owner);
      if (u.pathname === '/cloud/prepare') {
        const current = documents.find((x) => x.id === b.documentId);
        if (current && (current.revision !== b.expectedRevision || current.modified !== b.expectedModified))
          return Response.json({ error: 'revision_conflict' }, { status: 409 });
        const id = 'u' + ++sequence;
        pending.set(id, b);
        return Response.json({ userId: owner, uploadId: id, projectUrl: `https://storage.yandexcloud.net/fixture/${id}` });
      }
      if (u.pathname === '/cloud/commit') {
        const p = pending.get(b.uploadId),
          document = { id: p.documentId, name: p.name, folderId: p.folderId, revision: 'r' + sequence, modified: sequence, hash: p.hash };
        const i = documents.findIndex((x) => x.id === document.id);
        if (i < 0) documents.push(document);
        else documents[i] = document;
        objects.set(document.revision, objects.get(b.uploadId));
        return Response.json({ document });
      }
      if (u.pathname === '/cloud/open') {
        const d = documents.find((x) => x.id === b.id);
        return Response.json({ userId: owner, document: d, url: `https://storage.yandexcloud.net/fixture/${d.revision}` });
      }
    }
    if (u.hostname === 'storage.yandexcloud.net') {
      expect(options.headers?.Authorization).toBeUndefined();
      expect(options.redirect).toBe('error');
      const id = u.pathname.split('/').at(-1);
      if (options.method === 'PUT') {
        if (failPut) return new Response('', { status: 503 });
        objects.set(id, Buffer.from(options.body));
        return new Response('');
      }
      return new Response(objects.get(id));
    }
    throw Error('unexpected URL');
  });
  return {
    fetcher,
    documents,
    folders,
    pending,
    objects,
    calls,
    failPut: () => {
      failPut = true;
    },
  };
}
const withDir = async (fn) => {
  mkdirSync('temp/cloud-http-tests', { recursive: true });
  const p = mkdtempSync('temp/cloud-http-tests/run-');
  try {
    return await fn(p);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
};
describe('standalone cloud agent', () => {
  it('uses the existing owner guard and never sends a personal token to object storage', async () => {
    const f = fixture(),
      a = createCloudHttp(token, f.fetcher),
      result = await a.upload(bytes('A'));
    expect(result.document.id).not.toBe('original');
    expect(f.calls.filter((c) => c.url.endsWith('/cloud/commit'))).toHaveLength(1);
    const stored = JSON.parse(gunzipSync(f.objects.get('u1')));
    expect(stored.versions[0].name).toBe('V1');
    expect(stored.id).toBe(result.document.id);
    const down = await a.download(result.document.id);
    expect(JSON.parse(down.bytes).versions).toEqual(stored.versions);
  });
  it('does not commit an incomplete object transfer', async () => {
    const f = fixture();
    f.failPut();
    await expect(createCloudHttp(token, f.fetcher).upload(bytes('A'))).rejects.toThrow('PUT failed');
    expect(f.calls.some((c) => c.url.endsWith('/cloud/commit'))).toBe(false);
  });
  it('does not follow untrusted signed URLs or leak the token in an API error', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ userId: owner, projectUrl: 'https://attacker.invalid/object', uploadId: 'u' }));
    await expect(createCloudHttp(token, fetcher).upload(bytes('A'))).rejects.toThrow('Untrusted storage URL');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const bad = vi.fn().mockResolvedValue(Response.json({ error: token }, { status: 401 }));
    await expect(createCloudHttp(token, bad).list()).rejects.toThrow('request_failed');
  });
  it('keeps a changed output intact when a checksum fails', async () =>
    withDir(async (dir) => {
      const f = fixture(),
        a = createCloudHttp(token, f.fetcher),
        r = await a.upload(bytes('A')),
        file = dir + '/out.json';
      writeFileSync(file, 'original');
      f.objects.set(r.document.revision, Buffer.from('corrupt'));
      await expect(
        runHeadlessCloudCommand(['download', r.document.id, file, '--overwrite'], { token, fetcher: f.fetcher, out: vi.fn() }),
      ).rejects.toThrow('checksum');
      expect(readFileSync(file, 'utf8')).toBe('original');
    }));
  it('syncs both directions and stops when both sides changed without changing either file', async () =>
    withDir(async (dir) => {
      const file = dir + '/a.webcad.json';
      writeFileSync(file, bytes('A'));
      const f = fixture(),
        out = vi.fn(),
        run = () => runHeadlessCloudCommand(['sync-file', file], { token, fetcher: f.fetcher, out });
      await run();
      expect(out.mock.calls.at(-1)[0].action).toBe('uploaded');
      const meta = JSON.parse(readFileSync(file + '.cloud.json'));
      expect(meta.userId).toBe(owner);
      expect(JSON.stringify(meta)).not.toContain(token);
      await run();
      expect(out.mock.calls.at(-1)[0].action).toBe('unchanged');
      writeFileSync(file, bytes('Local edit'));
      await run();
      expect(out.mock.calls.at(-1)[0].action).toBe('uploaded');
      const remote = f.documents[0],
        data = gzipSync(bytes('Remote edit'));
      remote.revision = 'r-remote';
      remote.modified = 100;
      remote.name = 'Remote edit';
      remote.hash = hash(data);
      f.objects.set(remote.revision, data);
      await run();
      expect(out.mock.calls.at(-1)[0].action).toBe('downloaded');
      expect(JSON.parse(readFileSync(file)).name).toBe('Remote edit');
      writeFileSync(file, bytes('Conflicting local'));
      remote.modified = 101;
      const side = readFileSync(file + '.cloud.json', 'utf8'),
        before = readFileSync(file, 'utf8'),
        putCount = f.calls.filter((x) => x.options.method === 'PUT').length;
      await expect(run()).rejects.toThrow('both local file and cloud changed');
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(readFileSync(file + '.cloud.json', 'utf8')).toBe(side);
      expect(f.calls.filter((x) => x.options.method === 'PUT')).toHaveLength(putCount);
    }));
  it('refuses another account sidecar and never silently updates a file ID', async () =>
    withDir(async (dir) => {
      const file = dir + '/a.webcad.json';
      writeFileSync(file, bytes('A'));
      writeFileSync(file + '.cloud.json', JSON.stringify({ version: 1, userId: 'other' }));
      const f = fixture();
      await expect(runHeadlessCloudCommand(['sync-file', file], { token, fetcher: f.fetcher, out: vi.fn() })).rejects.toThrow(
        'another cloud account',
      );
      expect(f.calls.some((c) => c.options.method === 'PUT')).toBe(false);
      await expect(
        runHeadlessCloudCommand(['upload-file', file, '--document', 'id'], { token, fetcher: f.fetcher, out: vi.fn() }),
      ).rejects.toThrow('together');
    }));
  it('protects a local edit made while remote content is being downloaded', async () =>
    withDir(async (dir) => {
      const f = fixture(),
        r = await createCloudHttp(token, f.fetcher).upload(bytes('A')),
        file = dir + '/out.json';
      writeFileSync(file, 'before');
      const fetcher = async (url, o) => {
        const result = await f.fetcher(url, o);
        if (new URL(url).hostname === 'storage.yandexcloud.net' && o.method === 'GET') writeFileSync(file, 'new edit');
        return result;
      };
      await expect(
        runHeadlessCloudCommand(['download', r.document.id, file, '--overwrite'], { token, fetcher, out: vi.fn() }),
      ).rejects.toThrow('Local file changed');
      expect(readFileSync(file, 'utf8')).toBe('new edit');
    }));
  it('requires private credential files and reports malformed credentials without their value', async () =>
    withDir(async (dir) => {
      const file = dir + '/token';
      writeFileSync(file, token, { mode: 0o600 });
      expect(readApiToken({ WEBCAD_API_TOKEN_FILE: file })).toBe(token);
      chmodSync(file, 0o644);
      if (process.platform !== 'win32') expect(() => readApiToken({ WEBCAD_API_TOKEN_FILE: file })).toThrow('chmod 600');
      expect(() => readApiToken({ WEBCAD_API_TOKEN: 'very-private-invalid' })).toThrow('Invalid WebCAD');
      expect(readApiToken({})).toBeNull();
    }));
});
