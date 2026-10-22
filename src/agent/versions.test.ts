// Agent API for versions and branches in Node (a project file's `versions` and `workspaces`) with the real kernel:
// save versions, branch from one, change the branch, switch back, merge it into Main — as the app's Versions panel does.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';
import { readProject } from '../store/folderStore';
import type { ModelSummary } from './types';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

const sizeOf = async (s: Awaited<ReturnType<typeof openHeadless>>) => ((await s.state()) as ModelSummary).parts[0].size;

describe('agent API: versions and branches', () => {
  it('saves versions, branches, switches and merges', async () => {
    const s = await openHeadless(emptyDocument('Versions test'), wasm);
    const r1 = await s.run([
      { op: 'variable', name: 'w', value: 40 },
      { op: 'sketch', name: 'Base', shapes: [{ type: 'rect', center: true, w: '#w', h: 30 }] },
      { op: 'extrude', name: 'Block', depth: 10 },
      { op: 'version', description: 'The block' },
    ]);
    expect(r1.error).toBeUndefined();
    expect(r1.model!.parts[0].size).toEqual([40, 30, 10]);
    expect(r1.versions!.versions.map((v) => [v.name, v.description])).toEqual([['V1', 'The block']]);
    expect(r1.versions!.workspace).toBe('Main');

    // a branch from V1: wider there
    const r2 = await s.run([{ op: 'branch', from: 'V1', name: 'Wide' }, { op: 'setVariable', name: 'w', value: 60 }, { op: 'version', name: 'Wide 1' }]);
    expect(r2.error).toBeUndefined();
    expect(r2.versions).toMatchObject({ workspace: 'Wide', base: 'V1', workspaces: [{ name: 'Main' }] });
    expect(r2.versions!.versions.map((v) => v.name)).toEqual(['V1', 'Wide 1']);
    expect(await sizeOf(s)).toEqual([60, 30, 10]);

    // back to Main: as it was; then taller there, and the branch merged in, feature by feature — both changes
    const r3 = await s.run([{ op: 'workspace', name: 'Main' }]);
    expect(r3.versions).toMatchObject({ workspace: 'Main', workspaces: [{ name: 'Wide', base: 'V1' }] });
    expect(await sizeOf(s)).toEqual([40, 30, 10]);
    const both = await s.run([{ op: 'set', feature: 'Block', params: { depth: '20' } }, { op: 'merge', from: 'Wide' }]);
    expect(both.error).toBeUndefined();
    expect(both.versions!.merged!.from).toBe('Wide');
    expect(both.versions!.merged!.tabs[0]).toMatchObject({ name: 'Part Studio 1', change: 'changed', conflict: true, items: 1 });
    expect(await sizeOf(s)).toEqual([60, 30, 20]);

    // the project file keeps them: the versions and the workspace the document is not in
    const { versions } = readProject(JSON.parse(JSON.stringify(s.doc)), 'x');
    expect(versions.map((v) => [v.name, v.kind ?? 'version'])).toEqual([
      ['V1', 'version'],
      ['Wide 1', 'version'],
      ['Wide', 'workspace'],
    ]);
    // the latest version can be derived from (Derived by version)
    const derived = await s.run([{ op: 'studio', name: 'Copy' }, { op: 'derived', studio: 'Part Studio 1', version: 'Wide 1' }]);
    expect(derived.error).toBeUndefined();
    expect(derived.model!.parts[0].size).toEqual([60, 30, 10]);
  }, 180000);

  it('says what is wrong, and keeps what was done before it', async () => {
    const s = await openHeadless(emptyDocument('Versions errors'), wasm);
    const bad = await s.run([{ op: 'version', name: 'A' }, { op: 'branch', from: 'Nope' }]);
    expect(bad.error).toMatch(/op #1 \(branch\): No version "Nope". Versions: A/);
    expect(s.versions().versions.map((v) => v.name)).toEqual(['A']);
    expect((await s.run([{ op: 'version', name: 'a' }])).error).toMatch(/There is a version "a" already/);
    expect((await s.run([{ op: 'workspace', name: 'Other' }])).error).toMatch(/No other workspace "Other". Workspaces: Main/);
    expect((await s.run([{ op: 'merge', from: 'Main' }])).error).toMatch(/No other workspace/);
  }, 120000);
});
