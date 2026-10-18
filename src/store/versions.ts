// Versions and history of the open document (Onshape): versions made by the user, the history saved by itself,
// a version opened for viewing (read only) and restored into the workspace (one undo step).

import { create } from 'zustand';
import type { Draft } from 'immer';
import type { CadDocument, DocumentVersion, ProjectVersion } from '../core/types';
import { uid } from '../core/ids';
import { compareDocuments, contentHash, historyDue, historyOverflow, isEmptyDocument, nextVersionName, withVersionContent, type DocumentDiff } from '../core/versions';
import * as db from './persistence';
import { useDoc } from './docStore';

interface VersionsState {
  /** The document the list is of. */
  docId: string | null;
  /** Its versions and history, newest first. */
  versions: DocumentVersion[];
  /** The list has been read for this document. */
  loaded: boolean;
  /** The version open for viewing, and the workspace to come back to. */
  viewing: { version: DocumentVersion; workspace: { doc: CadDocument; past: CadDocument[]; future: CadDocument[] } } | null;
}

export const useVersions = create<VersionsState>(() => ({ docId: null, versions: [], loaded: false, viewing: null }));

async function refresh(docId: string) {
  const versions = await db.listVersions(docId);
  if (useVersions.getState().docId === docId) useVersions.setState({ versions, loaded: true });
}

async function snapshot(doc: CadDocument, v: Pick<DocumentVersion, 'kind' | 'name' | 'description' | 'reason'>) {
  const version: DocumentVersion = { id: uid('vr'), docId: doc.id, created: Date.now(), hash: contentHash(doc), ...v };
  if (!version.description) delete version.description;
  if (!version.reason) delete version.reason;
  await db.saveVersion(version, doc);
}

/** An entry of the history: the document as it is now, when it is due (the oldest entries beyond the limit go). */
async function remember(doc: CadDocument, reason: NonNullable<DocumentVersion['reason']>) {
  if (isEmptyDocument(doc)) return;
  const versions = await db.listVersions(doc.id);
  if (!historyDue(versions, contentHash(doc), reason, Date.now())) return;
  await snapshot(doc, { kind: 'auto', name: '', reason });
  await db.deleteVersions(historyOverflow(await db.listVersions(doc.id)));
  await refresh(doc.id);
}

/** A version of the workspace as it is now ("V3" when no name is given). */
export async function createVersion(name: string, description = '') {
  const { doc, readOnly } = useDoc.getState();
  if (!doc || readOnly) return;
  await useDoc.getState().flushSave();
  await snapshot(doc, { kind: 'version', name: name.trim() || nextVersionName(useVersions.getState().versions), description: description.trim() });
  await refresh(doc.id);
}

/** Open a version (or an entry of the history) for viewing: read only, until `exitVersion`. */
export async function viewVersion(id: string): Promise<boolean> {
  const version = useVersions.getState().versions.find((v) => v.id === id);
  const snap = await db.loadVersion(id);
  // what waits to be saved goes to the document first: nothing is saved while viewing
  await useDoc.getState().flushSave();
  const s = useDoc.getState();
  if (!version || !snap || !s.doc) return false;
  const workspace = useVersions.getState().viewing?.workspace ?? { doc: s.doc, past: s.past, future: s.future };
  useVersions.setState({ viewing: { version, workspace } });
  const doc = withVersionContent({ ...workspace.doc, activeTab: s.doc.activeTab }, snap);
  useDoc.setState({ doc, past: [], future: [], lastKey: null, readOnly: true });
  return true;
}

/** Back from the version to the workspace (the open tab stays, if it is there). */
export function exitVersion() {
  const w = useVersions.getState().viewing?.workspace;
  if (!w) return;
  const cur = useDoc.getState().doc;
  useVersions.setState({ viewing: null });
  const activeTab = cur && w.doc.tabs.some((t) => t.id === cur.activeTab) ? cur.activeTab : w.doc.activeTab;
  useDoc.setState({ doc: { ...w.doc, activeTab }, past: w.past, future: w.future, lastKey: null, readOnly: false });
}

/** Make the workspace what a version has (one undo step); the workspace as it was goes to the history first. */
export async function restoreVersion(id: string) {
  const snap = await db.loadVersion(id);
  if (!snap) return;
  exitVersion();
  const doc = useDoc.getState().doc;
  if (!doc) return;
  await remember(doc, 'restore');
  useDoc.getState().update((d) => {
    const next = withVersionContent(d as CadDocument, snap);
    d.tabs = next.tabs as Draft<CadDocument>['tabs'];
    d.units = next.units;
    d.activeTab = next.activeTab;
  });
}

/** What changed from a version to the workspace (the one to come back to, while a version is viewed). */
export async function compareWithWorkspace(id: string): Promise<DocumentDiff | null> {
  const snap = await db.loadVersion(id);
  const work = useVersions.getState().viewing?.workspace.doc ?? useDoc.getState().doc;
  return snap && work ? compareDocuments(snap, work) : null;
}

export async function deleteVersion(id: string) {
  await db.deleteVersions([id]);
  const docId = useVersions.getState().docId;
  if (docId) await refresh(docId);
}

/** Versions as project files have them, by id (a version does not change). */
const fileCache = new Map<string, ProjectVersion>();

/** The versions of a document (not its history) as its project file keeps them, oldest first. */
export async function fileVersions(docId: string): Promise<ProjectVersion[]> {
  const out: ProjectVersion[] = [];
  for (const v of (await db.listVersions(docId)).filter((x) => x.kind === 'version').reverse()) {
    let pv = fileCache.get(v.id);
    if (!pv) {
      const snap = await db.loadVersion(v.id);
      if (!snap) continue;
      pv = { id: v.id, name: v.name, ...(v.description ? { description: v.description } : {}), created: v.created, units: snap.units, tabs: snap.tabs, activeTab: snap.activeTab };
      fileCache.set(v.id, pv);
    }
    out.push(pv);
  }
  return out;
}

/**
 * Versions of a project file into the browser, for document `docId`. `sameDocument`: the file is this document's
 * own (a file of a folder) — the versions it has already are skipped; otherwise (an imported copy) all are added
 * anew. The number added.
 */
export async function importVersions(docId: string, versions: ProjectVersion[] | undefined, sameDocument: boolean): Promise<number> {
  if (!versions?.length) return 0;
  const have = new Set((await db.listVersions(docId)).map((v) => v.id));
  let added = 0;
  for (const pv of versions) {
    if (!pv || !Array.isArray(pv.tabs) || !pv.units || (sameDocument && have.has(pv.id))) continue;
    const id = sameDocument && typeof pv.id === 'string' ? pv.id : uid('vr');
    const snap: CadDocument = { id: docId, name: '', created: pv.created, modified: pv.created, units: pv.units, tabs: pv.tabs, activeTab: pv.activeTab, version: 1 };
    await db.saveVersion({ id, docId, kind: 'version', name: pv.name || 'V', ...(pv.description ? { description: pv.description } : {}), created: pv.created || Date.now(), hash: contentHash(pv) }, snap);
    added++;
  }
  if (added && useVersions.getState().docId === docId) await refresh(docId);
  return added;
}

let started = false;

/** Follow the open document: its list, an entry of the history when it is opened and every while after saves. */
export function startVersions() {
  if (started) return;
  started = true;
  useDoc.subscribe((s, prev) => {
    const id = s.doc?.id ?? null;
    if (id !== useVersions.getState().docId) {
      useVersions.setState({ docId: id, versions: [], loaded: false, viewing: null });
      if (s.doc) {
        const doc = s.doc;
        void refresh(doc.id).then(() => remember(doc, 'open'));
      }
      return;
    }
    if (prev.saving && !s.saving && s.doc && !s.readOnly) void remember(s.doc, 'edit');
  });
}
