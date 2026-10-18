// Configurations of a Part Studio (Onshape): inputs (lists of options) with a table each — options in rows,
// configured parameters of features in columns. The chosen option of each input is picked above the feature list.

import { useEffect, useState } from 'react';
import type { ConfigInput, Feature, PartStudioTab } from '../core/types';
import { configKey, ownValue, splitConfigKey } from '../core/config';
import { uid } from '../core/ids';
import { activeStudio, useDoc, withStudio } from '../store/docStore';
import { FORMS } from './forms';
import { FEATURE_ICONS } from './FeatureDialog';
import { Icon } from './icons';
import { useDraggable } from './useDraggable';
import { t, tName } from '../i18n';

/** A parameter of a feature that a configuration can set: an expression, a checkbox, whether it is disabled. */
export interface ConfigurableParam {
  param: string;
  label: string;
  kind: 'expr' | 'check';
}

/** What of a feature a configuration can set (its dialog's expressions and checkboxes, and its suppression). */
export function configurableParams(f: Feature): ConfigurableParam[] {
  const out: ConfigurableParam[] = [];
  for (const row of FORMS[f.type] ?? [])
    if ((row.kind === 'expr' || row.kind === 'check') && !out.some((p) => p.param === row.key))
      out.push({ param: row.key, label: row.label, kind: row.kind });
  out.push({ param: 'suppressed', label: 'Disabled', kind: 'check' });
  return out;
}

/** The column title of a configured parameter: the feature (a variable by its #name) and the parameter. */
function paramTitle(features: Feature[], key: string): { feature: string; param: string; kind: 'expr' | 'check'; gone: boolean } {
  const { featureId, param } = splitConfigKey(key);
  const f = features.find((x) => x.id === featureId);
  if (!f) return { feature: '?', param, kind: 'expr', gone: true };
  const p = configurableParams(f).find((x) => x.param === param);
  const feature = f.type === 'variable' ? `#${f.params.name}` : tName(f.name);
  return { feature, param: t(p?.label ?? param), kind: p?.kind ?? 'expr', gone: false };
}

/** Change the studio's configuration (one undo step). */
function edit(fn: (s: PartStudioTab, inputs: ConfigInput[]) => void) {
  useDoc.getState().update((d) =>
    withStudio(d, (s) => {
      s.configuration ??= [];
      fn(s as PartStudioTab, s.configuration as ConfigInput[]);
      if (!s.configuration.length) delete s.configuration;
    }),
  );
}

/** Choose an option of an input (not an undo step: like switching a view). */
export function chooseOption(inputId: string, optionId: string) {
  useDoc.getState().update(
    (d) =>
      withStudio(d, (s) => {
        s.configChoice = { ...s.configChoice, [inputId]: optionId };
      }),
    { undoable: false },
  );
}

/** A text cell: committed on Enter or when it loses focus. */
function TextCell({ value, placeholder, onCommit, className }: { value: string; placeholder?: string; onCommit: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={'cfg-cell' + (className ? ` ${className}` : '')}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

/**
 * The menu of parameters that can be added to an input's table: by feature, those not in it yet. It stands in the
 * window under its button (the panel would clip it).
 */
function AddParamMenu({ studio, input, at, onClose }: { studio: PartStudioTab; input: ConfigInput; at: DOMRect; onClose: () => void }) {
  const groups = studio.features
    .filter((f) => f.type !== 'sketch')
    .map((f) => ({ f, params: configurableParams(f).filter((p) => !input.params.includes(configKey(f.id, p.param))) }))
    .filter((g) => g.params.length);
  const width = 260;
  return (
    <div
      className="dropdown cfg-add-menu"
      style={{ position: 'fixed', top: at.bottom + 4, left: Math.max(4, Math.min(at.right - width, window.innerWidth - width - 4)), right: 'auto', width }}
      onMouseLeave={onClose}
    >
      {!groups.length && <div className="dropdown-label">{t('No features to configure')}</div>}
      {groups.map(({ f, params }) => (
        <div key={f.id}>
          <div className="dropdown-label cfg-add-feature">
            <Icon name={FEATURE_ICONS[f.type]} size={14} /> {f.type === 'variable' ? `#${f.params.name}` : tName(f.name)}
          </div>
          {params.map((p) => (
            <div
              key={p.param}
              className="dropdown-item"
              onClick={() => {
                onClose();
                edit((_, inputs) => {
                  const i = inputs.find((x) => x.id === input.id);
                  if (i) i.params.push(configKey(f.id, p.param));
                });
              }}
            >
              <span className="menu-icon" />
              {t(p.label)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One input: its name, and the table of its options and configured parameters. */
function InputTable({ studio, input }: { studio: PartStudioTab; input: ConfigInput }) {
  /** Where the "+ Parameter" menu opens (its button), while it is open. */
  const [adding, setAdding] = useState<DOMRect | null>(null);
  const chosen = input.options.find((o) => o.id === studio.configChoice?.[input.id])?.id ?? input.options[0]?.id;
  const cols = input.params.map((key) => ({ key, ...paramTitle(studio.features, key) }));
  const own = (key: string) => {
    const { featureId, param } = splitConfigKey(key);
    const f = studio.features.find((x) => x.id === featureId);
    return f ? (ownValue(f, param) ?? '') : '';
  };
  const setCell = (optionId: string, key: string, value: string) =>
    edit((_, inputs) => {
      const i = inputs.find((x) => x.id === input.id);
      if (!i) return;
      const cells = (i.values[optionId] ??= {});
      // empty: the feature's own value
      if (value === '') delete cells[key];
      else cells[key] = value;
    });
  const change = (fn: (i: ConfigInput) => void) =>
    edit((_, inputs) => {
      const i = inputs.find((x) => x.id === input.id);
      if (i) fn(i);
    });
  return (
    <div className="cfg-input">
      <div className="cfg-input-head">
        <Icon name="layers" size={14} />
        <TextCell value={input.name} className="cfg-input-name" onCommit={(v) => v && change((i) => void (i.name = v))} />
        <span className="spacer" />
        <button className={'btn small' + (adding ? ' active' : '')} onClick={(e) => setAdding(adding ? null : e.currentTarget.getBoundingClientRect())}>
          <Icon name="plus" size={12} /> {t('Parameter')}
        </button>
        {adding && <AddParamMenu studio={studio} input={input} at={adding} onClose={() => setAdding(null)} />}
        <button
          className="icon-btn"
          title={t('Delete input')}
          onClick={() =>
            edit((s, inputs) => {
              inputs.splice(
                inputs.findIndex((x) => x.id === input.id),
                1,
              );
              if (s.configChoice) delete s.configChoice[input.id];
            })
          }
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="cfg-table-wrap">
        <table className="cfg-table">
          <thead>
            <tr>
              <th>{t('Option')}</th>
              {cols.map((c) => (
                <th key={c.key} className={c.gone ? 'gone' : undefined} title={c.gone ? t('The feature is gone') : `${c.feature} — ${c.param}`}>
                  <div className="cfg-col">
                    <span className="cfg-col-title">
                      <b>{c.feature}</b>
                      <span>{c.param}</span>
                    </span>
                    <button
                      className="icon-btn"
                      title={t('Remove from the table')}
                      onClick={() =>
                        change((i) => {
                          i.params = i.params.filter((k) => k !== c.key);
                          for (const cells of Object.values(i.values)) delete cells[c.key];
                        })
                      }
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                </th>
              ))}
              {!cols.length && <th className="cfg-no-params">{t('Add parameters with "+ Parameter"')}</th>}
              <th className="cfg-row-actions" />
            </tr>
          </thead>
          <tbody>
            {input.options.map((o, row) => (
              <tr key={o.id} className={o.id === chosen ? 'chosen' : undefined}>
                <td>
                  <div className="cfg-name">
                    <input type="radio" name={`cfg-${input.id}`} checked={o.id === chosen} title={t('Show this option')} onChange={() => chooseOption(input.id, o.id)} />
                    <TextCell value={o.name} onCommit={(v) => v && change((i) => void (i.options[row].name = v))} />
                    {row === 0 && (
                      <span className="cfg-default" title={t('The default option')}>
                        {t('default')}
                      </span>
                    )}
                  </div>
                </td>
                {cols.map((c) => {
                  const cell = input.values[o.id]?.[c.key];
                  return (
                    <td key={c.key}>
                      {c.kind === 'check' ? (
                        <input type="checkbox" checked={(cell ?? own(c.key)) === 'true'} onChange={(e) => setCell(o.id, c.key, String(e.target.checked))} />
                      ) : (
                        <TextCell value={cell ?? ''} placeholder={own(c.key)} onCommit={(v) => setCell(o.id, c.key, v)} />
                      )}
                    </td>
                  );
                })}
                {!cols.length && <td />}
                <td className="cfg-row-actions">
                  {/* shown on hovering the row; the last option stays */}
                  {input.options.length > 1 && (
                    <button
                      className="icon-btn"
                      title={t('Delete option')}
                      onClick={() =>
                        change((i) => {
                          i.options.splice(row, 1);
                          delete i.values[o.id];
                        })
                      }
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn small cfg-add-row" onClick={() => change((i) => void i.options.push({ id: uid('co'), name: `${t('Option')} ${i.options.length + 1}` }))}>
        <Icon name="plus" size={12} /> {t('Option')}
      </button>
    </div>
  );
}

/** Add a list input with two options. */
function addInput(studio: PartStudioTab) {
  const n = (studio.configuration?.length ?? 0) + 1;
  edit(
    (_, inputs) =>
      void inputs.push({
        id: uid('ci'),
        name: n === 1 ? t('Configuration') : `${t('Configuration')} ${n}`,
        options: [
          { id: uid('co'), name: t('Default') },
          { id: uid('co'), name: `${t('Option')} 2` },
        ],
        params: [],
        values: {},
      }),
  );
}

export function ConfigPanel({ onClose }: { onClose: () => void }) {
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const drag = useDraggable('configuration');
  if (!studio) return null;
  const inputs = studio.configuration ?? [];
  return (
    <div className="right-panel cfg-panel" ref={drag.ref} style={drag.style}>
      <div className="panel-header drag-handle" title={t('Drag to move; double-click to put it back next to its button')} onPointerDown={drag.onPointerDown} onDoubleClick={drag.reset}>
        <Icon name="layers" size={16} /> {t('Configurations')}
        <span className="spacer" />
        <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('Add input')} onClick={() => addInput(studio)}>
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('Close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="cfg-body">
        {!inputs.length ? (
          <div className="sel-empty cfg-empty">
            {t('A configuration makes variants of the model: its options are the rows of a table, and the parameters of features — dimensions, checkboxes, whether a feature is disabled, variables — are its columns.')}
            <div style={{ marginTop: 10 }}>
              <button className="btn small primary" onClick={() => addInput(studio)}>
                <Icon name="plus" size={12} /> {t('Add input')}
              </button>
            </div>
          </div>
        ) : (
          inputs.map((input) => <InputTable key={input.id} studio={studio} input={input} />)
        )}
      </div>
    </div>
  );
}

/** Above the feature list: the chosen option of each input (Onshape's configuration panel). */
export function ConfigChooser({ studio }: { studio: PartStudioTab }) {
  const inputs = studio.configuration ?? [];
  if (!inputs.length) return null;
  return (
    <div className="cfg-chooser">
      {inputs.map((input) => {
        const chosen = input.options.find((o) => o.id === studio.configChoice?.[input.id])?.id ?? input.options[0]?.id;
        return (
          <label key={input.id} className="cfg-choose">
            <span>{input.name}</span>
            <select value={chosen} onChange={(e) => chooseOption(input.id, e.target.value)}>
              {input.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
