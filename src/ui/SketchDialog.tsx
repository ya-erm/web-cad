// Floating sketch dialog (Onshape style): name, sketch plane and display options.

import { useEditor, toggleShowConstraints, toggleShowExpressions } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { useRefLabel } from './FeatureDialog';
import { Icon } from './icons';
import { t, tName } from '../i18n';

export function SketchDialog() {
  const editing = useEditor((s) => s.editing);
  const sketch = useEditor((s) => s.sketch);
  const pattern = useEditor((s) => s.sketchPattern);
  const showConstraints = useEditor((s) => s.showConstraints);
  const showExpressions = useEditor((s) => s.showExpressions);
  const commit = useEditor((s) => s.commitEditing);
  const cancel = useEditor((s) => s.cancelEditing);
  const update = useEditor((s) => s.updateDraft);
  const doc = useDoc((s) => s.doc);
  const label = useRefLabel();
  if (!editing || editing.draft.type !== 'sketch' || !sketch || pattern) return null;
  const plane = editing.draft.params.plane;
  const studio = activeStudio(doc);
  const planeText =
    plane.kind === 'std'
      ? `${t(plane.name[0].toUpperCase() + plane.name.slice(1))} ${t('plane')}`
      : plane.kind === 'feature'
        ? tName(studio?.features.find((f) => f.id === plane.featureId)?.name ?? '?')
        : label(plane.ref);
  return (
    <div className="feature-dialog sketch-dialog" onKeyDown={(e) => e.stopPropagation()}>
      <div className="fd-header">
        <Icon name="sketch" size={20} />
        <input
          className="fd-title"
          value={tName(editing.draft.name)}
          onChange={(e) =>
            update((f) => {
              f.name = e.target.value;
            })
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        <button className="icon-btn fd-ok" title={`${t('Finish sketch')} (Enter)`} onClick={() => commit()}>
          <Icon name="check" size={20} />
        </button>
        <button className="icon-btn fd-cancel" title={`${t('Cancel')} (Esc)`} onClick={() => cancel()}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="fd-body">
        <div
          className={'sel-field' + (sketch.tool === 'plane' ? ' active' : '')}
          data-tip={t('Click, then select another plane or planar face')}
          onClick={() => useEditor.getState().setSketchTool(sketch.tool === 'plane' ? 'select' : 'plane')}
        >
          <div className="sel-label">{t('Sketch plane')}</div>
          {sketch.tool === 'plane' ? <div className="sel-empty">{t('Select a plane or a planar face for the sketch.')}</div> : <div className="sel-chip">{planeText}</div>}
        </div>
        <label className="fd-check">
          <input type="checkbox" checked={showConstraints} onChange={toggleShowConstraints} />
          {t('Show constraints')} <span className="menu-shortcut">Shift+C</span>
        </label>
        <label className="fd-check">
          <input type="checkbox" checked={showExpressions} onChange={toggleShowExpressions} />
          {t('Show expressions')}
        </label>
        {sketch.solve && sketch.solve.dof > 0 && (
          <div style={{ color: '#1565c0', fontSize: 12 }}>
            {t('Under defined')}: {sketch.solve.dof} {t('degrees of freedom')}
          </div>
        )}
      </div>
    </div>
  );
}
