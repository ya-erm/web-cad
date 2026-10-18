// Versions and history of a document (Onshape): what is saved when, how versions are named, what a restore puts
// back. The snapshots themselves are kept in IndexedDB (store/persistence.ts).

import type { CadDocument, DocTab, DocumentVersion, Feature } from './types';
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

/** A change of one item of a tab: a feature, a part, an instance, a mate, a view… */
export interface ItemChange {
  kind: 'added' | 'removed' | 'changed';
  what: 'feature' | 'part' | 'instance' | 'mate' | 'group' | 'relation' | 'explodedView' | 'view' | 'dimension' | 'note';
  /** Its name (a feature, an instance…) or id. */
  name: string;
  /** A feature's type; a drawing view's orientation. */
  type?: string;
  /** What changed in it: its own keys ("depth", "position", "suppressed", "name"…). */
  keys?: string[];
  /** Renamed: the name it had. */
  from?: string;
}

/** A change of a tab between two states of a document. */
export interface TabChange {
  kind: 'added' | 'removed' | 'changed';
  type: DocTab['type'];
  name: string;
  /** Renamed: the name it had. */
  from?: string;
  /** Changes of the tab itself: "order" of features, "rollback", "configuration", "configChoice", sheet keys… */
  keys: string[];
  items: ItemChange[];
}

export interface DocumentDiff {
  units?: { from: string; to: string };
  tabs: TabChange[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The keys of two objects whose values differ (`skip` left out). */
function changedKeys(a: object, b: object, skip: string[] = []): string[] {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => !skip.includes(k) && !same(ra[k], rb[k]));
}

/** Items of a list matched by id: added, removed, changed (and renamed). */
function listChanges<T extends { id: string }>(
  before: T[] | undefined,
  after: T[] | undefined,
  what: ItemChange['what'],
  nameOf: (x: T) => string,
  { keysOf = (a: T, b: T) => changedKeys(a, b, ['id', 'name']), typeOf }: { keysOf?: (a: T, b: T) => string[]; typeOf?: (x: T) => string } = {},
): ItemChange[] {
  const b = before ?? [];
  const a = after ?? [];
  const out: ItemChange[] = [];
  const item = (kind: ItemChange['kind'], x: T): ItemChange => ({ kind, what, name: nameOf(x), ...(typeOf ? { type: typeOf(x) } : {}) });
  for (const x of a) {
    const old = b.find((y) => y.id === x.id);
    if (!old) out.push(item('added', x));
    else if (!same(old, x)) {
      const keys = keysOf(old, x);
      const renamed = nameOf(old) !== nameOf(x);
      out.push({ ...item('changed', x), ...(keys.length ? { keys } : {}), ...(renamed ? { from: nameOf(old) } : {}) });
    }
  }
  for (const y of b) if (!a.some((x) => x.id === y.id)) out.push(item('removed', y));
  return out;
}

/** What changed from `before` (a version) to `after` (the workspace, another version): tabs and what is in them. */
export function compareDocuments(before: Pick<CadDocument, 'units' | 'tabs'>, after: Pick<CadDocument, 'units' | 'tabs'>): DocumentDiff {
  const out: DocumentDiff = { tabs: [] };
  if (!same(before.units, after.units)) out.units = { from: `${before.units.length}, ${before.units.angle}`, to: `${after.units.length}, ${after.units.angle}` };
  for (const t of after.tabs) {
    const old = before.tabs.find((x) => x.id === t.id);
    if (!old) {
      out.tabs.push({ kind: 'added', type: t.type, name: t.name, keys: [], items: [] });
      continue;
    }
    if (same(old, t)) continue;
    const keys: string[] = [];
    let items: ItemChange[] = [];
    if (t.type === 'partStudio' && old.type === 'partStudio') {
      // a feature: its params that changed, whether it is disabled, its name
      items = listChanges(old.features, t.features, 'feature', (f: Feature) => f.name, {
        keysOf: (a, b) => [...changedKeys(a.params, b.params), ...(!!a.suppressed !== !!b.suppressed ? ['suppressed'] : [])],
        typeOf: (f) => f.type,
      });
      const common = (fs: Feature[], other: Feature[]) => fs.filter((f) => other.some((g) => g.id === f.id)).map((f) => f.id);
      if (!same(common(old.features, t.features), common(t.features, old.features))) keys.push('order');
      if (old.rollback !== t.rollback) keys.push('rollback');
      if (!same(old.configuration, t.configuration)) keys.push('configuration');
      if (!same(old.configChoice, t.configChoice)) keys.push('configChoice');
      const parts = (s: typeof t) => Object.entries(s.parts).map(([id, m]) => ({ id, ...m }));
      items.push(...listChanges(parts(old), parts(t), 'part', (p) => p.name ?? p.id));
    } else if (t.type === 'assembly' && old.type === 'assembly') {
      items = [
        ...listChanges(old.instances, t.instances, 'instance', (i) => i.name),
        ...listChanges(old.mates, t.mates, 'mate', (m) => m.name),
        ...listChanges(old.groups, t.groups, 'group', (g) => g.name),
        ...listChanges(old.relations, t.relations, 'relation', (r) => r.name),
        ...listChanges(old.explodedViews, t.explodedViews, 'explodedView', (e) => e.name),
      ];
    } else if (t.type === 'drawing' && old.type === 'drawing') {
      items = [
        ...listChanges(old.drawing.views, t.drawing.views, 'view', (v) => v.label || v.orientation, { typeOf: (v) => v.orientation }),
        ...listChanges(old.drawing.dimensions, t.drawing.dimensions, 'dimension', (d) => d.id),
        ...listChanges(old.drawing.notes, t.drawing.notes, 'note', (n) => n.id),
      ];
      keys.push(...changedKeys(old.drawing, t.drawing, ['views', 'dimensions', 'notes']));
    }
    const renamed = old.name !== t.name;
    if (!items.length && !keys.length && !renamed) continue;
    out.tabs.push({ kind: 'changed', type: t.type, name: t.name, ...(renamed ? { from: old.name } : {}), keys, items });
  }
  for (const t of before.tabs) if (!after.tabs.some((x) => x.id === t.id)) out.tabs.push({ kind: 'removed', type: t.type, name: t.name, keys: [], items: [] });
  return out;
}

/** The workspace with a version's content: its tabs and units; the name stays, and the open tab if it is there. */
export function withVersionContent<T extends Pick<CadDocument, 'tabs' | 'units' | 'activeTab'>>(workspace: T, snapshot: CadDocument): T {
  const activeTab = snapshot.tabs.some((t) => t.id === workspace.activeTab) ? workspace.activeTab : snapshot.activeTab;
  return { ...workspace, tabs: structuredClone(snapshot.tabs), units: { ...snapshot.units }, activeTab };
}
