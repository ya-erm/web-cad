import { useMemo } from 'react';
import { useEditor } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { collectVariables, makeEvalContext } from '../core/features';
import { tryEvaluate } from '../core/expr';
import type { SkPattern } from '../core/types';
import { getEngine } from '../viewport/engineRef';
import { Icon } from './icons';
import { t } from '../i18n';

function Field({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: string;
  unit: 'length' | 'angle' | 'number';
  onChange: (v: string) => void;
}) {
  const doc = useDoc((s) => s.doc);
  const index = useEditor((s) => s.editing?.index ?? 0);
  const ctx = useMemo(() => (doc ? makeEvalContext(doc, collectVariables(activeStudio(doc)?.features ?? [], index, doc.units)) : null), [doc, index]);
  const ok = ctx ? tryEvaluate(value, unit, ctx) !== null : true;
  return (
    <div className="fd-row">
      <label>{t(label)}</label>
      <div className="fd-control">
        <input
          type="text"
          className={ok ? '' : 'invalid'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') getEngine()?.sketchEditor.applyPattern();
            if (e.key === 'Escape') getEngine()?.sketchEditor.cancelPattern();
          }}
        />
      </div>
    </div>
  );
}

/** Parameters of the sketch pattern being created / edited. Changes apply live. */
export function SketchPatternPanel() {
  const st = useEditor((s) => s.sketchPattern);
  const pattern = useEditor((s) =>
    s.sketchPattern && s.editing?.draft.type === 'sketch' ? s.editing.draft.params.patterns?.find((p) => p.id === s.sketchPattern!.patternId) : undefined,
  );
  if (!st || !pattern) return null;
  const set = (patch: Partial<SkPattern>) => getEngine()?.sketchEditor.updatePattern(patch);
  const linear = pattern.kind === 'linear';
  const closed = !linear && /^\s*360\s*(deg|°)?\s*$/.test(pattern.angle ?? '360 deg');
  return (
    <div className="feature-dialog" onKeyDown={(e) => e.stopPropagation()}>
      <div className="fd-header">
        <Icon name={linear ? 'sketchLinearPattern' : 'sketchCircularPattern'} size={20} />
        <span className="fd-title" style={{ border: 'none' }}>
          {t(linear ? 'Sketch linear pattern' : 'Sketch circular pattern')}
        </span>
        <button className="icon-btn fd-ok" title={`${t('Accept')} (Enter)`} onClick={() => getEngine()?.sketchEditor.applyPattern()}>
          <Icon name="check" size={20} />
        </button>
        <button className="icon-btn fd-cancel" title={`${t('Cancel')} (Esc)`} onClick={() => getEngine()?.sketchEditor.cancelPattern()}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="fd-body">
        <div className="sel-label">
          {t('Entities to pattern')}: {pattern.seed.length}
          {pattern.skipped?.length ? ` · ${t('removed instances')}: ${pattern.skipped.length}` : ''}
        </div>
        <Field label="Instance count" value={pattern.count} unit="number" onChange={(v) => set({ count: v })} />
        {linear ? (
          <>
            <Field label="Distance" value={pattern.spacing ?? ''} unit="length" onChange={(v) => set({ spacing: v })} />
            <Field label="Direction angle" value={pattern.dirAngle ?? '0 deg'} unit="angle" onChange={(v) => set({ dirAngle: v })} />
            <div className="segmented">
              {[
                ['0 deg', '→'],
                ['90 deg', '↑'],
                ['180 deg', '←'],
                ['270 deg', '↓'],
              ].map(([v, l]) => (
                <button key={v} className={pattern.dirAngle === v ? 'on' : ''} onClick={() => set({ dirAngle: v })}>
                  {l}
                </button>
              ))}
            </div>
            <label className="fd-check">
              <input type="checkbox" checked={(pattern.count2 ?? '1') !== '1'} onChange={(e) => set({ count2: e.target.checked ? '2' : '1' })} />
              {t('Second direction')}
            </label>
            {(pattern.count2 ?? '1') !== '1' && (
              <>
                <Field label="Instance count" value={pattern.count2 ?? '2'} unit="number" onChange={(v) => set({ count2: v })} />
                <Field label="Distance" value={pattern.spacing2 ?? ''} unit="length" onChange={(v) => set({ spacing2: v })} />
              </>
            )}
          </>
        ) : (
          <>
            <label className="fd-check">
              <input type="checkbox" checked={closed} onChange={(e) => set({ angle: e.target.checked ? '360 deg' : '90 deg' })} />
              {t('Full circle (equal spacing)')}
            </label>
            {!closed && <Field label="Angle" value={pattern.angle ?? '90 deg'} unit="angle" onChange={(v) => set({ angle: v })} />}
            <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
              {pattern.centerRef ? t('Center is attached to a sketch point.') : t('Drag the center handle on the canvas, or drop it on a point to attach.')}
            </div>
          </>
        )}
        {!st.isNew && (
          <button
            className="btn small danger"
            onClick={() => {
              const id = pattern.id;
              getEngine()?.sketchEditor.applyPattern();
              getEngine()?.sketchEditor.deletePattern(id);
            }}
          >
            <Icon name="trash" size={14} /> {t('Delete pattern')}
          </button>
        )}
      </div>
    </div>
  );
}
