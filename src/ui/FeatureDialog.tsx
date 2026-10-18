import { useEffect, useMemo, useRef, useState } from 'react';
import type { Draft } from 'immer';
import type { ConfigInput, Feature, FeatureType, PartStudioTab, SelRef } from '../core/types';
import { FIELD_SPECS } from '../core/fieldSpecs';
import { FEATURE_LABELS, collectVariables, makeEvalContext } from '../core/features';
import { chosenOption, configuredOf, configuredParams } from '../core/config';
import { derivableStudios } from '../core/derived';
import { sourcePartList } from '../store/rebuild';
import { formatNumber, LENGTH_FACTOR, tryEvaluate } from '../core/expr';
import { useEditor, refKey, FIRST_FIELD } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { FORMS, type Row } from './forms';
import { Icon, type IconName } from './icons';
import { t, tName } from '../i18n';
import { openHelp } from '../help/context';
import { FEATURE_HELP } from '../help/pages';

export const FEATURE_ICONS: Record<FeatureType, IconName> = {
  sketch: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  sweep: 'sweep',
  loft: 'loft',
  thicken: 'thicken',
  fillet: 'fillet',
  chamfer: 'chamfer',
  shell: 'shell',
  draft: 'draft',
  hole: 'hole',
  linearPattern: 'linearPattern',
  circularPattern: 'circularPattern',
  mirror: 'mirror',
  boolean: 'boolean',
  split: 'split',
  transform: 'transform',
  deletePart: 'deletePart',
  plane: 'plane',
  variable: 'variable',
  import: 'import',
  derived: 'partStudio',
  helix: 'helix',
  mateConnector: 'mateConnector',
};

export function useRefLabel() {
  const build = useEditor((s) => s.build);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  return (r: SelRef): string => {
    const partName = (id: string) => build?.parts.find((p) => p.id === id)?.name ?? 'Part';
    const featName = (id: string) => tName(studio?.features.find((f) => f.id === id)?.name ?? '?');
    switch (r.kind) {
      case 'face':
        return `${t('Face')} ${t('of')} ${partName(r.partId)}`;
      case 'edge':
        return `${t('Edge')} ${t('of')} ${partName(r.partId)}`;
      case 'vertex':
        return `${t('Vertex')} ${t('of')} ${partName(r.partId)}`;
      case 'part':
        return partName(r.partId);
      case 'region':
        return `${t('Sketch region')} (${featName(r.sketchId)})`;
      case 'sketchEntity': {
        const f = studio?.features.find((x) => x.id === r.sketchId);
        // a whole curve feature (helix)
        if (f && f.type !== 'sketch') return featName(r.sketchId);
        const e = f?.type === 'sketch' ? f.params.entities.find((x) => x.id === r.entityId) : undefined;
        const kind = e?.type === 'point' ? t('Sketch point') : e?.type === 'line' ? t('Sketch line') : t('Sketch curve');
        return `${kind} (${featName(r.sketchId)})`;
      }
      case 'plane':
        return r.planeId === 'top' || r.planeId === 'front' || r.planeId === 'right'
          ? `${t(r.planeId[0].toUpperCase() + r.planeId.slice(1))} ${t('plane')}`
          : featName(r.planeId);
      case 'origin':
        return t('Origin');
    }
  };
}

/** Collapse many references with the same label (e.g. 13 regions of one sketch) into one chip. */
function groupRefs(refs: SelRef[], label: (r: SelRef) => string) {
  const groups = new Map<string, SelRef[]>();
  for (const r of refs) {
    const k = label(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: { ref: SelRef; text: string; all: SelRef[] }[] = [];
  for (const [text, all] of groups) {
    if (all.length > 2) out.push({ ref: all[0], text: `${text} × ${all.length}`, all });
    else for (const r of all) out.push({ ref: r, text, all: [r] });
  }
  return out;
}

function SelField({ fkey, type, refs }: { fkey: string; type: FeatureType; refs: SelRef[] }) {
  const active = useEditor((s) => s.activeField === fkey);
  const setActive = useEditor((s) => s.setActiveField);
  const update = useEditor((s) => s.updateDraft);
  const setHover = useEditor((s) => s.setHover);
  const label = useRefLabel();
  const spec = FIELD_SPECS[type]?.[fkey];
  return (
    <div className={'sel-field' + (active ? ' active' : '')} onClick={() => setActive(fkey)}>
      <div className="sel-label">{t(spec?.label ?? fkey)}</div>
      {refs.length === 0 && <div className="sel-empty">{active ? t('Select in the graphics area') : t('Click to select')}</div>}
      {groupRefs(refs, label).map(({ ref: r, text, all }) => (
        <div key={refKey(r)} className="sel-chip" onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)}>
          <span>{text}</span>
          <span
            className="x"
            onClick={(e) => {
              e.stopPropagation();
              setHover(null);
              const drop = new Set(all.map(refKey));
              update((f) => {
                const p = f.params as unknown as Record<string, SelRef[]>;
                p[fkey] = (p[fkey] ?? []).filter((x) => !drop.has(refKey(x)));
              });
            }}
          >
            <Icon name="close" size={14} />
          </span>
        </div>
      ))}
    </div>
  );
}

function ExprInput({ value, unit, onChange }: { value: string; unit: 'length' | 'angle' | 'number'; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const doc = useDoc((s) => s.doc);
  const index = useEditor((s) => s.editing?.index ?? 0);
  useEffect(() => setText(value), [value]);
  const ctx = useMemo(() => {
    const studio = activeStudio(doc);
    return doc ? makeEvalContext(doc, collectVariables(configuredOf(studio), index, doc.units)) : null;
  }, [doc, index]);
  const v = ctx ? tryEvaluate(text, unit, ctx) : null;
  const title =
    v === null
      ? t('Invalid expression')
      : unit === 'length' && doc
        ? `${formatNumber(v / LENGTH_FACTOR[doc.units.length], 4)} ${doc.units.length}`
        : unit === 'angle'
          ? `${formatNumber((v * 180) / Math.PI, 4)} deg`
          : formatNumber(v, 4);
  return (
    <input
      type="text"
      className={v === null ? 'invalid' : ''}
      value={text}
      title={title}
      onChange={(e) => {
        setText(e.target.value);
        if (ctx && tryEvaluate(e.target.value, unit, ctx) !== null) onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // nudge numeric values like Onshape
          const m = /^(-?\d*\.?\d+)(.*)$/.exec(text.trim());
          if (m) {
            e.preventDefault();
            const step = unit === 'angle' ? 1 : unit === 'number' ? 1 : 1;
            const nv = `${formatNumber(parseFloat(m[1]) + (e.key === 'ArrowUp' ? step : -step), 6)}${m[2]}`;
            setText(nv);
            onChange(nv);
          }
        }
      }}
    />
  );
}

function FeaturePicker({ value, onChange, upTo }: { value: string[]; onChange: (v: string[]) => void; upTo: number }) {
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const feats = (studio?.features ?? []).slice(0, upTo).filter((f) => ['extrude', 'revolve', 'sweep', 'loft', 'hole', 'thicken'].includes(f.type));
  if (!feats.length) return <div className="sel-empty">{t('No features to pattern')}</div>;
  return (
    <div className="feature-list-picker">
      {feats.map((f) => (
        <label key={f.id}>
          <input
            type="checkbox"
            checked={value.includes(f.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, f.id] : value.filter((x) => x !== f.id))}
          />
          <Icon name={FEATURE_ICONS[f.type]} size={16} />
          {tName(f.name)}
        </label>
      ))}
    </div>
  );
}

/**
 * Derived: the source — another Part Studio of the document (not one that uses this one: a cycle) — and which of
 * its parts to bring in (all by default). The parts are listed from the source's build.
 */
function DerivedSourceField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const studioId = draft?.type === 'derived' ? draft.params.studioId : '';
  const [parts, setParts] = useState<{ id: string; name: string }[] | null>(null);
  const options = doc && studio ? derivableStudios(doc, studio.id) : [];
  // the first possible source to start with
  useEffect(() => {
    if (draft?.type === 'derived' && !draft.params.studioId && options[0])
      update((f) => {
        if (f.type === 'derived') f.params.studioId = options[0].id;
      });
  }, [draft?.type, studioId, options[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the source's parts, from its build
  useEffect(() => {
    let live = true;
    setParts(null);
    const src = doc?.tabs.find((t): t is PartStudioTab => t.id === studioId && t.type === 'partStudio');
    if (!doc || !src) return;
    void sourcePartList(doc, src).then((list) => live && setParts(list), () => live && setParts([]));
    return () => {
      live = false;
    };
  }, [doc, studioId]);
  if (!draft || draft.type !== 'derived' || !studio) return null;
  const chosen = draft.params.parts;
  const gone = !!studioId && !doc?.tabs.some((t) => t.id === studioId);
  const setChosen = (ids: string[]) =>
    update((f) => {
      if (f.type === 'derived') f.params.parts = ids;
    });
  return (
    <>
      <div className="fd-row">
        <label>{t('Part Studio')}</label>
        <div className="fd-control">
          {options.length || gone ? (
            <select
              value={studioId}
              onChange={(e) =>
                update((f) => {
                  if (f.type !== 'derived') return;
                  f.params.studioId = e.target.value;
                  f.params.parts = [];
                })
              }
            >
              {gone && <option value={studioId}>{t('(deleted)')}</option>}
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="sel-empty">{t('No other Part Studio to derive from')}</span>
          )}
        </div>
      </div>
      {studioId && !gone && (
        <div className="fd-section">
          <div className="sel-label">{t('Parts')}</div>
          <div className="feature-list-picker">
            <label>
              <input type="checkbox" checked={!chosen.length} onChange={(e) => setChosen(e.target.checked ? [] : (parts ?? []).slice(0, 1).map((p) => p.id))} />
              {t('All parts')}
            </label>
            {parts === null && <div className="sel-empty">{t('Building the source…')}</div>}
            {parts?.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={!chosen.length || chosen.includes(p.id)}
                  onChange={(e) => {
                    const now = chosen.length ? chosen : parts.map((x) => x.id);
                    setChosen(e.target.checked ? [...now, p.id] : now.filter((x) => x !== p.id));
                  }}
                />
                <Icon name="partItem" size={16} />
                {p.name}
              </label>
            ))}
            {/* chosen parts the source no longer has */}
            {parts && chosen.filter((id) => !parts.some((p) => p.id === id)).map((id) => (
              <label key={id} className="gone">
                <input type="checkbox" checked onChange={() => setChosen(chosen.filter((x) => x !== id))} />
                <Icon name="warning" size={16} />
                {t('A part that is gone')}
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function FileField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const ref = useRef<HTMLInputElement>(null);
  if (!draft || draft.type !== 'import') return null;
  return (
    <div className="fd-row">
      <label>{t('File')}</label>
      <div className="fd-control">
        <button className="btn small" onClick={() => ref.current?.click()}>
          <Icon name="upload" size={14} /> {draft.params.fileName || 'STEP / STL…'}
        </button>
        <input
          ref={ref}
          type="file"
          accept=".step,.stp,.stl"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const buf = new Uint8Array(await file.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            const data = btoa(bin);
            const format = /\.stl$/i.test(file.name) ? 'stl' : 'step';
            update((f) => {
              if (f.type !== 'import') return;
              f.params.fileName = file.name;
              f.params.format = format;
              f.params.data = data;
              f.name = file.name.replace(/\.[^.]+$/, '');
            });
          }}
        />
      </div>
    </div>
  );
}

export function FeatureDialog() {
  const editing = useEditor((s) => s.editing);
  const preview = useEditor((s) => s.build?.preview);
  const building = useEditor((s) => s.building);
  const commit = useEditor((s) => s.commitEditing);
  const cancel = useEditor((s) => s.cancelEditing);
  const update = useEditor((s) => s.updateDraft);
  const studio = useDoc((s) => activeStudio(s.doc));
  if (!editing || editing.draft.type === 'sketch') return null;
  const draft = editing.draft;
  // parameters set by the configuration: what is typed goes to the chosen configuration's cell
  const configured = studio ? configuredParams(studio, draft.id) : new Map<string, ConfigInput>();
  const configMark = (key: string) => {
    const input = configured.get(key);
    const opt = input && chosenOption(input, studio?.configChoice);
    return input && opt ? (
      <span className="cfg-mark" title={`${t('Set by the configuration')} «${input.name}»: ${opt.name}`}>
        <Icon name="layers" size={13} />
      </span>
    ) : null;
  };
  const p = draft.params as unknown as Record<string, unknown>;
  const rows = FORMS[draft.type] ?? [];
  // Don't nag with "select …" errors before the user picked anything in the first field.
  const first = FIRST_FIELD[draft.type];
  const hasInput = !first || ((p[first] as unknown[] | undefined)?.length ?? 0) > 0;
  const set = (key: string, v: unknown) =>
    update((f: Draft<Feature>) => {
      (f.params as unknown as Record<string, unknown>)[key] = v;
    });

  const renderRow = (row: Row, i: number) => {
    if (row.when && !row.when(p)) return null;
    switch (row.kind) {
      case 'segmented':
        return (
          <div key={i} className="segmented">
            {row.options.map(([v, label]) => (
              <button key={v} className={p[row.key] === v ? 'on' : ''} onClick={() => set(row.key, v)}>
                {t(label)}
              </button>
            ))}
          </div>
        );
      case 'select':
        return (
          <div key={i} className="fd-row">
            <label>{t(row.label)}</label>
            <div className="fd-control">
              <select value={String(p[row.key])} onChange={(e) => set(row.key, e.target.value)}>
                {row.options.map(([v, label]) => (
                  <option key={v} value={v}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      case 'sel':
        return <SelField key={i} fkey={row.key} type={draft.type} refs={(p[row.key] as SelRef[]) ?? []} />;
      case 'expr':
        return (
          <div key={i} className="fd-row">
            <label>
              {t(row.label)}
              {configMark(row.key)}
            </label>
            <div className="fd-control">
              <ExprInput
                value={String(p[row.key] ?? '')}
                unit={row.unitKey ? (({ length: 'length', angle: 'angle', number: 'number', any: 'number' } as const)[String(p[row.unitKey] ?? 'any') as 'length'] ?? 'number') : row.unit}
                onChange={(v) => set(row.key, v)}
              />
              {row.flipKey && (
                <button
                  className={'icon-btn' + (p[row.flipKey] ? ' active' : '')}
                  title={t('Opposite direction')}
                  onClick={() => set(row.flipKey!, !p[row.flipKey!])}
                >
                  <Icon name="flip" size={18} />
                </button>
              )}
            </div>
          </div>
        );
      case 'check':
        return (
          <label key={i} className="fd-check">
            <input type="checkbox" checked={!!p[row.key]} onChange={(e) => set(row.key, e.target.checked)} />
            {t(row.label)}
            {configMark(row.key)}
          </label>
        );
      case 'flip':
        return (
          <div key={i} className="fd-row">
            <label>{t(row.label)}</label>
            <div className="fd-control">
              <button className={'icon-btn' + (p[row.key] ? ' active' : '')} onClick={() => set(row.key, !p[row.key])}>
                <Icon name="flip" size={18} />
              </button>
            </div>
          </div>
        );
      case 'text':
        return (
          <div key={i} className="fd-row">
            <label>{t(row.label)}</label>
            <div className="fd-control">
              {draft.type === 'variable' && row.key === 'name' && <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>#</span>}
              <input
                type="text"
                value={String(p[row.key] ?? '')}
                onChange={(e) => set(row.key, draft.type === 'variable' && row.key === 'name' ? e.target.value.replace(/[^A-Za-z0-9_]/g, '') : e.target.value)}
              />
            </div>
          </div>
        );
      case 'features':
        return (
          <div key={i} className="fd-section">
            <div className="sel-label">{t(row.label)}</div>
            <FeaturePicker value={(p[row.key] as string[]) ?? []} onChange={(v) => set(row.key, v)} upTo={editing.index} />
          </div>
        );
      case 'merge':
        return (
          <div key={i} className="fd-section">
            <label className="fd-check">
              <input type="checkbox" checked={!!p.mergeAll} onChange={(e) => set('mergeAll', e.target.checked)} />
              {t('Merge with all')}
            </label>
            {!p.mergeAll && <SelField fkey="parts" type={draft.type} refs={(p.parts as SelRef[]) ?? []} />}
          </div>
        );
      case 'file':
        return <FileField key={i} />;
      case 'derivedSource':
        return <DerivedSourceField key={i} />;
      case 'section':
        return (
          <div key={i} className="sel-label">
            {t(row.label)}
          </div>
        );
    }
  };

  return (
    <div
      className="feature-dialog"
      onKeyDown={(e) => {
        e.stopPropagation();
        // F1 anywhere in the dialog: help for this feature
        if (e.key === 'F1') {
          e.preventDefault();
          openHelp(FEATURE_HELP[draft.type]);
          return;
        }
        // Onshape: Enter in any field accepts the feature, Esc cancels it
        if (e.nativeEvent.isComposing || (e.target as HTMLElement).tagName !== 'INPUT') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') cancel();
      }}
    >
      <div className="fd-header">
        <Icon name={FEATURE_ICONS[draft.type]} size={20} />
        <input
          className="fd-title"
          value={tName(draft.name)}
          onChange={(e) =>
            update((f) => {
              f.name = e.target.value;
            })
          }
        />
        {building && <div className="spinner" />}
        <button className="icon-btn fd-help" title={`${t('Help')} (F1)`} onClick={() => openHelp(FEATURE_HELP[draft.type])}>
          <Icon name="help" size={18} />
        </button>
        <button className="icon-btn fd-ok" title={`${t('Accept')} (Enter)`} onClick={() => commit()}>
          <Icon name="check" size={20} />
        </button>
        <button className="icon-btn fd-cancel" title={`${t('Cancel')} (Esc)`} onClick={() => cancel()}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="fd-body">
        {rows.map(renderRow)}
        {preview && !preview.status.ok && hasInput && <div className="fd-error">{t(preview.status.error ?? '')}</div>}
        {preview?.status.ok && preview.status.warning && <div className="fd-warning">{t(preview.status.warning)}</div>}
        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{t(FEATURE_LABELS[draft.type])}</div>
      </div>
    </div>
  );
}
