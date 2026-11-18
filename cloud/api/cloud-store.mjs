import { Driver } from '@ydbjs/core';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { query } from '@ydbjs/query';

export class CloudError extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
/** @param {unknown[][]} result @returns {any[]} */
const rows = (result) => result[0] ?? [];
/** @param {any[]} result */
const unpack = (result) => result.map((r) => JSON.parse(r.payload));
/** @param {any[]} folders @param {string} id */
function trail(folders, id) {
  const seen = new Set();
  while (id) {
    if (seen.has(id)) throw new CloudError(409, 'folder_cycle');
    seen.add(id);
    const parent = folders.find((f) => f.id === id);
    if (!parent) throw new CloudError(404, 'folder_not_found');
    id = parent.parentId;
  }
  return seen;
}

/** @param {string} connection @param {string} token @param {AbortSignal} signal */
export async function createCloudStore(connection, token, signal) {
  const driver = new Driver(connection, { credentialsProvider: new AccessTokenCredentialsProvider({ token }) });
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  try {
    await driver.ready(signal);
  } catch (e) {
    driver.close();
    throw e;
  }
  /** @template T @param {(tx: import('@ydbjs/query').TX) => Promise<T>} fn */
  const transaction = async (fn) => {
    try {
      return await sql.begin({ idempotent: true, signal }, fn);
    } catch (error) {
      let cause = error;
      for (let n = 0; n < 8 && cause instanceof Error; n++) {
        if (cause instanceof CloudError) throw cause;
        cause = cause.cause;
      }
      throw error;
    }
  };
  return {
    /** @param {string} hash */
    async authenticate(hash) {
      const result = rows(await sql`SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ${hash}`.signal(signal))[0];
      if (!result || !(result.expires_at instanceof Date) || result.expires_at.getTime() <= Date.now()) return null;
      return /** @type {string} */ (result.user_id);
    },
    /** @param {string} user */
    async list(user) {
      return transaction(async (tx) => ({
        folders: unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`)),
        documents: unpack(rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user}`)),
      }));
    },
    /** @param {string} user @param {string} id */
    async document(user, id) {
      const result = rows(await sql`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${id}`.signal(signal));
      return result.length ? JSON.parse(result[0].payload) : null;
    },
    /** @param {string} user @param {any} input */
    async folder(user, input) {
      return transaction(async (tx) => {
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        const old = folders.find((f) => f.id === input.id);
        if (input.remove) {
          if (!old) throw new CloudError(404, 'folder_not_found');
          const documents = unpack(rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user}`));
          if (folders.some((f) => f.parentId === input.id) || documents.some((d) => d.folderId === input.id))
            throw new CloudError(409, 'folder_not_empty');
          await tx`DELETE FROM cloud_folders WHERE user_id = ${user} AND id = ${input.id}`;
          return;
        }
        if (folders.length >= 1000 && !old) throw new CloudError(409, 'folder_limit');
        if (trail(folders, input.parentId).has(input.id) || input.parentId === input.id) throw new CloudError(409, 'folder_cycle');
        if (folders.some((f) => f.id !== input.id && f.parentId === input.parentId && f.name.toLowerCase() === input.name.toLowerCase()))
          throw new CloudError(409, 'folder_name_exists');
        if (old && input.expectedModified !== old.modified) throw new CloudError(409, 'revision_conflict');
        const folder = {
          id: input.id,
          name: input.name,
          parentId: input.parentId,
          created: old?.created ?? Date.now(),
          modified: Date.now(),
        };
        await tx`UPSERT INTO cloud_folders (user_id, id, payload) VALUES (${user}, ${input.id}, ${JSON.stringify(folder)})`;
      });
    },
    /** @param {string} user @param {any} pending */
    async prepare(user, pending) {
      await transaction(async (tx) => {
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        trail(folders, pending.folderId);
        const result = rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${pending.documentId}`);
        const old = result.length ? JSON.parse(result[0].payload) : null;
        if ((old?.revision ?? '') !== pending.expectedRevision) throw new CloudError(409, 'revision_conflict');
        await tx`INSERT INTO cloud_uploads (user_id, id, payload, expires_at) VALUES (${user}, ${pending.id}, ${JSON.stringify(pending)}, CAST(${new Date(Date.now() + 86400000)} AS Timestamp))`;
      });
    },
    /** @param {string} user @param {string} id */
    async pending(user, id) {
      const result = rows(await sql`SELECT payload, expires_at FROM cloud_uploads WHERE user_id = ${user} AND id = ${id}`.signal(signal));
      if (!result.length || result[0].expires_at.getTime() <= Date.now()) throw new CloudError(404, 'upload_not_found');
      return JSON.parse(result[0].payload);
    },
    /** @param {string} user @param {any} upload */
    async commit(user, upload) {
      return transaction(async (tx) => {
        const current = rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${upload.documentId}`);
        const old = current.length ? JSON.parse(current[0].payload) : null;
        // Retrying a commit whose response was lost is safe.
        if (old?.revision === upload.id) return old;
        if ((old?.revision ?? '') !== upload.expectedRevision) throw new CloudError(409, 'revision_conflict');
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        trail(folders, upload.folderId);
        const doc = {
          id: upload.documentId,
          name: upload.name,
          folderId: upload.folderId,
          revision: upload.id,
          created: old?.created ?? Date.now(),
          modified: Date.now(),
          size: upload.size,
          thumbnailSize: upload.thumbnailSize,
          hash: upload.hash,
          thumbnailHash: upload.thumbnailHash,
        };
        await tx`UPSERT INTO cloud_documents (user_id, id, payload) VALUES (${user}, ${doc.id}, ${JSON.stringify(doc)})`;
        // Keep upload metadata until TTL for idempotent commit retries.
        return doc;
      });
    },
    /** @param {string} user @param {any} input */
    async move(user, input) {
      await transaction(async (tx) => {
        const result = rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${input.id}`);
        if (!result.length) throw new CloudError(404, 'document_not_found');
        const old = JSON.parse(result[0].payload);
        if (old.revision !== input.revision || old.modified !== input.modified) throw new CloudError(409, 'revision_conflict');
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        trail(folders, input.folderId);
        const doc = { ...old, folderId: input.folderId, modified: Date.now() };
        await tx`UPDATE cloud_documents SET payload = ${JSON.stringify(doc)} WHERE user_id = ${user} AND id = ${input.id}`;
      });
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
