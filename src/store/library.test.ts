import { describe, it, expect } from 'vitest';
import { folderTrail, validateLibraryChange, type LibraryFolder } from './library';
const f = (id: string, parentId = '', name = id): LibraryFolder => ({ id, parentId, name, created: 1, modified: 1 });
describe('library folder integrity', () => {
  it('builds stable breadcrumbs after renaming', () =>
    expect(folderTrail([f('a', '', 'Parts'), f('b', 'a', 'Fasteners')], 'b').map((f) => f.name)).toEqual(['Parts', 'Fasteners']));
  it('rejects descendant and self moves', () => {
    const fs = [f('a'), f('b', 'a')];
    for (const parentId of ['a', 'b'])
      expect(() => validateLibraryChange(fs, [], { kind: 'folder', folder: f('a', parentId) })).toThrow('itself');
  });
  it('rejects missing destinations and duplicate names in one parent', () => {
    expect(() => validateLibraryChange([], [], { kind: 'folder', folder: f('b', 'missing') })).toThrow('not found');
    expect(() => validateLibraryChange([f('a', '', 'Parts')], [], { kind: 'folder', folder: f('b', '', 'parts') })).toThrow(
      'already exists',
    );
  });
  it('keeps folders containing documents, including trash', () => {
    expect(() => validateLibraryChange([f('a')], [{ id: 'doc', folderId: 'a' }], { kind: 'remove', id: 'a' })).toThrow('empty');
    expect(() => validateLibraryChange([f('a'), f('b', 'a')], [], { kind: 'remove', id: 'a' })).toThrow('empty');
  });
  it('moves documents only to existing folders and supports the root', () => {
    expect(() => validateLibraryChange([], [{ id: 'doc' }], { kind: 'document', id: 'doc', folderId: '' })).not.toThrow();
    expect(() => validateLibraryChange([], [{ id: 'doc' }], { kind: 'document', id: 'doc', folderId: 'bad' })).toThrow();
  });
});
