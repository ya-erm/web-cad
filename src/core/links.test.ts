import { describe, expect, it } from 'vitest';
import { derivedBuildOrder, prepareDerived, sourceStudio } from './derived';
import { featureLink, keepsCopyOf, linkableStudios, linkClosure, linkFingerprint, linkSourceId, makeLink, syncLinks } from './links';
import { mergePlan } from './versions';
import type { CadDocument, DocumentLink, Feature, PartStudioTab } from './types';

const derived = (id: string, studioId: string): Feature => ({ id, type: 'derived', name: id, params: { studioId, parts: [] } });
const variable = (id: string, value: string): Feature => ({ id, type: 'variable', name: id, params: { name: id, value, varType: 'length' } }) as Feature;
const studio = (id: string, features: Feature[], extra: Partial<PartStudioTab> = {}): PartStudioTab => ({ id, type: 'partStudio', name: id, features, rollback: null, parts: {}, ...extra });
const units: CadDocument['units'] = { length: 'mm', angle: 'deg' };
const docOf = (id: string, tabs: PartStudioTab[]): CadDocument => ({ id, name: `Doc ${id}`, created: 1, modified: 1, units, tabs, activeTab: tabs[0]?.id ?? '', version: 1 });
const studioIds = (tabs: PartStudioTab[]) => tabs.map((t) => t.id);

describe('Derived from another document: copies', () => {
  // document B: S derives from T (and from a version), U stands apart
  const B = () =>
    docOf('docB', [studio('S', [variable('v1', '10 mm'), derived('d1', 'T'), derived('d2', 'X@vr-other')]), studio('T', [variable('v2', '5 mm')]), studio('U', [variable('v3', '1 mm')])]);

  it('copies the Part Studio with those of the same document it derives from', () => {
    expect(studioIds(linkClosure(B().tabs, 'S'))).toEqual(['S', 'T']);
    expect(studioIds(linkClosure(B().tabs, 'T'))).toEqual(['T']);
    expect(linkClosure(B().tabs, 'nope')).toEqual([]);
    const link = makeLink(B(), 'S', 1000);
    expect(link).toMatchObject({ docId: 'docB', docName: 'Doc docB', copied: 1000, units });
    expect(studioIds(link.tabs)).toEqual(['S', 'T']);
    expect(link.id).not.toMatch(/[@#]/);
  });

  it('tells a changed source from the same one: its Part Studio and those it uses, not the others or how parts are shown', () => {
    const b = B();
    const link = makeLink(b, 'S');
    const fp = (d: Pick<CadDocument, 'tabs' | 'units'>) => linkFingerprint(d, 'S');
    expect(fp(link)).toBe(fp(b));
    // another Part Studio, a part hidden: the same
    const other = { ...b, tabs: b.tabs.map((t) => (t.id === 'U' ? { ...t, features: [variable('v3', '2 mm')] } : t)) };
    expect(fp(other)).toBe(fp(link));
    const hidden = { ...b, tabs: b.tabs.map((t) => (t.id === 'S' ? { ...t, parts: { p1: { hidden: true, opacity: 0.5 } } } : t)) };
    expect(fp(hidden)).toBe(fp(b));
    // its own feature, a Part Studio it derives from, a part's name, the units: changed
    const own = { ...b, tabs: b.tabs.map((t) => (t.id === 'S' ? { ...t, features: [variable('v1', '12 mm'), ...t.features.slice(1)] } : t)) };
    const used = { ...b, tabs: b.tabs.map((t) => (t.id === 'T' ? { ...t, rollback: 0 } : t)) };
    const named = { ...b, tabs: b.tabs.map((t) => (t.id === 'S' ? { ...t, parts: { p1: { name: 'Motor' } } } : t)) };
    for (const d of [own, used, named, { ...b, units: { length: 'in' as const, angle: 'deg' as const } }]) expect(fp(d)).not.toBe(fp(link));
    // gone
    expect(linkFingerprint({ ...b, tabs: b.tabs.filter((t) => t.id !== 'S') }, 'S')).toBeNull();
  });

  it('builds a Part Studio of the copy with the copied Part Studios it uses; a copy kept in a file is found by itself', () => {
    const link = makeLink(B(), 'S');
    const W = studio('W', [derived('w1', linkSourceId('S', link))], { links: [link] });
    const doc = { units, tabs: [W] };
    expect(derivedBuildOrder(doc, 'W', W.features)).toEqual([`T@${link.id}`, `S@${link.id}`]);
    const [ok] = prepareDerived(doc, 'W', W.features, (id) => `src:${id}`);
    expect(ok.params).toMatchObject({ sourceKey: `src:S@${link.id}` });
    expect(sourceStudio(doc, `S@${link.id}`)?.features[1]).toMatchObject({ params: { studioId: `T@${link.id}` } });
    // as read from a project file (never made here): known from the Part Studio that keeps it
    const file: DocumentLink = JSON.parse(JSON.stringify({ ...link, id: 'lk-from-file' }));
    const F = studio('F', [derived('f1', 'S@lk-from-file')], { links: [file] });
    const [fromFile] = prepareDerived({ units, tabs: [F] }, 'F', F.features, (id) => `src:${id}`);
    expect(fromFile.params).toMatchObject({ sourceKey: 'src:S@lk-from-file' });
    expect(featureLink(F, F.features[0])).toMatchObject({ link: { id: 'lk-from-file' }, tabId: 'S' });
  });

  it('nests the copies the copied Part Studio keeps (another document of that document)', () => {
    // C's R copied into B's S; then B's S copied into A's W
    const c = docOf('docC', [studio('R', [variable('r', '3 mm')])]);
    const lc = makeLink(c, 'R');
    const b = docOf('docB', [studio('S', [derived('d1', linkSourceId('R', lc))], { links: [lc] })]);
    const lb: DocumentLink = JSON.parse(JSON.stringify({ ...makeLink(b, 'S'), id: 'lk-nested-b' }));
    // the nested copy, as read from a file too
    lb.tabs[0].links![0].id = 'lk-nested-c';
    lb.tabs[0].features[0] = derived('d1', 'R@lk-nested-c');
    const W = studio('W', [derived('w1', 'S@lk-nested-b')], { links: [lb] });
    const doc = { units, tabs: [W] };
    expect(derivedBuildOrder(doc, 'W', W.features)).toEqual(['R@lk-nested-c', 'S@lk-nested-b']);
    expect(prepareDerived(doc, 'W', W.features, (id) => id)[0].params).toMatchObject({ sourceKey: 'S@lk-nested-b' });
    expect(keepsCopyOf([W], 'docC')).toBe(true);
  });

  it('does not offer the Part Studios that use a copy of the document deriving from them', () => {
    const a = docOf('docA', [studio('P', [variable('p', '1 mm')])]);
    const la = makeLink(a, 'P');
    const b = docOf('docB', [studio('S', [derived('d1', linkSourceId('P', la))], { links: [la] }), studio('T', [derived('d2', 'S')]), studio('U', [])]);
    expect(studioIds(linkableStudios(b, 'docA'))).toEqual(['U']);
    expect(studioIds(linkableStudios(b, 'docC'))).toEqual(['S', 'T', 'U']);
  });

  it('keeps with a Part Studio the copies its Derived features use, and only those', () => {
    const l1 = makeLink(B(), 'S');
    const l2 = makeLink(B(), 'T');
    // a feature given a copy just made: it comes in
    const tabs = [studio('W', [derived('w1', linkSourceId('S', l1))])];
    const added = syncLinks(tabs);
    expect((added[0] as PartStudioTab).links).toEqual([l1]);
    // nothing changes: the same tabs
    expect(syncLinks(added)).toBe(added);
    // the feature moves to another copy: the old one goes
    const moved = [{ ...(added[0] as PartStudioTab), features: [derived('w1', linkSourceId('T', l2)), derived('w2', 'X'), derived('w3', 'X@vr-1')] }];
    expect((syncLinks(moved)[0] as PartStudioTab).links).toEqual([l2]);
    // the feature deleted: no copies left
    const none = syncLinks([{ ...(added[0] as PartStudioTab), features: [] }]);
    expect('links' in none[0]).toBe(false);
    // tabs not changed since `before` are not looked at
    expect(syncLinks(tabs, tabs)).toBe(tabs);
  });

  it('does not merge copies as a change of their own: they follow the Derived features', () => {
    const l1 = makeLink(B(), 'S');
    const l2 = makeLink(B(), 'S');
    const base = docOf('docA', [studio('W', [derived('w1', linkSourceId('S', l1))], { links: [l1] })]);
    const source = docOf('docA', [studio('W', [derived('w1', linkSourceId('S', l2))], { links: [l2] })]);
    const plan = mergePlan(base, source, base);
    expect(plan.tabs[0].keys ?? []).not.toContain('links');
    expect(plan.tabs[0].items?.map((x) => x.id)).toEqual(['w1']);
  });
});
