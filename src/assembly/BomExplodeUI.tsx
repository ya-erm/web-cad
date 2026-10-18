// Bill of materials panel and exploded views of an assembly (Onshape BOM / Exploded views).

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ExplodeStep, ExplodedView, Vec3 } from '../core/types';
import { activeAssembly, useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { requestRebuild } from '../store/rebuild';
import { uid } from '../core/ids';
import { LENGTH_FACTOR } from '../core/expr';
import { Icon } from '../ui/icons';
import { t } from '../i18n';
import { useAssembly } from './sources';
import { BOM_COLUMNS, BOM_EDITABLE, BOM_LABELS, BOM_TYPE_LABELS, BOM_TYPES, billOfMaterials, bomCsv, type BomColumn, type BomRow, type BomType } from './bom';
import { composeDisplayed, explodedViewName, useExplode } from './explode';
import { commitAssembly, NumField, selectedInstances } from './AssemblyUI';

/** The panel: open, its columns, its type and the sub-assembly rows collapsed in it (by item number). */
const useBom = create<{ open: boolean; columns: BomColumn[]; type: BomType; collapsed: string[] }>(() => ({
  open: false,
  columns: [...BOM_COLUMNS],
  type: 'structured',
  collapsed: [],
}));

export function toggleBom() {
  useBom.setState((s) => ({ open: !s.open }));
}

export function useBomOpen() {
  return useBom((s) => s.open);
}

/** A part property in a BOM cell: edited in place, stored with the part in its Part Studio. */
function PropCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="bom-cell"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

/** Set (or clear) a property of a part in its Part Studio — one undo step. */
function setPartProperty(studioId: string, partId: string, key: 'partNumber' | 'description' | 'material', value: string) {
  useDoc.getState().update((d) => {
    const st = d.tabs.find((x) => x.id === studioId);
    if (st?.type !== 'partStudio') return;
    const meta = (st.parts[partId] ??= {});
    if (value) meta[key] = value;
    else delete meta[key];
  });
}

/**
 * Bill of materials: one row per part (structured: and per sub-assembly, its parts under it) with its quantity;
 * part number, description and material are edited in the table; the columns are chosen in a menu; a click on
 * a row selects the instances; CSV export (of every row, collapsed ones too).
 */
export function BomPanel() {
  const open = useBom((s) => s.open);
  const columns = useBom((s) => s.columns);
  const type = useBom((s) => s.type);
  const collapsed = useBom((s) => s.collapsed);
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const sources = useAssembly((s) => s.sources);
  if (!open || !asm || !doc) return null;
  const rows = billOfMaterials(doc, asm, sources, type);
  const shown = rows.filter((r) => !collapsed.some((c) => r.item.startsWith(`${c}.`)));
  const hasInside = (r: BomRow) => rows.some((x) => x.item.startsWith(`${r.item}.`));
  const toggle = (item: string) => useBom.setState((s) => ({ collapsed: s.collapsed.includes(item) ? s.collapsed.filter((x) => x !== item) : [...s.collapsed, item] }));
  const labels = Object.fromEntries(BOM_COLUMNS.map((c) => [c, t(BOM_LABELS[c])])) as Record<BomColumn, string>;
  const exportCsv = () => {
    const blob = new Blob([bomCsv(rows, columns, labels)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${asm.name} — ${t('Bill of materials')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const columnMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    useEditor.setState({
      contextMenu: {
        x: r.left,
        y: r.bottom + 4,
        items: BOM_COLUMNS.map((c) => ({
          label: labels[c],
          icon: columns.includes(c) ? ('check' as const) : undefined,
          action: () =>
            useBom.setState((s) => ({
              // keep the table's order; never hide every column
              columns: s.columns.includes(c) ? (s.columns.length > 1 ? s.columns.filter((x) => x !== c) : s.columns) : BOM_COLUMNS.filter((x) => x === c || s.columns.includes(x)),
            })),
        })),
      },
    });
  };
  const cell = (r: BomRow, c: BomColumn) => {
    if (BOM_EDITABLE.includes(c) && r.kind === 'part')
      return <PropCell value={String(r[c])} onCommit={(v) => setPartProperty(r.studioId, r.partId, c as 'partNumber' | 'description' | 'material', v)} />;
    if (c !== 'name') return r[c];
    // the name: indented by level, a sub-assembly with its icon and (structured) a toggle for its rows
    const inside = type === 'structured' && hasInside(r);
    return (
      <span className="bom-name" style={{ paddingLeft: (r.level - 1) * 14 }}>
        <span
          className={'bom-toggle' + (inside ? '' : ' none')}
          title={inside ? t('Expand / collapse') : undefined}
          onClick={(e) => {
            if (!inside) return;
            e.stopPropagation();
            toggle(r.item);
          }}
        >
          {inside && <Icon name={collapsed.includes(r.item) ? 'chevronRight' : 'chevronDown'} size={12} />}
        </span>
        <Icon name={r.kind === 'assembly' ? 'assembly' : 'partItem'} size={14} />
        {r.name}
      </span>
    );
  };
  return (
    <div className="bom-panel">
      <div className="fd-header">
        <Icon name="bom" size={18} />
        <span className="fd-title">{t('Bill of materials')}</span>
        <select
          className="bom-type"
          title={t('BOM type: structured — sub-assemblies with their parts by levels; flattened — all the parts; top-level only — the instances of this assembly')}
          value={type}
          onChange={(e) => useBom.setState({ type: e.target.value as BomType })}
        >
          {BOM_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(BOM_TYPE_LABELS[x])}
            </option>
          ))}
        </select>
        <button className="icon-btn" title={t('Columns')} onClick={columnMenu}>
          <Icon name="filter" size={18} />
        </button>
        <button className="icon-btn" title={t('Export CSV')} disabled={!rows.length} onClick={exportCsv}>
          <Icon name="download" size={18} />
        </button>
        <button className="icon-btn" title={t('Close')} onClick={toggleBom}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {rows.length ? (
        <div className="bom-scroll">
          <table className="bom-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className={c === 'quantity' || c === 'item' ? 'num' : undefined}>
                    {labels[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.item}
                  className={r.kind === 'assembly' ? 'sub' : undefined}
                  onClick={() => useEditor.getState().setSelection(r.instances.map((id) => ({ kind: 'part', partId: id })))}
                >
                  {columns.map((c) => (
                    <td key={c} className={c === 'quantity' || c === 'item' ? 'num' : BOM_EDITABLE.includes(c) ? 'edit' : undefined}>
                      {cell(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel-empty">{t('Insert parts from a Part Studio with the Insert button.')}</div>
      )}
    </div>
  );
}

/** Exploded views of the assembly (under the mates): a click opens one, + adds a new one. */
export function ExplodedViewList() {
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const openView = useExplode((s) => s.view);
  if (!asm) return null;
  const views = asm.explodedViews ?? [];
  const open = (v: ExplodedView) => {
    useExplode.setState({ assembly: asm.id, view: v.id, amount: 1 });
    useEditor.getState().setSelection([]);
  };
  const add = () => {
    const v: ExplodedView = { id: uid('ev'), name: explodedViewName(asm), steps: [] };
    commitAssembly((a) => void (a.explodedViews = [...(a.explodedViews ?? []), v]));
    open(v);
  };
  const menu = (e: React.MouseEvent, v: ExplodedView) => {
    e.preventDefault();
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: t('Open'), icon: 'edit', action: () => open(v) },
          { separator: true, label: '' },
          {
            label: t('Delete'), icon: 'trash', danger: true,
            action: () => {
              if (openView === v.id) closeExploded();
              commitAssembly((a) => void (a.explodedViews = (a.explodedViews ?? []).filter((x) => x.id !== v.id)));
            },
          },
        ],
      },
    });
  };
  return (
    <div className="panel-section exploded-views">
      <div className="panel-header">
        {t('Exploded views')} <span className="count">({views.length})</span>
        <button className="icon-btn panel-add" title={t('New exploded view')} onClick={add}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="panel-body">
        {views.map((v) => (
          <div key={v.id} className={'tree-item' + (openView === v.id ? ' selected' : '')} onClick={() => open(v)} onContextMenu={(e) => menu(e, v)}>
            <span className="tree-icon">
              <Icon name="explode" size={16} />
            </span>
            <span className="tree-name">{v.name.replace(/^Exploded view(?= \d+$)/, t('Exploded view'))}</span>
            <span className="mate-type">{v.steps.length}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function closeExploded() {
  useExplode.setState({ assembly: null, view: null, amount: 1, pending: null });
  requestRebuild();
}

/** A step being dragged with the triad (shown on top of the fully exploded view); null clears it. */
export function explodePreview(step: Omit<ExplodeStep, 'id'> | null) {
  useExplode.setState({ pending: step ? { ...step, id: 'pending' } : null, amount: 1 });
}

/** The dragged step becomes the view's next step (unless it did not move anything). */
export function explodeCommit() {
  const { pending, view } = useExplode.getState();
  useExplode.setState({ pending: null });
  if (!pending || !view || (Math.abs(pending.distance) < 1e-6 && Math.abs(pending.angle ?? 0) < 1e-6)) return;
  const step: ExplodeStep = { ...pending, id: uid('es') };
  commitAssembly((a) => {
    const v = (a.explodedViews ?? []).find((x) => x.id === view);
    if (v) v.steps.push(step);
  });
}

const DIRECTIONS: [string, Vec3][] = [
  ['+X', [1, 0, 0]],
  ['−X', [-1, 0, 0]],
  ['+Y', [0, 1, 0]],
  ['−Y', [0, -1, 0]],
  ['+Z', [0, 0, 1]],
  ['−Z', [0, 0, -1]],
];

/** The open exploded view: its steps, a new step for the selected instances, the explode slider. */
export function ExplodeDialog() {
  const { view: viewId, amount, assembly, pending } = useExplode();
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const sources = useAssembly((s) => s.sources);
  const selection = useEditor((s) => s.selection);
  const [dir, setDir] = useState(4);
  const [distance, setDistance] = useState(50);
  const view = asm?.explodedViews?.find((v) => v.id === viewId);
  // show the assembly exploded as far as the slider says (and the step being dragged)
  useEffect(() => {
    if (asm && view && assembly === asm.id) useEditor.setState({ build: composeDisplayed(asm, sources).build });
  }, [asm, view, amount, assembly, pending, sources]);
  // another tab, or the view went away
  useEffect(() => {
    if (viewId && (!asm || assembly !== asm.id || !view)) closeExploded();
  }, [viewId, asm, assembly, view]);
  if (!asm || !doc || !view) return null;
  const unit = doc.units.length;
  const k = LENGTH_FACTOR[unit];
  const ids = selectedInstances(selection).filter((id) => asm.instances.some((i) => i.id === id));
  const name = (id: string) => asm.instances.find((i) => i.id === id)?.name ?? '?';
  const editSteps = (fn: (v: ExplodedView) => void) =>
    commitAssembly((a) => {
      const v = (a.explodedViews ?? []).find((x) => x.id === view.id);
      if (v) fn(v);
    });
  const addStep = () => {
    if (!ids.length) return;
    editSteps((v) => void v.steps.push({ id: uid('es'), instances: ids, dir: DIRECTIONS[dir][1], distance: distance * k }));
    useExplode.setState({ amount: 1 });
    useEditor.getState().setSelection([]);
  };
  // a direction along an axis by its name, any other by its components
  const dirLabel = (d: Vec3) => DIRECTIONS.find(([, v]) => v.every((c, i) => Math.abs(c - d[i]) < 1e-6))?.[0] ?? `(${d.map((c) => Math.round(c * 100) / 100).join(', ')})`;
  const stepLabel = (s: ExplodeStep) =>
    [
      Math.abs(s.distance) > 1e-6 ? `${dirLabel(s.dir)} ${Math.round((s.distance / k) * 1000) / 1000} ${unit}` : '',
      s.angle ? `↻ ${dirLabel(s.dir).replace(/^[+−]/, '')} ${Math.round(s.angle * 100) / 100}°` : '',
    ]
      .filter(Boolean)
      .join(', ');
  return (
    <div
      className="feature-dialog explode-dialog"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closeExploded();
      }}
    >
      <div className="fd-header">
        <Icon name="explode" size={18} />
        <span className="fd-title">{view.name.replace(/^Exploded view(?= \d+$)/, t('Exploded view'))}</span>
        <button className="icon-btn" title={`${t('Close')} (Esc)`} onClick={closeExploded}>
          <Icon name="check" size={18} />
        </button>
      </div>
      <div className="fd-body">
        <div className="fd-row animate-controls">
          <label>{t('Explode')}</label>
          <input type="range" min={0} max={1000} value={Math.round(amount * 1000)} onChange={(e) => useExplode.setState({ amount: Number(e.target.value) / 1000 })} />
          <span className="animate-value">{Math.round(amount * 100)}%</span>
        </div>
        <div className="fd-section">{t('Steps')}</div>
        {view.steps.length ? (
          view.steps.map((s, i) => (
            <div key={s.id} className="explode-step" title={s.instances.map(name).join(', ')}>
              <span className="explode-step-n">{i + 1}</span>
              <span className="explode-step-what">{s.instances.length === 1 ? name(s.instances[0]) : `${name(s.instances[0])} +${s.instances.length - 1}`}</span>
              <span className="explode-step-how">{stepLabel(s)}</span>
              <button className="icon-btn" title={t('Delete')} onClick={() => editSteps((v) => void (v.steps = v.steps.filter((x) => x.id !== s.id)))}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="fd-hint">{t('No steps yet: select instances, set the direction and distance, then Add step.')}</div>
        )}
        <div className="fd-section">{t('New step')}</div>
        <div className="fd-hint">{ids.length ? `${t('Instances')}: ${ids.map(name).join(', ')}` : t('Select instances in the graphics area or in the list')}</div>
        <div className="fd-row">
          <label>{t('Direction')}</label>
          <div className="fd-control">
            <select value={dir} onChange={(e) => setDir(Number(e.target.value))}>
              {DIRECTIONS.map(([l], i) => (
                <option key={l} value={i}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="fd-row">
          <label>{t('Distance')}</label>
          <div className="fd-control">
            <NumField value={distance} onCommit={(v) => setDistance(v)} suffix={unit} />
          </div>
        </div>
        <div className="fd-row">
          <button className="btn" disabled={!ids.length} onClick={addStep}>
            <Icon name="plus" size={16} /> {t('Add step')}
          </button>
        </div>
      </div>
    </div>
  );
}
