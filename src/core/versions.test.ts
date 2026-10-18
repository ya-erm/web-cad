// Versions and history: names of versions, when the history saves, what it keeps, what a restore puts back.

import { describe, expect, it } from 'vitest';
import type { CadDocument, DocumentVersion } from './types';
import { compareDocuments, contentHash, HISTORY_EVERY, HISTORY_KEEP, historyDue, historyOverflow, nextVersionName, withVersionContent } from './versions';

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
