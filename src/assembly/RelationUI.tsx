// Mate relations (Onshape Gear / Rack and pinion / Screw relations): tie the free motions of mates.

import { useEffect } from 'react';
import { create } from 'zustand';
import type { AssemblyMate, AssemblyTab, MateRelation, MateRelationType } from '../core/types';
import { activeAssembly, useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { requestRebuild } from '../store/rebuild';
import { uid } from '../core/ids';
import { LENGTH_FACTOR } from '../core/expr';
import { Icon } from '../ui/icons';
import { t, tIn } from '../i18n';
import { composeAssembly } from './compose';
import { applySolve, makeRelation, RELATION_MATES, relationName } from './mates';
import { useAssembly } from './sources';
import { commitAssembly, NumField } from './AssemblyUI';

export const RELATION_TYPES: [MateRelationType, string][] = [
  ['gear', 'Gear'],
  ['rackPinion', 'Rack and pinion'],
  ['screw', 'Screw'],
];

export const relationTypeLabel = (ty: MateRelationType) => tIn('relation', RELATION_TYPES.find(([v]) => v === ty)?.[1] ?? ty);

interface RelationDraft {
  editing?: string;
  name?: string;
  type: MateRelationType;
  a?: string;
  b?: string;
  value: number;
  reverse: boolean;
}

const useRelation = create<{ draft: RelationDraft | null }>(() => ({ draft: null }));

export function relationDialogOpen() {
  return useRelation.getState().draft !== null;
}

/** Keys of the open relation dialog: Enter accepts, Esc cancels. */
export function relationDialogKey(e: KeyboardEvent): boolean {
  if (!useRelation.getState().draft) return false;
  const buttons = document.querySelectorAll<HTMLButtonElement>('.relation-dialog .fd-header button');
  if (e.key === 'Escape') buttons[1]?.click();
  else if (e.key === 'Enter') buttons[0]?.click();
  else return false;
  return true;
}

/** Open the relation dialog: a new relation, or an existing one to edit. */
export function startRelation(r?: MateRelation) {
  // the dialog takes the place of the position panel
  useEditor.getState().setSelection([]);
  useRelation.setState({
    draft: r ? { editing: r.id, name: r.name, type: r.type, a: r.a, b: r.b, value: r.value, reverse: !!r.reverse } : { type: 'gear', value: 1, reverse: false },
  });
}

/** Mates that can be the first / second end of a relation of this type. */
function candidates(asm: AssemblyTab, type: MateRelationType, end: 0 | 1): AssemblyMate[] {
  return (asm.mates ?? []).filter((m) => !m.suppressed && RELATION_MATES[type][end].includes(m.type));
}

/** The assembly with the draft relation in place (and solved); the relation's zero is the current placement. */
function withDraft(asm: AssemblyTab, d: RelationDraft): { tab: AssemblyTab; relation: MateRelation | null; failed: string[] } {
  const tab = structuredClone(asm) as AssemblyTab;
  const b = d.type === 'screw' ? d.a : d.b;
  if (!d.a || !b || !(d.value > 0)) return { tab, relation: null, failed: [] };
  const sources = useAssembly.getState().sources;
  const old = (tab.relations ?? []).find((r) => r.id === d.editing);
  const base = { id: d.editing ?? uid('rl'), name: d.name ?? relationName(tab, d.type), type: d.type, a: d.a, b, value: d.value, ...(d.reverse ? { reverse: true } : {}) };
  // an edited relation over the same mates keeps its zero (and its count of turns)
  const relation: MateRelation =
    old && old.type === d.type && old.a === base.a && old.b === base.b ? { ...base, zero: old.zero, last: old.last } : makeRelation(tab, sources, base);
  const list = (tab.relations ?? []).filter((r) => r.id !== relation.id);
  tab.relations = [...list, relation];
  const failed = applySolve(tab, sources);
  return { tab, relation, failed };
}

export function RelationDialog() {
  const draft = useRelation((s) => s.draft);
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const sources = useAssembly((s) => s.sources);
  useEffect(() => {
    if (draft && asm) useEditor.setState({ build: composeAssembly(withDraft(asm, draft).tab, sources).build });
  }, [draft, asm, sources]);
  if (!draft || !asm || !doc) return null;
  const preview = withDraft(asm, draft);
  const close = () => {
    useRelation.setState({ draft: null });
    requestRebuild();
  };
  const ok = () => {
    const r = preview.relation;
    if (!r) return;
    commitAssembly((a) => void (a.relations = [...(a.relations ?? []).filter((x) => x.id !== r.id), r]));
    useRelation.setState({ draft: null });
  };
  const set = (patch: Partial<RelationDraft>) => useRelation.setState({ draft: { ...draft, ...patch } });
  const unit = doc.units.length;
  const k = LENGTH_FACTOR[unit];
  const mateSelect = (label: string, end: 0 | 1, value: string | undefined, onChange: (id: string) => void) => {
    const list = candidates(asm, draft.type, end);
    return (
      <div className="fd-row">
        <label>{label}</label>
        <div className="fd-control">
          <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>
              {list.length ? t('Select a mate') : t('No suitable mates')}
            </option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };
  const [first, second] =
    draft.type === 'gear' ? [t('First gear'), t('Second gear')] : draft.type === 'rackPinion' ? [t('Pinion'), t('Rack')] : [t('Cylindrical mate'), ''];
  const valueLabel = draft.type === 'gear' ? t('Ratio') : draft.type === 'rackPinion' ? t('Pitch diameter') : t('Pitch');
  const conflict = !!preview.relation && preview.failed.includes(preview.relation.id);
  return (
    <div className="feature-dialog relation-dialog" onKeyDown={(e) => e.stopPropagation()}>
      <div className="fd-header">
        <Icon name="gear" size={18} />
        <span className="fd-title">{draft.name ? draft.name.replace(/^(Gear|Rack and pinion|Screw)(?= \d+$)/, (s) => tIn('relation', s)) : t('Mate relation')}</span>
        <button className="icon-btn" title={`${t('Accept')} (Enter)`} disabled={!preview.relation} onClick={ok}>
          <Icon name="check" size={18} />
        </button>
        <button className="icon-btn" title={`${t('Cancel')} (Esc)`} onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="fd-body">
        <div className="fd-row">
          <label>{t('Relation type')}</label>
          <div className="fd-control">
            <select value={draft.type} onChange={(e) => set({ type: e.target.value as MateRelationType, a: undefined, b: undefined, value: e.target.value === 'gear' ? 1 : 10 * k })}>
              {RELATION_TYPES.map(([v]) => (
                <option key={v} value={v}>
                  {relationTypeLabel(v)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {mateSelect(first, 0, draft.a, (id) => set({ a: id }))}
        {draft.type !== 'screw' && mateSelect(second, 1, draft.b, (id) => set({ b: id }))}
        <div className="fd-row" title={draft.type === 'gear' ? t('Turns of the second gear per turn of the first') : draft.type === 'rackPinion' ? t('The rack travels this diameter × π per turn of the pinion') : t('Travel per turn')}>
          <label>{valueLabel}</label>
          <div className="fd-control">
            {draft.type === 'gear' ? (
              <NumField value={draft.value} onCommit={(v) => v > 0 && set({ value: v })} suffix="" />
            ) : (
              <NumField value={draft.value / k} onCommit={(v) => v > 0 && set({ value: v * k })} suffix={unit} />
            )}
          </div>
        </div>
        <label className="fd-check">
          <input type="checkbox" checked={draft.reverse} onChange={(e) => set({ reverse: e.target.checked })} />
          {t('Reverse direction')}
        </label>
        {conflict && <div className="fd-error">{t('This relation cannot be satisfied')}</div>}
      </div>
    </div>
  );
}
