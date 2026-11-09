// Derived from other documents as they are now (core/links.ts): the copies the open document keeps compared with
// those documents in the browser — when the document is opened, when its copies change, when the app comes back
// into focus (another tab may have changed them). Features whose source has changed are offered an update: a new
// copy of the document as it is now (one undo step).

import { create } from 'zustand';
import * as db from './persistence';
import { useDoc } from './docStore';
import { featureLink, linkFingerprint, linkSourceId, makeLink } from '../core/links';
import type { CadDocument, DocumentLink, PartStudioTab } from '../core/types';

/**
 * How a copy stands with its document: the same, changed since, the document deleted (or in the trash), or the
 * document no longer has the Part Studio. The copy is used as it is in every case.
 */
export type LinkState = 'current' | 'outdated' | 'deleted' | 'gone';

export interface LinkInfo {
  state: LinkState;
  /** The copy it is about (the feature may have another one by now: not checked yet). */
  linkId: string;
  /** The document's name now (when it is there), else as it was copied. */
  docName: string;
  copied: number;
}

interface LinkStatusState {
  /** The document the states are of. */
  docId: string | null;
  /** By "tabId/featureId" of the Derived features that use copies. */
  byFeature: Record<string, LinkInfo>;
}

export const useLinkStatus = create<LinkStatusState>(() => ({ docId: null, byFeature: {} }));

export const linkKey = (tabId: string, featureId: string) => `${tabId}/${featureId}`;

/** A document to derive from as it is now: none when it is gone or in the trash. */
export async function sourceDocument(id: string): Promise<CadDocument | null> {
  const summary = (await db.listDocuments()).find((d) => d.id === id);
  if (!summary || summary.trashed) return null;
  return (await db.loadDocument(id)) ?? null;
}

/** The other documents to derive from as they are now (not in the trash), newest first. */
export async function otherDocuments(docId: string) {
  return (await db.listDocuments()).filter((d) => d.id !== docId && !d.trashed);
}

/** How copy `link` (its Part Studio `tabId`) stands with its document `src` now (null: it is gone). */
export function linkState(link: DocumentLink, tabId: string, src: CadDocument | null): LinkState {
  if (!src) return 'deleted';
  const now = linkFingerprint(src, tabId);
  return now === null ? 'gone' : now === linkFingerprint(link, tabId) ? 'current' : 'outdated';
}

/** The Derived features of a document that use copies (and the copies). */
function linkedFeatures(doc: CadDocument) {
  return doc.tabs.flatMap((t) =>
    t.type === 'partStudio'
      ? t.features.flatMap((f) => {
          const fl = featureLink(t, f);
          return fl ? [{ studio: t, featureId: f.id, ...fl }] : [];
        })
      : [],
  );
}

let checking: Promise<void> | null = null;
let again = false;

/** Compare the open document's copies with their documents now. */
export function checkLinks(): Promise<void> {
  // one at a time: a check asked for meanwhile runs after it
  if (checking) {
    again = true;
    return checking;
  }
  checking = (async () => {
    do {
      again = false;
      await runCheck().catch((e) => console.warn('Checking the documents derived from failed', e));
    } while (again);
    checking = null;
  })();
  return checking;
}

async function runCheck() {
  const doc = useDoc.getState().doc;
  if (!doc) return useLinkStatus.setState({ docId: null, byFeature: {} });
  const items = linkedFeatures(doc);
  const sources = new Map<string, CadDocument | null>();
  const byFeature: Record<string, LinkInfo> = {};
  for (const it of items) {
    if (!sources.has(it.link.docId)) sources.set(it.link.docId, await sourceDocument(it.link.docId));
    const src = sources.get(it.link.docId) ?? null;
    byFeature[linkKey(it.studio.id, it.featureId)] = {
      state: linkState(it.link, it.tabId, src),
      linkId: it.link.id,
      docName: src?.name ?? it.link.docName,
      copied: it.link.copied,
    };
  }
  // another document opened meanwhile: its own check follows
  if (useDoc.getState().doc?.id !== doc.id) return;
  useLinkStatus.setState({ docId: doc.id, byFeature });
}

/**
 * Update Derived features (of Part Studio `tabId`, by ids) whose source documents have changed: each gets a copy
 * of its document as it is now — one copy for the features of the same Part Studio — in one undo step. The number
 * of features updated.
 */
export async function updateLinks(items: { tabId: string; featureId: string }[]): Promise<number> {
  const { doc, readOnly } = useDoc.getState();
  if (!doc || readOnly) return 0;
  const sources = new Map<string, CadDocument | null>();
  const made = new Map<string, DocumentLink>();
  const changes: { tabId: string; featureId: string; studioId: string }[] = [];
  for (const it of items) {
    const studio = doc.tabs.find((t): t is PartStudioTab => t.id === it.tabId && t.type === 'partStudio');
    const f = studio?.features.find((x) => x.id === it.featureId);
    const fl = studio && f && featureLink(studio, f);
    if (!fl) continue;
    if (!sources.has(fl.link.docId)) sources.set(fl.link.docId, await sourceDocument(fl.link.docId));
    const src = sources.get(fl.link.docId);
    if (!src || linkState(fl.link, fl.tabId, src) !== 'outdated') continue;
    // a copy already as the document is now: the one just made, or one the Part Studio keeps
    const key = `${src.id}/${fl.tabId}`;
    const now = linkFingerprint(src, fl.tabId);
    const link = made.get(key) ?? studio.links?.find((l) => l.docId === src.id && linkFingerprint(l, fl.tabId) === now) ?? makeLink(src, fl.tabId);
    made.set(key, link);
    changes.push({ tabId: studio.id, featureId: f.id, studioId: linkSourceId(fl.tabId, link) });
  }
  if (!changes.length) return 0;
  useDoc.getState().update((d) => {
    for (const c of changes) {
      const t = d.tabs.find((x) => x.id === c.tabId);
      const f = t?.type === 'partStudio' ? t.features.find((x) => x.id === c.featureId) : undefined;
      if (f?.type === 'derived') f.params.studioId = c.studioId;
    }
  });
  void checkLinks();
  return changes.length;
}

/** What the open document's copies are (which feature uses which copy): a change of it is checked again. */
function linksSignature(doc: CadDocument | null): string {
  if (!doc) return '';
  return linkedFeatures(doc)
    .map((x) => `${x.studio.id}/${x.featureId}=${x.link.id}:${x.tabId}`)
    .join(' ');
}

let started = false;

/** Follow the open document's copies: compared when it opens, when they change, when the app is back in focus. */
export function startLinkChecks() {
  if (started) return;
  started = true;
  let docId: string | null = null;
  let signature = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void checkLinks(), 300);
  };
  useDoc.subscribe((s) => {
    const id = s.doc?.id ?? null;
    if (id !== docId) {
      docId = id;
      signature = linksSignature(s.doc);
      useLinkStatus.setState({ docId: null, byFeature: {} });
      if (signature) schedule();
      return;
    }
    const sig = linksSignature(s.doc);
    if (sig === signature) return;
    signature = sig;
    schedule();
  });
  const back = () => {
    if (document.visibilityState === 'visible' && signature) schedule();
  };
  window.addEventListener('focus', back);
  document.addEventListener('visibilitychange', back);
}
