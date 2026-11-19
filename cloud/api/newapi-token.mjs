import { APP_ORIGIN, SESSION_COOKIE, header, cookie } from './auth.mjs';
import { hashSecret } from './yandex.mjs';
import { createApiTokenStore, ApiTokenError, API_TOKEN_DEFAULT_DAYS, API_TOKEN_MAX_DAYS, parseApiToken } from './newapi-token-store.mjs';
export const API_TOKEN_ROUTES = new Map([
  ['/auth/tokens', ['GET', 'POST']],
  ['/auth/tokens/revoke', ['POST']],
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** A present but malformed Authorization header must never fall back to cookies.
 * @param {import('./auth.mjs').AuthEvent} event */
export function apiAuthorization(event) {
  const present = [event.headers, event.multiValueHeaders].some((headers) =>
    Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'authorization'),
  );
  const value = header(event, 'authorization');
  const match = /^Bearer ([^\s]+)$/i.exec(value);
  return { present, token: match && parseApiToken(match[1]) ? match[1] : null };
}
/** @param {{store?:typeof createApiTokenStore,now?:()=>number}} dependencies */
export function createApiTokenHandler({ store = createApiTokenStore, now = Date.now } = {}) {
  /** @param {import('./auth.mjs').AuthEvent & {body?:string,isBase64Encoded?:boolean}} event @param {{token?:{access_token?:string}}} context */
  return async (event, context) => {
    const methods = API_TOKEN_ROUTES.get(event.path ?? ''),
      origin = header(event, 'origin'),
      method = event.httpMethod;
    /** @type {Record<string,string>} */
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin',
    };
    if (origin === APP_ORIGIN) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    /** @param {number} statusCode @param {object} body */
    const respond = (statusCode, body) => ({ statusCode, headers: { ...headers }, body: JSON.stringify(body), isBase64Encoded: false });
    if (!methods) return respond(404, { error: 'not_found' });
    if (method === 'OPTIONS') {
      const requested = header(event, 'access-control-request-method');
      if (origin !== APP_ORIGIN || !methods.includes(requested)) return respond(403, { error: 'origin_not_allowed' });
      return {
        ...respond(204, {}),
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': methods.join(', '),
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        },
        body: '',
      };
    }
    if (!method || !methods.includes(method)) return respond(405, { error: 'method_not_allowed' });
    if ((origin && origin !== APP_ORIGIN) || (method === 'POST' && origin !== APP_ORIGIN))
      return respond(403, { error: 'origin_not_allowed' });
    if (apiAuthorization(event).present) return respond(401, { error: 'cookie_authentication_required' });
    const secret = cookie(event, SESSION_COOKIE);
    if (!secret) return respond(401, { error: 'sign_in_required' });
    if (!context.token?.access_token) return respond(503, { error: 'service_credentials_unavailable' });
    /** @type {any} */ let input = {};
    if (method === 'POST') {
      if (header(event, 'content-type').split(';')[0] !== 'application/json') return respond(415, { error: 'json_required' });
      const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
      if (Buffer.byteLength(body) > 2048) return respond(413, { error: 'request_too_large' });
      try {
        input = JSON.parse(body);
      } catch {
        return respond(400, { error: 'invalid_request' });
      }
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        (input.expectedUserId !== undefined && (typeof input.expectedUserId !== 'string' || !UUID.test(input.expectedUserId)))
      )
        return respond(400, { error: 'invalid_request' });
    }
    /** @type {Awaited<ReturnType<typeof createApiTokenStore>>|undefined} */ let db;
    try {
      db = await store(process.env.YDB_CONNECTION_STRING ?? '', context.token.access_token, AbortSignal.timeout(10000));
      const at = now(),
        user = await db.session(hashSecret(secret), at);
      if (!user) return respond(401, { error: 'sign_in_required' });
      if (input.expectedUserId !== undefined && input.expectedUserId !== user) return respond(409, { error: 'account_changed' });
      if (method === 'GET') return respond(200, { userId: user, tokens: await db.list(user, at) });
      if (event.path === '/auth/tokens/revoke') {
        if (typeof input.id !== 'string' || !UUID.test(input.id)) return respond(400, { error: 'invalid_request' });
        await db.revoke(user, input.id);
        return respond(200, { userId: user, ok: true });
      }
      const days = input.expiresInDays === undefined ? API_TOKEN_DEFAULT_DAYS : input.expiresInDays,
        scopes = input.scopes === undefined ? ['read'] : input.scopes;
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.trim().length > 80 ||
        /[\u0000-\u001f\u007f]/.test(input.name) ||
        !Number.isSafeInteger(days) ||
        days < 1 ||
        days > API_TOKEN_MAX_DAYS ||
        !Array.isArray(scopes) ||
        !scopes.includes('read') ||
        scopes.some((scope) => !['read', 'write'].includes(scope)) ||
        new Set(scopes).size !== scopes.length
      )
        return respond(400, { error: 'invalid_request' });
      const issued = await db.issue(
        user,
        { name: input.name.trim(), scopes: scopes.includes('write') ? ['read', 'write'] : ['read'], expiresInDays: days },
        at,
      );
      return respond(200, { userId: user, ...issued });
    } catch (error) {
      return error instanceof ApiTokenError
        ? respond(error.status, { error: error.message })
        : respond(503, { error: 'token_service_unavailable' });
    } finally {
      try {
        await db?.close();
      } catch {
        /* Never expose cleanup errors or lose a successfully issued one-time secret. */
      }
    }
  };
}
export const apiTokenHandler = createApiTokenHandler();
