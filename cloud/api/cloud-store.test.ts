import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({
  documents: new Map<string, unknown>(),
  uploads: new Map<string, unknown>(),
  folders: new Map<string, unknown>(),
}));
vi.mock('./vendor.mjs', () => {
  const read = (strings: TemplateStringsArray, values: unknown[]) => {
    const command = strings.join('?');
    if (command.includes('SELECT payload FROM cloud_folders'))
      return [
        [...memory.folders.entries()]
          .filter(([key]) => key.startsWith(String(values[0]) + ':'))
          .map(([, value]) => ({ payload: JSON.stringify(value) })),
      ];
    if (command.includes('SELECT payload FROM cloud_documents')) {
      const doc = memory.documents.get(`${values[0]}:${values[1]}`);
      return [doc ? [{ payload: JSON.stringify(doc) }] : []];
    }
    if (command.includes('UPSERT INTO cloud_folders')) memory.folders.set(`${values[0]}:${values[1]}`, JSON.parse(String(values[2])));
    else if (command.includes('DELETE FROM cloud_folders')) memory.folders.delete(`${values[0]}:${values[1]}`);
    else if (command.includes('UPSERT INTO cloud_documents'))
      memory.documents.set(`${values[0]}:${values[1]}`, JSON.parse(String(values[2])));
    else if (command.includes('UPDATE cloud_documents')) memory.documents.set(`${values[1]}:${values[2]}`, JSON.parse(String(values[0])));
    else if (command.includes('INSERT INTO cloud_uploads')) memory.uploads.set(`${values[0]}:${values[1]}`, JSON.parse(String(values[2])));
    else throw new Error('Unexpected store query');
    return [[]];
  };
  const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => read(strings, values);
  const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ signal: async () => read(strings, values) }), {
    begin: async (_options: unknown, callback: (tx: unknown) => unknown) => callback(tx),
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
import { createCloudStore } from './cloud-store.mjs';
const pending = (id: string, expectedRevision = '', expectedModified?: number) => ({
  id,
  documentId: 'doc',
  name: 'Document',
  folderId: '',
  expectedRevision,
  expectedModified,
  size: 10,
  thumbnailSize: 0,
  hash: 'hash',
  thumbnailHash: '',
});
beforeEach(() => {
  memory.documents.clear();
  memory.uploads.clear();
  memory.folders.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('snapshot metadata transactions', () => {
  it('returns canonical folder timestamps for following metadata CAS changes', async () => {
    const db = await createCloudStore('unused', 'unused', AbortSignal.timeout(3000));
    try {
      const created = await db.folder('owner', { id: 'folder', name: 'Parts', parentId: '', modified: 0 });
      expect(created?.modified).toBeGreaterThan(0);
      expect(memory.folders.get('owner:folder')).toEqual(created);
      const renamed = await db.folder('owner', { id: 'folder', name: 'Renamed', parentId: '', expectedModified: created!.modified });
      expect(renamed?.name).toBe('Renamed');
      expect(renamed?.modified).toBeGreaterThan(created!.modified);
    } finally {
      await db.close();
    }
  });
  it('retains each displaced revision once while idempotent commit retries do not grow history', async () => {
    const db = await createCloudStore('unused', 'unused', AbortSignal.timeout(3000));
    try {
      const first = await db.commit('owner', pending('r1'));
      expect(first.retired).toEqual([]);
      const second = await db.commit('owner', pending('r2', 'r1', first.modified));
      const third = await db.commit('owner', pending('r3', 'r2', second.modified));
      expect(third.retired.map((r: { revision: string }) => r.revision)).toEqual(['r2', 'r1']);
      expect((await db.commit('owner', pending('r3', 'r2', second.modified))).retired).toEqual(third.retired);
      expect(third.uploadedAt).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
  it('pauses automatic uploads at the bounded cleanup backlog while allowing explicit manual saves', async () => {
    const doc = {
      id: 'doc',
      revision: 'r1',
      modified: 1,
      retired: Array.from({ length: 32 }, (_, n) => ({ revision: 'old-' + n, retiredAt: 0, thumbnailSize: 0 })),
    };
    memory.documents.set('owner:doc', doc);
    const db = await createCloudStore('unused', 'unused', AbortSignal.timeout(3000));
    try {
      await expect(db.prepare('owner', { ...pending('r2', 'r1', 1), auto: true })).rejects.toMatchObject({
        status: 429,
        message: 'storage_cleanup_pending',
      });
      expect(memory.uploads.size).toBe(0);
      await db.prepare('owner', pending('r2', 'r1', 1));
      expect(memory.uploads.size).toBe(1);
    } finally {
      await db.close();
    }
  });
  it('rereads the latest owner row before removing only acknowledged retired entries', async () => {
    const latest = {
      id: 'doc',
      revision: 'new-current',
      name: 'Renamed concurrently',
      folderId: 'moved',
      modified: 99,
      retired: [
        { revision: 'previous', retiredAt: 5 },
        { revision: 'obsolete', retiredAt: 0 },
      ],
    };
    memory.documents.set('owner:doc', latest);
    memory.documents.set('foreign:doc', { private: true });
    const db = await createCloudStore('unused', 'unused', AbortSignal.timeout(3000));
    try {
      await db.cleaned('owner', 'doc', ['obsolete', 'previous', 'new-current']);
      expect(memory.documents.get('owner:doc')).toEqual({ ...latest, retired: [latest.retired[0]] });
      expect(memory.documents.get('foreign:doc')).toEqual({ private: true });
    } finally {
      await db.close();
    }
  });
});
