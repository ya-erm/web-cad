// The sketch Transform (Onshape): move / turn / copy the selected entities — values typed, the result previewed.

import { useMemo } from 'react';
import { useEditor } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { collectVariables, makeEvalContext } from '../core/features';
import { configuredOf } from '../core/config';
import { tryEvaluate } from '../core/expr';
import { getEngine } from '../viewport/engineRef';
import { Icon } from './icons';
import { t } from '../i18n';

const editor = () => getEngine()?.sketchEditor;

function Field({ label, value, unit, onChange }: { label: string; value: string; unit: 'length' | 'angle'; onChange: (v: string) => void }) {
  const doc = useDoc((s) => s.doc);
  const index = useEditor((s) => s.editing?.index ?? 0);
  const ctx = useMemo(() => (doc ? makeEvalContext(doc, collectVariables(configuredOf(activeStudio(doc)), index, doc.units)) : null), [doc, index]);
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
            if (e.key === 'Enter') editor()?.applyTransform();
            if (e.key === 'Escape') editor()?.cancelTransform();
          }}
        />
      </div>
    </div>
  );
}

export function SketchTransformPanel() {
  const st = useEditor((s) => s.sketchTransform);
  if (!st) return null;
  const set = (patch: Parameters<NonNullable<ReturnType<typeof editor>>['updateTransform']>[0]) => editor()?.updateTransform(patch);
  return (
    <div className="feature-dialog" onKeyDown={(e) => e.stopPropagation()}>
      <div className="fd-header">
        <Icon name="sketchTransform" size={20} />
        <span className="fd-title" style={{ border: 'none' }}>
          {t('Sketch transform')}
        </span>
        <button className="icon-btn fd-ok" title={`${t('Accept')} (Enter)`} onClick={() => editor()?.applyTransform()}>
          <Icon name="check" size={20} />
        </button>
        <button className="icon-btn fd-cancel" title={`${t('Cancel')} (Esc)`} onClick={() => editor()?.cancelTransform()}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="fd-body">
        <div className="sel-label">
          {t('Entities to transform')}: {st.ids.length}
        </div>
        <Field label="Move X" value={st.dx} unit="length" onChange={(v) => set({ dx: v })} />
        <Field label="Move Y" value={st.dy} unit="length" onChange={(v) => set({ dy: v })} />
        <Field label="Rotation angle" value={st.angle} unit="angle" onChange={(v) => set({ angle: v })} />
        <div className="fd-hint">{t('About the middle of the entities')}</div>
        <label className="fd-check">
          <input type="checkbox" checked={st.copy} onChange={(e) => set({ copy: e.target.checked })} />
          {t('Copy')}
        </label>
      </div>
    </div>
  );
}
