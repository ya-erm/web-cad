// Standalone cloud access. Personal tokens are sent only to the WebCAD API, never to signed storage URLs.
import { readFileSync, statSync, existsSync, writeFileSync, renameSync, unlinkSync, linkSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const API = 'https://api.cad.ya-erm.ru';
const LIMIT = 100 * 1024 * 1024,
  COMPRESSED_LIMIT = 20 * 1024 * 1024;
const TOKEN = /^wcad_pat_v1\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/;
const digest = (data) => createHash('sha256').update(data).digest('hex');
export function readApiToken(env = process.env) {
  let value = env.WEBCAD_API_TOKEN;
  if (!value && env.WEBCAD_API_TOKEN_FILE) {
    const s = statSync(env.WEBCAD_API_TOKEN_FILE);
    if (s.size > 4096 || !s.isFile() || (process.platform !== 'win32' && s.mode & 0o077))
      throw Error('WEBCAD_API_TOKEN_FILE must be a private regular file (chmod 600)');
    value = readFileSync(env.WEBCAD_API_TOKEN_FILE, 'utf8');
  }
  if (!value) return null;
  value = value.trim();
  if (!TOKEN.test(value)) throw Error('Invalid WebCAD personal API token format');
  return value;
}
function parse(args, schema, min, max = min) {
  const values = [],
    options = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      values.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      values.push(a);
      continue;
    }
    if (!Object.hasOwn(schema, a) || Object.hasOwn(options, a)) throw Error('Unknown or repeated cloud option');
    if (schema[a] === 'bool') {
      options[a] = true;
      continue;
    }
    const v = args[++i];
    if (v === undefined || v.startsWith('--') || !v.trim()) throw Error('Missing cloud option value');
    if (schema[a] === 'number') {
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < 0) throw Error('Cloud timestamp must be a non-negative integer');
      options[a] = n;
    } else options[a] = v;
  }
  if (values.length < min || values.length > max) throw Error('Invalid headless cloud arguments; see npm run agent -- help');
  return { values, options };
}
function project(bytes) {
  if (bytes.length > LIMIT) throw Error('Project exceeds 100 MiB');
  let raw;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw Error('Invalid project JSON');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tabs) || !raw.units) throw Error('Invalid WebCAD project');
  return raw;
}
function safeDocument(d) {
  const { thumbnailUrl, ...result } = d;
  return result;
}
function storageURL(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error('Invalid storage URL');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.hash ||
    !(u.hostname === 'storage.yandexcloud.net' || u.hostname.endsWith('.storage.yandexcloud.net'))
  )
    throw Error('Untrusted storage URL');
  return u.href;
}
async function limitedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw Error('Cloud object exceeds size limit');
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty cloud response');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('Cloud object exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
function fingerprint(path) {
  return existsSync(path) ? digest(readFileSync(path)) : null;
}
function atomicWrite(path, bytes, expected) {
  if (fingerprint(path) !== expected) throw Error('Local file changed during cloud operation; refusing to overwrite');
  const tmp = join(dirname(path), '.webcad-' + randomUUID() + '.tmp');
  writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 });
  try {
    if (fingerprint(path) !== expected) throw Error('Local file changed during cloud operation; refusing to overwrite');
    if (expected === null) {
      linkSync(tmp, path);
      unlinkSync(tmp);
    } else renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}
export function createCloudHttp(token, fetcher = fetch) {
  const owner = TOKEN.exec(token)?.[1];
  if (!owner) throw Error('Invalid WebCAD personal API token format');
  const request = async (path, body) => {
    let r;
    try {
      r = await fetcher(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify({ ...body, expectedUserId: owner }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw Error('WebCAD API request failed');
    }
    let data;
    try {
      data = await r.json();
    } catch {
      throw Error('Invalid WebCAD API response');
    }
    if (!r.ok) {
      const code = typeof data?.error === 'string' && /^[a-z_]{1,80}$/.test(data.error) ? data.error : 'request_failed';
      throw Error(`WebCAD API ${r.status}: ${code}`);
    }
    if (data.userId !== undefined && data.userId !== owner) throw Error('Cloud account changed');
    return data;
  };
  const list = async () => {
    const data = await request('/cloud/list');
    if (data.userId !== owner || !Array.isArray(data.documents) || !Array.isArray(data.folders)) throw Error('Invalid cloud list');
    return data;
  };
  const transfer = async (url, method, body) => {
    let r;
    try {
      r = await fetcher(storageURL(url), { method, body, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(120000) });
    } catch (e) {
      if (e.message === 'Untrusted storage URL') throw e;
      throw Error('Cloud storage request failed');
    }
    if (!r.ok) throw Error(`Cloud storage ${method} failed (HTTP ${r.status})`);
    return r;
  };
  const download = async (id) => {
    const r = await request('/cloud/open', { id });
    if (r.userId !== owner || !r.document) throw Error('Invalid cloud download response');
    const bytes = await limitedBody(await transfer(r.url, 'GET'), COMPRESSED_LIMIT);
    if (digest(bytes) !== r.document.hash) throw Error('Cloud project checksum mismatch');
    let decoded;
    try {
      decoded = gunzipSync(bytes, { maxOutputLength: LIMIT });
    } catch {
      throw Error('Invalid or oversized compressed cloud project');
    }
    const raw = project(decoded);
    raw.id = r.document.id;
    raw.name = r.document.name;
    return { bytes: Buffer.from(JSON.stringify(raw, null, 1)), document: safeDocument(r.document) };
  };
  const upload = async (fileBytes, { id, folderId = '', expectedRevision = '', expectedModified } = {}) => {
    const raw = project(fileBytes);
    raw.id = id ?? randomUUID();
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw Error('Project name is required');
    let thumbnail = null;
    const source = raw.thumbnail;
    delete raw.thumbnail;
    if (typeof source === 'string') {
      const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(source);
      if (m) {
        const data = Buffer.from(m[2], 'base64');
        if (data.length <= 1024 * 1024 && data.length) thumbnail = data;
      }
    }
    const serialized = Buffer.from(JSON.stringify(raw));
    if (serialized.length > LIMIT) throw Error('Project exceeds 100 MiB');
    const data = gzipSync(serialized);
    if (data.length > COMPRESSED_LIMIT) throw Error('Compressed project exceeds 20 MiB');
    const p = await request('/cloud/prepare', {
      documentId: raw.id,
      name: raw.name,
      folderId,
      expectedRevision,
      ...(expectedModified === undefined ? {} : { expectedModified }),
      size: data.length,
      hash: digest(data),
      thumbnailSize: thumbnail?.length ?? 0,
      thumbnailHash: thumbnail ? digest(thumbnail) : '',
    });
    // Validate both returned destinations before uploading either object.
    storageURL(p.projectUrl);
    if (thumbnail) storageURL(p.thumbnailUrl);
    await (await transfer(p.projectUrl, 'PUT', data)).body?.cancel();
    if (thumbnail) await (await transfer(p.thumbnailUrl, 'PUT', thumbnail)).body?.cancel();
    const committed = await request('/cloud/commit', { uploadId: p.uploadId });
    if (!committed.document) throw Error('Invalid cloud commit response');
    return { document: safeDocument(committed.document), thumbnailSkipped: !!source && !thumbnail };
  };
  return { owner, request, list, download, upload };
}
export async function runHeadlessCloudCommand(args, { token, out, fetcher = fetch }) {
  const api = createCloudHttp(token, fetcher),
    [command, ...rest] = args;
  switch (command) {
    case 'status': {
      parse(rest, {}, 0);
      const d = await api.list();
      return out({ mode: 'token', userId: d.userId, documents: d.documents.length, folders: d.folders.length });
    }
    case 'list': {
      parse(rest, {}, 0);
      const d = await api.list();
      return out({ ...d, documents: d.documents.map(safeDocument) });
    }
    case 'mkdir': {
      const {
        values: [name],
        options: o,
      } = parse(rest, { '--parent': 'string' }, 1);
      const d = await api.list();
      const parentId = o['--parent'] ?? '';
      if (parentId && !d.folders.some((f) => f.id === parentId)) throw Error('Cloud parent folder not found');
      return out(await api.request('/cloud/folder', { id: randomUUID(), name, parentId }));
    }
    case 'upload-file': {
      const {
        values: [file],
        options: o,
      } = parse(
        rest,
        { '--folder': 'string', '--document': 'string', '--expected-revision': 'string', '--expected-modified': 'number' },
        1,
      );
      const updating = o['--document'] !== undefined;
      if (updating !== (o['--expected-revision'] !== undefined) || updating !== (o['--expected-modified'] !== undefined))
        throw Error('Updating needs --document, --expected-revision and --expected-modified together');
      const bytes = readFileSync(resolve(file));
      project(bytes);
      const d = await api.list();
      const target = updating ? d.documents.find((x) => x.id === o['--document']) : null;
      if (updating && (!target || target.trashed)) throw Error('Cloud document not found or is in trash');
      const folderId = o['--folder'] ?? target?.folderId ?? '';
      if (folderId && !d.folders.some((f) => f.id === folderId)) throw Error('Cloud destination folder not found');
      return out(
        await api.upload(bytes, {
          id: o['--document'],
          folderId,
          expectedRevision: o['--expected-revision'],
          expectedModified: o['--expected-modified'],
        }),
      );
    }
    case 'download': {
      const {
        values: [id, file],
        options: o,
      } = parse(rest, { '--overwrite': 'bool' }, 2);
      const path = resolve(file),
        before = fingerprint(path);
      if (before !== null && !o['--overwrite']) throw Error('Output exists; choose another path or --overwrite');
      const r = await api.download(id);
      atomicWrite(path, r.bytes, before);
      return out({ saved: path, document: r.document });
    }
    case 'sync-file': {
      const {
        values: [file],
        options: o,
      } = parse(rest, { '--folder': 'string' }, 1);
      const path = resolve(file),
        side = path + '.cloud.json',
        before = readFileSync(path),
        localHash = digest(before),
        metaHash = fingerprint(side);
      project(before);
      const meta = metaHash === null ? null : JSON.parse(readFileSync(side, 'utf8'));
      const d = await api.list();
      if (
        meta &&
        (meta.version !== 1 ||
          meta.api !== API ||
          meta.userId !== api.owner ||
          typeof meta.documentId !== 'string' ||
          typeof meta.revision !== 'string' ||
          !Number.isFinite(meta.modified) ||
          !/^[a-f0-9]{64}$/.test(meta.localHash))
      )
        throw Error('Invalid sync sidecar or another cloud account');
      const remote = meta ? d.documents.find((x) => x.id === meta.documentId) : null;
      if (meta && (!remote || remote.trashed)) throw Error('Cloud document was removed or moved to trash; sync stopped');
      if (o['--folder'] !== undefined && o['--folder'] !== (remote?.folderId ?? '') && meta)
        throw Error('--folder applies only to the first sync');
      const localChanged = !meta || localHash !== meta.localHash,
        remoteChanged = !!meta && (remote.revision !== meta.revision || remote.modified !== meta.modified);
      if (localChanged && remoteChanged) throw Error('Sync conflict: both local file and cloud changed; neither was overwritten');
      if (!localChanged && !remoteChanged) return out({ action: 'unchanged', document: safeDocument(remote), sidecar: side });
      let result, action, ackHash;
      if (remoteChanged) {
        result = await api.download(remote.id);
        atomicWrite(path, result.bytes, localHash);
        ackHash = digest(result.bytes);
        action = 'downloaded';
      } else {
        const folderId = remote?.folderId ?? o['--folder'] ?? '';
        if (folderId && !d.folders.some((f) => f.id === folderId)) throw Error('Cloud destination folder not found');
        result = await api.upload(before, {
          id: remote?.id,
          folderId,
          expectedRevision: remote?.revision ?? '',
          expectedModified: remote?.modified,
        });
        ackHash = localHash;
        action = 'uploaded';
      }
      const record = {
        version: 1,
        api: API,
        userId: api.owner,
        documentId: result.document.id,
        revision: result.document.revision,
        modified: result.document.modified,
        localHash: ackHash,
      };
      atomicWrite(side, Buffer.from(JSON.stringify(record, null, 2) + '\n'), metaHash);
      return out({ action, document: result.document, sidecar: side, pendingLocalChanges: fingerprint(path) !== ackHash });
    }
    default:
      throw Error(
        'With WEBCAD_API_TOKEN use cloud status/list/mkdir/upload-file/download/sync-file. Browser-only methods require a selected authenticated tab.',
      );
  }
}
