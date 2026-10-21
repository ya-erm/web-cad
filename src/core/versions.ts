// Versions and history of a document (Onshape): what is saved when, how versions are named, what a restore puts
// back. The snapshots themselves are kept in IndexedDB (store/persistence.ts).

import type { CadDocument, DocTab, DocumentVersion, DrawingNote, DrawingView, Feature, PartStudioTab, Workspace } from './types';
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
  what: 'feature' | 'part' | 'instance' | 'mate' | 'group' | 'relation' | 'explodedView' | 'view' | 'dimension' | 'note' | 'balloon';
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
  id: string;
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
      out.tabs.push({ kind: 'added', id: t.id, type: t.type, name: t.name, keys: [], items: [] });
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
        ...listChanges(old.drawing.balloons ?? [], t.drawing.balloons ?? [], 'balloon', (n) => n.id),
      ];
      keys.push(...changedKeys(old.drawing, t.drawing, ['views', 'dimensions', 'notes', 'balloons']));
    }
    const renamed = old.name !== t.name;
    if (!items.length && !keys.length && !renamed) continue;
    out.tabs.push({ kind: 'changed', id: t.id, type: t.type, name: t.name, ...(renamed ? { from: old.name } : {}), keys, items });
  }
  for (const t of before.tabs) if (!after.tabs.some((x) => x.id === t.id)) out.tabs.push({ kind: 'removed', id: t.id, type: t.type, name: t.name, keys: [], items: [] });
  return out;
}

/** The workspace a document is in when it has none of its own: Main. */
export const MAIN_WORKSPACE: Workspace = { id: 'main', name: 'Main' };

/** What a merge of a workspace into another does to one tab. */
export interface MergeTab {
  id: string;
  name: string;
  type: DocTab['type'];
  /** In the source: added, removed or changed since the base. */
  change: 'added' | 'removed' | 'changed';
  /** Changed in the target too since the base: the source's tab replaces it (unless left out). */
  conflict: boolean;
  /**
   * A tab the base, the source and the target all have: merged item by item — what the source did to its features
   * (a Part Studio), instances, mates… (an assembly), views, dimensions… (a drawing), taken one by one
   * (`tabId/itemId`), and the keys of the tab itself it changed (its name, parts, rollback bar, sheet, title block…:
   * taken together, `tabId`). None: the tab is taken whole.
   */
  items?: MergeItem[];
  keys?: string[];
  /** Some of `keys` the target changed too. */
  keysConflict?: boolean;
}

/** An item of a tab (a feature, an instance, a view…) the source added, changed or removed since the base: taken (or not) on its own. */
export interface MergeItem {
  id: string;
  /** Its list in the tab ("features", "mates", "views"…) and what it is. */
  list: string;
  what: ItemChange['what'];
  name: string;
  /** A feature's type; a drawing view's orientation. */
  type?: string;
  change: 'added' | 'removed' | 'changed';
  /** What the target did to it since the base: changed it too, or removed it. */
  conflict?: 'changed' | 'removed';
  /** Changed on both sides: the keys both changed differently ("depth", "position"…) — the source's are taken. */
  clash?: string[];
  /**
   * The items of the merge it refers to (by id, a variable by its name): taken with it. An item the source removed:
   * the removed items that referred to it (a mate of a removed instance) — removed with it.
   */
  needs: string[];
}

export interface MergePlan {
  tabs: MergeTab[];
  /** The source's units, when it changed them. */
  units?: CadDocument['units'];
}

interface Item {
  id: string;
  name?: string;
}

/** A list of a tab whose items merge one by one: where it is, what its items are called. */
interface MergeList {
  list: string;
  what: ItemChange['what'];
  get: (tab: DocTab) => Item[] | undefined;
  set: (tab: DocTab, items: Item[]) => void;
  name: (x: Item) => string;
  type?: (x: Item) => string | undefined;
  /** Its order matters (features): reordered by the source, the tab is taken whole. */
  ordered?: boolean;
}

/** A list of a tab, `key` of the tab itself (or, `drawing`, of its drawing). */
function list(key: string, what: ItemChange['what'], over: Partial<MergeList> = {}, drawing = false): MergeList {
  const holder = (tab: DocTab) => (drawing && tab.type === 'drawing' ? tab.drawing : tab) as unknown as Record<string, Item[] | undefined>;
  return { list: key, what, get: (tab) => holder(tab)[key], set: (tab, items) => void (holder(tab)[key] = items), name: (x) => x.name ?? x.id, ...over };
}

const MERGE_LISTS: Record<DocTab['type'], MergeList[]> = {
  partStudio: [list('features', 'feature', { type: (f) => (f as Feature).type, ordered: true })],
  assembly: [list('instances', 'instance'), list('mates', 'mate'), list('groups', 'group'), list('relations', 'relation'), list('explodedViews', 'explodedView')],
  drawing: [
    list('views', 'view', { name: (v) => (v as DrawingView).label || (v as DrawingView).orientation, type: (v) => (v as DrawingView).orientation }, true),
    list('dimensions', 'dimension', {}, true),
    list('notes', 'note', { name: (n) => (n as DrawingNote).text?.split('\n')[0] ?? '' }, true),
    list('balloons', 'balloon', { name: () => '' }, true),
  ],
};

/** The keys of a tab itself (not its lists, id or type) — of a drawing: its name and its drawing's keys. */
function ownOf(tab: DocTab): Record<string, unknown> {
  const lists = new Set(MERGE_LISTS[tab.type].map((l) => l.list));
  const src: object = tab.type === 'drawing' ? { name: tab.name, ...tab.drawing } : tab;
  return Object.fromEntries(Object.entries(src).filter(([k]) => k !== 'id' && k !== 'type' && !lists.has(k)));
}

function setOwn(tab: DocTab, key: string, value: unknown) {
  const o = (tab.type === 'drawing' && key !== 'name' ? tab.drawing : tab) as unknown as Record<string, unknown>;
  if (value === undefined) delete o[key];
  else o[key] = structuredClone(value);
}

/** The ids of the items both lists have, in the order of the first. */
const commonOrder = (xs: Item[], other: Item[]) => xs.filter((x) => other.some((y) => y.id === x.id)).map((x) => x.id);

/** Whether an item (as JSON) refers to another one: by its id (a feature's parts, sketch entities…), a variable by `#name`. */
function refersTo(json: string, x: Item): boolean {
  if (json.includes(x.id)) return true;
  const f = x as Feature;
  if (f.type !== 'variable' || !f.params?.name) return false;
  return new RegExp(`#${f.params.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(json);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A value changed on both sides, three-way: each side's changes — the source's where both changed it (its key to `clash`). */
function mergeFields(b: unknown, s: unknown, t: unknown, key: string, clash: string[]): unknown {
  if (same(s, t) || same(t, b)) return s;
  if (same(s, b)) return t;
  if (isRecord(b) && isRecord(s) && isRecord(t)) {
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(t), ...Object.keys(s), ...Object.keys(b)])) {
      const v = mergeFields(b[k], s[k], t[k], k, clash);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  clash.push(key);
  return s;
}

/**
 * An item the source changed, as the target has it (changed too, maybe): the changes of both, field by field — the
 * source's where both changed the same field (`clash`: those keys). A sketch's geometry (entities, constraints and
 * patterns) goes as one: the source's if both changed it.
 */
function mergeItem(what: ItemChange['what'], b: Item, s: Item, t: Item): { value: Item; clash: string[] } {
  const clash: string[] = [];
  const sk = (x: Item) => (x as Feature).params as unknown as Record<string, unknown>;
  if (what === 'feature' && (s as Feature).type === 'sketch') {
    const geo = (x: Item) => [sk(x).entities, sk(x).constraints, sk(x).patterns];
    if (!same(geo(s), geo(b)) && !same(geo(t), geo(b))) {
      if (!same(geo(s), geo(t))) clash.push('entities');
      t = { ...t, params: { ...sk(t), entities: sk(s).entities, constraints: sk(s).constraints, patterns: sk(s).patterns } } as Item;
    }
  }
  return { value: structuredClone(mergeFields(b, s, t, '', clash)) as Item, clash: [...new Set(clash)] };
}

/**
 * What the source did to a tab since the base, item by item (its features, instances, views…), and to the tab itself.
 * Null when its items cannot be merged one by one: the source reordered features (the tab is then taken whole).
 */
function tabChanges(b: DocTab, s: DocTab, t: DocTab): Pick<MergeTab, 'items' | 'keys' | 'keysConflict'> | null {
  const items: MergeItem[] = [];
  /** By item id: its list and the item as the base, the source, the target have it. */
  const all = new Map<string, { L: MergeList; b?: Item; s?: Item; t?: Item }>();
  for (const L of MERGE_LISTS[s.type]) {
    const [bl, sl, tl] = [L.get(b) ?? [], L.get(s) ?? [], L.get(t) ?? []];
    if (L.ordered && !same(commonOrder(sl, bl), commonOrder(bl, sl))) return null;
    // the source's order, then the ones it removed
    for (const x of [...sl, ...bl]) {
      if (all.has(x.id)) continue;
      const e = { L, b: bl.find((y) => y.id === x.id), s: sl.find((y) => y.id === x.id), t: tl.find((y) => y.id === x.id) };
      all.set(x.id, e);
      if (same(e.s, e.b) || same(e.s, e.t)) continue;
      const it = (e.s ?? e.b)!;
      const conflict = !e.b || same(e.t, e.b) ? undefined : e.t ? 'changed' : 'removed';
      const clash = conflict === 'changed' && e.s ? mergeItem(L.what, e.b!, e.s, e.t!).clash : [];
      const type = L.type?.(it);
      items.push({
        id: x.id,
        list: L.list,
        what: L.what,
        name: L.name(it),
        ...(type ? { type } : {}),
        change: !e.s ? 'removed' : !e.b ? 'added' : 'changed',
        ...(conflict ? { conflict } : {}),
        ...(clash.length ? { clash } : {}),
        needs: [],
      });
    }
  }
  for (const m of items) {
    const e = all.get(m.id)!;
    // what it refers to that the target has not got (to come with it); removed: the removed items that referred to
    // it (to go with it)
    if (m.change === 'removed') m.needs = items.filter((o) => o !== m && o.change === 'removed' && refersTo(JSON.stringify(all.get(o.id)!.b), e.b!)).map((o) => o.id);
    else {
      const json = JSON.stringify(e.s);
      m.needs = items.filter((o) => o !== m && (o.change === 'added' || o.conflict === 'removed') && refersTo(json, all.get(o.id)!.s!)).map((o) => o.id);
    }
  }
  const [ob, os, ot] = [ownOf(b), ownOf(s), ownOf(t)];
  const keys = [...new Set([...Object.keys(os), ...Object.keys(ob)])].filter((k) => !same(os[k], ob[k]) && !same(os[k], ot[k]));
  // the target changed it too: the same part (a Part Studio's parts merge one by one, its hidden features too)
  const parts = (o: Record<string, unknown>) => (o.parts ?? {}) as Record<string, unknown>;
  const keysConflict = keys.some((k) =>
    k === 'hidden'
      ? false
      : k === 'parts'
        ? Object.keys({ ...parts(os), ...parts(ob) }).some((id) => !same(parts(os)[id], parts(ob)[id]) && !same(parts(ot)[id], parts(ob)[id]) && !same(parts(os)[id], parts(ot)[id]))
        : !same(ot[k], ob[k]),
  );
  return { items, keys, ...(keysConflict ? { keysConflict } : {}) };
}

/** The items of a merge to take with `id`: what it refers to, and what those refer to… */
export function mergeNeeds(features: MergeItem[], id: string): string[] {
  const out = new Set<string>();
  const visit = (x: string) => {
    for (const n of features.find((f) => f.id === x)?.needs ?? []) if (!out.has(n)) out.add(n), visit(n);
  };
  visit(id);
  return [...out];
}

/** The items of a merge that refer to `id` (or to those that do…): left out with it. */
export function mergeDependents(features: MergeItem[], id: string): string[] {
  const out = new Set<string>();
  const visit = (x: string) => {
    for (const f of features) if (f.needs.includes(x) && !out.has(f.id)) out.add(f.id), visit(f.id);
  };
  visit(id);
  return [...out];
}

/**
 * What merging `source` into `target` brings, tab by tab (Onshape: Merge into current workspace): what the source
 * changed since `base` (the version it was branched from); a tab the target changed too is a conflict. Without a base
 * every tab that differs is the source's to take (a tab only the target has stays).
 */
export function mergePlan(base: Pick<CadDocument, 'units' | 'tabs'> | null, source: Pick<CadDocument, 'units' | 'tabs'>, target: Pick<CadDocument, 'units' | 'tabs'>): MergePlan {
  const tabs: MergeTab[] = [];
  const byId = (d: Pick<CadDocument, 'tabs'> | null, id: string) => d?.tabs.find((t) => t.id === id);
  const ids = [...new Set([...source.tabs, ...(base?.tabs ?? [])].map((t) => t.id))];
  for (const id of ids) {
    const s = byId(source, id);
    const t = byId(target, id);
    const b = byId(base, id);
    if (same(s, t)) continue;
    // nothing the source did to it (or no base: a tab the source has not got is the target's)
    if (base ? same(s, b) : !s) continue;
    const tab = (s ?? b)!;
    // (a tab the target has not got: the source's to add — new there, or removed here while changed there)
    const change: MergeTab['change'] = !s ? 'removed' : !t ? 'added' : 'changed';
    // the target changed it too (or has it when the source added it)
    const conflict = base ? !same(t, b) : false;
    const items = change === 'changed' && b && s && t && b.type === s.type && t.type === s.type ? tabChanges(b, s, t) : null;
    tabs.push({ id, name: tab.name, type: tab.type, change, conflict, ...items });
  }
  const unitsChanged = !same(source.units, target.units) && (!base || !same(source.units, base.units));
  return { tabs, ...(unitsChanged ? { units: { ...source.units } } : {}) };
}

/**
 * The rollback bar of `list` where it was in `from` (`r` features applied there): after the same feature — the
 * nearest one before it that `list` has; null (all) stays.
 */
function rollbackIn(list: Feature[], from: Feature[], r: number | null): number | null {
  if (r === null) return null;
  for (let k = Math.min(r, from.length) - 1; k >= 0; k--) {
    const at = list.findIndex((f) => f.id === from[k].id);
    if (at >= 0) return at + 1;
  }
  return 0;
}

/**
 * A tab merged item by item: the target's, with the source's items `take` has (`tabId/itemId`) — changed in place
 * (with the target's own changes of them: field by field), removed, added after the item before them in the
 * source — and, if `take` has the tab's id, the tab's keys the source changed (a Part Studio's parts and hidden
 * features: each as the source changed it).
 */
function mergeTabItems(b: DocTab, s: DocTab, t: DocTab, m: MergeTab, take: Set<string>): DocTab {
  const out = structuredClone(t);
  for (const L of MERGE_LISTS[t.type]) {
    const [bl, sl] = [L.get(b) ?? [], L.get(s) ?? []];
    const items = [...(L.get(out) ?? [])];
    let touched = false;
    for (const x of m.items ?? []) {
      if (x.list !== L.list || !take.has(`${m.id}/${x.id}`)) continue;
      touched = true;
      const sx = sl.find((y) => y.id === x.id);
      const bx = bl.find((y) => y.id === x.id);
      const at = items.findIndex((y) => y.id === x.id);
      if (!sx) {
        if (at >= 0) items.splice(at, 1);
      } else if (at >= 0) items[at] = bx ? mergeItem(L.what, bx, sx, items[at]).value : structuredClone(sx);
      else {
        let pos = 0;
        for (let k = sl.indexOf(sx) - 1; k >= 0 && !pos; k--) pos = items.findIndex((y) => y.id === sl[k].id) + 1;
        items.splice(pos, 0, structuredClone(sx));
      }
    }
    if (touched && (items.length || L.get(t))) L.set(out, items);
  }
  const keys = take.has(m.id) ? (m.keys ?? []) : [];
  const [ob, os, ot] = [ownOf(b), ownOf(s), ownOf(t)];
  for (const k of keys) {
    if (k === 'rollback') continue;
    if (k === 'parts' && out.type === 'partStudio') {
      // each part as the source has it, if it changed it
      const [bp, sp] = [ob.parts as PartStudioTab['parts'], os.parts as PartStudioTab['parts']];
      for (const id of new Set([...Object.keys(sp), ...Object.keys(bp)]))
        if (!same(sp[id], bp[id])) {
          if (sp[id]) out.parts[id] = structuredClone(sp[id]);
          else delete out.parts[id];
        }
    } else if (k === 'hidden' && out.type === 'partStudio') {
      const [bh, sh] = [(ob.hidden ?? []) as string[], (os.hidden ?? []) as string[]];
      const hidden = new Set((ot.hidden ?? []) as string[]);
      for (const id of sh) if (!bh.includes(id)) hidden.add(id);
      for (const id of bh) if (!sh.includes(id)) hidden.delete(id);
      out.hidden = [...hidden];
    } else setOwn(out, k, os[k]);
  }
  if (out.type === 'partStudio' && s.type === 'partStudio' && t.type === 'partStudio')
    out.rollback = keys.includes('rollback') ? rollbackIn(out.features, s.features, s.rollback) : rollbackIn(out.features, t.features, t.rollback);
  return out;
}

/**
 * The target with what the plan brings: the tabs `take` (ids) as the source has them (added at the end, replaced in
 * place, removed), the source's units if `units`. A tab merged item by item (`MergeTab.items`) takes the items `take`
 * has (`tabId/itemId`) and its own keys if it has its id; it needs the `base`. The open tab stays if it is still there.
 */
export function applyMerge<T extends Pick<CadDocument, 'units' | 'tabs' | 'activeTab'>>(
  target: T,
  source: Pick<CadDocument, 'tabs'>,
  plan: MergePlan,
  take: Set<string>,
  units: boolean,
  base?: Pick<CadDocument, 'tabs'> | null,
): T {
  let tabs = [...target.tabs];
  for (const m of plan.tabs) {
    const s = source.tabs.find((t) => t.id === m.id);
    const at = tabs.findIndex((t) => t.id === m.id);
    if (m.items) {
      const t = tabs[at];
      const b = base?.tabs.find((x) => x.id === m.id);
      if (t && s && b && t.type === s.type && b.type === s.type) tabs[at] = mergeTabItems(b, s, t, m, take);
      continue;
    }
    if (!take.has(m.id)) continue;
    if (!s) tabs = tabs.filter((t) => t.id !== m.id);
    else if (at >= 0) tabs[at] = structuredClone(s);
    else tabs.push(structuredClone(s));
  }
  const activeTab = tabs.some((t) => t.id === target.activeTab) ? target.activeTab : (tabs[0]?.id ?? '');
  return { ...target, tabs, units: units && plan.units ? { ...plan.units } : target.units, activeTab };
}

/** The workspace with a version's content: its tabs and units; the name stays, and the open tab if it is there. */
export function withVersionContent<T extends Pick<CadDocument, 'tabs' | 'units' | 'activeTab'>>(workspace: T, snapshot: CadDocument): T {
  const activeTab = snapshot.tabs.some((t) => t.id === workspace.activeTab) ? workspace.activeTab : snapshot.activeTab;
  return { ...workspace, tabs: structuredClone(snapshot.tabs), units: { ...snapshot.units }, activeTab };
}
