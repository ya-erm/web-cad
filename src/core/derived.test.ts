import { describe, expect, it } from 'vitest';
import { derivedBuildOrder, parseVersionStudio, prepareDerived, renameVersionSources, setVersionSnapshot, usedVersions, versionStudioId } from './derived';
import type { CadDocument, Feature, PartStudioTab } from './types';

const derived = (id: string, studioId: string): Feature => ({ id, type: 'derived', name: id, params: { studioId, parts: [] } });
const studio = (id: string, features: Feature[]): PartStudioTab => ({ id, type: 'partStudio', name: id, features, rollback: null, parts: {} });
const units: CadDocument['units'] = { length: 'mm', angle: 'deg' };

describe('Derived from saved versions', () => {
  it('names a version Part Studio "tab@version"', () => {
    expect(versionStudioId('ps1', 'vr1')).toBe('ps1@vr1');
    expect(parseVersionStudio('ps1@vr1')).toEqual({ tabId: 'ps1', versionId: 'vr1' });
    expect(parseVersionStudio('ps1')).toBeNull();
  });

  it('builds a version Part Studio with the version Part Studios it uses; an unknown version — an error', () => {
    // the version: B derives from A (its own tab ids)
    setVersionSnapshot('vr-core-1', { units, tabs: [studio('A', []), studio('B', [derived('d1', 'A')])] });
    const doc = { units, tabs: [studio('W', [derived('d2', 'B@vr-core-1'), derived('d3', 'A@vr-missing')])] };
    const feats = doc.tabs[0].features;
    // A of the version first, then B of the version
    expect(derivedBuildOrder(doc, 'W', feats)).toEqual(['A@vr-core-1', 'B@vr-core-1']);
    const [ok, missing] = prepareDerived(doc, 'W', feats, (id) => `src:${id}`);
    expect(ok.params).toMatchObject({ sourceKey: 'src:B@vr-core-1' });
    expect(missing.params).toMatchObject({ sourceError: 'version' });
    expect(usedVersions(feats)).toEqual(['vr-core-1', 'vr-missing']);
  });

  it('renames the versions a copy of a document uses', () => {
    const tabs = [studio('W', [derived('d1', 'A@old'), derived('d2', 'A'), derived('d3', 'A@other')])];
    const out = renameVersionSources(tabs, new Map([['old', 'new']]));
    expect((out[0] as PartStudioTab).features.map((f) => (f.type === 'derived' ? f.params.studioId : ''))).toEqual(['A@new', 'A', 'A@other']);
  });
});
