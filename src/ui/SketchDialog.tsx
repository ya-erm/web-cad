// Floating sketch dialog (Onshape style): name, sketch plane and display options; a selected text's string, font and
// size, a selected gear's parameters.

import { useRef } from 'react';
import type { SkFont, SkGear, SketchData } from '../core/types';
import { FONT_NAMES, hasTextBox, textFrame, textWidth } from '../sketch/text';
import { textSizeDims } from '../sketch/sketchOps';
import { entityMap } from '../sketch/curves';
import { getEngine } from '../viewport/engineRef';
import { gearRotation, gearSizeOf, meshPartner } from '../sketch/gear';
import { gearCircles, meshDistance, type GearSize } from '../core/gear';
import { uid } from '../core/ids';
import { collectVariables, makeEvalContext } from '../core/features';
import { configuredOf } from '../core/config';
import { formatNumber, LENGTH_FACTOR } from '../core/expr';
import { useEditor, toggleShowConstraints, toggleShowExpressions } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { ExprInput, useRefLabel } from './FeatureDialog';
import { Icon } from './icons';
import { t, tName } from '../i18n';

/**
 * The one selected text (Onshape Text dialog; or a side of its box): its string and font, its height and width —
 * one of them a dimension of its box that sizes it (typed here or made with the Dimension tool), the other following
 * from the font — and what it comes to. A field's edits while it has the focus are one undo step.
 */
function TextProps() {
  const sketch = useEditor((s) => s.sketch);
  const draft = useEditor((s) => (s.editing?.draft.type === 'sketch' ? s.editing.draft.params : null));
  const doc = useDoc((s) => s.doc);
  // the last edit typed here: which field of which text, and the sketch it made
  const typing = useRef<{ key: string; params: SketchData } | null>(null);
  const id = sketch?.selection.length === 1 ? sketch.selection[0] : null;
  const picked = id ? draft?.entities.find((e) => e.id === id) : undefined;
  const text = picked?.type === 'line' && picked.owner ? draft?.entities.find((e) => e.id === picked.owner) : picked;
  if (!sketch || !draft || !doc || !text || text.type !== 'text') return null;
  const editor = () => getEngine()?.sketchEditor;
  // the first edit of a field is an undo step, the next ones (typed on) go into it — only while nothing else changed
  // the sketch in between (another field, another text, a line drawn, an undo; ▲▼ clicked give no focus to go by)
  const current = () => {
    const d = useEditor.getState().editing?.draft;
    return d?.type === 'sketch' ? d.params : null;
  };
  const typedOn = (key: string) => typing.current?.key === key && typing.current.params === current();
  const typed = (key: string) => {
    const params = current();
    typing.current = params ? { key, params } : null;
  };
  const edit = (patch: { text?: string; font?: SkFont }) => {
    const key = `${text.id}:text`;
    if (editor()?.editText(text.id, patch, !typedOn(key))) typed(key);
  };
  // its box and the dimensions that size it, in the document's units
  const map = entityMap(draft.entities);
  const h = textFrame(text, map)?.h ?? 0;
  const p3 = hasTextBox(text) ? map.get(text.p3) : undefined;
  const p1 = map.get(text.p1);
  const w = p3?.type === 'point' && p1?.type === 'point' ? Math.hypot(p3.x - p1.x, p3.y - p1.y) : textWidth(text, map);
  const dims = textSizeDims(draft, text);
  const k = LENGTH_FACTOR[doc.units.length];
  const len = (v: number) => formatNumber(v / k, 3);
  const sizeRow = (side: 'height' | 'width', label: string, measured: number) => {
    const dim = dims[side];
    return (
      <div className={'fd-row' + (dim ? '' : ' text-size-free')} title={t(dim ? 'A dimension of the sketch sets it' : 'Follows from the font: a value typed here becomes a dimension')}>
        <label>{t(label)}</label>
        <div className="fd-control">
          <ExprInput
            value={dim?.value ?? len(measured)}
            unit="length"
            onChange={(v) => {
              const key = `${text.id}:${side}`;
              if (editor()?.setTextSize(text.id, side, v, !typedOn(key))) typed(key);
            }}
          />
        </div>
      </div>
    );
  };
  const status = sketch.solve?.status[text.id];
  const chars = Array.from(text.text).length;
  return (
    <div className="text-props" onFocus={() => (typing.current = null)}>
      <div className="fd-section text-props-title">
        <Icon name="sketchText" size={16} />
        <span>{t('Text')}</span>
      </div>
      <div className="fd-row">
        <label>{t('Text')}</label>
        <div className="fd-control">
          <input
            type="text"
            value={text.text}
            autoFocus={sketch.editText === text.id}
            onFocus={(e) => {
              if (sketch.editText === text.id) e.currentTarget.select();
            }}
            onChange={(e) => edit({ text: e.target.value })}
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
          <select value={text.font} onChange={(e) => editor()?.editText(text.id, { font: e.target.value as SkFont }, true)}>
            {(Object.keys(FONT_NAMES) as SkFont[]).map((f) => (
              <option key={f} value={f}>
                {FONT_NAMES[f]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {hasTextBox(text) && sizeRow('height', 'Height', h)}
      {hasTextBox(text) && sizeRow('width', 'Width', w)}
      <div className="fd-hint">
        {t('Box')} {len(w)} × {len(h)} {doc.units.length} · {t('characters')}: {chars}
        {status && ` · ${t(status === 'full' ? 'fully defined' : status === 'over' ? 'over defined' : 'under defined')}`}
      </div>
      <div className="fd-hint">
        {t(
          dims.width
            ? 'A dimension sets the width, the height follows from the font.'
            : dims.height
              ? 'A dimension sets the height, the width follows from the font.'
              : 'The sides of its box are sketch lines: constrain and dimension them.',
        )}
      </div>
    </div>
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
  if (!sketch || !entities || !gear || gear.type !== 'gear' || !doc) return null;
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
  const withUnit = (key: 'size' | 'pressureAngle' | 'rotation' | 'backlash', unit: string) => () => {
    const cur = useEditor.getState().editing?.draft;
    const e = cur?.type === 'sketch' ? cur.params.entities.find((x) => x.id === gear.id) : undefined;
    const v = e?.type === 'gear' ? (e[key] ?? '') : '';
    if (/^\s*-?\d+([.,]\d+)?\s*$/.test(v)) set({ [key]: `${v.trim().replace(',', '.')} ${unit}` });
  };
  // the pair: the gear it meshes with sets its rotation; it may mesh with any other gear not meshing with it in turn
  const map = entityMap(entities);
  const gears = entities.filter((e): e is SkGear => e.type === 'gear');
  const gearName = (g: SkGear) => `${t('Spur gear')} ${gears.indexOf(g) + 1}`;
  const meshesWithIt = (g: SkGear) => {
    const seen: string[] = [];
    for (let p: SkGear | null = g; p; p = meshPartner(p, map, seen)) {
      if (p.meshWith === gear.id) return true;
      seen.push(p.id);
    }
    return false;
  };
  const choices = gears.filter((g) => g !== gear && !meshesWithIt(g));
  const partner = meshPartner(gear, map);
  const ps = partner && gearSizeOf(partner, ctx);
  const pair = partner && ps && !('error' in ps) && !('error' in s) ? pairState(gear, partner, s.size, ps.size, map) : null;
  // its rotation as the pair sets it: the first tooth's direction, within one tooth
  const meshed = partner && !('error' in s) ? gearRotation(gear, map, ctx) : null;
  const step = 'error' in s ? 1 : 360 / s.size.z;
  const meshedDeg = meshed === null ? 0 : ((((meshed * 180) / Math.PI) % step) + step) % step;
  // the centre distance of the pair: its dimension between the centres (a new one, or the one there is)
  const setDistance = (value: number) => {
    if (!partner) return;
    const text = `${formatNumber(value / k, 6)} ${doc.units.length}`;
    getEngine()?.sketchEditor.change(
      (d) => {
        const refs = [partner.c, gear.c];
        const dim = d.constraints.find((c) => c.type === 'distance' && c.refs.length === 2 && refs.every((r) => c.refs.includes(r)));
        if (dim) dim.value = text;
        else d.constraints.push({ id: uid('c'), type: 'distance', refs, value: text });
      },
      { checkConflict: true },
    );
  };
  return (
    // a field's edits while it has the focus are one undo step
    <div className="gear-props" onFocus={() => (typing.current = false)}>
      <div className="fd-section gear-props-title">
        <Icon name="sketchGear" size={16} />
        <span>{gears.length > 1 ? gearName(gear) : t('Spur gear')}</span>
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
      {row(
        'Backlash',
        <ExprInput value={gear.backlash || `0 ${doc.units.length}`} unit="length" onChange={(v) => set({ backlash: v })} />,
        'gear-backlash',
        withUnit('backlash', doc.units.length),
      )}
      {(choices.length > 0 || partner) &&
        row(
          'Mesh with',
          <select value={partner?.id ?? ''} onChange={(e) => set({ meshWith: e.target.value || undefined })}>
            <option value="">—</option>
            {choices.map((g) => {
              const gs = gearSizeOf(g, ctx);
              return (
                <option key={g.id} value={g.id}>
                  {gearName(g)}
                  {'error' in gs ? '' : ` · ${gs.size.z} ${t('teeth')}`}
                </option>
              );
            })}
          </select>,
          'gear-mesh',
        )}
      {meshed !== null ? (
        <div className="fd-row gear-rotation" title={t('Set by the gear it meshes with')}>
          <label>{t('Tooth rotation')}</label>
          <div className="fd-control">
            <input type="text" disabled value={`${formatNumber(meshedDeg, 3)} deg`} />
          </div>
        </div>
      ) : (
        row('Tooth rotation', <ExprInput value={gear.rotation} unit="angle" onChange={(v) => set({ rotation: v })} />, 'gear-rotation', withUnit('rotation', 'deg'))
      )}
      {'error' in s ? (
        <div className="fd-hint fd-error">{t(s.error)}</div>
      ) : (
        circles && (
          <div className="fd-hint">
            {t('Module')} {mm(s.size.m)} · {t('outer')} Ø {mm(2 * circles.ra)} · {t('pitch')} Ø {mm(2 * circles.r)} · {t('root')} Ø {mm(2 * circles.rf)}
          </div>
        )
      )}
      {pair &&
        (pair.problem ? (
          <div className="fd-hint fd-error gear-pair">{t(pair.problem)}</div>
        ) : (
          <div className={'gear-pair' + (pair.distance < pair.needed - 1e-6 ? ' fd-error' : ' fd-hint')}>
            <span>
              {t('Centre distance')} {mm(pair.distance)}
              {Math.abs(pair.distance - pair.needed) > 1e-6 && ` · ${t('meshing')} ${mm(pair.needed)}`}
              {pair.distance < pair.needed - 1e-6 && ` — ${t('the teeth jam')}`}
            </span>
            {Math.abs(pair.distance - pair.needed) > 1e-6 && (
              <button className="btn small" title={t('A dimension between the centres of the pair')} onClick={() => setDistance(pair.needed)}>
                {t('Set')} {mm(pair.needed)}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

/** A gear and the one it meshes with: the distance between their centres and the one they mesh at, or why they do not. */
function pairState(gear: SkGear, partner: SkGear, a: GearSize, b: GearSize, map: ReturnType<typeof entityMap>) {
  const p = map.get(partner.c);
  const q = map.get(gear.c);
  const distance = p?.type === 'point' && q?.type === 'point' ? Math.hypot(q.x - p.x, q.y - p.y) : 0;
  const problem =
    Math.abs(a.m - b.m) > 1e-9 * Math.max(a.m, b.m)
      ? 'Not the module of the gear it meshes with: they do not mesh'
      : Math.abs(a.alpha - b.alpha) > 1e-9
        ? 'Not the pressure angle of the gear it meshes with: they do not mesh'
        : null;
  return { distance, needed: meshDistance(a.m, a.z, b.z), problem };
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
