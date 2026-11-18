import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthHandler, APP_ORIGIN, SESSION_COOKIE, ATTEMPT_COOKIE } from './auth.mjs';
import { hashSecret } from './yandex.mjs';
import { SESSION_LIFETIME_MS } from './auth-policy.mjs';
import type { AuthStore } from './auth-store.mjs';

const token = 'a'.repeat(43);
const state = 'b'.repeat(43);
const binding = 'c'.repeat(43);
const profile = { provider: 'yandex', subject: '1', displayName: 'User', email: null, avatarUrl: null };
const user = { id: 'user-id', displayName: 'User', email: null, avatarUrl: null };
function setup() {
  const db = {
    saveAttempt: vi.fn<AuthStore['saveAttempt']>().mockResolvedValue(),
    consumeAttempt: vi.fn<AuthStore['consumeAttempt']>().mockResolvedValue('verifier'),
    login: vi.fn<AuthStore['login']>().mockResolvedValue(user),
    session: vi.fn<AuthStore['session']>().mockResolvedValue(null),
    logout: vi.fn<AuthStore['logout']>().mockResolvedValue(), close: vi.fn<AuthStore['close']>().mockResolvedValue(),
  };
  const store = vi.fn(async () => db);
  const client = { authorizeUrl: vi.fn(() => 'https://oauth.yandex.ru/authorize?response_type=code'), profileFromCode: vi.fn(async () => profile) };
  const provider = vi.fn(() => client);
  return { db, store, client, handle: createAuthHandler({ store, provider, now: () => 1000000 }) };
}
const ctx = { token: { access_token: 'IAM-TOKEN-SECRET' } };
const callback = (extra = {}) => ({ httpMethod: 'GET', path: '/auth/yandex/callback',
  headers: { Cookie: `${ATTEMPT_COOKIE}=${binding}` }, queryStringParameters: { state, code: 'oauth-code', ...extra } });

beforeEach(() => {
  vi.stubEnv('YDB_CONNECTION_STRING', 'grpcs://db.test/database');
  vi.stubEnv('YANDEX_CLIENT_ID', 'id');
  vi.stubEnv('YANDEX_CLIENT_SECRET', 'client-secret');
});
describe('authentication routes', () => {
  it('does not contact the database for an anonymous session', async () => {
    const { handle, store } = setup();
    const r = await handle({ path: '/auth/session', httpMethod: 'GET', headers: { Origin: APP_ORIGIN } }, {});
    expect(JSON.parse(r.body)).toEqual({ user: null });
    expect(r.headers['Access-Control-Allow-Origin']).toBe(APP_ORIGIN);
    expect(r.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(store).not.toHaveBeenCalled();
  });
  it.each(['https://evil.test', 'https://other.ya-erm.ru', 'null', ''])('rejects logout Origin %s before accessing data', async origin => {
    const { handle, store } = setup();
    const r = await handle({ path: '/auth/logout', httpMethod: 'POST', headers: { Origin: origin, Cookie: `${SESSION_COOKIE}=${token}` } }, ctx);
    expect(r.statusCode).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });
  it('allows preflight only from the app for the configured method', async () => {
    const { handle, store } = setup();
    const r = await handle({ path: '/auth/logout', httpMethod: 'OPTIONS', headers: { Origin: APP_ORIGIN, 'Access-Control-Request-Method': 'POST' } }, {});
    expect(r.statusCode).toBe(204);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('POST');
    const denied = await handle({ path: '/auth/logout', httpMethod: 'OPTIONS', headers: { Origin: APP_ORIGIN, 'Access-Control-Request-Method': 'DELETE' } }, {});
    expect(denied.statusCode).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });
  it('creates a short-lived attempt, stores hashes and sets a host-only secure cookie', async () => {
    const { handle, db } = setup();
    const r = await handle({ path: '/auth/yandex/start', httpMethod: 'GET' }, ctx);
    expect(r.statusCode).toBe(302);
    const saved = db.saveAttempt.mock.calls[0][0];
    expect(saved.expiresAt).toBe(1600000);
    const cookie = r.multiValueHeaders['Set-Cookie']![0];
    expect(cookie).toMatch(/Max-Age=600; HttpOnly; Secure; SameSite=Lax/);
    expect(cookie).not.toContain('Domain=');
    const secret = cookie.split(';')[0].split('=')[1];
    expect(saved.bindingHash).toBe(hashSecret(secret));
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(db.close).toHaveBeenCalledOnce();
  });
  it('requires state and browser binding before opening a database connection', async () => {
    const { handle, store } = setup();
    for (const e of [ { ...callback(), headers: {} }, callback({ state: 'bad' }),
      { ...callback(), headers: { Cookie: `${ATTEMPT_COOKIE}=${binding}; ${ATTEMPT_COOKIE}=${binding}` } },
      { ...callback(), multiValueQueryStringParameters: { state: [state, state] } } ]) {
      expect((await handle(e, ctx)).statusCode).toBe(400);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('refuses expired, mismatched or already consumed attempts before token exchange', async () => {
    const { handle, db, client } = setup();
    db.consumeAttempt.mockResolvedValue(null);
    const r = await handle(callback(), ctx);
    expect(r.statusCode).toBe(400);
    expect(client.profileFromCode).not.toHaveBeenCalled();
    expect(db.login).not.toHaveBeenCalled();
  });
  it('consumes a denied attempt without exchanging a code', async () => {
    const { handle, db, client } = setup();
    const r = await handle(callback({ error: 'access_denied' }), ctx);
    expect(r.statusCode).toBe(303);
    expect(r.headers.Location).toBe(`${APP_ORIGIN}/?auth=denied`);
    expect(db.consumeAttempt).toHaveBeenCalledWith(hashSecret(state), hashSecret(binding), 1000000);
    expect(client.profileFromCode).not.toHaveBeenCalled();
  });
  it('creates an independent random session without placing secrets in the redirect URL', async () => {
    const { handle, db } = setup();
    const r = await handle(callback({ returnTo: 'https://evil.test' }), ctx);
    expect(r.statusCode).toBe(303);
    expect(r.headers.Location).toBe(`${APP_ORIGIN}/?auth=success`);
    const cookies = r.multiValueHeaders['Set-Cookie']!;
    expect(cookies).toHaveLength(2);
    const session = cookies.find(s => s.startsWith(SESSION_COOKIE + '='))!;
    const secret = session.split(';')[0].split('=')[1];
    expect(session).toContain(`Max-Age=${SESSION_LIFETIME_MS / 1000}`);
    expect(db.login).toHaveBeenCalledWith(profile, hashSecret(secret), 1000000);
    expect(JSON.stringify(db.login.mock.calls)).not.toContain(secret);
    expect(r.headers.Location).not.toMatch(/oauth-code|IAM-TOKEN|evil/);
  });
  it('renews a session cookie only when storage reports renewal', async () => {
    const { handle, db } = setup();
    const e = { path: '/auth/session', httpMethod: 'GET', headers: { Origin: APP_ORIGIN, Cookie: `${SESSION_COOKIE}=${token}` } };
    db.session.mockResolvedValue({ user, expiresAt: 1000000 + SESSION_LIFETIME_MS, renewed: false });
    expect((await handle(e, ctx)).multiValueHeaders).toEqual({});
    db.session.mockResolvedValue({ user, expiresAt: 1000000 + SESSION_LIFETIME_MS, renewed: true });
    const renewed = await handle(e, ctx);
    expect(renewed.multiValueHeaders['Set-Cookie']![0]).toContain(`Max-Age=${SESSION_LIFETIME_MS / 1000}`);
    db.session.mockResolvedValue(null);
    expect((await handle(e, ctx)).multiValueHeaders['Set-Cookie']![0]).toContain('Max-Age=0');
  });
  it('revokes the hashed session and clears its cookie on logout', async () => {
    const { handle, db } = setup();
    const r = await handle({ path: '/auth/logout', httpMethod: 'POST', headers: { Origin: APP_ORIGIN, Cookie: `${SESSION_COOKIE}=${token}` } }, ctx);
    expect(db.logout).toHaveBeenCalledWith(hashSecret(token));
    expect(r.multiValueHeaders['Set-Cookie']![0]).toContain('Max-Age=0');
  });
  it('sanitizes failures and always closes the store', async () => {
    const { handle, db, client } = setup();
    client.profileFromCode.mockRejectedValue(new Error('client-secret oauth-code IAM-TOKEN-SECRET'));
    const r = await handle(callback(), ctx);
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toMatch(/client-secret|oauth-code|IAM-TOKEN/);
    expect(db.close).toHaveBeenCalledOnce();
    expect(db.login).not.toHaveBeenCalled();
  });
});
