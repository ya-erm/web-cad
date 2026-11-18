import { randomBytes } from 'node:crypto';
import { createAuthStore } from './auth-store.mjs';
import { createLoginAttempt, createYandexClient, hashSecret } from './yandex.mjs';
import { SESSION_LIFETIME_MS, OAUTH_ATTEMPT_LIFETIME_MS } from './auth-policy.mjs';

export const APP_ORIGIN = 'https://cad.ya-erm.ru';
export const SESSION_COOKIE = '__Host-webcad_session';
export const ATTEMPT_COOKIE = '__Host-webcad_oauth';
export const AUTH_ROUTES = new Map([
  ['/auth/yandex/start', 'GET'], ['/auth/yandex/callback', 'GET'],
  ['/auth/session', 'GET'], ['/auth/logout', 'POST'],
]);
/** @typedef {{httpMethod?: string, path?: string, headers?: Record<string,string>, multiValueHeaders?: Record<string,string[]>,
 * queryStringParameters?: Record<string,string>, multiValueQueryStringParameters?: Record<string,string[]>}} AuthEvent */

/** @param {AuthEvent} event @param {string} name */
export function header(event, name) {
  const multiple = Object.entries(event.multiValueHeaders ?? {}).find(([key]) => key.toLowerCase() === name);
  if (multiple) return multiple[1].length === 1 ? multiple[1][0] : '';
  return Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}
/** @param {AuthEvent} event @param {string} name */
export function cookie(event, name) {
  const values = header(event, 'cookie').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
/** @param {AuthEvent} event @param {string} key */
function param(event, key) {
  const values = event.multiValueQueryStringParameters?.[key];
  if (values && values.length !== 1) return '';
  return values?.[0] ?? event.queryStringParameters?.[key] ?? '';
}
/** @param {string} name @param {string} value @param {number} maxAge */
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Lax`;

/** @param {{store?: typeof createAuthStore, provider?: typeof createYandexClient, now?: () => number}} dependencies */
export function createAuthHandler({ store = createAuthStore, provider = createYandexClient, now = Date.now } = {}) {
  /** @param {AuthEvent} event @param {{token?:{access_token?:string}}} context */
  return async (event, context) => {
    const path = event.path ?? '';
    const method = event.httpMethod;
    const origin = header(event, 'origin');
    /** @type {Record<string,string>} */
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    if (origin === APP_ORIGIN) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    /** @param {number} statusCode @param {object} body @param {string[]} cookies */
    const respond = (statusCode, body, cookies = []) => ({ statusCode, headers: { ...headers },
      multiValueHeaders: cookies.length ? { 'Set-Cookie': cookies } : {}, body: JSON.stringify(body), isBase64Encoded: false });
    /** @param {string} result @param {string[]} cookies */
    const redirect = (result, cookies) => ({ ...respond(303, {}, cookies), headers: { ...headers, Location: `${APP_ORIGIN}/?auth=${result}` } });
    const expected = AUTH_ROUTES.get(path);
    if (!expected) return respond(404, { error: 'not_found' });
    if (method === 'OPTIONS') {
      if (origin !== APP_ORIGIN || paramHeaderMethod(event) !== expected) return respond(403, { error: 'origin_not_allowed' });
      return { ...respond(204, {}), headers: { ...headers, 'Access-Control-Allow-Methods': expected,
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }, body: '' };
    }
    if (method !== expected) return { ...respond(405, { error: 'method_not_allowed' }), headers: { ...headers, Allow: expected } };
    if (origin && origin !== APP_ORIGIN) return respond(403, { error: 'origin_not_allowed' });
    // Every cookie-authenticated mutation must be a same-origin application request.
    if (method === 'POST' && origin !== APP_ORIGIN) return respond(403, { error: 'origin_not_allowed' });

    const sessionToken = cookie(event, SESSION_COOKIE);
    if (path === '/auth/session' && !sessionToken) return respond(200, { user: null });
    const clearAttempt = setCookie(ATTEMPT_COOKIE, '', 0);
    const state = param(event, 'state');
    const binding = cookie(event, ATTEMPT_COOKIE);
    if (path === '/auth/yandex/callback' && (!/^[A-Za-z0-9_-]{43}$/.test(state) || !binding)) {
      return respond(400, { error: 'invalid_oauth_attempt' }, [clearAttempt]);
    }
    const token = context.token?.access_token;
    if (!token) return respond(503, { error: 'service_credentials_unavailable' });
    /** @type {import('./auth-store.mjs').AuthStore|undefined} */
    let db;
    try {
      const connection = process.env.YDB_CONNECTION_STRING;
      if (!connection) throw new Error('Database configuration missing');
      const signal = AbortSignal.timeout(10000);
      db = await store(connection, token, signal);
      const at = now();
      if (path === '/auth/session') {
        const current = await db.session(hashSecret(/** @type {string} */ (sessionToken)), at);
        if (!current) return respond(200, { user: null }, [setCookie(SESSION_COOKIE, '', 0)]);
        const cookies = current.renewed ? [setCookie(SESSION_COOKIE, /** @type {string} */ (sessionToken), (current.expiresAt - at) / 1000)] : [];
        return respond(200, { user: current.user }, cookies);
      }
      if (path === '/auth/logout') {
        if (sessionToken) await db.logout(hashSecret(sessionToken));
        return respond(200, { user: null }, [setCookie(SESSION_COOKIE, '', 0)]);
      }
      const client = provider({ clientId: process.env.YANDEX_CLIENT_ID ?? '', clientSecret: process.env.YANDEX_CLIENT_SECRET ?? '' });
      if (path === '/auth/yandex/start') {
        const attempt = createLoginAttempt();
        await db.saveAttempt({ stateHash: attempt.stateHash, bindingHash: attempt.bindingHash,
          verifier: attempt.verifier, expiresAt: at + OAUTH_ATTEMPT_LIFETIME_MS }, at);
        return { ...respond(302, {}, [setCookie(ATTEMPT_COOKIE, attempt.browserBinding, OAUTH_ATTEMPT_LIFETIME_MS / 1000)]),
          headers: { ...headers, Location: client.authorizeUrl(attempt.state, attempt.challenge) } };
      }
      const verifier = await db.consumeAttempt(hashSecret(state), hashSecret(/** @type {string} */ (binding)), at);
      if (!verifier) return respond(400, { error: 'invalid_oauth_attempt' }, [clearAttempt]);
      if (param(event, 'error')) return redirect('denied', [clearAttempt]);
      const code = param(event, 'code');
      if (!code || code.length > 4096) return respond(400, { error: 'invalid_oauth_code' }, [clearAttempt]);
      const profile = await client.profileFromCode(code, verifier, signal);
      const secret = randomBytes(32).toString('base64url');
      await db.login(profile, hashSecret(secret), now());
      // Replace and revoke an existing browser session only after the new login succeeds.
      if (sessionToken) await db.logout(hashSecret(sessionToken));
      return redirect('success', [clearAttempt, setCookie(SESSION_COOKIE, secret, SESSION_LIFETIME_MS / 1000)]);
    } catch {
      // Do not log errors: OAuth/SDK errors can carry callback codes and credentials.
      return respond(503, { error: 'authentication_unavailable' }, path === '/auth/yandex/callback' ? [clearAttempt] : []);
    } finally {
      try { await db?.close(); } catch { /* Cleanup must not replace the response or leak SDK errors. */ }
    }
  };
}
/** @param {AuthEvent} event */
const paramHeaderMethod = event => header(event, 'access-control-request-method');

export const authHandler = createAuthHandler();
