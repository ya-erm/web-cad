// A folder on the computer: its project files — at every level of its subfolders — listed, read, written and moved,
// its subfolders made, renamed and moved (an in-memory folder stands for the disk: with the browser's `move`, and
// without it, when a copy and a removal stand for it).

import { describe, expect, it } from 'vitest';
import {
  baseOf,
  byPath,
  dirOf,
  fileStamp,
  freeFileName,
  freeFolderName,
  joinPath,
  listFolder,
  makeSubfolder,
  moveFolderFile,
  movedPath,
  moveSubfolder,
  readFolderFile,
  sameStamp,
  within,
  writeFolderFile,
} from './localFolder';
import { namesIn, parseProject, projectText, readProject, sameContent, subfoldersOf } from './folderStore';
import type { CadDocument } from '../core/types';
import { docId } from '../core/ids';

interface FakeFile {
  kind: 'file';
  text: string;
  modified: number;
}
interface FakeDir {
  kind: 'directory';
  entries: Record<string, FakeFile | FakeDir>;
}
/** A folder as it is written in a test: a file (`file(…)`) or a subfolder (an object) by name. */
type Spec = { [name: string]: FakeFile | Spec };

const file = (text: string, modified = 1): FakeFile => ({ kind: 'file', text, modified });
const build = (spec: Spec): FakeDir => ({
  kind: 'directory',
  entries: Object.fromEntries(Object.entries(spec).map(([n, v]) => [n, v.kind === 'file' ? (v as FakeFile) : build(v as Spec)])),
});
/** The disk as a spec again: what is where now. */
const show = (d: FakeDir): Spec => Object.fromEntries(Object.entries(d.entries).map(([n, v]) => [n, v.kind === 'file' ? v.text : show(v)])) as unknown as Spec;

const notFound = () => new DOMException('not found', 'NotFoundError');
const mismatch = () => new DOMException('another kind', 'TypeMismatchError');

/** A folder of the in-memory disk; `move` — whether its handles can be moved (Chrome on some file systems cannot). */
function fakeFolder(root: FakeDir, { move = true, name = 'Models' } = {}): FileSystemDirectoryHandle {
  let clock = 1000;
  type Any = Record<string, unknown>;
  const fileHandle = (parent: FakeDir, name: string): Any => {
    const at = { parent, name };
    const node = () => at.parent.entries[at.name] as FakeFile;
    return {
      kind: 'file',
      get name() {
        return at.name;
      },
      getFile: async () => {
        const n = node();
        return { lastModified: n.modified, size: n.text.length, text: async () => n.text };
      },
      createWritable: async () => {
        let buf = '';
        return {
          write: async (s: string | { text(): Promise<string> }) => void (buf += typeof s === 'string' ? s : await s.text()),
          close: async () => void (at.parent.entries[at.name] = file(buf, ++clock)),
        };
      },
      ...(move && {
        move: async (a: string | Any, b?: string) => {
          const [dest, to] = typeof a === 'string' ? [at.parent, a] : [a._node as FakeDir, b!];
          const n = node();
          delete at.parent.entries[at.name];
          dest.entries[to] = n;
          Object.assign(at, { parent: dest, name: to });
        },
      }),
    };
  };
  const dirHandle = (node: FakeDir, name: string, parent?: FakeDir): FileSystemDirectoryHandle =>
    ({
      kind: 'directory',
      name,
      _node: node,
      async *values() {
        for (const [n, e] of Object.entries(node.entries)) yield e.kind === 'file' ? fileHandle(node, n) : dirHandle(e, n, node);
      },
      getFileHandle: async (n: string, o?: { create?: boolean }) => {
        const e = node.entries[n];
        if (e?.kind === 'directory') throw mismatch();
        if (!e) {
          if (!o?.create) throw notFound();
          node.entries[n] = file('', ++clock);
        }
        return fileHandle(node, n);
      },
      getDirectoryHandle: async (n: string, o?: { create?: boolean }) => {
        const e = node.entries[n];
        if (e?.kind === 'file') throw mismatch();
        if (!e) {
          if (!o?.create) throw notFound();
          node.entries[n] = { kind: 'directory', entries: {} };
        }
        return dirHandle(node.entries[n] as FakeDir, n, node);
      },
      removeEntry: async (n: string, o?: { recursive?: boolean }) => {
        const e = node.entries[n];
        if (!e) throw notFound();
        if (e.kind === 'directory' && Object.keys(e.entries).length && !o?.recursive) throw new DOMException('not empty', 'InvalidModificationError');
        delete node.entries[n];
      },
      isSameEntry: async (o: Any) => o._node === node,
      ...(move &&
        parent && {
          move: async (a: string | Any, b?: string) => {
            const [dest, to] = typeof a === 'string' ? [parent, a] : [a._node as FakeDir, b!];
            delete parent.entries[name];
            dest.entries[to] = node;
          },
        }),
    }) as unknown as FileSystemDirectoryHandle;
  return dirHandle(root, name);
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
  it('lists its project files at every level, the latest changed first, and every subfolder', async () => {
    const disk = build({
      'Bracket.webcad.json': file('{}', 10),
      'notes.txt': file('x', 50),
      'Lid.WEBCAD.JSON': file('{}', 30),
      Parts: {
        'Gear.webcad.json': file('{}', 40),
        Small: { 'Pin.webcad.json': file('{}', 20) },
        Empty: {},
      },
      // a folder with the extension is a folder, not a file
      'old.webcad.json': {},
      // hidden folders and installed packages are not looked into
      '.git': { 'HEAD.webcad.json': file('{}', 99) },
      node_modules: { 'x.webcad.json': file('{}', 98) },
    });
    const { files, dirs } = await listFolder(fakeFolder(disk));
    expect(files.map((f) => [f.name, f.title, f.modified])).toEqual([
      ['Parts/Gear.webcad.json', 'Gear', 40],
      ['Lid.WEBCAD.JSON', 'Lid', 30],
      ['Parts/Small/Pin.webcad.json', 'Pin', 20],
      ['Bracket.webcad.json', 'Bracket', 10],
    ]);
    expect(dirs).toEqual(['old.webcad.json', 'Parts', 'Parts/Empty', 'Parts/Small']);
  });

  it('knows what is right in each subfolder', async () => {
    const disk = build({ 'A.webcad.json': file('{}'), Parts: { 'B.webcad.json': file('{}'), Small: { 'C.webcad.json': file('{}') } } });
    const tree = await listFolder(fakeFolder(disk));
    expect(namesIn(tree, '').sort()).toEqual(['A.webcad.json', 'Parts']);
    expect(namesIn(tree, 'Parts').sort()).toEqual(['B.webcad.json', 'Small']);
    expect(namesIn(tree, 'Parts/Small')).toEqual(['C.webcad.json']);
    expect(subfoldersOf(tree, '')).toEqual(['Parts']);
    expect(subfoldersOf(tree, 'Parts')).toEqual(['Parts/Small']);
    expect(subfoldersOf(tree, 'Parts/Small')).toEqual([]);
  });

  it('sorts subfolders as a tree, names as people sort them', () => {
    expect(['Part 10', 'A B', 'Part 2', 'A/B', 'a', 'A/B/C'].sort(byPath)).toEqual(['a', 'A/B', 'A/B/C', 'A B', 'Part 2', 'Part 10']);
  });

  it('works with paths inside the folder', () => {
    expect(joinPath('', 'A.webcad.json')).toBe('A.webcad.json');
    expect(joinPath('Parts/Small', 'A.webcad.json')).toBe('Parts/Small/A.webcad.json');
    expect(dirOf('A.webcad.json')).toBe('');
    expect(dirOf('Parts/Small/A.webcad.json')).toBe('Parts/Small');
    expect(baseOf('Parts/Small/A.webcad.json')).toBe('A.webcad.json');
    expect(baseOf('A.webcad.json')).toBe('A.webcad.json');
    expect(within('Parts/Small/A.webcad.json', 'Parts')).toBe(true);
    expect(within('Parts', 'Parts')).toBe(true);
    expect(within('Parts 2/A.webcad.json', 'Parts')).toBe(false);
    expect(within('Anything', '')).toBe(true);
    expect(movedPath('Parts/Small/A.webcad.json', 'Parts', 'Old/Parts')).toBe('Old/Parts/Small/A.webcad.json');
    expect(movedPath('Parts', 'Parts', 'Details')).toBe('Details');
  });

  it('writes and reads a document as its project file — in a subfolder too, making it', async () => {
    const disk = build({});
    const dir = fakeFolder(disk);
    await writeFolderFile(dir, 'Bracket.webcad.json', projectText(doc));
    expect(parseProject(await readFolderFile(dir, 'Bracket.webcad.json'), 'Bracket')).toEqual(doc);
    // a second write replaces the file
    await writeFolderFile(dir, 'Bracket.webcad.json', projectText({ ...doc, name: 'Bracket 2' }));
    expect(parseProject(await readFolderFile(dir, 'Bracket.webcad.json'), 'x').name).toBe('Bracket 2');
    // a subfolder that is not there yet is made
    await writeFolderFile(dir, 'Parts/Small/Pin.webcad.json', projectText({ ...doc, name: 'Pin' }));
    expect(parseProject(await readFolderFile(dir, 'Parts/Small/Pin.webcad.json'), 'x').name).toBe('Pin');
    expect(Object.keys(show(disk))).toEqual(['Bracket.webcad.json', 'Parts']);
    await expect(readFolderFile(dir, 'Parts/Gone.webcad.json')).rejects.toThrow();
  });

  it("sees another program's change of a file, and whether it changed the document", async () => {
    const disk = build({});
    const dir = fakeFolder(disk);
    await writeFolderFile(dir, 'Parts/Bracket.webcad.json', projectText(doc));
    const ours = await fileStamp(dir, 'Parts/Bracket.webcad.json');
    expect(sameStamp(ours, await fileStamp(dir, 'Parts/Bracket.webcad.json'))).toBe(true);
    // another program: the same size, a later time — or another size
    const parts = disk.entries.Parts as FakeDir;
    parts.entries['Bracket.webcad.json'] = file((parts.entries['Bracket.webcad.json'] as FakeFile).text, 5000);
    expect(sameStamp(ours, await fileStamp(dir, 'Parts/Bracket.webcad.json'))).toBe(false);
    expect(sameStamp(ours, { modified: ours.modified, size: ours.size + 1 })).toBe(false);
    // its content: the same document saved again (another time, another tab open) — or really changed
    const again = parseProject(projectText({ ...doc, modified: 500, activeTab: 'other' }), 'x');
    expect(sameContent(again, doc)).toBe(true);
    expect(sameContent(parseProject(projectText({ ...doc, name: 'Bracket 2' }), 'x'), doc)).toBe(false);
  });

  for (const move of [true, false])
    describe(move ? 'where the browser moves files and folders' : 'where the browser cannot move them (a copy, then the old one removed)', () => {
      it('renames a file in its subfolder and moves it into another one, its content staying', async () => {
        const disk = build({ Parts: { 'A.webcad.json': file('{"a":1}', 7) }, Old: {} });
        const dir = fakeFolder(disk, { move });
        expect(await moveFolderFile(dir, 'Parts/A.webcad.json', 'Parts/B.webcad.json')).toBe('Parts/B.webcad.json');
        expect(show(disk)).toEqual({ Parts: { 'B.webcad.json': '{"a":1}' }, Old: {} });
        expect(await moveFolderFile(dir, 'Parts/B.webcad.json', 'Old/Deep/B.webcad.json')).toBe('Old/Deep/B.webcad.json');
        expect(show(disk)).toEqual({ Parts: {}, Old: { Deep: { 'B.webcad.json': '{"a":1}' } } });
        expect(await moveFolderFile(dir, 'Old/Deep/B.webcad.json', 'B.webcad.json')).toBe('B.webcad.json');
        expect(show(disk)).toEqual({ Parts: {}, Old: { Deep: {} }, 'B.webcad.json': '{"a":1}' });
        // the same place: nothing happens
        expect(await moveFolderFile(dir, 'B.webcad.json', 'B.webcad.json')).toBe('B.webcad.json');
      });

      it('moves a file into another folder', async () => {
        const a = build({ 'A.webcad.json': file('{"a":1}') });
        const b = build({ Parts: {} });
        expect(await moveFolderFile(fakeFolder(a, { move }), 'A.webcad.json', 'Parts/A.webcad.json', fakeFolder(b, { move, name: 'Other' }))).toBe('Parts/A.webcad.json');
        expect(show(a)).toEqual({});
        expect(show(b)).toEqual({ Parts: { 'A.webcad.json': '{"a":1}' } });
      });

      it('renames a subfolder and moves it into another one with everything in it', async () => {
        const disk = build({ Parts: { 'A.webcad.json': file('{"a":1}'), 'photo.png': file('PNG'), Small: { 'B.webcad.json': file('{"b":2}') } }, Old: {} });
        const dir = fakeFolder(disk, { move });
        expect(await moveSubfolder(dir, 'Parts', 'Details')).toBe('Details');
        const content = { 'A.webcad.json': '{"a":1}', 'photo.png': 'PNG', Small: { 'B.webcad.json': '{"b":2}' } };
        expect(show(disk)).toEqual({ Details: content, Old: {} });
        expect(await moveSubfolder(dir, 'Details', 'Old/Details')).toBe('Old/Details');
        expect(show(disk)).toEqual({ Old: { Details: content } });
        await makeSubfolder(dir, 'Old/Details/Small/Deeper');
        expect(show(disk)).toEqual({ Old: { Details: { ...content, Small: { ...content.Small, Deeper: {} } } } });
      });

      it('does not move a subfolder into itself or over what is there', async () => {
        const disk = build({ Parts: { Small: {} }, 'Other.webcad.json': file('{}'), Other: {} });
        const dir = fakeFolder(disk, { move });
        await expect(moveSubfolder(dir, 'Parts', 'Parts/Small/Parts')).rejects.toThrow();
        await expect(moveSubfolder(dir, 'Parts', 'Other')).rejects.toThrow();
        await expect(moveSubfolder(dir, 'Parts', 'Other.webcad.json')).rejects.toThrow();
        expect(show(disk)).toEqual({ Parts: { Small: {} }, 'Other.webcad.json': '{}', Other: {} });
      });
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

  it('names a new subfolder, not over what is in its folder and not hidden', () => {
    expect(freeFolderName('Parts', [])).toBe('Parts');
    expect(freeFolderName('Parts', ['parts', 'Parts (2)'])).toBe('Parts (3)');
    expect(freeFolderName('a/b: c?', [])).toBe('a_b_ c_');
    // a leading dot would hide it from the list
    expect(freeFolderName('.hidden', [])).toBe('hidden');
    expect(freeFolderName(' .. ', [], 'New folder')).toBe('New folder');
    expect(freeFolderName('node_modules', ['New folder'], 'New folder')).toBe('New folder (2)');
  });
});
