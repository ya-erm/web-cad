// A folder on the computer: its project files listed, read and written (an in-memory folder stands for the disk).

import { describe, expect, it } from 'vitest';
import { fileStamp, freeFileName, listFolder, readFolderFile, sameStamp, writeFolderFile } from './localFolder';
import { parseProject, projectText, readProject, sameContent } from './folderStore';
import type { CadDocument } from '../core/types';
import { docId } from '../core/ids';

type Disk = Record<string, { text: string; modified: number }>;

function fakeFolder(disk: Disk): FileSystemDirectoryHandle {
  const file = (name: string) => ({
    kind: 'file',
    name,
    getFile: async () => ({ lastModified: disk[name].modified, size: disk[name].text.length, text: async () => disk[name].text }),
    createWritable: async () => {
      let buf = '';
      return {
        write: async (s: string) => void (buf += s),
        close: async () => void (disk[name] = { text: buf, modified: 99 }),
      };
    },
  });
  return {
    name: 'Models',
    async *values() {
      for (const name of Object.keys(disk)) yield file(name);
      yield { kind: 'directory', name: 'old.webcad.json' };
    },
    getFileHandle: async (name: string, o?: { create?: boolean }) => {
      if (!disk[name]) {
        if (!o?.create) throw new DOMException('not found', 'NotFoundError');
        disk[name] = { text: '', modified: 0 };
      }
      return file(name);
    },
  } as unknown as FileSystemDirectoryHandle;
}

const doc: CadDocument = {
  id: 'docA',
  name: 'Bracket',
  created: 1,
  modified: 2,
  units: { length: 'mm', angle: 'deg' },
  tabs: [],
  activeTab: '',
  version: 1,
};

describe('a folder on the computer', () => {
  it('lists its project files only, the latest changed first', async () => {
    const disk: Disk = {
      'Bracket.webcad.json': { text: '{}', modified: 10 },
      'notes.txt': { text: 'x', modified: 50 },
      'Lid.WEBCAD.JSON': { text: '{}', modified: 30 },
    };
    expect((await listFolder(fakeFolder(disk))).map((f) => [f.name, f.title, f.modified])).toEqual([
      ['Lid.WEBCAD.JSON', 'Lid', 30],
      ['Bracket.webcad.json', 'Bracket', 10],
    ]);
  });

  it('writes and reads a document as its project file', async () => {
    const disk: Disk = {};
    const dir = fakeFolder(disk);
    await writeFolderFile(dir, 'Bracket.webcad.json', projectText(doc));
    expect(parseProject(await readFolderFile(dir, 'Bracket.webcad.json'), 'Bracket')).toEqual(doc);
    // a second write replaces the file
    await writeFolderFile(dir, 'Bracket.webcad.json', projectText({ ...doc, name: 'Bracket 2' }));
    expect(parseProject(disk['Bracket.webcad.json'].text, 'x').name).toBe('Bracket 2');
  });

  it("sees another program's change of a file, and whether it changed the document", async () => {
    const disk: Disk = {};
    const dir = fakeFolder(disk);
    await writeFolderFile(dir, 'Bracket.webcad.json', projectText(doc));
    const ours = await fileStamp(dir, 'Bracket.webcad.json');
    expect(sameStamp(ours, await fileStamp(dir, 'Bracket.webcad.json'))).toBe(true);
    // another program: the same size, a later time — or another size
    disk['Bracket.webcad.json'] = { text: disk['Bracket.webcad.json'].text, modified: 150 };
    expect(sameStamp(ours, await fileStamp(dir, 'Bracket.webcad.json'))).toBe(false);
    expect(sameStamp(ours, { modified: ours.modified, size: ours.size + 1 })).toBe(false);
    // its content: the same document saved again (another time, another tab open) — or really changed
    const again = parseProject(projectText({ ...doc, modified: 500, activeTab: 'other' }), 'x');
    expect(sameContent(again, doc)).toBe(true);
    expect(sameContent(parseProject(projectText({ ...doc, name: 'Bracket 2' }), 'x'), doc)).toBe(false);
  });

  it('keeps the versions of a document in its project file, apart from the document', () => {
    const v1 = { id: 'vr1', name: 'V1', description: 'First', created: 5, units: doc.units, tabs: [], activeTab: '' };
    const text = projectText(doc, [v1]);
    expect(JSON.parse(text).versions).toEqual([v1]);
    const { doc: read, versions } = readProject(JSON.parse(text), 'x');
    expect(read).toEqual(doc);
    expect('versions' in read).toBe(false);
    expect(versions).toEqual([v1]);
    // none: the plain document, as before
    expect(JSON.parse(projectText(doc))).toEqual(doc);
    expect(readProject(JSON.parse(projectText(doc)), 'x').versions).toEqual([]);
  });

  it('keeps the workspaces the document is not in apart from its versions (`workspaces`)', () => {
    const v1 = { id: 'vr1', name: 'V1', created: 5, units: doc.units, tabs: [], activeTab: '' };
    const branch = { id: 'ws1', kind: 'workspace' as const, name: 'Branch 1', base: 'vr1', created: 9, units: doc.units, tabs: [], activeTab: '' };
    const file = JSON.parse(projectText({ ...doc, workspace: { id: 'main2', name: 'Main' } } as typeof doc, [v1, branch]));
    // older readers see the versions as before; the workspaces have no kind in the file
    expect(file.versions).toEqual([v1]);
    expect(file.workspaces).toEqual([{ id: 'ws1', name: 'Branch 1', base: 'vr1', created: 9, units: doc.units, tabs: [], activeTab: '' }]);
    const { doc: read, versions } = readProject(file, 'x');
    expect('workspaces' in read).toBe(false);
    expect(read.workspace).toEqual({ id: 'main2', name: 'Main' });
    expect(versions).toEqual([v1, branch]);
  });

  it('keeps its card picture in the project file (last), apart from the document', () => {
    const pic = 'data:image/png;base64,iVBORw0KGgo=';
    const text = projectText(doc, [], pic);
    const raw = JSON.parse(text);
    expect(raw.thumbnail).toBe(pic);
    expect(Object.keys(raw).at(-1)).toBe('thumbnail');
    const read = readProject(raw, 'x');
    expect(read.thumbnail).toBe(pic);
    expect('thumbnail' in read.doc).toBe(false);
    expect(read.doc).toEqual(doc);
    // none, or not a picture: nothing
    expect(readProject(JSON.parse(projectText(doc)), 'x').thumbnail).toBeUndefined();
    expect(readProject({ ...doc, thumbnail: 'javascript:alert(1)' }, 'x').thumbnail).toBeUndefined();
  });

  it('takes a project file without id or name, and refuses other JSON', () => {
    const p = parseProject(JSON.stringify({ units: doc.units, tabs: [] }), 'From disk');
    expect(p.name).toBe('From disk');
    expect(p.id).toMatch(/^doc/);
    expect(() => parseProject('{"a":1}', 'x')).toThrow('Invalid project file');
    expect(() => parseProject('not json', 'x')).toThrow();
  });

  it('gives a new document an id with the date and time it was made', () => {
    expect(docId(new Date(2026, 9, 18, 14, 35, 7))).toMatch(/^doc-20261018-143507-[0-9a-z]{4}$/);
    expect(docId()).not.toBe(docId());
  });

  it('names a new file after the document, not over an existing one', () => {
    expect(freeFileName('Bracket', [])).toBe('Bracket.webcad.json');
    expect(freeFileName('Bracket', ['bracket.webcad.json', 'Bracket (2).webcad.json'])).toBe('Bracket (3).webcad.json');
    expect(freeFileName('a/b: c?', [])).toBe('a_b_ c_.webcad.json');
    expect(freeFileName('  ', [])).toBe('Document.webcad.json');
  });
});
