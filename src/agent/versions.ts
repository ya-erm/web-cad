// Agent API for versions and branches (Onshape): save a version of the document, branch a workspace from a version,
// switch workspaces, merge one into another. They are records apart from the document's content, so a run applies
// them at once and in order between its other operations. In Node (a project file) they are the file's `versions`
// and `workspaces`, kept here; in the browser — the app's own versions (src/agent/browser.ts).

import type { CadDocument, DocumentVersion, ProjectVersion } from '../core/types';
import { uid } from '../core/ids';
import { applyMerge, MAIN_WORKSPACE, mergePlan, nextVersionName, withVersionContent, type MergePlan, type MergeTab } from '../core/versions';
import { t } from '../i18n';
import { AgentError } from './runner';
import type { DocumentOp } from './document';
import type { RunReport, VersionOp, VersionsSummary } from './types';

const OPS = new Set(['version', 'branch', 'workspace', 'merge']);
export const isVersionOp = (op: { op: string }): op is VersionOp => OPS.has(op.op);

/** An operation of a run: of the document, or of its versions. */
export type AnyOp = DocumentOp | VersionOp;

/** A run's operations in stretches: the document's (run together, from op #`at`), a version op (on its own). */
export function stretches(ops: AnyOp[]): ({ ops: DocumentOp[]; at: number } | { op: VersionOp; at: number })[] {
  const out: ({ ops: DocumentOp[]; at: number } | { op: VersionOp; at: number })[] = [];
  ops.forEach((op, i) => {
    const last = out[out.length - 1];
    if (isVersionOp(op)) out.push({ op, at: i });
    else if (last && 'ops' in last) last.ops.push(op);
    else out.push({ ops: [op], at: i });
  });
  return out;
}

/** A stretch's report added to the run's: its error counted from the run's start. */
export function addReport(out: RunReport, r: RunReport, at: number) {
  out.added.push(...r.added);
  out.changed.push(...r.changed);
  out.removed.push(...r.removed);
  out.failed.push(...r.failed);
  if (r.model) out.model = r.model;
  if (r.assembly) out.assembly = r.assembly;
  if (r.drawing) out.drawing = r.drawing;
  if (r.error) out.error = r.error.replace(/^op #(\d+)/, (_, n) => `op #${Number(n) + at}`);
  out.ok = out.ok && r.ok;
}

const lower = (s: string) => s.trim().toLowerCase();
export const sameName = (a: string, b: string) => a === b || lower(a) === lower(b);
/** Main, in the interface language too. */
export const isMain = (name: string) => sameName(name, MAIN_WORKSPACE.name) || sameName(name, t('Main'));

/** What a merge brought, for the report. */
export const mergedSummary = (from: string, plan: MergePlan): NonNullable<VersionsSummary['merged']> => ({
  from,
  tabs: plan.tabs.map((m: MergeTab) => ({ name: m.name, change: m.change, conflict: m.conflict, ...(m.items ? { items: m.items.length } : {}) })),
});

/** Everything a merge plan offers: every tab and item (as the app's merge dialog has them checked at first). */
export const takeAll = (plan: MergePlan) => new Set(plan.tabs.flatMap((m) => [...(!m.items || m.keys?.length ? [m.id] : []), ...(m.items ?? []).map((f) => `${m.id}/${f.id}`)]));

/** A branch's name not taken yet: "Branch 1", "Branch 2" … (in the interface language). */
export function nextBranch(names: string[]): string {
  let n = 0;
  for (const name of names) {
    const m = /^\S+ (\d+)$/.exec(name);
    if (m && (name.startsWith('Branch ') || name.startsWith(`${t('Branch')} `))) n = Math.max(n, Number(m[1]));
  }
  return `${t('Branch')} ${n + 1}`;
}

// ---------------------------------------------------------------------------
// A project file (Node): the document with its versions and the workspaces it is not in
// ---------------------------------------------------------------------------

export type ProjectDoc = CadDocument & { versions?: ProjectVersion[]; workspaces?: ProjectVersion[] };

/** A snapshot of the document's content (a version, a workspace kept). */
const snapshotOf = (doc: CadDocument) => ({ units: structuredClone(doc.units), tabs: structuredClone(doc.tabs), activeTab: doc.activeTab });

/** A version or kept workspace as a document (to take its content from). */
const asDocument = (doc: CadDocument, v: ProjectVersion): CadDocument => ({ ...doc, units: v.units, tabs: v.tabs, activeTab: v.activeTab });

/** The workspace the document is in, kept beside the others (to switch back to). */
function keep(doc: ProjectDoc, now: number): ProjectVersion[] {
  const ws = doc.workspace ?? MAIN_WORKSPACE;
  const kept: ProjectVersion = { id: ws.id, name: ws.name, created: now, ...(ws.base ? { base: ws.base } : {}), ...snapshotOf(doc) };
  return [...(doc.workspaces ?? []).filter((w) => w.id !== ws.id), kept];
}

function versionNamed(doc: ProjectDoc, name: string): ProjectVersion {
  const list = doc.versions ?? [];
  const v = list.find((x) => x.name === name) ?? list.find((x) => sameName(x.name, name));
  if (!v) throw new AgentError(`No version "${name}". Versions: ${list.map((x) => x.name).join(', ') || '(none)'}`);
  return v;
}

function workspaceNamed(doc: ProjectDoc, name: string): ProjectVersion {
  const list = doc.workspaces ?? [];
  const w = list.find((x) => x.name === name) ?? list.find((x) => sameName(x.name, name) || (isMain(name) && x.id === MAIN_WORKSPACE.id));
  if (!w) throw new AgentError(`No other workspace "${name}". Workspaces: ${[(doc.workspace ?? MAIN_WORKSPACE).name, ...list.map((x) => x.name)].join(', ')}`);
  return w;
}

/**
 * A version op on a project file: the file after it (and, for a merge, what it brought). A new version is returned
 * as `created` (Derived features may use it).
 */
export function applyVersionOp(doc: ProjectDoc, op: VersionOp, now = Date.now()): { doc: ProjectDoc; created?: ProjectVersion; merged?: VersionsSummary['merged'] } {
  switch (op.op) {
    case 'version': {
      const list = doc.versions ?? [];
      const name = op.name?.trim() || nextVersionName(list.map((v) => ({ kind: 'version', name: v.name }) as DocumentVersion));
      if (list.some((v) => sameName(v.name, name))) throw new AgentError(`There is a version "${name}" already`);
      const created: ProjectVersion = { id: uid('vr'), name, ...(op.description?.trim() ? { description: op.description.trim() } : {}), created: now, ...snapshotOf(doc) };
      return { doc: { ...doc, versions: [...list, created] }, created };
    }
    case 'branch': {
      const v = versionNamed(doc, op.from);
      const taken = [(doc.workspace ?? MAIN_WORKSPACE).name, ...(doc.workspaces ?? []).map((w) => w.name)];
      const name = op.name?.trim() || nextBranch(taken);
      if (taken.some((x) => sameName(x, name))) throw new AgentError(`There is a workspace "${name}" already`);
      const next: ProjectDoc = { ...withVersionContent(doc, asDocument(doc, structuredClone(v))), workspaces: keep(doc, now), workspace: { id: uid('ws'), name, base: v.id } };
      return { doc: next };
    }
    case 'workspace': {
      const cur = doc.workspace ?? MAIN_WORKSPACE;
      if (sameName(cur.name, op.name) || (isMain(op.name) && cur.id === MAIN_WORKSPACE.id)) return { doc };
      const w = workspaceNamed(doc, op.name);
      const next: ProjectDoc = { ...withVersionContent(doc, asDocument(doc, w)), workspaces: keep(doc, now).filter((x) => x.id !== w.id) };
      if (w.id === MAIN_WORKSPACE.id) delete next.workspace;
      else next.workspace = { id: w.id, name: w.name, ...(w.base ? { base: w.base } : {}) };
      return { doc: next };
    }
    case 'merge': {
      const w = workspaceNamed(doc, op.from);
      // the common base: the version the branch came from (merging Main into a branch: the open branch's own)
      const baseId = w.base ?? doc.workspace?.base;
      const base = baseId ? ((doc.versions ?? []).find((v) => v.id === baseId) ?? null) : null;
      const source = asDocument(doc, w);
      const plan = mergePlan(base && asDocument(doc, base), source, doc);
      const next = applyMerge(doc, source, plan, takeAll(plan), !!plan.units, base && asDocument(doc, base));
      return { doc: next, merged: mergedSummary(w.name, plan) };
    }
  }
}

/** A project file's versions and workspaces, for the report. */
export function summarizeVersions(doc: ProjectDoc): VersionsSummary {
  const ws = doc.workspace ?? MAIN_WORKSPACE;
  const name = (id?: string) => (id ? (doc.versions ?? []).find((v) => v.id === id)?.name : undefined);
  return {
    workspace: ws.name,
    ...(ws.base ? { base: name(ws.base) ?? ws.base } : {}),
    versions: (doc.versions ?? []).map((v) => ({ name: v.name, ...(v.description ? { description: v.description } : {}), created: new Date(v.created).toISOString() })),
    workspaces: (doc.workspaces ?? []).map((w) => ({ name: w.name, ...(w.base ? { base: name(w.base) ?? w.base } : {}) })),
  };
}
