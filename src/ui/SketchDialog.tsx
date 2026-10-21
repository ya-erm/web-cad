// Floating sketch dialog (Onshape style): name, sketch plane and display options; a selected text's string and font.

import { useRef } from 'react';
import type { SkFont, SkGear } from '../core/types';
import { FONT_NAMES } from '../sketch/text';
import { gearSizeOf } from '../sketch/gear';
import { gearCircles } from '../core/gear';
import { collectVariables, makeEvalContext } from '../core/features';
import { configuredOf } from '../core/config';
import { formatNumber, LENGTH_FACTOR } from '../core/expr';
import { useEditor, toggleShowConstraints, toggleShowExpressions } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { ExprInput, useRefLabel } from './FeatureDialog';
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

/**
 * The parameters of the one selected gear (Onshape Spur gear): teeth, what sets its size and its value, pressure
 * angle, rotation — expressions (`#z` teeth follow the variable) — and the sizes they give. Editing a field is one
 * undo step.
 */
function GearProps() {
  const sketch = useEditor((s) => s.sketch);
  const entities = useEditor((s) => (s.editing?.draft.type === 'sketch' ? s.editing.draft.params.entities : null));
  const index = useEditor((s) => s.editing?.index ?? 0);
  const doc = useDoc((s) => s.doc);
  const typing = useRef(false);
  const id = sketch?.selection.length === 1 ? sketch.selection[0] : null;
  const gear = id ? entities?.find((e) => e.id === id) : undefined;
  if (!sketch || !gear || gear.type !== 'gear' || !doc) return null;
  const set = (patch: Partial<SkGear>) => {
    useEditor.getState().updateSketch((d) => {
      const e = d.entities.find((x) => x.id === gear.id);
      if (e && e.type === 'gear') Object.assign(e, patch);
    }, !typing.current);
    typing.current = true;
  };
  // the sizes it gives, in the document's units
  const ctx = makeEvalContext(doc, collectVariables(configuredOf(activeStudio(doc)), index, doc.units));
  const s = gearSizeOf(gear, ctx);
  const k = LENGTH_FACTOR[doc.units.length];
  const mm = (v: number) => `${formatNumber(v / k, 3)} ${doc.units.length}`;
  const circles = 'error' in s ? null : gearCircles(s.size);
  const sizeLabel = { module: 'Module', outerDiameter: 'Outer diameter', pitchDiameter: 'Pitch diameter' } as const;
  // another size given: the same gear — its value in that size (an expression with variables stays as it is)
  const switchSize = (sizeBy: SkGear['sizeBy']) => {
    if ('error' in s || gear.size.includes('#')) return set({ sizeBy });
    const { m, z } = s.size;
    const v = sizeBy === 'module' ? m : sizeBy === 'outerDiameter' ? m * (z + 2) : m * z;
    set({ sizeBy, size: `${formatNumber(v / k, 6)} ${doc.units.length}` });
  };
  const row = (label: string, child: React.ReactNode, className = '', onBlur?: () => void) => (
    <div className={'fd-row ' + className} onBlur={onBlur}>
      <label>{t(label)}</label>
      <div className="fd-control">{child}</div>
    </div>
  );
  // a bare number typed into a size or an angle gets its unit when the field is left: "12" → "12 mm", "20" → "20 deg"
  const withUnit = (key: 'size' | 'pressureAngle' | 'rotation', unit: string) => () => {
    const cur = useEditor.getState().editing?.draft;
    const e = cur?.type === 'sketch' ? cur.params.entities.find((x) => x.id === gear.id) : undefined;
    const v = e?.type === 'gear' ? e[key] : '';
    if (/^\s*-?\d+([.,]\d+)?\s*$/.test(v)) set({ [key]: `${v.trim().replace(',', '.')} ${unit}` });
  };
  return (
    // a field's edits while it has the focus are one undo step
    <div className="gear-props" onFocus={() => (typing.current = false)}>
      <div className="fd-section gear-props-title">
        <Icon name="sketchGear" size={16} />
        <span>{t('Spur gear')}</span>
      </div>
      {row('Number of teeth', <ExprInput value={gear.teeth} unit="number" onChange={(v) => set({ teeth: v })} />)}
      {row(
        'Size by',
        <select value={gear.sizeBy} onChange={(e) => switchSize(e.target.value as SkGear['sizeBy'])}>
          {(Object.keys(sizeLabel) as SkGear['sizeBy'][]).map((v) => (
            <option key={v} value={v}>
              {t(sizeLabel[v])}
            </option>
          ))}
        </select>,
      )}
      {row(sizeLabel[gear.sizeBy], <ExprInput value={gear.size} unit="length" onChange={(v) => set({ size: v })} />, 'gear-size', withUnit('size', doc.units.length))}
      {row('Pressure angle', <ExprInput value={gear.pressureAngle} unit="angle" onChange={(v) => set({ pressureAngle: v })} />, '', withUnit('pressureAngle', 'deg'))}
      {row('Tooth rotation', <ExprInput value={gear.rotation} unit="angle" onChange={(v) => set({ rotation: v })} />, '', withUnit('rotation', 'deg'))}
      {'error' in s ? (
        <div className="fd-hint fd-error">{t(s.error)}</div>
      ) : (
        circles && (
          <div className="fd-hint">
            {t('Module')} {mm(s.size.m)} · {t('outer')} Ø {mm(2 * circles.ra)} · {t('pitch')} Ø {mm(2 * circles.r)} · {t('root')} Ø {mm(2 * circles.rf)}
          </div>
        )
      )}
    </div>
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
        <GearProps />
        {sketch.solve && sketch.solve.dof > 0 && (
          <div style={{ color: '#1565c0', fontSize: 12 }}>
            {t('Under defined')}: {sketch.solve.dof} {t('degrees of freedom')}
          </div>
        )}
      </div>
    </div>
  );
}
