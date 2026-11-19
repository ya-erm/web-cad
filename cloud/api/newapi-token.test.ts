import { beforeEach, describe, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({
  tokens: new Map<string, any>(),
  sessions: new Map<string, any>(),
  users: new Set<string>(),
  writes: [] as unknown[][],
  queue: Promise.resolve(),
}));
vi.mock('./vendor.mjs', () => {
  const run = (strings: TemplateStringsArray, values: any[]) => {
    const command = strings.join('?');
    if (command.includes('FROM auth_sessions')) {
      const row = memory.sessions.get(values[0]);
      return [row ? [row] : []];
    }
    if (command.includes('FROM auth_users')) return [memory.users.has(values[0]) ? [{ user_id: values[0] }] : []];
    if (command.includes('SELECT') && command.includes('FROM auth_api_tokens')) {
      const found =
        values.length > 1
          ? [memory.tokens.get(`${values[0]}:${values[1]}`)].filter(Boolean)
          : [...memory.tokens.entries()].filter(([key]) => key.startsWith(values[0] + ':')).map(([, value]) => value);
      return [found];
    }
    if (command.includes('INSERT INTO auth_api_tokens')) {
      const [user, id, token_hash, name, scopes, created_at, expires_at] = values;
      memory.tokens.set(`${user}:${id}`, { id, token_hash, name, scopes, created_at, expires_at });
      memory.writes.push(values);
      return [[]];
    }
    if (command.includes('DELETE FROM auth_api_tokens')) {
      memory.tokens.delete(`${values[0]}:${values[1]}`);
      return [[]];
    }
    throw new Error('Unexpected query');
  };
  const tx = async (strings: TemplateStringsArray, ...values: any[]) => run(strings, values);
  const sql = Object.assign((strings: TemplateStringsArray, ...values: any[]) => ({ signal: async () => run(strings, values) }), {
    begin: async (_options: unknown, callback: (tx: unknown) => unknown) => {
      const promise = memory.queue.then(() => callback(tx));
      memory.queue = promise.then(
        () => {},
        () => {},
      );
      return promise;
    },
    [Symbol.asyncDispose]: async () => {},
  });
  return {
    Driver: class {
      ready = async () => {};
      close() {}
    },
    AccessTokenCredentialsProvider: class {},
    query: () => sql,
  };
});
import { apiTokenHash, createApiTokenStore, parseApiToken, verifyApiToken } from './newapi-token-store.mjs';
import { apiAuthorization, createApiTokenHandler } from './newapi-token.mjs';
import { APP_ORIGIN, SESSION_COOKIE } from './auth.mjs';
import { hashSecret } from './yandex.mjs';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  at = 1800000000000;
const session = 'a'.repeat(43),
  context = { token: { access_token: 'test-iam' } };
const store = () => createApiTokenStore('test', 'test', AbortSignal.timeout(3000));
const handle = createApiTokenHandler({ now: () => at });
const request = (path: string, body?: object, headers: Record<string, string> = {}) =>
  handle(
    {
      path,
      httpMethod: body ? 'POST' : 'GET',
      headers: { Origin: APP_ORIGIN, Cookie: `${SESSION_COOKIE}=${session}`, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    },
    context,
  );
beforeEach(() => {
  memory.tokens.clear();
  memory.sessions.clear();
  memory.users.clear();
  memory.writes.length = 0;
  memory.queue = Promise.resolve();
  memory.users.add(user);
  memory.users.add(other);
  memory.sessions.set(hashSecret(session), { user_id: user, expires_at: new Date(at + 86400000) });
});

describe('personal token persistence and verification', () => {
  it('stores only a full-token digest and validates strict versioned owner/id tokens', async () => {
    const db = await store();
    const issued = await db.issue(user, { name: 'CLI', scopes: ['read'], expiresInDays: 90 }, at);
    expect(parseApiToken(issued.token)).toEqual({ userId: user, id: issued.record.id });
    expect(memory.writes.flat()).not.toContain(issued.token);
    expect(memory.tokens.get(`${user}:${issued.record.id}`).token_hash).toBe(apiTokenHash(issued.token));
    expect(verifyApiToken(issued.token, apiTokenHash(issued.token))).toBe(true);
    expect(verifyApiToken(issued.token + 'x', apiTokenHash(issued.token))).toBe(false);
    expect(verifyApiToken(issued.token, 'malformed')).toBe(false);
    expect(await db.authenticate(issued.token, at + 1)).toEqual({ userId: user, scopes: ['read'] });
    const wrong = issued.token.slice(0, -1) + (issued.token.endsWith('a') ? 'b' : 'a');
    expect(await db.authenticate(wrong, at)).toBeNull();
    expect(await db.authenticate(issued.token.replace(user, other), at)).toBeNull();
    expect(parseApiToken(issued.token.replace('wcad_pat_v1', 'wcad_pat_v2'))).toBeNull();
    expect(parseApiToken('not-a-token')).toBeNull();
    await db.close();
  });
  it('rejects expired, revoked, malformed metadata and removed-owner tokens', async () => {
    const db = await store();
    const issued = await db.issue(user, { name: 'CLI', scopes: ['read', 'write'], expiresInDays: 1 }, at);
    expect(await db.authenticate(issued.token, issued.record.expiresAt)).toBeNull();
    const row = memory.tokens.get(`${user}:${issued.record.id}`);
    const expiry = row.expires_at;
    row.expires_at = new Date(NaN);
    expect(await db.authenticate(issued.token, at)).toBeNull();
    row.expires_at = expiry;
    row.scopes = '["write"]';
    expect(await db.authenticate(issued.token, at)).toBeNull();
    row.scopes = '["read","write"]';
    memory.users.delete(user);
    expect(await db.authenticate(issued.token, at)).toBeNull();
    memory.users.add(user);
    await db.revoke(other, issued.record.id);
    expect(await db.authenticate(issued.token, at)).not.toBeNull();
    await db.revoke(user, issued.record.id);
    expect(await db.authenticate(issued.token, at)).toBeNull();
    await db.close();
  });
  it('enforces the active cap in the issuance transaction, including simultaneous requests', async () => {
    const db = await store();
    for (let n = 0; n < 19; n++) await db.issue(user, { name: 'CLI', scopes: ['read'], expiresInDays: 1 }, at);
    const results = await Promise.allSettled([
      db.issue(user, { name: 'A', scopes: ['read'], expiresInDays: 1 }, at),
      db.issue(user, { name: 'B', scopes: ['read'], expiresInDays: 1 }, at),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409, message: 'token_limit_reached' } });
    expect(memory.tokens.size).toBe(20);
    await db.issue(other, { name: 'Other', scopes: ['read'], expiresInDays: 1 }, at);
    const expired = [...memory.tokens.values()][0];
    expired.expires_at = new Date(at);
    await expect(db.issue(user, { name: 'Replace expired', scopes: ['read'], expiresInDays: 1 }, at)).resolves.toHaveProperty('token');
    await db.close();
  });
});

describe('browser-only token management', () => {
  it('issues the secret once and lists only owned public active metadata', async () => {
    const issued = await request('/auth/tokens', { name: ' Laptop ', scopes: ['read', 'write'], expectedUserId: user });
    expect(issued.statusCode).toBe(200);
    const body = JSON.parse(issued.body);
    expect(body.userId).toBe(user);
    expect(body.record).toMatchObject({ name: 'Laptop', scopes: ['read', 'write'], createdAt: at, expiresAt: at + 90 * 86400000 });
    const db = await store();
    await db.issue(other, { name: 'Hidden', scopes: ['read'], expiresInDays: 1 }, at);
    await db.close();
    const listed = await request('/auth/tokens');
    expect(JSON.parse(listed.body)).toEqual({ userId: user, tokens: [body.record] });
    expect(listed.body).not.toContain(body.token);
    expect(listed.body).not.toContain('token_hash');
    expect(listed.headers['Cache-Control']).toBe('no-store');
    const revoked = await request('/auth/tokens/revoke', { id: body.record.id, expectedUserId: user });
    expect(JSON.parse(revoked.body)).toEqual({ userId: user, ok: true });
    expect(JSON.parse((await request('/auth/tokens')).body).tokens).toEqual([]);
  });
  it.each(['', 'https://evil.test'])('blocks cookie mutations from disallowed Origin %s', async (origin) => {
    expect((await request('/auth/tokens', { name: 'CLI' }, { Origin: origin })).statusCode).toBe(403);
    expect((await request('/auth/tokens/revoke', { id: user }, { Origin: origin })).statusCode).toBe(403);
    expect(memory.tokens.size).toBe(0);
  });
  it('refuses any Authorization management request even with a valid cookie', async () => {
    for (const value of ['', 'Bearer invalid', 'Basic anything'])
      expect((await request('/auth/tokens', { name: 'CLI' }, { Authorization: value })).statusCode).toBe(401);
    expect(memory.tokens.size).toBe(0);
  });
  it('guards expiry, missing cookie and account switch before issuing or revoking', async () => {
    expect((await request('/auth/tokens', { name: 'CLI' }, { Cookie: '' })).statusCode).toBe(401);
    expect((await request('/auth/tokens', { name: 'CLI', expectedUserId: other })).statusCode).toBe(409);
    expect((await request('/auth/tokens/revoke', { id: user, expectedUserId: other })).statusCode).toBe(409);
    memory.sessions.get(hashSecret(session)).expires_at = new Date(at);
    expect((await request('/auth/tokens')).statusCode).toBe(401);
    expect(memory.tokens.size).toBe(0);
  });
  it.each([
    { name: '' },
    { name: 'a\nsecret' },
    { name: 'a'.repeat(81) },
    { name: 'CLI', scopes: ['write'] },
    { name: 'CLI', scopes: ['read', 'admin'] },
    { name: 'CLI', scopes: ['read', 'read'] },
    { name: 'CLI', expiresInDays: 366 },
    { name: 'CLI', expiresInDays: 0 },
    { name: 'CLI', expiresInDays: 1.5 },
  ])('validates issuance parameters %j', async (input) => {
    expect((await request('/auth/tokens', input)).statusCode).toBe(400);
    expect(memory.tokens.size).toBe(0);
  });
  it('accepts the maximum expiry while keeping expired records out of listings', async () => {
    const issued = JSON.parse((await request('/auth/tokens', { name: 'Year', expiresInDays: 365, scopes: ['read'] })).body);
    expect(issued.record.expiresAt).toBe(at + 365 * 86400000);
    memory.tokens.get(`${user}:${issued.record.id}`).expires_at = new Date(at);
    expect(JSON.parse((await request('/auth/tokens')).body).tokens).toEqual([]);
  });
  it('never falls back from duplicate or malformed Authorization', () => {
    expect(apiAuthorization({ headers: { Authorization: '' } })).toEqual({ present: true, token: null });
    expect(apiAuthorization({ multiValueHeaders: { Authorization: ['Bearer bad', 'Bearer bad'] } })).toEqual({
      present: true,
      token: null,
    });
  });
});
