// Versions and history of the open document (Onshape): versions made by the user, the history saved by itself,
// a version opened for viewing (read only) and restored into the workspace (one undo step).

import { create } from 'zustand';
import type { Draft } from 'immer';
import type { CadDocument, DocumentVersion, ProjectVersion, Workspace } from '../core/types';
import { uid } from '../core/ids';
import { renameVersionSources } from '../core/derived';
import {
  applyMerge,
  compareDocuments,
  contentHash,
  historyDue,
  historyOverflow,
  isEmptyDocument,
  MAIN_WORKSPACE,
  mergePlan,
  nextVersionName,
  withVersionContent,
  type DocumentDiff,
  type MergePlan,
} from '../core/versions';
import * as db from './persistence';
import { useDoc } from './docStore';
import { t } from '../i18n';

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

/** The workspace the open document is in (Main when it has none). */
export const currentWorkspace = (doc: CadDocument | null): Workspace => doc?.workspace ?? MAIN_WORKSPACE;

/** The open workspace kept beside the versions (to come back to): its state now, under its id. */
async function keepWorkspace(doc: CadDocument) {
  const ws = currentWorkspace(doc);
  const record: DocumentVersion = { id: `${doc.id}:${ws.id}`, docId: doc.id, kind: 'workspace', name: ws.name, created: Date.now(), hash: contentHash(doc), ...(ws.base ? { base: ws.base } : {}) };
  await db.saveVersion(record, structuredClone(doc));
}

/** The document now in workspace `ws` with `content` (tabs, units); the undo history of the other one does not apply. */
function enterWorkspace(doc: CadDocument, content: CadDocument, ws: Workspace) {
  const next: CadDocument = { ...withVersionContent(doc, content), ...(ws.id === MAIN_WORKSPACE.id ? {} : { workspace: ws }) };
  if (ws.id === MAIN_WORKSPACE.id) delete next.workspace;
  useDoc.getState().update(
    (d) => {
      d.tabs = next.tabs as Draft<CadDocument>['tabs'];
      d.units = next.units;
      d.activeTab = next.activeTab;
      if (next.workspace) d.workspace = next.workspace;
      else delete d.workspace;
    },
    { undoable: false },
  );
  useDoc.setState({ past: [], future: [], lastKey: null });
}

/** A new workspace (Onshape: Branch to create workspace) from a version: the open one is kept, the new one opens. */
export async function branchFromVersion(versionId: string, name: string) {
  const version = useVersions.getState().versions.find((v) => v.id === versionId);
  const snap = await db.loadVersion(versionId);
  exitVersion();
  await useDoc.getState().flushSave();
  const doc = useDoc.getState().doc;
  if (!version || !snap || !doc) return;
  await keepWorkspace(doc);
  enterWorkspace(doc, snap, { id: uid('ws'), name: name.trim() || nextBranchName(useVersions.getState().versions), base: versionId });
  await refresh(doc.id);
}

/** "Branch 1", "Branch 2"… (in the interface language) after the highest one. */
export function nextBranchName(versions: DocumentVersion[]): string {
  let n = 0;
  const own = useDoc.getState().doc?.workspace?.name;
  for (const name of [...versions.filter((v) => v.kind === 'workspace').map((v) => v.name), ...(own ? [own] : [])]) {
    const m = /^\S+ (\d+)$/.exec(name);
    if (m && (name.startsWith('Branch ') || name.startsWith(`${t('Branch')} `))) n = Math.max(n, Number(m[1]));
  }
  return `${t('Branch')} ${n + 1}`;
}

/** Open another workspace: the open one is kept, the other one's state comes in (it is no longer kept apart). */
export async function switchWorkspace(recordId: string) {
  const record = useVersions.getState().versions.find((v) => v.id === recordId && v.kind === 'workspace');
  const snap = await db.loadVersion(recordId);
  exitVersion();
  await useDoc.getState().flushSave();
  const doc = useDoc.getState().doc;
  if (!record || !snap || !doc) return;
  await keepWorkspace(doc);
  const id = recordId.slice(doc.id.length + 1);
  enterWorkspace(doc, snap, { id, name: record.name, ...(record.base ? { base: record.base } : {}) });
  await db.deleteVersions([recordId]);
  await refresh(doc.id);
}

/** What merging a kept workspace into the open one would do (compared with the version it was branched from). */
export async function planMerge(recordId: string): Promise<{ plan: MergePlan; source: CadDocument; base: CadDocument | null } | null> {
  const record = useVersions.getState().versions.find((v) => v.id === recordId && v.kind === 'workspace');
  const source = await db.loadVersion(recordId);
  const doc = useDoc.getState().doc;
  if (!record || !source || !doc) return null;
  // the common base: the version the branch came from (merging Main into a branch: the open branch's own)
  const baseId = record.base ?? currentWorkspace(doc).base;
  const base = baseId ? ((await db.loadVersion(baseId)) ?? null) : null;
  return { plan: mergePlan(base, source, doc), source, base };
}

/**
 * Merge a workspace's tabs (and features of Part Studios) into the open one (one undo step; the open one as it was
 * goes to the history first).
 */
export async function mergeWorkspace(source: CadDocument, base: CadDocument | null, plan: MergePlan, take: Set<string>, units: boolean) {
  exitVersion();
  const doc = useDoc.getState().doc;
  if (!doc) return;
  await remember(doc, 'merge');
  // of the document as it is (not a draft: merged tabs are cloned)
  const next = applyMerge(useDoc.getState().doc ?? doc, source, plan, take, units, base);
  useDoc.getState().update((d) => {
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

/**
 * The versions of a document (not its history) as its project file keeps them, oldest first; then the workspaces it
 * is not in (`kind: 'workspace'`, by their own ids).
 */
export async function fileVersions(docId: string): Promise<ProjectVersion[]> {
  const out: ProjectVersion[] = [];
  const records = (await db.listVersions(docId)).reverse();
  for (const v of [...records.filter((x) => x.kind === 'version'), ...records.filter((x) => x.kind === 'workspace')]) {
    // a version does not change; a workspace kept again is saved anew (its time)
    const key = v.kind === 'workspace' ? `${v.id}@${v.created}` : v.id;
    let pv = fileCache.get(key);
    if (!pv) {
      const snap = await db.loadVersion(v.id);
      if (!snap) continue;
      const own = v.kind === 'workspace' ? { id: v.id.slice(docId.length + 1), kind: 'workspace' as const, ...(v.base ? { base: v.base } : {}) } : { id: v.id };
      pv = { ...own, name: v.name, ...(v.description ? { description: v.description } : {}), created: v.created, units: snap.units, tabs: snap.tabs, activeTab: snap.activeTab };
      fileCache.set(key, pv);
    }
    out.push(pv);
  }
  return out;
}

/** New ids for the versions of a copy of a project (old id → new); its Derived features follow them (`renameVersionSources`). */
export const copiedVersionIds = (versions: ProjectVersion[] | undefined) =>
  new Map((versions ?? []).filter((v) => typeof v?.id === 'string' && v.kind !== 'workspace').map((v) => [v.id, uid('vr')]));

/** A copy of a project's document: its Derived features, and the version its workspace came from, follow the copied versions. */
export const withCopiedVersions = (doc: CadDocument, copies: Map<string, string>): CadDocument => ({
  ...doc,
  tabs: renameVersionSources(doc.tabs, copies),
  ...(doc.workspace?.base ? { workspace: { ...doc.workspace, base: copies.get(doc.workspace.base) ?? doc.workspace.base } } : {}),
});

/**
 * Versions of a project file into the browser, for document `docId`. `sameDocument`: the file is this document's
 * own (a file of a folder) — the versions it has already are skipped; otherwise (an imported copy) all are added
 * anew, under the ids `copies` gives them (see `copiedVersionIds`). The number added.
 */
export async function importVersions(docId: string, versions: ProjectVersion[] | undefined, sameDocument: boolean, copies?: Map<string, string>): Promise<number> {
  if (!versions?.length) return 0;
  const records = await db.listVersions(docId);
  const have = new Set(records.map((v) => v.id));
  // the workspace the document is in is the document itself: not kept apart
  const own = `${docId}:${currentWorkspace((await db.loadDocument(docId)) ?? null).id}`;
  if (sameDocument && have.has(own)) await db.deleteVersions([own]);
  let added = 0;
  for (const pv of versions) {
    if (!pv || !Array.isArray(pv.tabs) || !pv.units) continue;
    if (pv.kind === 'workspace') {
      // a workspace: under this document's id; of the file's own document — when it is newer than the browser's
      const id = `${docId}:${pv.id}`;
      const kept = records.find((v) => v.id === id);
      if (typeof pv.id !== 'string' || id === own || (sameDocument && kept && kept.created >= pv.created)) continue;
      const base = pv.base && !sameDocument ? (copies?.get(pv.base) ?? pv.base) : pv.base;
      const tabs = !sameDocument && copies ? renameVersionSources(pv.tabs, copies) : pv.tabs;
      const snap: CadDocument = { id: docId, name: '', created: pv.created, modified: pv.created, units: pv.units, tabs, activeTab: pv.activeTab, version: 1 };
      await db.saveVersion({ id, docId, kind: 'workspace', name: pv.name || 'Branch', created: pv.created || Date.now(), hash: contentHash(pv), ...(base ? { base } : {}) }, snap);
      added++;
      continue;
    }
    if (sameDocument && have.has(pv.id)) continue;
    const id = sameDocument && typeof pv.id === 'string' ? pv.id : (copies?.get(pv.id) ?? uid('vr'));
    // in a copy, versions that derive from earlier ones use the copies
    const tabs = !sameDocument && copies ? renameVersionSources(pv.tabs, copies) : pv.tabs;
    const snap: CadDocument = { id: docId, name: '', created: pv.created, modified: pv.created, units: pv.units, tabs, activeTab: pv.activeTab, version: 1 };
    await db.saveVersion({ id, docId, kind: 'version', name: pv.name || 'V', ...(pv.description ? { description: pv.description } : {}), created: pv.created || Date.now(), hash: contentHash(pv) }, snap);
    added++;
  }
  if ((added || (sameDocument && have.has(own))) && useVersions.getState().docId === docId) await refresh(docId);
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
