// Versions and history: names of versions, when the history saves, what it keeps, what a restore puts back.

import { describe, expect, it } from 'vitest';
import type { CadDocument, DocumentVersion, Feature, PartStudioTab } from './types';
import {
  applyMerge,
  compareDocuments,
  contentHash,
  HISTORY_EVERY,
  HISTORY_KEEP,
  historyDue,
  historyOverflow,
  mergeDependents,
  mergeNeeds,
  mergePlan,
  nextVersionName,
  withVersionContent,
} from './versions';

const v = (over: Partial<DocumentVersion>): DocumentVersion => ({ id: 'x', docId: 'd', kind: 'version', name: '', created: 0, hash: 'h', ...over });
const doc = (tabs: CadDocument['tabs'], over: Partial<CadDocument> = {}): CadDocument =>
  ({ id: 'd', name: 'Doc', created: 0, modified: 0, units: { length: 'mm', angle: 'deg' }, tabs, activeTab: tabs[0]?.id ?? '', version: 1, ...over }) as CadDocument;
const studio = (id: string, n = 0) => ({ id, type: 'partStudio' as const, name: id, features: Array.from({ length: n }, (_, i) => ({ id: `f${i}`, type: 'variable', name: `V${i}`, params: { name: `v${i}`, value: '1', description: '' } })), rollback: null, parts: {} });

describe('versions', () => {
  it('names versions V1, V2… after the highest one; the history and other names do not count', () => {
    expect(nextVersionName([])).toBe('V1');
    expect(nextVersionName([v({ name: 'V2' }), v({ name: 'Release' }), v({ name: 'V7', kind: 'auto' })])).toBe('V3');
  });

  it('the history saves a changed document: when opened at once, while editing every while', () => {
    const now = 1_000_000_000;
    expect(historyDue([], 'a', 'edit', now)).toBe(true);
    // the same content as the newest snapshot: never
    expect(historyDue([v({ hash: 'a' })], 'a', 'open', now)).toBe(false);
    const recent = [v({ kind: 'auto', hash: 'a', created: now - HISTORY_EVERY / 2 })];
    expect(historyDue(recent, 'b', 'edit', now)).toBe(false);
    expect(historyDue(recent, 'b', 'open', now)).toBe(true);
    expect(historyDue(recent, 'b', 'restore', now)).toBe(true);
    expect(historyDue([v({ kind: 'auto', hash: 'a', created: now - HISTORY_EVERY })], 'b', 'edit', now)).toBe(true);
  });

  it('keeps the newest entries of the history and every version', () => {
    const list = Array.from({ length: HISTORY_KEEP + 3 }, (_, i) => v({ id: `a${i}`, kind: 'auto', created: -i }));
    const all = [v({ id: 'v1', name: 'V1' }), ...list, v({ id: 'v0', name: 'V0', created: -1000 })];
    expect(historyOverflow(all)).toEqual([`a${HISTORY_KEEP}`, `a${HISTORY_KEEP + 1}`, `a${HISTORY_KEEP + 2}`]);
  });

  it('compares content (units and tabs), not the name or the open tab', () => {
    const a = doc([studio('s1', 1), studio('s2')]);
    expect(contentHash({ ...a, name: 'Other', activeTab: 's2' })).toBe(contentHash(a));
    expect(contentHash(doc([studio('s1', 2), studio('s2')]))).not.toBe(contentHash(a));
    expect(contentHash({ ...a, units: { length: 'in', angle: 'deg' } })).not.toBe(contentHash(a));
  });

  it('compares two states of a document: tabs, features, parts, instances, the feature order', () => {
    const f =(id: string, depth: string, over: object = {}) => ({ id, type: 'extrude', name: `Extrude ${id}`, params: { depth }, ...over });
    const ps = (features: object[], over: object = {}) => ({ id: 'ps', type: 'partStudio', name: 'Studio', features, rollback: null, parts: {}, ...over });
    const before = doc([ps([f('1', '10 mm'), f('2', '5 mm'), f('3', '1 mm')]), { id: 'as', type: 'assembly', name: 'Rig', instances: [{ id: 'i1', name: 'A <1>', position: [0, 0, 0] }] }, { id: 'old', type: 'assembly', name: 'Old', instances: [] }] as never);
    const after = doc(
      [
        ps([f('2', '5 mm', { suppressed: true }), f('1', '20 mm', { name: 'Base' }), f('4', '3 mm')], { parts: { p: { name: 'Plate' } } }),
        { id: 'as', type: 'assembly', name: 'Rig', instances: [{ id: 'i1', name: 'A <1>', position: [0, 5, 0] }, { id: 'i2', name: 'B <1>', position: [0, 0, 0] }] },
        { id: 'dw', type: 'drawing', name: 'Drawing 1', drawing: { views: [], dimensions: [], notes: [] } },
      ] as never,
      { units: { length: 'in', angle: 'deg' } },
    );
    const d = compareDocuments(before, after);
    expect(d.units).toEqual({ from: 'mm, deg', to: 'in, deg' });
    const studio = d.tabs.find((t) => t.name === 'Studio')!;
    expect(studio.keys).toEqual(['order']);
    expect(studio.items).toEqual([
      { kind: 'changed', what: 'feature', name: 'Extrude 2', type: 'extrude', keys: ['suppressed'] },
      { kind: 'changed', what: 'feature', name: 'Base', type: 'extrude', keys: ['depth'], from: 'Extrude 1' },
      { kind: 'added', what: 'feature', name: 'Extrude 4', type: 'extrude' },
      { kind: 'removed', what: 'feature', name: 'Extrude 3', type: 'extrude' },
      { kind: 'added', what: 'part', name: 'Plate' },
    ]);
    expect(d.tabs.find((t) => t.name === 'Rig')!.items).toEqual([
      { kind: 'changed', what: 'instance', name: 'A <1>', keys: ['position'] },
      { kind: 'added', what: 'instance', name: 'B <1>' },
    ]);
    expect(d.tabs.filter((t) => t.kind !== 'changed').map((t) => [t.kind, t.name])).toEqual([
      ['added', 'Drawing 1'],
      ['removed', 'Old'],
    ]);
    // nothing changed: nothing to show
    expect(compareDocuments(before, structuredClone(before))).toEqual({ tabs: [] });
  });

  it('a restore puts back tabs and units; the name stays, and the open tab if the version has it', () => {
    const work = doc([studio('s1', 3), studio('s3')], { name: 'Renamed', activeTab: 's3', units: { length: 'in', angle: 'deg' } });
    const snap = doc([studio('s1', 1), studio('s2')], { activeTab: 's2' });
    const r = withVersionContent(work, snap);
    expect(r.name).toBe('Renamed');
    expect(r.tabs).toEqual(snap.tabs);
    expect(r.tabs).not.toBe(snap.tabs);
    expect(r.units).toEqual({ length: 'mm', angle: 'deg' });
    // its open tab is gone in the version: the version's own
    expect(r.activeTab).toBe('s2');
    expect(withVersionContent({ ...work, activeTab: 's1' }, snap).activeTab).toBe('s1');
  });
});

describe('branches and merges', () => {
  // the base version V1: studios a, b, c
  const base = doc([studio('a', 1), studio('b', 1), studio('c', 1)]);

  it('merges what the branch changed since its version; a tab changed on both sides is a conflict', () => {
    // the branch: a changed, c deleted, d new; the open workspace (Main): b changed, a changed too
    const branch = doc([studio('a', 2), studio('b', 1), studio('d', 1)]);
    const main = doc([studio('a', 3), studio('b', 2), studio('c', 1)]);
    const plan = mergePlan(base, branch, main);
    const byId = Object.fromEntries(plan.tabs.map((m) => [m.id, [m.change, m.conflict]]));
    expect(byId).toEqual({ a: ['changed', true], c: ['removed', false], d: ['added', false] });
    // b: changed only in Main — not the branch's to bring
    expect(byId.b).toBeUndefined();
    expect(plan.units).toBeUndefined();
    // a: merged feature by feature — the feature the branch added Main has added too, the same
    expect(plan.tabs[0].items).toEqual([]);
    // all taken: a as merged (Main's three features), no c, d added at the end; Main's own b stays
    const all = applyMerge(main, branch, plan, new Set(['a', 'c', 'd']), false, base);
    expect(all.tabs.map((t) => [t.id, t.type === 'partStudio' ? t.features.length : 0])).toEqual([
      ['a', 3],
      ['b', 2],
      ['d', 1],
    ]);
    // the conflict left out: Main's a stays
    const some = applyMerge(main, branch, plan, new Set(['c', 'd']), false);
    expect(some.tabs.find((t) => t.id === 'a')).toEqual(main.tabs[0]);
  });

  it('takes the branch’s units when it changed them, and nothing when it changed nothing', () => {
    const inches = doc([studio('a', 1), studio('b', 1), studio('c', 1)], { units: { length: 'in', angle: 'deg' } });
    const plan = mergePlan(base, inches, base);
    expect(plan.tabs).toEqual([]);
    expect(plan.units).toEqual({ length: 'in', angle: 'deg' });
    expect(applyMerge(base, inches, plan, new Set(), true).units.length).toBe('in');
    expect(applyMerge(base, inches, plan, new Set(), false).units.length).toBe('mm');
    // the branch as its version was: nothing to merge
    expect(mergePlan(base, base, doc([studio('a', 5)]))).toEqual({ tabs: [] });
  });

  describe('a Part Studio changed on both sides: feature by feature', () => {
    const f = (id: string, type: string, params: object) => ({ id, type, name: id, params }) as unknown as Feature;
    const ps = (features: Feature[], over: Partial<PartStudioTab> = {}): PartStudioTab => ({ id: 'p', type: 'partStudio', name: 'P', features, rollback: null, parts: {}, ...over });
    const h = f('h', 'variable', { name: 'h', value: '10', description: '' });
    const s1 = f('s1', 'sketch', { entities: [] });
    const e1 = f('e1', 'extrude', { sketch: 's1', depth: '#h' });
    const v1 = doc([ps([h, s1, e1])]);
    // the branch: deeper e1, a variable w and a sketch s2 extruded by #w after it; the tab renamed, a part's colour
    const w = f('w', 'variable', { name: 'w', value: '5', description: '' });
    const s2 = f('s2', 'sketch', { entities: [] });
    const e2 = f('e2', 'extrude', { sketch: 's2', depth: '#w' });
    const deeper = { ...e1, params: { sketch: 's1', depth: '#h*2' } } as Feature;
    const branch = doc([ps([h, s1, deeper, w, s2, e2], { name: 'P2', parts: { 'e1.0': { color: '#ff0000' } } })]);
    // Main: h changed, a fillet of e1's part after it, s1 hidden, the rollback bar after e1
    const fil = f('fil', 'fillet', { edges: [{ partId: 'e1.0' }] });
    const h12 = { ...h, params: { name: 'h', value: '12', description: '' } } as Feature;
    const main = doc([ps([h12, s1, e1, fil], { hidden: ['s1'], rollback: 3, parts: { 'fil.0': { name: 'Mine' } } })]);

    it('lists what the branch did to each feature, what they refer to, and the tab’s own keys', () => {
      const m = mergePlan(v1, branch, main).tabs[0];
      expect(m.items!.map((x) => [x.id, x.change, x.conflict ?? null, x.needs])).toEqual([
        ['e1', 'changed', null, []],
        ['w', 'added', null, []],
        ['s2', 'added', null, []],
        ['e2', 'added', null, ['w', 's2']],
      ]);
      expect(m.keys).toEqual(['name', 'parts']);
      // Main's own part changed — not the branch's: no conflict; the same part recoloured in Main: a conflict
      expect(m.keysConflict).toBeUndefined();
      const blue = doc([ps([h12, s1, e1, fil], { parts: { 'e1.0': { color: '#0000ff' } } })]);
      expect(mergePlan(v1, branch, blue).tabs[0].keysConflict).toBe(true);
      // taken with e2: what it refers to; left out with s2: what refers to it
      expect(mergeNeeds(m.items!, 'e2')).toEqual(['w', 's2']);
      expect(mergeDependents(m.items!, 's2')).toEqual(['e2']);
      expect(mergeDependents(m.items!, 'e1')).toEqual([]);
    });

    it('takes the chosen features into Main’s, after the feature before them in the branch', () => {
      const plan = mergePlan(v1, branch, main);
      const all = applyMerge(main, branch, plan, new Set(['p', 'p/e1', 'p/w', 'p/s2', 'p/e2']), false, v1).tabs[0] as PartStudioTab;
      expect(all.features.map((x) => x.id)).toEqual(['h', 's1', 'e1', 'w', 's2', 'e2', 'fil']);
      // Main's own changes stay: h, the fillet, s1 hidden; the branch's: e1, the name, its part's colour
      expect(all.features[0]).toEqual(h12);
      expect(all.features[2]).toEqual(deeper);
      expect(all.name).toBe('P2');
      expect(all.hidden).toEqual(['s1']);
      expect(all.parts).toEqual({ 'fil.0': { name: 'Mine' }, 'e1.0': { color: '#ff0000' } });
      // the rollback bar stays after e1
      expect(all.rollback).toBe(3);
      // only e1, not the tab's keys: Main's name and parts
      const one = applyMerge(main, branch, plan, new Set(['p/e1']), false, v1).tabs[0] as PartStudioTab;
      expect(one.features.map((x) => x.id)).toEqual(['h', 's1', 'e1', 'fil']);
      expect(one.features[2]).toEqual(deeper);
      expect([one.name, one.parts]).toEqual(['P', { 'fil.0': { name: 'Mine' } }]);
      // nothing taken: Main's tab as it was
      expect(applyMerge(main, branch, plan, new Set(), false, v1).tabs[0]).toEqual(main.tabs[0]);
    });

    it('marks a feature changed or removed on both sides, removes what the branch removed', () => {
      const mainE1 = { ...e1, params: { sketch: 's1', depth: '#h+1' } } as Feature;
      const changed = mergePlan(v1, branch, doc([ps([h, s1, mainE1])])).tabs[0];
      expect(changed.items![0]).toMatchObject({ id: 'e1', conflict: 'changed' });
      const removed = mergePlan(v1, branch, doc([ps([h, s1])])).tabs[0];
      expect(removed.items![0]).toMatchObject({ id: 'e1', conflict: 'removed' });
      // taken: back from the branch, after s1
      const back = applyMerge(doc([ps([h, s1, fil])]), branch, { tabs: [removed] }, new Set(['p/e1']), false, v1).tabs[0] as PartStudioTab;
      expect(back.features.map((x) => x.id)).toEqual(['h', 's1', 'e1', 'fil']);
      // the branch removed s1 and e1: gone from Main too when taken
      const cut = doc([ps([h], { name: 'P' })]);
      const plan = mergePlan(v1, cut, main);
      expect(plan.tabs[0].items!.map((x) => [x.id, x.change])).toEqual([
        ['s1', 'removed'],
        ['e1', 'removed'],
      ]);
      const gone = applyMerge(main, cut, plan, new Set(['p/s1', 'p/e1']), false, v1).tabs[0] as PartStudioTab;
      expect(gone.features.map((x) => x.id)).toEqual(['h', 'fil']);
      // the rollback bar was after e1: now after h, the feature before it Main still has
      expect(gone.rollback).toBe(1);
    });

    it('merges a feature changed on both sides field by field, the branch’s where both changed the same', () => {
      // Main renamed e1 and disabled it, the branch made it deeper: both
      const mainE1 = { ...e1, name: 'Block', suppressed: true } as Feature;
      const main2 = doc([ps([h, s1, mainE1])]);
      const plan = mergePlan(v1, branch, main2);
      const x = plan.tabs[0].items!.find((i) => i.id === 'e1')!;
      expect([x.conflict, x.clash]).toEqual(['changed', undefined]);
      const merged = (applyMerge(main2, branch, plan, new Set(['p/e1']), false, v1).tabs[0] as PartStudioTab).features[2];
      expect(merged).toEqual({ ...deeper, name: 'Block', suppressed: true });
      // both changed the depth: the branch's, said so
      const main3 = doc([ps([h, s1, { ...mainE1, params: { sketch: 's1', depth: '#h+1' } } as Feature])]);
      const plan3 = mergePlan(v1, branch, main3);
      expect(plan3.tabs[0].items![0].clash).toEqual(['depth']);
      expect((applyMerge(main3, branch, plan3, new Set(['p/e1']), false, v1).tabs[0] as PartStudioTab).features[2]).toEqual({ ...deeper, name: 'Block', suppressed: true });
    });

    it('takes a sketch’s geometry as one when both changed it', () => {
      const sk = (entities: unknown[], constraints: unknown[], name = 'S') => ({ id: 'sk', type: 'sketch', name, params: { plane: 'XY', entities, constraints } }) as unknown as Feature;
      const p1 = { id: 'p1', type: 'point', x: 0, y: 0 };
      const p2 = { id: 'p2', type: 'point', x: 5, y: 0 };
      const was = doc([ps([sk([p1], [])])]);
      // the branch added a point, Main fixed the first one and renamed the sketch: the branch's geometry, Main's name
      const src = doc([ps([sk([p1, p2], [])])]);
      const dst = doc([ps([sk([p1], [{ id: 'c1', type: 'fix', entities: ['p1'] }], 'Mine')])]);
      const plan = mergePlan(was, src, dst);
      expect(plan.tabs[0].items![0].clash).toEqual(['entities']);
      const out = (applyMerge(dst, src, plan, new Set(['p/sk']), false, was).tabs[0] as PartStudioTab).features[0];
      expect(out).toEqual(sk([p1, p2], [], 'Mine'));
    });
  });

  describe('assemblies and drawings: item by item', () => {
    const inst = (id: string, over: object = {}) => ({ id, name: id, partStudio: 'p', partId: 'x', position: [0, 0, 0], rotation: [0, 0, 0], ...over });
    const mate = (id: string, a: string, b: string) => ({ id, name: id, type: 'fastened', a: { instance: a }, b: { instance: b } });
    const asm = (instances: object[], mates: object[] = [], over: object = {}) => ({ id: 'a', type: 'assembly', name: 'A', instances, mates, ...over }) as unknown as CadDocument['tabs'][number];

    it('takes instances and mates one by one, an instance with the changes of both', () => {
      const was = doc([asm([inst('i1')], [])]);
      // the branch: i1 renamed, i2 and a mate of the two; Main: i1 moved, its own i3
      const src = doc([asm([inst('i1', { name: 'Base' }), inst('i2')], [mate('m1', 'i1', 'i2')])]);
      const dst = doc([asm([inst('i1', { position: [10, 0, 0] }), inst('i3')], [])]);
      const plan = mergePlan(was, src, dst);
      const items = plan.tabs[0].items!;
      expect(items.map((x) => [x.id, x.what, x.change, x.conflict ?? null, x.needs])).toEqual([
        ['i1', 'instance', 'changed', 'changed', []],
        ['i2', 'instance', 'added', null, []],
        ['m1', 'mate', 'added', null, ['i2']],
      ]);
      // the mate comes with i2 (Main has i1 already); left out with i2
      expect(mergeNeeds(items, 'm1')).toEqual(['i2']);
      expect(mergeDependents(items, 'i2')).toEqual(['m1']);
      const out = applyMerge(dst, src, plan, new Set(['a/i1', 'a/i2', 'a/m1']), false, was).tabs[0] as unknown as { instances: { id: string; name: string; position: number[] }[]; mates: { id: string }[] };
      expect(out.instances.map((i) => [i.id, i.name, i.position[0]])).toEqual([
        ['i1', 'Base', 10],
        ['i2', 'i2', 0],
        ['i3', 'i3', 0],
      ]);
      expect(out.mates.map((m) => m.id)).toEqual(['m1']);
    });

    it('removes an instance with the mates that held it', () => {
      const was = doc([asm([inst('i1'), inst('i2')], [mate('m1', 'i1', 'i2')])]);
      const src = doc([asm([inst('i2')], [])]);
      const plan = mergePlan(was, src, was);
      const items = plan.tabs[0].items!;
      expect(items.map((x) => [x.id, x.change, x.needs])).toEqual([
        ['i1', 'removed', ['m1']],
        ['m1', 'removed', []],
      ]);
      // keeping the mate keeps the instance
      expect(mergeDependents(items, 'm1')).toEqual(['i1']);
      const out = applyMerge(was, src, plan, new Set(['a/i1', 'a/m1']), false, was).tabs[0] as unknown as { instances: { id: string }[]; mates: unknown[] };
      expect([out.instances.map((i) => i.id), out.mates]).toEqual([['i2'], []]);
    });

    it('merges a drawing’s views and dimensions one by one, its sheet and title block as its own keys', () => {
      const dw = (drawing: object, name = 'D') =>
        ({ id: 'd', type: 'drawing', name, drawing: { sheet: 'A4', landscape: true, views: [], dimensions: [], notes: [], title: 'T', author: '', ...drawing } }) as unknown as CadDocument['tabs'][number];
      const v1v = { id: 'v1', orientation: 'front', x: 0, y: 0, scale: 1 };
      const v2v = { id: 'v2', orientation: 'top', x: 0, y: 50, scale: 1 };
      const dim = { id: 'dm', viewId: 'v2', kind: 'linear' };
      const was = doc([dw({ views: [v1v] })]);
      // the branch: a top view with a dimension, its own title; Main: A3
      const src = doc([dw({ views: [v1v, v2v], dimensions: [dim], title: 'Bracket' })]);
      const dst = doc([dw({ views: [v1v], sheet: 'A3' })]);
      const plan = mergePlan(was, src, dst);
      const m = plan.tabs[0];
      expect(m.items!.map((x) => [x.id, x.what, x.change, x.needs])).toEqual([
        ['v2', 'view', 'added', []],
        ['dm', 'dimension', 'added', ['v2']],
      ]);
      expect([m.keys, m.keysConflict]).toEqual([['title'], undefined]);
      const out = applyMerge(dst, src, plan, new Set(['d', 'd/v2', 'd/dm']), false, was).tabs[0] as unknown as { drawing: { sheet: string; title: string; views: { id: string }[]; dimensions: { id: string }[] } };
      expect([out.drawing.sheet, out.drawing.title, out.drawing.views.map((v) => v.id), out.drawing.dimensions.map((d) => d.id)]).toEqual(['A3', 'Bracket', ['v1', 'v2'], ['dm']]);
    });
  });

  describe('a Part Studio reordered', () => {
    const f = (id: string, type: string, params: object) => ({ id, type, name: id, params }) as unknown as Feature;
    const ps = (features: Feature[], over: Partial<PartStudioTab> = {}): PartStudioTab => ({ id: 'p', type: 'partStudio', name: 'P', features, rollback: null, parts: {}, ...over });
    const h = f('h', 'variable', { name: 'h', value: '10', description: '' });
    const s1 = f('s1', 'sketch', { entities: [] });
    const e1 = f('e1', 'extrude', { sketch: 's1', depth: '#h' });
    const v1 = doc([ps([h, s1, e1])]);
    const main = doc([ps([h, s1, e1, f('fil', 'fillet', {})])]);

    it('takes the tab whole when the branch reordered its features', () => {
      const reordered = doc([ps([s1, h, e1])]);
      const m = mergePlan(v1, reordered, main).tabs[0];
      expect(m.items).toBeUndefined();
      expect((applyMerge(main, reordered, mergePlan(v1, reordered, main), new Set(['p']), false, v1).tabs[0] as PartStudioTab).features.map((x) => x.id)).toEqual(['s1', 'h', 'e1']);
    });
  });

  it('without a base, brings every tab that differs, and keeps the tabs only the target has', () => {
    const src = doc([studio('a', 2), studio('n', 1)]);
    const dst = doc([studio('a', 1), studio('own', 1)]);
    const plan = mergePlan(null, src, dst);
    expect(plan.tabs.map((m) => [m.id, m.change, m.conflict])).toEqual([
      ['a', 'changed', false],
      ['n', 'added', false],
    ]);
    // the open tab stays where it is still there
    expect(applyMerge({ ...dst, activeTab: 'own' }, src, plan, new Set(['a', 'n']), false).activeTab).toBe('own');
  });
});
