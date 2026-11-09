// Derived from another document as it is now (Onshape derives from other documents through their versions): its
// Part Studio is copied into the Part Studio that uses it (`PartStudioTab.links`, `DocumentLink`) with the Part
// Studios of that document it derives from in turn, and the feature names a Part Studio of the copy: "tab@copy".
// The copy does not change — the document stands on its own — and it remembers the document it came from: when
// that document's Part Studio has changed (`linkFingerprint` differs), an update is offered, which is a new copy.

import { uid } from './ids';
import { hash, knownLink, parseVersionStudio, registerLink, versionStudioId } from './derived';
import type { CadDocument, DocTab, DocumentLink, Feature, PartStudioTab } from './types';

type Source = Pick<CadDocument, 'tabs' | 'units'>;

/**
 * The Part Studios a copy of Part Studio `tabId` needs: it, then those of the same document it derives from (in
 * any configuration: suppressed or rolled back Derived features too), theirs in turn. None — there is no such tab.
 */
export function linkClosure(tabs: readonly DocTab[], tabId: string): PartStudioTab[] {
  const out: PartStudioTab[] = [];
  const visit = (id: string) => {
    if (out.some((t) => t.id === id)) return;
    const t = tabs.find((x): x is PartStudioTab => x.id === id && x.type === 'partStudio');
    if (!t) return;
    out.push(t);
    for (const f of t.features) if (f.type === 'derived' && f.params.studioId && !parseVersionStudio(f.params.studioId)) visit(f.params.studioId);
  };
  visit(tabId);
  return out;
}

/**
 * What a copy of Part Studio `tabId` of a document has — the same for the document and for its copy as long as
 * neither has changed: the units, and of each Part Studio copied its features, rollback bar, configuration and its
 * parts' names, colours and materials (not how they are shown). Null — there is no such Part Studio.
 */
export function linkFingerprint(src: Source, tabId: string): string | null {
  const tabs = linkClosure(src.tabs, tabId);
  if (!tabs.length) return null;
  const parts = (p: PartStudioTab['parts']) =>
    Object.entries(p)
      .map(([id, { hidden: _h, opacity: _o, ...m }]) => [id, m] as const)
      .filter(([, m]) => Object.keys(m).length);
  return hash(JSON.stringify([src.units, tabs.map((t) => [t.id, t.features, t.rollback, parts(t.parts), t.configuration ?? null, t.configChoice ?? null])]));
}

/** Whether these Part Studios keep a copy of document `docId` — themselves, or in the copies they keep. */
export function keepsCopyOf(tabs: readonly PartStudioTab[], docId: string): boolean {
  return tabs.some((t) => (t.links ?? []).some((l) => l.docId === docId || keepsCopyOf(l.tabs, docId)));
}

/**
 * The Part Studios of document `src` that document `forDoc` may derive from: those that do not use a copy of
 * `forDoc` itself (they would bring their old copy of it back into it, every update in turn).
 */
export function linkableStudios(src: Pick<CadDocument, 'tabs'>, forDoc: string): PartStudioTab[] {
  return src.tabs.filter((t): t is PartStudioTab => t.type === 'partStudio' && !keepsCopyOf(linkClosure(src.tabs, t.id), forDoc));
}

/** A new copy of Part Studio `tabId` of document `src` (with those it derives from), known at once as a source. */
export function makeLink(src: Pick<CadDocument, 'id' | 'name' | 'tabs' | 'units'>, tabId: string, now = Date.now()): DocumentLink {
  const link: DocumentLink = {
    id: uid('lk'),
    docId: src.id,
    docName: src.name,
    copied: now,
    units: { ...src.units },
    tabs: structuredClone(linkClosure(src.tabs, tabId)),
  };
  registerLink(link);
  return link;
}

/** The source of a Derived feature made from a copy: "tab@copy". */
export const linkSourceId = (tabId: string, link: DocumentLink) => versionStudioId(tabId, link.id);

/**
 * The copy source `studioId` of a Derived feature of Part Studio `studio` names ("tab@copy"), and the Part Studio of
 * the copy it takes (its id there); none — not a copy (a tab of this document, a saved version).
 */
export function linkOf(studio: PartStudioTab, studioId: string): { link: DocumentLink; tabId: string } | null {
  const v = parseVersionStudio(studioId);
  const link = v && (studio.links?.find((l) => l.id === v.versionId) ?? knownLink(v.versionId));
  return link ? { link, tabId: v.tabId } : null;
}

/** The copy a Derived feature of Part Studio `studio` uses (`linkOf`). */
export const featureLink = (studio: PartStudioTab, f: Feature) => (f.type === 'derived' ? linkOf(studio, f.params.studioId) : null);

/**
 * The tabs with the copies their Derived features use: those no feature uses any more dropped, those a feature has
 * just been given (made for it, known by now) added. The same array when nothing changes; tabs the same as in
 * `before` (at the same place) are not looked at.
 */
export function syncLinks<T extends DocTab>(tabs: T[], before?: readonly T[]): T[] {
  let out = tabs;
  tabs.forEach((t, i) => {
    if (t.type !== 'partStudio' || before?.[i] === t) return;
    const have = t.links ?? [];
    const used: DocumentLink[] = [];
    for (const f of t.features) {
      const v = f.type === 'derived' ? parseVersionStudio(f.params.studioId) : null;
      if (!v || used.some((l) => l.id === v.versionId)) continue;
      const l = have.find((x) => x.id === v.versionId) ?? knownLink(v.versionId);
      if (l) used.push(l);
    }
    if (used.length === have.length && used.every((l) => have.includes(l))) return;
    if (out === tabs) out = [...tabs];
    const next = { ...t } as PartStudioTab;
    if (used.length) next.links = used;
    else delete next.links;
    out[i] = next as T;
  });
  return out;
}
