import { Driver, AccessTokenCredentialsProvider, query } from './vendor.mjs';

export class CloudError extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
export const RETIRED_GRACE_MS = 10 * 60 * 1000;
export const RETIRED_BACKLOG_LIMIT = 32;
const SNAPSHOT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Remember immutable snapshots, newest predecessor first. Never infer history by listing S3.
 * @param {any} previous @param {number} now */
export function retireSnapshot(previous, now) {
  if (!previous) return [];
  const newest = { revision: previous.revision, retiredAt: now, thumbnailSize: previous.thumbnailSize ?? 0 };
  const unique = new Map();
  for (const entry of [newest, ...(Array.isArray(previous.retired) ? previous.retired : [])])
    if (typeof entry?.revision === 'string' && SNAPSHOT_ID.test(entry.revision) && !unique.has(entry.revision))
      unique.set(entry.revision, entry);
  return [...unique.values()];
}

/** The current snapshot and newest predecessor remain protected, even when malformed old metadata repeats them.
 * @param {any} document @param {number} [now] @param {number} [limit] @returns {any[]} */
export function retiredCandidates(document, now = Date.now(), limit = 2) {
  /** @type {any[]} */
  const history = Array.isArray(document?.retired) ? document.retired : [];
  const newest = history[0];
  // Corrupt predecessor metadata makes its identity/ordering ambiguous: keep every object until repaired.
  if (
    !newest ||
    typeof newest.revision !== 'string' ||
    !SNAPSHOT_ID.test(newest.revision) ||
    newest.revision === document.revision ||
    !Number.isSafeInteger(newest.retiredAt)
  )
    return [];
  const protectedRevision = newest.revision;
  const seen = new Set();
  return history
    .filter((entry) => {
      if (
        !entry ||
        typeof entry.revision !== 'string' ||
        !SNAPSHOT_ID.test(entry.revision) ||
        entry.revision === document.revision ||
        entry.revision === protectedRevision ||
        seen.has(entry.revision) ||
        !Number.isSafeInteger(entry.retiredAt) ||
        entry.retiredAt > now - RETIRED_GRACE_MS
      )
        return false;
      seen.add(entry.revision);
      return true;
    })
    .slice(0, Math.min(2, Math.max(0, limit)));
}

/** Apply acknowledgements to the freshly reread row, preserving all concurrent model/metadata changes.
 * @param {any} latest @param {string[]} revisions */
export function cleanedSnapshotMetadata(latest, revisions) {
  /** @type {any[]} */
  const history = Array.isArray(latest.retired) ? latest.retired : [];
  const previous = history[0]?.revision;
  const removed = new Set(revisions.filter((revision) => revision !== latest.revision && revision !== previous));
  return { ...latest, retired: history.filter((entry) => !removed.has(entry.revision)) };
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
  /** @template T @param {(tx: import('@ydbjs/query').TX) => Promise<T>} fn @param {AbortSignal} [requestSignal] */
  const transaction = async (fn, requestSignal = signal) => {
    try {
      return await sql.begin({ idempotent: true, signal: requestSignal }, fn);
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
    /** @param {string} user @param {string} id @param {AbortSignal} [requestSignal] */
    async document(user, id, requestSignal = signal) {
      const result = rows(await sql`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${id}`.signal(requestSignal));
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
          modified: Math.max(Date.now(), (old?.modified ?? 0) + 1),
        };
        await tx`UPSERT INTO cloud_folders (user_id, id, payload) VALUES (${user}, ${input.id}, ${JSON.stringify(folder)})`;
        return folder;
      });
    },
    /** @param {string} user @param {any} pending */
    async prepare(user, pending) {
      await transaction(async (tx) => {
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        trail(folders, pending.folderId);
        const result = rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${pending.documentId}`);
        const old = result.length ? JSON.parse(result[0].payload) : null;
        if (old?.trashed) throw new CloudError(409, 'document_trashed');
        if ((old?.revision ?? '') !== pending.expectedRevision || (old && old.modified !== pending.expectedModified))
          throw new CloudError(409, 'revision_conflict');
        if (pending.auto === true && (old?.retired?.length ?? 0) >= RETIRED_BACKLOG_LIMIT)
          throw new CloudError(429, 'storage_cleanup_pending');
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
        if (old?.trashed) throw new CloudError(409, 'document_trashed');
        if ((old?.revision ?? '') !== upload.expectedRevision || (old && old.modified !== upload.expectedModified))
          throw new CloudError(409, 'revision_conflict');
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        trail(folders, upload.folderId);
        const now = Date.now();
        const doc = {
          id: upload.documentId,
          name: upload.name,
          folderId: upload.folderId,
          revision: upload.id,
          created: old?.created ?? Date.now(),
          modified: Math.max(now, (old?.modified ?? 0) + 1),
          uploadedAt: now,
          retired: retireSnapshot(old, now),
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
      return transaction(async (tx) => {
        const result = rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${input.id}`);
        if (!result.length) throw new CloudError(404, 'document_not_found');
        const old = JSON.parse(result[0].payload);
        if (old.trashed && input.trashed !== false) throw new CloudError(409, 'document_trashed');
        if (old.revision !== input.revision || old.modified !== input.modified) throw new CloudError(409, 'revision_conflict');
        const folders = unpack(rows(await tx`SELECT payload FROM cloud_folders WHERE user_id = ${user}`));
        trail(folders, input.folderId);
        const doc = {
          ...old,
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          folderId: input.folderId,
          modified: Math.max(Date.now(), old.modified + 1),
        };
        if (input.trashed === true) doc.trashed = Date.now();
        if (input.trashed === false) delete doc.trashed;
        await tx`UPDATE cloud_documents SET payload = ${JSON.stringify(doc)} WHERE user_id = ${user} AND id = ${input.id}`;
        return doc;
      });
    },
    /** @param {string} user @param {string} id @param {string[]} revisions @param {AbortSignal} [requestSignal] */
    async cleaned(user, id, revisions, requestSignal = signal) {
      return transaction(async (tx) => {
        const result = rows(await tx`SELECT payload FROM cloud_documents WHERE user_id = ${user} AND id = ${id}`);
        if (!result.length) return;
        const latest = JSON.parse(result[0].payload);
        const next = cleanedSnapshotMetadata(latest, revisions);
        if (JSON.stringify(next.retired) === JSON.stringify(latest.retired ?? [])) return;
        await tx`UPDATE cloud_documents SET payload = ${JSON.stringify(next)} WHERE user_id = ${user} AND id = ${id}`;
      }, requestSignal);
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
