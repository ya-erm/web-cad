import { describe, it, expect } from 'vitest';
import { libraryDocumentStatus, unifiedLibrary, recentDocuments } from './library';
import { canMoveCloudItem, cloudFolderPreview } from './folders';
import type { CloudList, CloudDocument } from './client';
import type { DocumentSummary } from '../core/types';
const folder = (id: string, parentId = '', name = id) => ({ id, parentId, name, created: 1, modified: 1 });
const doc = (id: string, folderId = ''): DocumentSummary => ({ id, name: id, created: 1, modified: 2, folderId });
const cloud = (id: string, folderId = ''): CloudDocument => ({
  ...doc(id, folderId),
  folderId,
  revision: 'r1',
  size: 10,
  thumbnailSize: 0,
  hash: 'h',
  thumbnailHash: '',
});
describe('one managed document across browser and cloud', () => {
  it('groups the original and old downloaded copies without deleting variants', () => {
    const original = doc('logical', 'local'),
      copy = { ...doc('old-copy'), cloudSource: { userId: 'user', documentId: 'logical', revision: 'r1' } };
    const remote: CloudList = { userId: 'user', folders: [folder('remote', '', 'Parts')], documents: [cloud('logical', 'remote')] };
    const view = unifiedLibrary([folder('local', '', 'Parts')], [original, copy], remote);
    expect(view.folders).toHaveLength(1);
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0].locals.map((d) => d.id)).toEqual(['logical', 'old-copy']);
    expect(view.documents[0].folderId).toBe('local');
    expect(original.folderId).toBe('local');
  });
  it('keeps a disk document separate from its explicit library copy', () => {
    const disk = doc('disk');
    const copy = { ...doc('copy'), cloudSource: { userId: 'user', documentId: 'disk', revision: 'r1' } };
    expect(recentDocuments([disk, copy], new Set(['disk']))).toHaveLength(2);
  });
  it('does not bind another account’s local cache to a remote document', () => {
    const cached = { ...doc('cached'), cloudSource: { userId: 'other', documentId: 'same-id', revision: 'r1' } };
    expect(unifiedLibrary([], [cached], { userId: 'current', folders: [], documents: [cloud('same-id')] }).documents).toHaveLength(2);
  });
  it('keeps canonical local IDs from a different account separate', () => {
    const cached = { ...doc('same-id'), cloudSource: { userId: 'other', documentId: 'same-id', revision: 'r1' } };
    expect(unifiedLibrary([], [cached], { userId: 'current', folders: [], documents: [cloud('same-id')] }).documents).toHaveLength(2);
  });
  it('keeps cloud folder identity when its name changes', () => {
    const local = { ...folder('local', '', 'Old'), cloudSource: { userId: 'user', folderId: 'remote' } };
    const view = unifiedLibrary([local], [], { userId: 'user', folders: [folder('remote', '', 'Renamed')], documents: [] });
    expect(view.folders).toMatchObject([{ id: 'local', name: 'Renamed', cloudId: 'remote' }]);
  });
  it('includes nested descendants in folder mosaics and counts', () => {
    const folders = [folder('a'), folder('b', 'a')],
      docs = Array.from({ length: 6 }, (_, i) => cloud(String(i), 'b'));
    expect(cloudFolderPreview(folders, docs, 'a')).toMatchObject({ count: 6, more: 3 });
    expect(cloudFolderPreview(folders, docs, 'a').shown).toHaveLength(3);
  });
  it('rejects no-op, cyclic, and missing-target drag moves', () => {
    const fs = [folder('a'), folder('b', 'a')],
      ds = [cloud('doc', 'a')];
    expect(canMoveCloudItem(fs, ds, { kind: 'folder', id: 'a' }, 'b')).toBe(false);
    expect(canMoveCloudItem(fs, ds, { kind: 'document', id: 'doc' }, 'a')).toBe(false);
    expect(canMoveCloudItem(fs, ds, { kind: 'document', id: 'doc' }, 'missing')).toBe(false);
    expect(canMoveCloudItem(fs, ds, { kind: 'document', id: 'doc' }, 'b')).toBe(true);
  });
  it('distinguishes availability, saved local baseline, edits and remote changes', () => {
    const local = { ...doc('same'), cloudSource: { userId: 'user', documentId: 'same', revision: 'r1', savedModified: 2 } };
    const entry = unifiedLibrary([], [local], { userId: 'user', folders: [], documents: [cloud('same')] }).documents[0];
    expect(libraryDocumentStatus(entry)).toBe('Saved in cloud');
    entry.locals = [{ ...local, modified: 3 }];
    expect(libraryDocumentStatus(entry)).toBe('Unsaved cloud changes');
    entry.cloud = { ...entry.cloud!, revision: 'r2' };
    expect(libraryDocumentStatus(entry)).toBe('Cloud version changed');
  });
});
