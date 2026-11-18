import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Driver } from '@ydbjs/core';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { query } from '@ydbjs/query';
import { SESSION_LIFETIME_MS, SESSION_RENEWAL_INTERVAL_MS } from './auth-policy.mjs';

/** @typedef {{id: string, displayName: string, email: string|null, avatarUrl: string|null}} AuthUser */
/** @typedef {ReturnType<import('./yandex.mjs').normalizeYandexProfile>} Profile */
/** @typedef {{stateHash: string, bindingHash: string, verifier: string, expiresAt: number}} Attempt */
/** @typedef {{user: AuthUser, expiresAt: number, renewed: boolean}} Session */
/** @typedef {{
 * saveAttempt: (a: Attempt, now: number) => Promise<void>,
 * consumeAttempt: (stateHash: string, bindingHash: string, now: number) => Promise<string|null>,
 * login: (profile: Profile, tokenHash: string, now: number) => Promise<AuthUser>,
 * session: (tokenHash: string, now: number) => Promise<Session|null>,
 * logout: (tokenHash: string) => Promise<void>, close: () => Promise<void>
 * }} AuthStore */

/** @param {unknown[][]} results @returns {Record<string, any>|undefined} */
const first = (results) => /** @type {Record<string, any>|undefined} */ (results[0]?.[0]);
/** @param {unknown} value */
const nullableString = (value) => typeof value === 'string' ? value : null;
/** @param {Record<string, any>} row @returns {AuthUser} */
function userFromRow(row) {
  if (typeof row.user_id !== 'string' || !row.user_id) throw new Error('Invalid user record');
  return { id: row.user_id, displayName: nullableString(row.display_name) ?? 'Пользователь',
    email: nullableString(row.email), avatarUrl: nullableString(row.avatar_url) };
}

/** @param {string} connectionString @param {string} token @param {AbortSignal} signal @returns {Promise<AuthStore>} */
export async function createAuthStore(connectionString, token, signal) {
  const driver = new Driver(connectionString, { credentialsProvider: new AccessTokenCredentialsProvider({ token }) });
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  try { await driver.ready(signal); } catch (error) { driver.close(); throw error; }
  /** @template T @param {(tx: import('@ydbjs/query').TX) => Promise<T>} fn */
  const transaction = (fn) => sql.begin({ idempotent: true, signal }, fn);
  return {
    async saveAttempt(a, now) {
      await sql`INSERT INTO auth_requests (state_hash, browser_binding_hash, provider, pkce_verifier, created_at, expires_at)
        VALUES (${a.stateHash}, ${a.bindingHash}, 'yandex', ${a.verifier},
        CAST(${new Date(now)} AS Timestamp), CAST(${new Date(a.expiresAt)} AS Timestamp))`.signal(signal);
    },
    async consumeAttempt(stateHash, bindingHash, now) {
      return transaction(async tx => {
        const a = first(await tx`SELECT * FROM auth_requests WHERE state_hash = ${stateHash}`);
        if (!a || a.provider !== 'yandex' || !(a.expires_at instanceof Date) || a.expires_at.getTime() <= now
          || typeof a.browser_binding_hash !== 'string' || typeof a.pkce_verifier !== 'string') return null;
        const actual = Buffer.from(a.browser_binding_hash);
        const expected = Buffer.from(bindingHash);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        await tx`DELETE FROM auth_requests WHERE state_hash = ${stateHash}`;
        return a.pkce_verifier;
      });
    },
    async login(profile, tokenHash, now) {
      const candidateId = randomUUID();
      return transaction(async tx => {
        const identity = first(await tx`SELECT user_id FROM auth_identities
          WHERE provider = ${profile.provider} AND provider_subject = ${profile.subject}`);
        const id = identity?.user_id ?? candidateId;
        if (typeof id !== 'string' || !id) throw new Error('Invalid identity record');
        if (!identity) {
          await tx`INSERT INTO auth_users (user_id, display_name, email, avatar_url, created_at)
            VALUES (${id}, ${profile.displayName}, NULLIF(${profile.email ?? ''}, CAST('' AS Utf8)),
              NULLIF(${profile.avatarUrl ?? ''}, CAST('' AS Utf8)), CAST(${new Date(now)} AS Timestamp))`;
          await tx`INSERT INTO auth_identities (provider, provider_subject, user_id, created_at)
            VALUES (${profile.provider}, ${profile.subject}, ${id}, CAST(${new Date(now)} AS Timestamp))`;
        } else {
          const existing = first(await tx`SELECT user_id FROM auth_users WHERE user_id = ${id}`);
          if (!existing) throw new Error('Identity owner missing');
          await tx`UPDATE auth_users SET display_name = ${profile.displayName}, email = NULLIF(${profile.email ?? ''}, CAST('' AS Utf8)),
            avatar_url = NULLIF(${profile.avatarUrl ?? ''}, CAST('' AS Utf8)) WHERE user_id = ${id}`;
        }
        await tx`INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
          VALUES (${tokenHash}, ${id}, CAST(${new Date(now)} AS Timestamp), CAST(${new Date(now + SESSION_LIFETIME_MS)} AS Timestamp))`;
        return { id, displayName: profile.displayName, email: profile.email, avatarUrl: profile.avatarUrl };
      });
    },
    async session(tokenHash, now) {
      return transaction(async tx => {
        const session = first(await tx`SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ${tokenHash}`);
        if (!session || !(session.expires_at instanceof Date) || session.expires_at.getTime() <= now) return null;
        const user = first(await tx`SELECT * FROM auth_users WHERE user_id = ${session.user_id}`);
        if (!user) return null;
        let expiresAt = session.expires_at.getTime();
        const renewed = now >= expiresAt - SESSION_LIFETIME_MS + SESSION_RENEWAL_INTERVAL_MS;
        if (renewed) {
          expiresAt = now + SESSION_LIFETIME_MS;
          await tx`UPDATE auth_sessions SET expires_at = CAST(${new Date(expiresAt)} AS Timestamp) WHERE token_hash = ${tokenHash}`;
        }
        return { user: userFromRow(user), expiresAt, renewed };
      });
    },
    async logout(tokenHash) { await sql`DELETE FROM auth_sessions WHERE token_hash = ${tokenHash}`.signal(signal); },
    async close() { try { await sql[Symbol.asyncDispose](); } finally { driver.close(); } },
  };
}
