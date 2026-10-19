// Floating sketch dialog (Onshape style): name, sketch plane and display options; a selected text's string and font.

import { useRef } from 'react';
import type { SkFont } from '../core/types';
import { FONT_NAMES } from '../sketch/text';
import { useEditor, toggleShowConstraints, toggleShowExpressions } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { useRefLabel } from './FeatureDialog';
import { Icon } from './icons';
import { t, tName } from '../i18n';

/** The text and font of the one selected text (Onshape Text dialog); typing in it is one undo step. */
function TextProps() {
  const sketch = useEditor((s) => s.sketch);
  const entities = useEditor((s) => (s.editing?.draft.type === 'sketch' ? s.editing.draft.params.entities : null));
  const typing = useRef(false);
  const id = sketch?.selection.length === 1 ? sketch.selection[0] : null;
  const text = id ? entities?.find((e) => e.id === id) : undefined;
  if (!sketch || !text || text.type !== 'text') return null;
  const set = (fn: (e: { text: string; font: SkFont }) => void, undoable: boolean) =>
    useEditor.getState().updateSketch((d) => {
      const e = d.entities.find((x) => x.id === text.id);
      if (e && e.type === 'text') fn(e);
    }, undoable);
  return (
    <>
      <div className="fd-row">
        <label>{t('Text')}</label>
        <div className="fd-control">
          <input
            type="text"
            value={text.text}
            autoFocus={sketch.editText === text.id}
            onFocus={(e) => {
              typing.current = false;
              if (sketch.editText === text.id) e.currentTarget.select();
            }}
            onChange={(e) => {
              const v = e.target.value;
              set((x) => {
                x.text = v;
              }, !typing.current);
              typing.current = true;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            // placed and typed: selecting the text later leaves the keys to the sketch (Delete and so on)
            onBlur={() => useEditor.setState((s) => (s.sketch?.editText ? { sketch: { ...s.sketch, editText: undefined } } : {}))}
          />
        </div>
      </div>
      <div className="fd-row">
        <label>{t('Font')}</label>
        <div className="fd-control">
          <select
            value={text.font}
            onChange={(e) =>
              set((x) => {
                x.font = e.target.value as SkFont;
              }, true)
            }
          >
            {(Object.keys(FONT_NAMES) as SkFont[]).map((f) => (
              <option key={f} value={f}>
                {FONT_NAMES[f]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

export function SketchDialog() {
  const editing = useEditor((s) => s.editing);
  const sketch = useEditor((s) => s.sketch);
  // a pattern or a transform being set up takes the dialog's place
  const pattern = useEditor((s) => !!s.sketchPattern || !!s.sketchTransform);
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
        <button className="icon-btn fd-ok" title={`${t('Finish sketch')} (Enter)`} disabled={sketch.planePending} onClick={() => commit()}>
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
          onClick={() => !sketch.planePending && useEditor.getState().setSketchTool(sketch.tool === 'plane' ? 'select' : 'plane')}
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
        <TextProps />
        {sketch.solve && sketch.solve.dof > 0 && (
          <div style={{ color: '#1565c0', fontSize: 12 }}>
            {t('Under defined')}: {sketch.solve.dof} {t('degrees of freedom')}
          </div>
        )}
      </div>
    </div>
  );
}
