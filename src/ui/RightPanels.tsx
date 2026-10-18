// Right-hand panel strip (Onshape: variable table, etc.).

import { useState } from 'react';
import { collectVariables } from '../core/features';
import { formatQuantity } from '../core/expr';
import { uid } from '../core/ids';
import { defaultParams, nextFeatureName } from '../core/features';
import type { FeatureOf } from '../core/types';
import { useEditor } from '../store/editorStore';
import { activeStudio, effectiveRollback, useDoc, withStudio } from '../store/docStore';
import { Icon } from './icons';
import { t, tName } from '../i18n';

function VariableTable({ onClose }: { onClose: () => void }) {
  const doc = useDoc((s) => s.doc)!;
  const studio = activeStudio(doc);
  const statuses = useEditor((s) => s.build?.statuses);
  const editing = useEditor((s) => s.editing);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (!studio) return null;
  const rollback = effectiveRollback(studio);
  const rows = studio.features
    .map((f, i) => ({ f, i }))
    .filter((x): x is { f: FeatureOf<'variable'>; i: number } => x.f.type === 'variable');
  const commit = (id: string, value: string) => {
    useDoc.getState().update((d) =>
      withStudio(d, (s) => {
        const f = s.features.find((x) => x.id === id);
        if (f && f.type === 'variable') f.params.value = value;
      }),
    );
    setEditingId(null);
  };
  const addVariable = () => {
    if (editing) return;
    const f = {
      id: uid('f'),
      type: 'variable' as const,
      name: nextFeatureName(studio.features, 'variable'),
      params: { ...defaultParams('variable'), name: `var${rows.length + 1}` },
    };
    useDoc.getState().update((d) =>
      withStudio(d, (s) => {
        const at = s.rollback ?? s.features.length;
        s.features.splice(at, 0, f);
        if (s.rollback !== null) s.rollback++;
      }),
    );
    useEditor.getState().editFeature(f.id);
  };
  return (
    <div className="right-panel">
      <div className="panel-header">
        <Icon name="variable" size={16} /> {t('Variable table')}
        <span className="spacer" />
        <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('Add variable')} disabled={!!editing} onClick={addVariable}>
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('Close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="var-table">
        <div className="var-row head">
          <span>{t('Name')}</span>
          <span>{t('Value')}</span>
          <span>{t('Expression')}</span>
        </div>
        {rows.length === 0 && <div className="sel-empty" style={{ padding: 10 }}>{t('No variables yet. Use # in any value field after creating one.')}</div>}
        {rows.map(({ f, i }) => {
          const vars = collectVariables(studio.features, i + 1, doc.units);
          const q = vars[f.params.name];
          const err = statuses?.[f.id] && !statuses[f.id].ok;
          const rolled = i >= rollback;
          return (
            <div
              key={f.id}
              className={'var-row' + (rolled ? ' rolled' : '') + (f.suppressed ? ' suppressed' : '')}
              title={f.params.description || tName(f.name)}
              onDoubleClick={() => !editing && useEditor.getState().editFeature(f.id)}
            >
              <span className="var-name">#{f.params.name}</span>
              <span className={'var-value' + (err ? ' error' : '')}>{q ? formatQuantity(q, doc.units.length) : '—'}</span>
              {editingId === f.id ? (
                <input
                  className="tree-rename"
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(f.id, draft)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commit(f.id, draft);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className="var-expr"
                  onClick={() => {
                    setEditingId(f.id);
                    setDraft(f.params.value);
                  }}
                >
                  {f.params.value}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RightPanels() {
  const [open, setOpen] = useState<'variables' | null>(null);
  return (
    <>
      <div className="right-strip">
        <button
          className={'icon-btn' + (open === 'variables' ? ' active' : '')}
          title={t('Variable table')}
          onClick={() => setOpen(open === 'variables' ? null : 'variables')}
        >
          <Icon name="variable" size={18} />
        </button>
      </div>
      {open === 'variables' && <VariableTable onClose={() => setOpen(null)} />}
    </>
  );
}
