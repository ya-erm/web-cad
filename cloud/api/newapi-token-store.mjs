import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { Driver, AccessTokenCredentialsProvider, query } from './vendor.mjs';

export const API_TOKEN_LIMIT = 20;
export const API_TOKEN_DEFAULT_DAYS = 90;
export const API_TOKEN_MAX_DAYS = 365;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const PATTERN = new RegExp(`^wcad_pat_v1\\.(${UUID})\\.(${UUID})\\.([A-Za-z0-9_-]{43})$`);
export class ApiTokenError extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
/** @param {string} value */
export function parseApiToken(value) {
  const match = typeof value === 'string' && PATTERN.exec(value);
  return match ? { userId: match[1], id: match[2] } : null;
}
/** @param {string} value */
export const apiTokenHash = (value) => createHash('sha256').update(value).digest('hex');
/** @param {string} value @param {unknown} hash */
export function verifyApiToken(value, hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(apiTokenHash(value), 'hex'), Buffer.from(hash, 'hex'));
}
/** @param {any} row */
function publicRecord(row) {
  if (
    !(row.created_at instanceof Date) ||
    !(row.expires_at instanceof Date) ||
    !Number.isSafeInteger(row.created_at.getTime()) ||
    !Number.isSafeInteger(row.expires_at.getTime()) ||
    row.expires_at.getTime() <= row.created_at.getTime() ||
    typeof row.id !== 'string' ||
    typeof row.name !== 'string'
  )
    return null;
  let scopes;
  try {
    scopes = JSON.parse(row.scopes);
  } catch {
    return null;
  }
  if (!Array.isArray(scopes) || !scopes.includes('read') || scopes.some((scope) => !['read', 'write'].includes(scope))) return null;
  return {
    id: row.id,
    name: row.name,
    scopes: /** @type {string[]} */ (scopes),
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
  };
}
/** @param {unknown[][]} result @returns {any[]} */
const rows = (result) => result[0] ?? [];
/** @param {string} connection @param {string} credential @param {AbortSignal} signal */
export async function createApiTokenStore(connection, credential, signal) {
  const driver = new Driver(connection, { credentialsProvider: new AccessTokenCredentialsProvider({ token: credential }) });
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  try {
    await driver.ready(signal);
  } catch (error) {
    driver.close();
    throw error;
  }
  /** @template T @param {(tx: import('@ydbjs/query').TX) => Promise<T>} fn */
  const transaction = async (fn) => {
    try {
      return await sql.begin({ idempotent: true, signal }, fn);
    } catch (error) {
      let cause = error;
      for (let n = 0; n < 8 && cause instanceof Error; n++) {
        if (cause instanceof ApiTokenError) throw cause;
        cause = cause.cause;
      }
      throw error;
    }
  };
  return {
    /** @param {string} hash @param {number} now */
    async session(hash, now) {
      const row = rows(await sql`SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ${hash}`.signal(signal))[0];
      if (!row || !(row.expires_at instanceof Date) || row.expires_at.getTime() <= now) return null;
      const owner = rows(await sql`SELECT user_id FROM auth_users WHERE user_id = ${row.user_id}`.signal(signal))[0];
      return owner ? /** @type {string} */ (row.user_id) : null;
    },
    /** @param {string} token @param {number} now */
    async authenticate(token, now) {
      const parsed = parseApiToken(token);
      if (!parsed) return null;
      const row = rows(
        await sql`SELECT id, name, scopes, created_at, expires_at, token_hash FROM auth_api_tokens WHERE user_id = ${parsed.userId} AND id = ${parsed.id}`.signal(
          signal,
        ),
      )[0];
      if (!row || !verifyApiToken(token, row.token_hash)) return null;
      const record = publicRecord(row);
      if (!record || record.expiresAt <= now) return null;
      const owner = rows(await sql`SELECT user_id FROM auth_users WHERE user_id = ${parsed.userId}`.signal(signal))[0];
      return owner ? { userId: parsed.userId, scopes: record.scopes } : null;
    },
    /** @param {string} user @param {number} now */
    async list(user, now) {
      const result = rows(
        await sql`SELECT id, name, scopes, created_at, expires_at FROM auth_api_tokens WHERE user_id = ${user}`.signal(signal),
      );
      return result
        .map(publicRecord)
        .filter((record) => record && record.expiresAt > now)
        .sort((a, b) => /** @type {NonNullable<typeof b>} */ (b).createdAt - /** @type {NonNullable<typeof a>} */ (a).createdAt);
    },
    /** @param {string} user @param {{name:string,scopes:string[],expiresInDays:number}} input @param {number} now */
    async issue(user, input, now) {
      const id = randomUUID(),
        token = `wcad_pat_v1.${user}.${id}.${randomBytes(32).toString('base64url')}`;
      const record = { id, name: input.name, scopes: input.scopes, createdAt: now, expiresAt: now + input.expiresInDays * 86400000 };
      await transaction(async (tx) => {
        const current = rows(await tx`SELECT id, expires_at FROM auth_api_tokens WHERE user_id = ${user}`);
        if (current.filter((row) => !(row.expires_at instanceof Date) || row.expires_at.getTime() > now).length >= API_TOKEN_LIMIT)
          throw new ApiTokenError(409, 'token_limit_reached');
        await tx`INSERT INTO auth_api_tokens (user_id, id, token_hash, name, scopes, created_at, expires_at) VALUES (${user}, ${id}, ${apiTokenHash(token)}, ${record.name}, ${JSON.stringify(record.scopes)}, CAST(${new Date(record.createdAt)} AS Timestamp), CAST(${new Date(record.expiresAt)} AS Timestamp))`;
      });
      return { token, record };
    },
    /** @param {string} user @param {string} id */
    async revoke(user, id) {
      await sql`DELETE FROM auth_api_tokens WHERE user_id = ${user} AND id = ${id}`.signal(signal);
    },
    async close() {
      try {
        await sql[Symbol.asyncDispose]();
      } finally {
        driver.close();
      }
    },
  };
}
