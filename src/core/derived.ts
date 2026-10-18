// Derived (Onshape): a Part Studio uses parts of another Part Studio of the document, linked one way. This module
// knows which Part Studios use which, refuses cycles, and prepares a Part Studio's features for a build: each
// Derived feature gets its source's builder key and version (a change of the source rebuilds it) — or the reason
// it cannot be built. The sources are built first (`buildDerivedSources`), the deepest first.

import { configuredFeatures } from './config';
import type { CadDocument, Feature, PartStudioTab } from './types';

type Doc = Pick<CadDocument, 'tabs' | 'units'>;

const studioOf = (doc: Doc, id: string) => doc.tabs.find((t): t is PartStudioTab => t.id === id && t.type === 'partStudio');
const rollbackOf = (s: PartStudioTab) => (s.rollback === null ? s.features.length : Math.min(s.rollback, s.features.length));
/** What a Part Studio builds: its features up to the rollback bar, as its chosen configuration has them. */
const builtFeatures = (s: PartStudioTab) => configuredFeatures(s).slice(0, rollbackOf(s));

/** The Part Studios the active Derived features of a feature list use (not suppressed). */
export function derivedSources(features: Feature[]): string[] {
  const out: string[] = [];
  for (const f of features) if (f.type === 'derived' && !f.suppressed && f.params.studioId && !out.includes(f.params.studioId)) out.push(f.params.studioId);
  return out;
}

/** Whether Part Studio `a` uses `b` — directly or through other Part Studios. */
export function derivesFrom(doc: Doc, a: string, b: string, seen: string[] = []): boolean {
  const s = studioOf(doc, a);
  if (!s || seen.includes(a)) return false;
  return derivedSources(builtFeatures(s)).some((x) => x === b || derivesFrom(doc, x, b, [...seen, a]));
}

/** Part Studios that `studioId` may use as a source: the others that do not use it (no cycles). */
export function derivableStudios(doc: Doc, studioId: string): PartStudioTab[] {
  return doc.tabs.filter((t): t is PartStudioTab => t.type === 'partStudio' && t.id !== studioId && !derivesFrom(doc, t.id, studioId));
}

function hash(str: string): string {
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
  return hash(JSON.stringify([doc.units, feats, sources]));
}

/** The tab of a Part Studio built in a configuration of its own ("studio#input=option"). */
const tabIdOf = (studioId: string) => studioId.split('#')[0];

/**
 * Features of Part Studio `studioId` ready for a build: each Derived feature gets its source's builder key
 * (`keyOf`) and version, or why it cannot be built — the source is gone, or it uses this Part Studio (a cycle).
 */
export function prepareDerived(doc: Doc, studioId: string, features: Feature[], keyOf: (id: string) => string): Feature[] {
  studioId = tabIdOf(studioId);
  return features.map((f) => {
    if (f.type !== 'derived' || !f.params.studioId) return f;
    const src = f.params.studioId;
    const error = !studioOf(doc, src) ? 'missing' : src === studioId || derivesFrom(doc, src, studioId) ? 'cycle' : undefined;
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
      if (!s || path.includes(id)) continue;
      visit(builtFeatures(s), [...path, id]);
      if (!out.includes(id)) out.push(id);
    }
  };
  visit(features, [tabIdOf(studioId)]);
  return out;
}

/**
 * Build the sources of a Part Studio (whose features are `features`) before it: `build` gets each source and its
 * features, prepared, in order. Returns the features of the Part Studio itself, prepared.
 */
export async function buildDerivedSources(
  doc: Doc,
  studioId: string,
  features: Feature[],
  keyOf: (id: string) => string,
  build: (source: PartStudioTab, features: Feature[]) => Promise<unknown>,
): Promise<Feature[]> {
  for (const id of derivedBuildOrder(doc, studioId, features)) {
    const s = studioOf(doc, id)!;
    await build(s, prepareDerived(doc, id, builtFeatures(s), keyOf));
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
