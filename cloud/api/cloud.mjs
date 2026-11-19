import { randomUUID } from 'node:crypto';
import { createCloudStore, CloudError } from './cloud-store.mjs';
import { createCloudStorage } from './cloud-storage.mjs';
import { APP_ORIGIN, SESSION_COOKIE, header, cookie } from './auth.mjs';
import { hashSecret } from './yandex.mjs';
export const CLOUD_ROUTES = new Map([
  ['/cloud/list', 'GET'],
  ['/cloud/folder', 'POST'],
  ['/cloud/prepare', 'POST'],
  ['/cloud/commit', 'POST'],
  ['/cloud/open', 'POST'],
  ['/cloud/document', 'POST'],
]);
const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** @param {any} value */
const id = (value) => typeof value === 'string' && ID.test(value);
/** @param {any} value */
const folder = (value) => value === '' || id(value);
/** @param {any} value */
const name = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 120 && !/[\\/\u0000-\u001f]/.test(value);
/** @param {{store?: typeof createCloudStore, storage?: typeof createCloudStorage}} dependencies */
export function createCloudHandler({ store = createCloudStore, storage = createCloudStorage } = {}) {
  /** @param {import('./auth.mjs').AuthEvent & {body?: string, isBase64Encoded?: boolean}} event @param {{token?:{access_token?: string}}} context */
  return async (event, context) => {
    const origin = header(event, 'origin'),
      method = event.httpMethod;
    /** @type {Record<string,string>} */
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin === APP_ORIGIN) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    /** @param {number} statusCode @param {any} body */
    const respond = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body), isBase64Encoded: false });
    const expected = CLOUD_ROUTES.get(event.path ?? '');
    if (!expected) return respond(404, { error: 'not_found' });
    if (method === 'OPTIONS') {
      if (origin !== APP_ORIGIN || header(event, 'access-control-request-method') !== expected)
        return respond(403, { error: 'origin_not_allowed' });
      Object.assign(headers, {
        'Access-Control-Allow-Methods': expected,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return { ...respond(204, {}), body: '' };
    }
    if (method !== expected) return respond(405, { error: 'method_not_allowed' });
    if ((origin && origin !== APP_ORIGIN) || (method === 'POST' && origin !== APP_ORIGIN))
      return respond(403, { error: 'origin_not_allowed' });
    const secret = cookie(event, SESSION_COOKIE);
    if (!secret) return respond(401, { error: 'sign_in_required' });
    if (!context.token?.access_token) return respond(503, { error: 'service_credentials_unavailable' });
    /** @type {Awaited<ReturnType<typeof createCloudStore>>|undefined} */ let db;
    /** @type {ReturnType<typeof createCloudStorage>|undefined} */ let objects;
    try {
      /** @type {any} */ let input = {};
      if (method === 'POST') {
        if (header(event, 'content-type').split(';')[0] !== 'application/json') return respond(415, { error: 'json_required' });
        const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
        if (Buffer.byteLength(body) > 8192) return respond(413, { error: 'request_too_large' });
        try {
          input = JSON.parse(body);
        } catch {
          return respond(400, { error: 'invalid_request' });
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return respond(400, { error: 'invalid_request' });
      }
      const signal = AbortSignal.timeout(12000);
      db = await store(process.env.YDB_CONNECTION_STRING ?? '', context.token.access_token, signal);
      const user = await db.authenticate(hashSecret(secret));
      if (!user) return respond(401, { error: 'sign_in_required' });
      const objectStorage = storage(process.env.S3_BUCKET ?? '', context.token.access_token, signal);
      objects = objectStorage;
      switch (event.path) {
        case '/cloud/list': {
          const result = await db.list(user);
          const documents = await Promise.all(
            result.documents.map(async (d) => ({
              ...d,
              thumbnailUrl: d.thumbnailSize ? await objectStorage.download(user, d, true) : null,
            })),
          );
          return respond(200, { userId: user, folders: result.folders, documents });
        }
        case '/cloud/folder':
          if (!id(input.id) || (!input.remove && (!name(input.name) || !folder(input.parentId))))
            return respond(400, { error: 'invalid_request' });
          await db.folder(user, { ...input, name: input.name?.trim() });
          return respond(200, { ok: true });
        case '/cloud/document':
          if (
            !id(input.id) ||
            !folder(input.folderId) ||
            !id(input.revision) ||
            !Number.isSafeInteger(input.modified) ||
            (input.name !== undefined && !name(input.name)) ||
            (input.trashed !== undefined && typeof input.trashed !== 'boolean')
          )
            return respond(400, { error: 'invalid_request' });
          return respond(200, { document: await db.move(user, input) });
        case '/cloud/prepare': {
          if (
            !id(input.documentId) ||
            !name(input.name) ||
            !folder(input.folderId) ||
            !(input.expectedRevision === '' || id(input.expectedRevision)) ||
            (input.expectedRevision !== '' && !Number.isSafeInteger(input.expectedModified)) ||
            !Number.isSafeInteger(input.size) ||
            input.size < 1 ||
            input.size > 20 * 1024 * 1024 ||
            !Number.isSafeInteger(input.thumbnailSize) ||
            input.thumbnailSize < 0 ||
            input.thumbnailSize > 1024 * 1024 ||
            !/^[a-f0-9]{64}$/.test(input.hash) ||
            (input.thumbnailSize && !/^[a-f0-9]{64}$/.test(input.thumbnailHash))
          )
            return respond(400, { error: 'invalid_request' });
          const upload = { ...input, id: randomUUID(), name: input.name.trim() };
          await db.prepare(user, upload);
          return respond(200, { userId: user, uploadId: upload.id, ...(await objects.prepare(user, upload)) });
        }
        case '/cloud/commit': {
          if (!id(input.uploadId)) return respond(400, { error: 'invalid_request' });
          const pending = await db.pending(user, input.uploadId);
          const current = await db.document(user, pending.documentId);
          if (current?.revision === pending.id) return respond(200, { document: current });
          if ((current?.revision ?? '') !== pending.expectedRevision || (current && current.modified !== pending.expectedModified))
            throw new CloudError(409, 'revision_conflict');
          await objects.seal(user, pending);
          return respond(200, { document: await db.commit(user, pending) });
        }
        case '/cloud/open': {
          if (!id(input.id)) return respond(400, { error: 'invalid_request' });
          const document = await db.document(user, input.id);
          if (!document) return respond(404, { error: 'document_not_found' });
          if (document.trashed) return respond(410, { error: 'document_trashed' });
          return respond(200, {
            userId: user,
            document,
            url: await objects.download(user, document),
            thumbnailUrl: document.thumbnailSize ? await objects.download(user, document, true) : null,
          });
        }
      }
      return respond(404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof CloudError) return respond(e.status, { error: e.message });
      return respond(503, { error: 'cloud_unavailable' });
    } finally {
      objects?.close();
      try {
        await db?.close();
      } catch {
        /* Never expose SDK errors or signed URLs. */
      }
    }
  };
}
export const cloudHandler = createCloudHandler();
