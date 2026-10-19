// Derived (Onshape): a Part Studio uses parts of another Part Studio of the document, linked one way. This module
// knows which Part Studios use which, refuses cycles, and prepares a Part Studio's features for a build: each
// Derived feature gets its source's builder key and version (a change of the source rebuilds it) — or the reason
// it cannot be built. The sources are built first (`buildDerivedSources`), the deepest first.
//
// A source is a Part Studio in a configuration of its own, or as chosen there: its key — the tab's id, or
// "studio#input=option,…" (`sourceKey`). Cycles are about the tabs, whatever their configurations.
//
// A source may also be a Part Studio of a saved version — of this document or of another one (Onshape derives from
// other documents through their versions): "tab@version". A version does not change: its snapshot is loaded once
// (`setVersionSnapshot`) before a build, and the Derived features of its Part Studios use its own Part Studios.

import { configuredFeatures, parseSourceKey, sourceKey, variantStudio } from './config';
import type { CadDocument, DocTab, Feature, PartStudioTab } from './types';

type Doc = Pick<CadDocument, 'tabs' | 'units'>;

/** The tab of a Part Studio built in a configuration of its own ("studio#input=option"). */
const tabIdOf = (studioId: string) => studioId.split('#')[0];

/** A Part Studio of a saved version: "tab@version". */
export const versionStudioId = (tabId: string, versionId: string) => `${tabId}@${versionId}`;

/** The version and the tab of a Part Studio id ("tab@version"); none — a Part Studio of the document itself. */
export function parseVersionStudio(studioId: string): { tabId: string; versionId: string } | null {
  const i = studioId.indexOf('@');
  return i < 0 ? null : { tabId: studioId.slice(0, i), versionId: studioId.slice(i + 1) };
}

/** Snapshots of saved versions used as sources (by version id), and their Part Studios as sources have them. */
const snapshots = new Map<string, Doc>();
const versionStudios = new Map<string, PartStudioTab>();

/** A version's snapshot, to build its Part Studios as sources (a version does not change: once is enough). */
export function setVersionSnapshot(versionId: string, doc: Doc) {
  if (snapshots.has(versionId)) return;
  snapshots.set(versionId, doc);
}

export const versionSnapshot = (versionId: string) => snapshots.get(versionId);

/**
 * A Part Studio of a loaded version (its id: "tab@version"): its Derived features use the version's own Part
 * Studios (or the versions they name). The same object every time — a rebuild compares its inputs by identity.
 */
function versionStudio(tabId: string, versionId: string): PartStudioTab | undefined {
  const id = versionStudioId(tabId, versionId);
  const known = versionStudios.get(id);
  if (known) return known;
  const snap = snapshots.get(versionId);
  const tab = snap?.tabs.find((t): t is PartStudioTab => t.id === tabId && t.type === 'partStudio');
  if (!tab) return undefined;
  const features = tab.features.map((f) =>
    f.type === 'derived' && f.params.studioId && !parseVersionStudio(f.params.studioId)
      ? ({ ...f, params: { ...f.params, studioId: versionStudioId(f.params.studioId, versionId) } } as Feature)
      : f,
  );
  const s: PartStudioTab = { ...tab, id, features };
  versionStudios.set(id, s);
  return s;
}

/** A Part Studio by id: a tab of the document, or of a loaded version ("tab@version"). */
function tabOf(doc: Doc, studioId: string): PartStudioTab | undefined {
  const v = parseVersionStudio(studioId);
  if (v) return versionStudio(v.tabId, v.versionId);
  return doc.tabs.find((t): t is PartStudioTab => t.id === studioId && t.type === 'partStudio');
}

/** The Part Studio a source key stands for, in its configuration (its id: the key); a version's — when loaded. */
export const sourceStudio = (doc: Doc, key: string) => {
  const { studioId, configuration } = parseSourceKey(key);
  const s = tabOf(doc, studioId);
  return s && variantStudio(s, configuration);
};
const studioOf = sourceStudio;

/** The units a source is built in: a version's — its own (they may differ from the document's). */
export function sourceUnits(doc: Doc, key: string): Doc['units'] {
  const v = parseVersionStudio(parseSourceKey(key).studioId);
  return (v && snapshots.get(v.versionId)?.units) || doc.units;
}

/**
 * Tabs whose Derived features use versions renamed by `ids` (old id → new): a copy of a document gets its versions
 * anew, its own references to them follow.
 */
export function renameVersionSources<T extends DocTab>(tabs: T[], ids: Map<string, string>): T[] {
  return tabs.map((t) => {
    if (t.type !== 'partStudio') return t;
    const features = t.features.map((f) => {
      const v = f.type === 'derived' ? parseVersionStudio(f.params.studioId) : null;
      const to = v && ids.get(v.versionId);
      return to ? ({ ...f, params: { ...f.params, studioId: versionStudioId(v.tabId, to) } } as Feature) : f;
    });
    return { ...t, features };
  });
}

/** The versions these Derived features use (and those their versions use in turn, as far as loaded). */
export function usedVersions(features: Feature[]): string[] {
  const out: string[] = [];
  const visit = (feats: Feature[]) => {
    for (const f of feats) {
      const v = f.type === 'derived' ? parseVersionStudio(f.params.studioId) : null;
      if (!v || out.includes(v.versionId)) continue;
      out.push(v.versionId);
      const snap = snapshots.get(v.versionId);
      if (snap) for (const t of snap.tabs) if (t.type === 'partStudio') visit(t.features);
    }
  };
  visit(features);
  return out;
}
const rollbackOf = (s: PartStudioTab) => (s.rollback === null ? s.features.length : Math.min(s.rollback, s.features.length));
/** What a Part Studio builds: its features up to the rollback bar, as its chosen configuration has them. */
const builtFeatures = (s: PartStudioTab) => configuredFeatures(s).slice(0, rollbackOf(s));

/** The source of a Derived feature: its Part Studio in the configuration the feature chooses. */
export const derivedSourceKey = (p: { studioId: string; configuration?: Record<string, string> }) => sourceKey({ studioId: p.studioId, configuration: p.configuration });

/** The sources the active Derived features of a feature list use (not suppressed). */
export function derivedSources(features: Feature[]): string[] {
  const out: string[] = [];
  for (const f of features) {
    if (f.type !== 'derived' || f.suppressed || !f.params.studioId) continue;
    const key = derivedSourceKey(f.params);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** Whether Part Studio `a` uses `b` — directly or through other Part Studios (in any configuration). */
export function derivesFrom(doc: Doc, a: string, b: string, seen: string[] = []): boolean {
  const s = studioOf(doc, a);
  if (!s || seen.includes(tabIdOf(a))) return false;
  return derivedSources(builtFeatures(s)).some((x) => tabIdOf(x) === tabIdOf(b) || derivesFrom(doc, x, b, [...seen, tabIdOf(a)]));
}

/** Part Studios that `studioId` may use as a source: the others that do not use it (no cycles). */
export function derivableStudios(doc: Doc, studioId: string): PartStudioTab[] {
  return doc.tabs.filter((t): t is PartStudioTab => t.type === 'partStudio' && t.id !== studioId && !derivesFrom(doc, t.id, studioId));
}

/** A short hash of a string (cyrb53). */
export function hash(str: string): string {
  // cyrb53
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The version of what a Part Studio builds: it changes with its features, their configuration, the rollback bar,
 * the units — and the versions of its own sources.
 */
export function studioVersion(doc: Doc, id: string, seen: string[] = []): string {
  const s = studioOf(doc, id);
  if (!s || seen.includes(id)) return 'none';
  const feats = builtFeatures(s);
  const sources = derivedSources(feats).map((x) => `${x}:${studioVersion(doc, x, [...seen, id])}`);
  return hash(JSON.stringify([sourceUnits(doc, id), feats, sources]));
}

/**
 * Features of Part Studio `studioId` ready for a build: each Derived feature gets its source's builder key
 * (`keyOf`) and version, or why it cannot be built — the source is gone, or it uses this Part Studio (a cycle).
 */
export function prepareDerived(doc: Doc, studioId: string, features: Feature[], keyOf: (id: string) => string): Feature[] {
  studioId = tabIdOf(studioId);
  return features.map((f) => {
    if (f.type !== 'derived' || !f.params.studioId) return f;
    const src = derivedSourceKey(f.params);
    const v = parseVersionStudio(tabIdOf(src));
    const error = !studioOf(doc, src)
      ? v && !snapshots.has(v.versionId)
        ? 'version'
        : 'missing'
      : tabIdOf(src) === studioId || derivesFrom(doc, src, studioId)
        ? 'cycle'
        : undefined;
    const extra = error ? { sourceError: error } : { sourceKey: keyOf(src), sourceVersion: studioVersion(doc, src) };
    return { ...f, params: { ...f.params, ...extra } } as Feature;
  });
}

/** The Part Studios to build before a Part Studio with these features: its sources, theirs first; no cycles. */
export function derivedBuildOrder(doc: Doc, studioId: string, features: Feature[]): string[] {
  const out: string[] = [];
  const visit = (feats: Feature[], path: string[]) => {
    for (const id of derivedSources(feats)) {
      const s = studioOf(doc, id);
      if (!s || path.includes(tabIdOf(id))) continue;
      visit(builtFeatures(s), [...path, tabIdOf(id)]);
      if (!out.includes(id)) out.push(id);
    }
  };
  visit(features, [tabIdOf(studioId)]);
  return out;
}

/**
 * Build the sources of a Part Studio (whose features are `features`) before it: `build` gets each source, its
 * features, prepared, and the units to build it in, in order. Returns the features of the Part Studio itself, prepared.
 */
export async function buildDerivedSources(
  doc: Doc,
  studioId: string,
  features: Feature[],
  keyOf: (id: string) => string,
  build: (source: PartStudioTab, features: Feature[], units: Doc['units']) => Promise<unknown>,
): Promise<Feature[]> {
  for (const id of derivedBuildOrder(doc, studioId, features)) {
    const s = studioOf(doc, id)!;
    await build(s, prepareDerived(doc, id, builtFeatures(s), keyOf), sourceUnits(doc, id));
  }
  return prepareDerived(doc, studioId, features, keyOf);
}

/** What a rebuild of a Part Studio depends on besides itself: its sources (deepest first) as they are now. */
export function derivedInputs(doc: Doc, studio: PartStudioTab): unknown[] {
  return derivedBuildOrder(doc, studio.id, builtFeatures(studio)).flatMap((id) => {
    const s = studioOf(doc, id)!;
    return [s.features, s.rollback, s.configuration, s.configChoice, s.parts];
  });
}
