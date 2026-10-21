// Versions and history (Onshape): the button in the top bar with its panel — make a version, open one for viewing,
// restore it — and the banner over a version being viewed.

import { useState } from 'react';
import type { CadDocument, DocumentVersion, FeatureType, ViewOrientation } from '../core/types';
import { MAIN_WORKSPACE, mergeDependents, mergeNeeds, nextVersionName, type DocumentDiff, type ItemChange, type MergeItem, type MergePlan, type MergeTab } from '../core/versions';
import { FEATURE_LABELS } from '../core/features';
import { VIEW_NAMES } from '../drawing/sheet';
import { useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { compareOnModel, endCompare } from '../store/compare';
import { COMPARE_COLORS } from '../viewport/engine';
import {
  branchFromVersion,
  compareWithWorkspace,
  createVersion,
  currentWorkspace,
  deleteVersion,
  exitVersion,
  mergeWorkspace,
  nextBranchName,
  planMerge,
  restoreVersion,
  switchWorkspace,
  useVersions,
  viewVersion,
} from '../store/versions';
import { FORMS } from './forms';
import { FEATURE_ICONS } from './FeatureDialog';
import { Icon } from './icons';
import { getLang, t, tName } from '../i18n';

const REASONS: Record<NonNullable<DocumentVersion['reason']>, string> = {
  open: 'When the document was opened',
  edit: 'While editing',
  restore: 'Before a version was restored',
  merge: 'Before a merge',
};

const when = (time: number) => new Date(time).toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
/** A version by its name, an entry of the history by why it was saved. */
const title = (v: DocumentVersion) => (v.kind === 'version' ? v.name : t('Autosave'));

/** What changed items are, for people. */
const WHAT: Record<ItemChange['what'], string> = {
  feature: 'Feature',
  part: 'Part',
  instance: 'Instance',
  mate: 'Mate',
  group: 'Group',
  relation: 'Mate relation',
  explodedView: 'Exploded view',
  view: 'View',
  dimension: 'Dimension',
  note: 'Note',
  balloon: 'Balloon',
};

/** Names of changed keys that are not fields of a feature dialog. */
const KEYS: Record<string, string> = {
  suppressed: 'Disabled',
  entities: 'Sketch geometry',
  constraints: 'Constraints and dimensions',
  plane: 'Plane',
  order: 'Order of features',
  rollback: 'Rollback bar',
  configuration: 'Configuration',
  configChoice: 'Chosen option',
  position: 'Position',
  rotation: 'Rotation',
  fixed: 'Fixed',
  hidden: 'Hidden',
  flexible: 'Flexible',
  flex: 'Flexible',
  color: 'Color',
  name: 'Name',
  scale: 'Scale',
  orientation: 'Orientation',
  x: 'Position',
  y: 'Position',
  sheet: 'Format',
  landscape: 'Sheet orientation',
  title: 'Title',
  author: 'Author',
  designation: 'Designation',
  titleBlock: 'Title block',
  projection: 'Projection',
  parts: 'Parts',
  folders: 'Folders',
};

/** A changed key: the dialog's field of a feature, else a name from `KEYS`, else the key itself. */
function keyLabel(c: Pick<ItemChange, 'what' | 'type'> | null, key: string): string {
  const row = c?.what === 'feature' && c.type ? FORMS[c.type as FeatureType]?.find((r) => 'key' in r && r.key === key) : undefined;
  const label = row && 'label' in row && row.label ? row.label : KEYS[key];
  return label ? t(label) : key;
}

type Named = Pick<ItemChange, 'what' | 'name' | 'type'>;
/** A changed item's name: a feature's (translated), a standard view's, none for dimensions, notes and balloons. */
const itemName = (c: Named) =>
  c.what === 'feature' ? tName(c.name) : c.what === 'view' && c.type && c.name === c.type ? t(VIEW_NAMES[c.type as ViewOrientation] ?? c.name) : c.what === 'dimension' || c.what === 'note' || c.what === 'balloon' ? '' : c.name;
/** What a changed item is: a feature's type, else its kind. */
const itemWhat = (c: Named) => t(c.what === 'feature' && c.type ? (FEATURE_LABELS[c.type as FeatureType] ?? WHAT.feature) : WHAT[c.what]);

/** What changed from a version to the workspace, tab by tab. */
function DiffView({ version, diff, onBack, onModel }: { version: DocumentVersion; diff: DocumentDiff; onBack: () => void; onModel?: (tabId: string) => void }) {
  const mark = { added: '+', removed: '−', changed: '~' } as const;
  return (
    <div className="ver-diff">
      <div className="ver-diff-head">
        <button className="icon-btn" title={t('Back')} onClick={onBack}>
          <Icon name="undo" size={14} />
        </button>
        <span>
          <b>{title(version)}</b> → <b>{t('Workspace')}</b>
        </span>
      </div>
      {!diff.units && !diff.tabs.length && <div className="ver-empty">{t('No differences')}</div>}
      {diff.units && (
        <div className="ver-diff-line changed">
          <span className="ver-mark">~</span> {t('Units')}: {diff.units.from} → {diff.units.to}
        </div>
      )}
      {diff.tabs.map((tab) => (
        <div key={`${tab.kind}${tab.name}`} className="ver-diff-tab">
          <div className={'ver-diff-line tab ' + tab.kind}>
            <span className="ver-mark">{mark[tab.kind]}</span>
            <Icon name={tab.type === 'partStudio' ? 'partStudio' : tab.type === 'assembly' ? 'assembly' : 'drawing'} size={14} />
            <b>{tName(tab.name)}</b>
            {tab.from && <span className="ver-was">({t('was')} {tName(tab.from)})</span>}
            {tab.kind !== 'changed' && <span className="ver-was">{t(tab.kind === 'added' ? 'new tab' : 'tab deleted')}</span>}
            {/* a Part Studio changed: its faces new, changed and gone, on the model */}
            {onModel && tab.kind === 'changed' && tab.type === 'partStudio' && (
              <button className="btn small ver-on-model" title={t('Show the differences on the model')} onClick={() => onModel(tab.id)}>
                {t('On the model')}
              </button>
            )}
          </div>
          {tab.keys.map((k) => (
            <div key={k} className="ver-diff-line changed sub">
              <span className="ver-mark">~</span> {keyLabel(null, k)}
            </div>
          ))}
          {tab.items.map((c, n) => (
            <div key={n} className={'ver-diff-line sub ' + c.kind}>
              <span className="ver-mark">{mark[c.kind]}</span>
              <span>
                {/* a feature: its icon and name ("Fillet 1"), anything else: what it is and its name */}
                {c.what === 'feature' && c.type ? <Icon name={FEATURE_ICONS[c.type as FeatureType] ?? 'edit'} size={13} /> : itemWhat(c)}
                {itemName(c) && <b> {itemName(c)}</b>}
                {c.from && (
                  <span className="ver-was">
                    {' '}
                    ({t('was')} {c.what === 'feature' ? tName(c.from) : c.from})
                  </span>
                )}
                {c.keys?.length ? <span className="ver-keys">: {[...new Set(c.keys.map((k) => keyLabel(c, k)))].join(', ')}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A workspace's name for people: Main in the interface language. */
const wsName = (name: string) => (name === MAIN_WORKSPACE.name ? t('Main') : name);

/** What merging a workspace into the open one brings: the tabs to take (checked), the units; then Merge. */
function MergeView({ from, into, plan, onMerge, onBack }: { from: string; into: string; plan: MergePlan; onMerge: (take: Set<string>, units: boolean) => void; onBack: () => void }) {
  // what can be taken of a tab: itself (merged item by item: its own keys, if changed) and its items
  const keysOf = (m: MergeTab) => [...(!m.items || m.keys?.length ? [m.id] : []), ...(m.items ?? []).map((f) => `${m.id}/${f.id}`)];
  const [take, setTake] = useState(() => new Set(plan.tabs.flatMap(keysOf)));
  const [units, setUnits] = useState(!!plan.units);
  const mark = { added: '+', removed: '−', changed: '~' } as const;
  const what = { added: 'new tab', removed: 'tab deleted', changed: 'changed' } as const;
  const set = (keys: string[], on: boolean) => {
    const next = new Set(take);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setTake(next);
  };
  // an item comes with the items it refers to, and goes with the ones referring to it
  const setItem = (m: MergeTab, f: MergeItem, on: boolean) =>
    set(
      [f.id, ...(on ? mergeNeeds(m.items!, f.id) : mergeDependents(m.items!, f.id))].map((id) => `${m.id}/${id}`),
      on,
    );
  /** An item for people: a feature by its name, anything else — what it is and its name (a note: its text). */
  const label = (x: MergeItem) => (x.what === 'feature' ? tName(x.name) : [itemWhat(x), x.what === 'note' ? x.name : itemName(x)].filter(Boolean).join(' '));
  const itemLabel = (m: MergeTab, id: string) => {
    const x = m.items?.find((f) => f.id === id);
    return x ? label(x) : id;
  };
  /** Changed here too: the changes of both combined — unless both changed the same fields (the branch's taken). */
  const conflictText = (x: MergeItem) =>
    x.conflict === 'removed'
      ? t('deleted here')
      : x.clash?.length
        ? `${t('changed here too, from the branch')}: ${[...new Set(x.clash.map((k) => keyLabel(x, k)))].join(', ')}`
        : t('changed here too: the changes are combined');
  const any = units || plan.tabs.some((m) => keysOf(m).some((k) => take.has(k)));
  return (
    <div className="ver-diff">
      <div className="ver-diff-head">
        <button className="icon-btn" title={t('Back')} onClick={onBack}>
          <Icon name="undo" size={14} />
        </button>
        <span>
          <b>{wsName(from)}</b> → <b>{wsName(into)}</b>
        </span>
      </div>
      {!plan.tabs.length && !plan.units && <div className="ver-empty">{t('Nothing to merge: the branch has not changed anything the open workspace lacks.')}</div>}
      {plan.tabs.map((m) => {
        const keys = keysOf(m);
        const taken = keys.filter((k) => take.has(k)).length;
        return (
          <div key={m.id}>
            <label className={'ver-diff-line tab ver-merge ' + m.change}>
              <input
                type="checkbox"
                checked={taken === keys.length}
                ref={(el) => {
                  if (el) el.indeterminate = taken > 0 && taken < keys.length;
                }}
                onChange={(e) => set(keys, e.target.checked)}
              />
              <span className="ver-mark">{mark[m.change]}</span>
              <Icon name={m.type === 'partStudio' ? 'partStudio' : m.type === 'assembly' ? 'assembly' : 'drawing'} size={14} />
              <b>{tName(m.name)}</b>
              <span className="ver-was">{t(what[m.change])}</span>
              {m.conflict && !m.items && <span className="ver-conflict">{t('changed here too: the branch’s replaces it')}</span>}
            </label>
            {/* merged item by item: the tab's own keys, then each item */}
            {m.items && !!m.keys?.length && (
              <label className="ver-diff-line sub ver-merge changed">
                <input type="checkbox" checked={take.has(m.id)} onChange={(e) => set([m.id], e.target.checked)} />
                <span className="ver-mark">~</span>
                <span>
                  {t('Tab settings')}
                  <span className="ver-keys">: {[...new Set(m.keys.map((k) => keyLabel(null, k)))].join(', ')}</span>
                </span>
                {m.keysConflict && <span className="ver-conflict">{t('changed here too')}</span>}
              </label>
            )}
            {m.items?.map((f) => (
              <label
                key={f.id}
                className={'ver-diff-line sub ver-merge ' + f.change}
                title={f.needs.length ? `${t(f.change === 'removed' ? 'Removed with' : 'Taken with')}: ${f.needs.map((id) => itemLabel(m, id)).join(', ')}` : undefined}
              >
                <input type="checkbox" checked={take.has(`${m.id}/${f.id}`)} onChange={(e) => setItem(m, f, e.target.checked)} />
                <span className="ver-mark">{mark[f.change]}</span>
                <span>
                  {f.what === 'feature' && <Icon name={FEATURE_ICONS[f.type as FeatureType] ?? 'edit'} size={13} />} <b>{label(f)}</b>
                </span>
                {f.conflict && <span className="ver-conflict">{conflictText(f)}</span>}
              </label>
            ))}
          </div>
        );
      })}
      {plan.units && (
        <label className="ver-diff-line tab ver-merge changed">
          <input type="checkbox" checked={units} onChange={(e) => setUnits(e.target.checked)} />
          <span className="ver-mark">~</span> {t('Units')}: {plan.units.length}, {plan.units.angle}
        </label>
      )}
      <div className="ver-form-actions">
        <button className="btn small" onClick={onBack}>
          {t('Cancel')}
        </button>
        <button className="btn small primary" disabled={!any} onClick={() => onMerge(take, units)}>
          <Icon name="merge" size={12} /> {t('Merge')}
        </button>
      </div>
    </div>
  );
}

/** A new workspace from a version: its name (Branch 1…). */
function BranchForm({ versionId, onDone }: { versionId: string; onDone: () => void }) {
  const versions = useVersions((s) => s.versions);
  const [name, setName] = useState('');
  const create = async () => {
    resetEditor();
    await branchFromVersion(versionId, name);
    onDone();
  };
  return (
    <div className="ver-form" onKeyDown={(e) => e.stopPropagation()}>
      <label>{t('New branch')}</label>
      <input type="text" value={name} placeholder={nextBranchName(versions)} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
      <div className="ver-form-actions">
        <button className="btn small" onClick={onDone}>
          {t('Cancel')}
        </button>
        <button className="btn small primary" onClick={() => void create()}>
          <Icon name="branch" size={12} /> {t('Create branch')}
        </button>
      </div>
    </div>
  );
}

/** Whatever was being edited closes: the document changes under it. */
const resetEditor = () => useEditor.setState({ editing: null, sketch: null, selection: [], hover: null, activeField: null });

function NewVersionForm({ onDone }: { onDone: () => void }) {
  const versions = useVersions((s) => s.versions);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = async () => {
    await createVersion(name, description);
    onDone();
  };
  return (
    <div className="ver-form" onKeyDown={(e) => e.stopPropagation()}>
      <label>{t('Name')}</label>
      <input type="text" value={name} placeholder={nextVersionName(versions)} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
      <label>{t('Description')}</label>
      <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="ver-form-actions">
        <button className="btn small" onClick={onDone}>
          {t('Cancel')}
        </button>
        <button className="btn small primary" onClick={() => void create()}>
          {t('Create')}
        </button>
      </div>
    </div>
  );
}

function VersionsPanel({ onClose }: { onClose: () => void }) {
  const versions = useVersions((s) => s.versions);
  const viewing = useVersions((s) => s.viewing);
  const readOnly = useDoc((s) => s.readOnly);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(true);
  /** A click on the trash asks once more. */
  const [deleting, setDeleting] = useState<string | null>(null);
  /** A version compared with the workspace: the list gives way to the differences. */
  const [comparing, setComparing] = useState<{ version: DocumentVersion; diff: DocumentDiff } | null>(null);
  /** The version a new branch is being named for. */
  const [branching, setBranching] = useState<string | null>(null);
  /** A kept workspace whose merge into the open one is being looked at. */
  const [merging, setMerging] = useState<{ from: DocumentVersion; plan: MergePlan; source: CadDocument; base: CadDocument | null } | null>(null);
  const doc = useDoc((s) => s.doc);
  const workspace = currentWorkspace(viewing?.workspace.doc ?? doc);
  const compare = async (v: DocumentVersion) => {
    const diff = await compareWithWorkspace(v.id);
    if (diff) setComparing({ version: v, diff });
  };
  const shown = versions.filter((v) => v.kind !== 'workspace' && (history || v.kind === 'version'));
  const kept = versions.filter((v) => v.kind === 'workspace');
  const nameOf = (id?: string) => versions.find((v) => v.id === id)?.name ?? '?';
  if (merging)
    return (
      <div className="dropdown ver-panel">
        <div className="ver-head">
          <Icon name="merge" size={16} />
          <span className="ver-head-title">{t('Merge into the open workspace')}</span>
          <span className="spacer" />
          <button className="icon-btn" title={t('Close')} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <MergeView
          from={merging.from.name}
          into={workspace.name}
          plan={merging.plan}
          onBack={() => setMerging(null)}
          onMerge={(take, units) => {
            resetEditor();
            void mergeWorkspace(merging.source, merging.base, merging.plan, take, units).then(() => setMerging(null));
          }}
        />
      </div>
    );
  if (comparing)
    return (
      <div className="dropdown ver-panel">
        <div className="ver-head">
          <Icon name="history" size={16} />
          <span className="ver-head-title">{t('Compare with the workspace')}</span>
          <span className="spacer" />
          <button className="icon-btn" title={t('Close')} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <DiffView
          version={comparing.version}
          diff={comparing.diff}
          onBack={() => setComparing(null)}
          // the model shown is the workspace's (not a version being viewed)
          onModel={
            viewing
              ? undefined
              : (tabId) => {
                  resetEditor();
                  onClose();
                  void compareOnModel(comparing.version.id, tabId, title(comparing.version));
                }
          }
        />
      </div>
    );
  return (
    <div className="dropdown ver-panel" onMouseLeave={() => setDeleting(null)}>
      <div className="ver-head">
        <Icon name="history" size={16} />
        <span className="ver-head-title">{t('Versions and history')}</span>
        <span className="spacer" />
        <button className="icon-btn" title={t('Close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {creating ? (
        <NewVersionForm onDone={() => setCreating(false)} />
      ) : (
        <div className="ver-actions">
          <button className="btn small primary" disabled={readOnly} title={readOnly ? t('Return to the workspace to make a version') : undefined} onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} /> {t('Create version')}
          </button>
          <label className="fd-check">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            {t('Show history')}
          </label>
        </div>
      )}
      {/* the workspaces: the open one, the others kept (open, merge into the open one, delete) */}
      {(kept.length > 0 || workspace.id !== MAIN_WORKSPACE.id) && (
        <div className="ver-workspaces">
          <div className="ver-section">{t('Workspaces')}</div>
          <div className="ver-item ver-current">
            <Icon name="branch" size={16} />
            <div className="ver-text">
              <b>{wsName(workspace.name)}</b>
              <span>
                {t('open now')}
                {workspace.base ? ` · ${t('from')} ${nameOf(workspace.base)}` : ''}
              </span>
            </div>
          </div>
          {kept.map((w) => (
            <div key={w.id} className="ver-item">
              <Icon name="branch" size={16} />
              <div
                className="ver-text"
                title={t('Open this workspace')}
                onClick={() => {
                  resetEditor();
                  void switchWorkspace(w.id);
                }}
              >
                <b>{wsName(w.name)}</b>
                <span>
                  {when(w.created)}
                  {w.base ? ` · ${t('from')} ${nameOf(w.base)}` : ''}
                </span>
              </div>
              <div className="ver-buttons">
                <button
                  className="icon-btn"
                  title={t('Open this workspace')}
                  onClick={() => {
                    resetEditor();
                    void switchWorkspace(w.id);
                  }}
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  className="icon-btn"
                  title={t('Merge into the open workspace')}
                  disabled={readOnly && !viewing}
                  onClick={() => void planMerge(w.id).then((m) => m && setMerging({ from: w, ...m }))}
                >
                  <Icon name="merge" size={14} />
                </button>
                {w.name !== MAIN_WORKSPACE.name &&
                  (deleting === w.id ? (
                    <button
                      className="btn small danger"
                      onClick={() => {
                        setDeleting(null);
                        void deleteVersion(w.id);
                      }}
                    >
                      {t('Delete')}?
                    </button>
                  ) : (
                    <button className="icon-btn" title={t('Delete')} onClick={() => setDeleting(w.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <div className="ver-section">{t('Versions')}</div>
        </div>
      )}
      <div className="ver-list">
        {!shown.length && <div className="ver-empty">{t('No versions yet. A version is a snapshot of the document to come back to.')}</div>}
        {viewing && (
          <div className="ver-item ver-workspace" onClick={exitVersion}>
            <Icon name="edit" size={16} />
            <div className="ver-text">
              <b>{t('Workspace')}</b>
              <span>{t('Return to the workspace')}</span>
            </div>
          </div>
        )}
        {shown.map((v) => (
          <div key={v.id}>
          <div className={'ver-item' + (v.kind === 'auto' ? ' auto' : '') + (viewing?.version.id === v.id ? ' viewing' : '')}>
            <Icon name={v.kind === 'version' ? 'star' : 'history'} size={16} />
            <div className="ver-text" title={t('Open for viewing')} onClick={() => void viewVersion(v.id).then((ok) => ok && resetEditor())}>
              <b>{title(v)}</b>
              <span>
                {when(v.created)}
                {v.reason ? ` · ${t(REASONS[v.reason])}` : ''}
              </span>
              {v.description && <span className="ver-desc">{v.description}</span>}
            </div>
            <div className="ver-buttons">
              <button className="icon-btn" title={t('Open for viewing')} onClick={() => void viewVersion(v.id).then((ok) => ok && resetEditor())}>
                <Icon name="eye" size={14} />
              </button>
              <button className="icon-btn" title={t('Compare with the workspace')} onClick={() => void compare(v)}>
                <Icon name="compare" size={14} />
              </button>
              {v.kind === 'version' && (
                <button className="icon-btn" title={t('Branch to create workspace')} onClick={() => setBranching(branching === v.id ? null : v.id)}>
                  <Icon name="branch" size={14} />
                </button>
              )}
              <button
                className="icon-btn"
                title={t('Restore this version')}
                onClick={() => {
                  resetEditor();
                  void restoreVersion(v.id);
                }}
              >
                <Icon name="rollback" size={14} />
              </button>
              {deleting === v.id ? (
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (viewing?.version.id === v.id) exitVersion();
                    setDeleting(null);
                    void deleteVersion(v.id);
                  }}
                >
                  {t('Delete')}?
                </button>
              ) : (
                <button className="icon-btn" title={t('Delete')} onClick={() => setDeleting(v.id)}>
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          </div>
          {branching === v.id && <BranchForm versionId={v.id} onDone={() => setBranching(null)} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The top bar's button: the number of versions; highlighted while one is viewed. */
export function VersionsButton() {
  const [open, setOpen] = useState(false);
  const count = useVersions((s) => s.versions.filter((v) => v.kind === 'version').length);
  const viewing = useVersions((s) => !!s.viewing);
  // a branch open: its name on the button
  const branch = useDoc((s) => s.doc?.workspace?.name);
  return (
    <div className="menu-wrap">
      <button className={'btn small ver-button' + (open || viewing ? ' active' : '')} title={t('Versions and history')} onClick={() => setOpen(!open)}>
        <Icon name="history" size={14} /> {t('Versions')}
        {count > 0 && <span className="ver-count">{count}</span>}
        {branch && <span className="ver-branch">{branch}</span>}
      </button>
      {open && <VersionsPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Over the model compared with a version: with what, the colours' legend, Hide. */
export function CompareBanner() {
  const cmp = useEditor((s) => s.compare);
  if (!cmp) return null;
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const none = !cmp.pending && !Object.keys(cmp.changed).length && !cmp.ghost.length;
  return (
    <div className="version-banner compare-banner">
      <Icon name="history" size={16} />
      <span>
        {t('Compared with')} <b>{tName(cmp.label)}</b>
        {cmp.pending && <> — {t('building the version…')}</>}
        {none && <> — {t('the geometry is the same')}</>}
      </span>
      {!cmp.pending && !none && (
        <>
          <span className="cmp-key">
            <i style={{ background: hex(COMPARE_COLORS.changed) }} /> {t('New or changed')}
          </span>
          <span className="cmp-key">
            <i style={{ background: hex(COMPARE_COLORS.removed), opacity: 0.6 }} /> {t('Removed')}
          </span>
        </>
      )}
      <span className="spacer" />
      <button className="btn small" onClick={endCompare}>
        {t('Hide')}
      </button>
    </div>
  );
}

/** Over a version being viewed: what it is, restore it, back to the workspace. */
export function VersionBanner() {
  const viewing = useVersions((s) => s.viewing);
  if (!viewing) return null;
  const v = viewing.version;
  return (
    <div className="version-banner">
      <Icon name="history" size={16} />
      <span>
        {t('Viewing')} <b>{title(v)}</b> · {when(v.created)} — {t('read only')}
      </span>
      <span className="spacer" />
      <button
        className="btn small"
        onClick={() => {
          resetEditor();
          void restoreVersion(v.id);
        }}
      >
        <Icon name="rollback" size={14} /> {t('Restore this version')}
      </button>
      <button
        className="btn small primary"
        onClick={() => {
          resetEditor();
          exitVersion();
        }}
      >
        {t('Return to the workspace')}
      </button>
    </div>
  );
}
