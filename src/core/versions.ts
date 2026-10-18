// Versions and history of a document (Onshape): what is saved when, how versions are named, what a restore puts
// back. The snapshots themselves are kept in IndexedDB (store/persistence.ts).

import type { CadDocument, DocumentVersion } from './types';
import { hash } from './derived';

/** While editing, the history saves the document at most this often. */
export const HISTORY_EVERY = 10 * 60_000;
/** The history keeps this many of its newest entries (versions are kept all). */
export const HISTORY_KEEP = 30;

/** A document's content as a snapshot compares it: units and tabs (not its name or the open tab). */
export const contentHash = (doc: Pick<CadDocument, 'units' | 'tabs'>) => hash(JSON.stringify([doc.units, doc.tabs]));

/** The name of the next version: "V1", "V2"… after the highest one. */
export function nextVersionName(versions: DocumentVersion[]): string {
  let n = 0;
  for (const v of versions) {
    const m = v.kind === 'version' ? /^V(\d+)$/.exec(v.name) : null;
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `V${n + 1}`;
}

/**
 * Whether the history saves the document now (`versions` newest first): not when the newest snapshot has the same
 * content; while editing — only when its last entry is old enough.
 */
export function historyDue(versions: DocumentVersion[], contentHash: string, reason: NonNullable<DocumentVersion['reason']>, now: number): boolean {
  if (versions[0]?.hash === contentHash) return false;
  if (reason !== 'edit') return true;
  const last = versions.find((v) => v.kind === 'auto');
  return !last || now - last.created >= HISTORY_EVERY;
}

/** Nothing in it yet (a new document): the history does not save it. */
export const isEmptyDocument = (doc: Pick<CadDocument, 'tabs'>) =>
  doc.tabs.every((t) => (t.type === 'partStudio' ? !t.features.length : t.type === 'assembly' ? !t.instances.length : !t.drawing.views.length));

/** The entries of the history beyond the newest `HISTORY_KEEP` (`versions` newest first). */
export const historyOverflow = (versions: DocumentVersion[]) =>
  versions
    .filter((v) => v.kind === 'auto')
    .slice(HISTORY_KEEP)
    .map((v) => v.id);

/** The workspace with a version's content: its tabs and units; the name stays, and the open tab if it is there. */
export function withVersionContent<T extends Pick<CadDocument, 'tabs' | 'units' | 'activeTab'>>(workspace: T, snapshot: CadDocument): T {
  const activeTab = snapshot.tabs.some((t) => t.id === workspace.activeTab) ? workspace.activeTab : snapshot.activeTab;
  return { ...workspace, tabs: structuredClone(snapshot.tabs), units: { ...snapshot.units }, activeTab };
}
