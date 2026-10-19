// Saved versions as Derived sources: their snapshots loaded from the browser's storage before a build, and the
// versions a Derived feature can choose — this document's and other documents' (Onshape derives from other
// documents through their versions).

import * as db from './persistence';
import { setVersionSnapshot, usedVersions, versionSnapshot } from '../core/derived';
import type { CadDocument, DocumentVersion, Feature, PartStudioTab } from '../core/types';

/** Load the snapshots of the versions these features (and the document's Part Studios) derive from, theirs too. */
export async function loadVersionSources(doc: Pick<CadDocument, 'tabs'>, features: Feature[] = []): Promise<void> {
  const all = [...features, ...doc.tabs.flatMap((t) => (t.type === 'partStudio' ? t.features : []))];
  for (;;) {
    let loaded = 0;
    for (const id of usedVersions(all).filter((v) => !versionSnapshot(v))) {
      const snap = await db.loadVersion(id).catch(() => undefined);
      if (!snap) continue;
      setVersionSnapshot(id, snap);
      loaded++;
    }
    // the versions just loaded may derive from others
    if (!loaded) return;
  }
}

/** A version's snapshot (loaded once). */
export async function versionDocument(versionId: string): Promise<Pick<CadDocument, 'tabs' | 'units'> | undefined> {
  const known = versionSnapshot(versionId);
  if (known) return known;
  const snap = await db.loadVersion(versionId).catch(() => undefined);
  if (snap) setVersionSnapshot(versionId, snap);
  return snap;
}

/** A document with versions to derive from. */
export interface VersionedDocument {
  docId: string;
  name: string;
  /** Its named versions (not the history), newest first. */
  versions: DocumentVersion[];
}

/** The documents whose versions a Derived feature can use: this one first (when it has any), then the others. */
export async function derivableVersions(docId: string, docName: string): Promise<VersionedDocument[]> {
  const docs = (await db.listDocuments()).filter((d) => d.id !== docId && !d.trashed);
  const out: VersionedDocument[] = [];
  for (const d of [{ id: docId, name: docName }, ...docs]) {
    const versions = (await db.listVersions(d.id)).filter((v) => v.kind === 'version');
    if (versions.length) out.push({ docId: d.id, name: d.name, versions });
  }
  return out;
}

/** The Part Studios of a snapshot. */
export const snapshotStudios = (snap: Pick<CadDocument, 'tabs'>) => snap.tabs.filter((t): t is PartStudioTab => t.type === 'partStudio');
