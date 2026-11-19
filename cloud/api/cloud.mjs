import { apiAuthorization } from './newapi-token.mjs';
import { createApiTokenStore } from './newapi-token-store.mjs';
import { randomUUID } from 'node:crypto';
import { createCloudStore, CloudError, retiredCandidates } from './cloud-store.mjs';
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
/** Internal object references are never part of the browser protocol. @param {any} document */
function publicDocument(document) {
  if (!document) return document;
  const { retired, ...result } = document;
  return result;
}
/** Cleanup is bounded and optional: it cannot turn a successful read/save into an error.
 * @param {Awaited<ReturnType<typeof createCloudStore>>} db @param {ReturnType<typeof createCloudStorage>} objects
 * @param {string} user @param {any[]} documents @param {AbortSignal} signal */
export async function collectRetired(db, objects, user, documents, signal) {
  const cleanupSignal = AbortSignal.any([signal, AbortSignal.timeout(1500)]);
  const candidates = documents
    .flatMap((document) => retiredCandidates(document).map((snapshot) => ({ id: document.id, revision: snapshot.revision })))
    .slice(0, 2);
  for (const candidate of candidates) {
    if (cleanupSignal.aborted) return;
    try {
      // Recheck after listing: a concurrent rename/upload must not be overwritten by the acknowledgement.
      const latest = await db.document(user, candidate.id, cleanupSignal);
      const snapshot = retiredCandidates(latest).find((entry) => entry.revision === candidate.revision);
      if (!snapshot) continue;
      await objects.removeRetired(user, latest, snapshot, cleanupSignal);
      await db.cleaned(user, latest.id, [snapshot.revision], cleanupSignal);
    } catch {
      /* Keep metadata for a later retry. Do not log SDK errors or private object names. */
    }
  }
}

/** @param {{store?: typeof createCloudStore, storage?: typeof createCloudStorage, tokenStore?: typeof createApiTokenStore}} dependencies */
export function createCloudHandler({ store = createCloudStore, storage = createCloudStorage, tokenStore = createApiTokenStore } = {}) {
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
      });
      return { ...respond(204, {}), body: '' };
    }
    if (method !== expected) return respond(405, { error: 'method_not_allowed' });
    const authorization = apiAuthorization(event);
    if (authorization.present && !authorization.token) return respond(401, { error: 'invalid_api_token' });
    if ((origin && origin !== APP_ORIGIN) || (!authorization.present && method === 'POST' && origin !== APP_ORIGIN))
      return respond(403, { error: 'origin_not_allowed' });
    const secret = cookie(event, SESSION_COOKIE);
    if (!authorization.present && !secret) return respond(401, { error: 'sign_in_required' });
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
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          (input.expectedUserId !== undefined && !id(input.expectedUserId))
        )
          return respond(400, { error: 'invalid_request' });
      }
      const signal = AbortSignal.timeout(12000);
      let user;
      if (authorization.token) {
        const tokens = await tokenStore(process.env.YDB_CONNECTION_STRING ?? '', context.token.access_token, signal);
        try {
          const identity = await tokens.authenticate(authorization.token, Date.now());
          if (!identity) return respond(401, { error: 'invalid_api_token' });
          const scope = event.path === '/cloud/list' || event.path === '/cloud/open' ? 'read' : 'write';
          if (!identity.scopes.includes(scope)) return respond(403, { error: 'insufficient_scope' });
          user = identity.userId;
        } finally {
          await tokens.close();
        }
        db = await store(process.env.YDB_CONNECTION_STRING ?? '', context.token.access_token, signal);
      } else {
        db = await store(process.env.YDB_CONNECTION_STRING ?? '', context.token.access_token, signal);
        user = await db.authenticate(hashSecret(/** @type {string} */ (secret)));
      }
      if (!user) return respond(401, { error: 'sign_in_required' });
      if (input.expectedUserId !== undefined && input.expectedUserId !== user) return respond(409, { error: 'account_changed' });
      const objectStorage = storage(process.env.S3_BUCKET ?? '', context.token.access_token, signal);
      objects = objectStorage;
      switch (event.path) {
        case '/cloud/list': {
          const result = await db.list(user);
          await collectRetired(db, objects, user, result.documents, signal);
          const documents = await Promise.all(
            result.documents.map(async (d) => ({
              ...publicDocument(d),
              thumbnailUrl: d.thumbnailSize ? await objectStorage.download(user, d, true) : null,
            })),
          );
          return respond(200, { userId: user, folders: result.folders, documents });
        }
        case '/cloud/folder': {
          if (!id(input.id) || (!input.remove && (!name(input.name) || !folder(input.parentId))))
            return respond(400, { error: 'invalid_request' });
          const savedFolder = await db.folder(user, { ...input, name: input.name?.trim() });
          return respond(200, { ok: true, ...(savedFolder ? { folder: savedFolder } : {}) });
        }
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
          return respond(200, { document: publicDocument(await db.move(user, input)) });
        case '/cloud/prepare': {
          if (
            !id(input.documentId) ||
            (input.auto !== undefined && typeof input.auto !== 'boolean') ||
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
          try {
            await db.prepare(user, upload);
          } catch (error) {
            if (!(error instanceof CloudError) || error.message !== 'storage_cleanup_pending' || input.auto !== true) throw error;
            // The first transaction rejected before inserting upload metadata. A bounded cleanup can unblock this retry.
            const current = await db.document(user, input.documentId);
            if (current) await collectRetired(db, objects, user, [current], signal);
            await db.prepare(user, upload);
          }
          return respond(200, { userId: user, uploadId: upload.id, ...(await objects.prepare(user, upload)) });
        }
        case '/cloud/commit': {
          if (!id(input.uploadId)) return respond(400, { error: 'invalid_request' });
          const pending = await db.pending(user, input.uploadId);
          const current = await db.document(user, pending.documentId);
          if (current?.revision === pending.id) {
            await collectRetired(db, objects, user, [current], signal);
            return respond(200, { document: publicDocument(current) });
          }
          if ((current?.revision ?? '') !== pending.expectedRevision || (current && current.modified !== pending.expectedModified))
            throw new CloudError(409, 'revision_conflict');
          await objects.seal(user, pending);
          const document = await db.commit(user, pending);
          await collectRetired(db, objects, user, [document], signal);
          return respond(200, { document: publicDocument(document) });
        }
        case '/cloud/open': {
          if (!id(input.id)) return respond(400, { error: 'invalid_request' });
          const document = await db.document(user, input.id);
          if (!document) return respond(404, { error: 'document_not_found' });
          if (document.trashed) return respond(410, { error: 'document_trashed' });
          return respond(200, {
            userId: user,
            document: publicDocument(document),
            url: await objects.download(user, document),
            thumbnailUrl: document.thumbnailSize ? await objects.download(user, document, true) : null,
          });
        }
      }
      return respond(404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof CloudError) {
        if (e.status === 429) headers['Retry-After'] = '60';
        return respond(e.status, { error: e.message, ...(e.status === 429 ? { retryAfter: 60 } : {}) });
      }
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
