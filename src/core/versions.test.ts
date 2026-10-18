// Versions and history: names of versions, when the history saves, what it keeps, what a restore puts back.

import { describe, expect, it } from 'vitest';
import type { CadDocument, DocumentVersion } from './types';
import { contentHash, HISTORY_EVERY, HISTORY_KEEP, historyDue, historyOverflow, nextVersionName, withVersionContent } from './versions';

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
