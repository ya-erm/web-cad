// A Derived feature being edited from another document has a copy of it that only the memory has until the feature
// is committed: a reload brings the draft back with that copy — not a source "not available".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knownLink, prepareDerived } from '../core/derived';
import { linkSourceId, makeLink } from '../core/links';
import type { CadDocument, DocumentLink, Feature, PartStudioTab } from '../core/types';
import { useDoc } from './docStore';
import { useEditor } from './editorStore';
import { restoreDraft, startDraftPersistence } from './draftPersistence';

const units: CadDocument['units'] = { length: 'mm', angle: 'deg' };
const studio = (id: string, features: Feature[], extra: Partial<PartStudioTab> = {}): PartStudioTab => ({ id, type: 'partStudio', name: id, features, rollback: null, parts: {}, ...extra });
const docOf = (id: string, tabs: PartStudioTab[]): CadDocument => ({ id, name: id, created: 1, modified: 1, units, tabs, activeTab: tabs[0].id, version: 1 });
const derived = (studioId: string): Feature => ({ id: 'f1', type: 'derived', name: 'Derived 1', params: { studioId, parts: [] } });
const source = () => docOf('docB', [studio('S', [{ id: 'v', type: 'variable', name: 'v', params: { name: 'v', value: '1 mm', varType: 'length' } } as Feature])]);

const storage = new Map<string, string>();
const KEY = 'webcad.draft';

beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  useEditor.setState({ editing: null, sketch: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the draft kept over a reload', () => {
  it('keeps with a Derived draft the copy of another document the document does not have yet', () => {
    startDraftPersistence();
    useDoc.setState({ doc: docOf('docA', [studio('W', [])]) });
    const link = makeLink(source(), 'S');
    useEditor.setState({ editing: { featureId: 'f1', isNew: true, index: 0, draft: derived(linkSourceId('S', link)) } });
    vi.runAllTimers();
    const stored = JSON.parse(storage.get(KEY)!) as { links?: DocumentLink[] };
    expect(stored.links?.map((l) => l.id)).toEqual([link.id]);
    // committed: the document keeps it, the draft of an edit has no need of it
    useDoc.setState({ doc: docOf('docA', [studio('W', [derived(linkSourceId('S', link))], { links: [link] })]) });
    useEditor.setState({ editing: { featureId: 'f1', isNew: false, index: 0, draft: derived(linkSourceId('S', link)) } });
    vi.runAllTimers();
    expect('links' in JSON.parse(storage.get(KEY)!)).toBe(false);
  });

  it('knows the copy again when the draft comes back, so the draft builds and is committed with it', () => {
    // as after a reload: a copy the memory has never had
    const link: DocumentLink = { ...JSON.parse(JSON.stringify(makeLink(source(), 'S'))), id: 'lk-after-reload' };
    const doc = docOf('docA', [studio('W', [])]);
    useDoc.setState({ doc });
    const draft = derived(linkSourceId('S', link));
    storage.set(KEY, JSON.stringify({ docId: 'docA', tabId: 'W', editing: { featureId: 'f1', isNew: true, index: 0, draft }, links: [link] }));
    expect(knownLink('lk-after-reload')).toBeUndefined();
    expect(prepareDerived(doc, 'W', [draft], (id) => id)[0].params).toMatchObject({ sourceError: 'copy' });
    expect(restoreDraft()).toBe(true);
    expect(knownLink('lk-after-reload')).toBeDefined();
    expect(prepareDerived(doc, 'W', [draft], (id) => id)[0].params).toMatchObject({ sourceKey: 'S@lk-after-reload' });
    useEditor.getState().commitEditing();
    expect((useDoc.getState().doc!.tabs[0] as PartStudioTab).links?.map((l) => l.id)).toEqual(['lk-after-reload']);
  });

  it('tells a lost copy from a version not available', () => {
    const doc = docOf('docA', [studio('W', [])]);
    expect(prepareDerived(doc, 'W', [derived('S@lk-never-known')], (id) => id)[0].params).toMatchObject({ sourceError: 'copy' });
    expect(prepareDerived(doc, 'W', [derived('S@vr-never-known')], (id) => id)[0].params).toMatchObject({ sourceError: 'version' });
  });
});
