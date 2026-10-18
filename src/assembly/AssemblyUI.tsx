// Assembly tab UI (Onshape-like): Insert, the Instances list, and the placement of the selected instance.

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ConfigurationFields } from '../ui/ConfigurationFields';
import type { AssemblyInstance, AssemblyTab, CadDocument, PartStudioTab, SelRef, Vec3 } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import { activeAssembly, useDoc, withAssembly } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { uid } from '../core/ids';
import { LENGTH_FACTOR, formatNumber } from '../core/expr';
import { Icon } from '../ui/icons';
import { t, tIn } from '../i18n';
import { buildStudioParts, useAssembly } from './sources';
import { composeAssembly, insertPosition, instanceName, parseInstanceConnector } from './compose';
import {
  animatableMotions,
  applySolve,
  applySolveLed,
  editPlacement,
  FACE_MATES,
  groupName,
  makeGroup,
  MATE_ANGLE_LIMITS,
  MATE_DOF,
  MATE_OFFSET,
  MATE_Z_LIMITS,
  mateName,
  mateValues,
  nearestFlip,
} from './mates';
import { useDragPreview } from './drag';
import { containsAssembly, findInstance, topInstance, unitOf } from './expand';
import { relationTypeLabel, startRelation } from './RelationUI';
import { startAnimation } from './AnimateUI';
import { toggleBom, useBomOpen } from './BomExplodeUI';
import { useExplode } from './explode';
import type { AssemblyGroup, AssemblyMate, AssemblyMateType, MateEnd, MateLimits, MateRelation } from '../core/types';
import { requestRebuild } from '../store/rebuild';

const useInsert = create<{ open: boolean }>(() => ({ open: false }));

/** Instances referenced by the selection (faces, edges, vertices or whole instances). */
export function selectedInstances(selection: SelRef[]): string[] {
  const out: string[] = [];
  // a part of a sub-assembly (`X/inner`) stands for the sub-assembly instance X
  for (const r of selection) if ('partId' in r && !out.includes(topInstance(r.partId))) out.push(topInstance(r.partId));
  return out;
}

/**
 * What the selection moves and places (the triad, the position panel): a part of a flexible sub-assembly by
 * itself, otherwise the top-level instance.
 */
export function selectedUnits(asm: AssemblyTab, selection: SelRef[]): string[] {
  const out: string[] = [];
  for (const r of selection) if ('partId' in r && !out.includes(unitOf(asm, r.partId))) out.push(unitOf(asm, r.partId));
  return out;
}

/**
 * Change the active assembly and re-solve its mates (one undo step). `lead` — an instance moved by hand: when
 * nothing fixed holds its mates and groups, it stays where it was put and the others follow it.
 */
export function commitAssembly(fn: (a: AssemblyTab) => void, key?: string, lead?: string) {
  useDoc.getState().update(
    (d) =>
      withAssembly(d, (a) => {
        fn(a as AssemblyTab);
        const sources = useAssembly.getState().sources;
        useAssembly.setState({ failedMates: lead ? applySolveLed(a as AssemblyTab, sources, lead) : applySolve(a as AssemblyTab, sources) });
      }),
    key ? { key } : undefined,
  );
}

function updateInstances(ids: string[], fn: (i: AssemblyInstance) => void, key?: string, lead?: string) {
  commitAssembly(
    (a) => {
      for (const i of a.instances) if (ids.includes(i.id)) fn(i);
    },
    key,
    lead,
  );
}

export function deleteInstances(ids: string[]) {
  if (!ids.length) return;
  commitAssembly((a) => {
    a.instances = a.instances.filter((i) => !ids.includes(i.id));
    // mates of deleted instances go with them; groups keep the rest (two members at least)
    a.mates = (a.mates ?? []).filter((m) => !ids.includes(topInstance(m.a.instance)) && !ids.includes(topInstance(m.b.instance)));
    const left = new Set(a.mates.map((m) => m.id));
    a.relations = (a.relations ?? []).filter((r) => left.has(r.a) && left.has(r.b));
    a.groups = (a.groups ?? []).flatMap((g) => {
      const left = g.members.map((m) => m.instance).filter((id) => !ids.includes(id));
      if (left.length < 2) return [];
      return [left.length === g.members.length ? g : { ...makeGroup(a, left, g.id, g.name), ...(g.suppressed ? { suppressed: true } : {}) }];
    });
  });
  useEditor.getState().setSelection([]);
}

/** Group instances (Onshape Group): they keep their relative placement and move as one. */
export function groupInstances(ids: string[]) {
  if (ids.length < 2) return;
  commitAssembly((a) => void (a.groups = [...(a.groups ?? []), makeGroup(a, ids, uid('gr'), groupName(a))]));
}

function insertInstance(doc: CadDocument, asm: AssemblyTab, studio: PartStudioTab, parts: PartMesh[], mesh: PartMesh) {
  const sources = new Map(useAssembly.getState().sources);
  sources.set(studio.id, { parts: new Map(parts.map((p) => [p.id, p])), mates: sources.get(studio.id)?.mates ?? [] });
  const inst: AssemblyInstance = {
    id: uid('in'),
    name: instanceName(asm, mesh.name),
    studioId: studio.id,
    partId: mesh.id,
    position: insertPosition(asm, sources, mesh),
    rotation: [0, 0, 0],
  };
  useDoc.getState().update((d) => withAssembly(d, (a) => void a.instances.push(inst)));
  void doc;
  return inst;
}

export function AssemblyToolbar() {
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const selection = useEditor((s) => s.selection);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const bomOpen = useBomOpen();
  if (!asm) return null;
  const ids = selectedInstances(selection).filter((id) => asm.instances.some((i) => i.id === id));
  const allFixed = ids.length > 0 && ids.every((id) => asm.instances.find((i) => i.id === id)?.fixed);
  return (
    <div className="toolbar">
      <button className="icon-btn" title={`${t('Undo')} (Ctrl+Z)`} disabled={!canUndo} onClick={undo}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" title={`${t('Redo')} (Ctrl+Y)`} disabled={!canRedo} onClick={redo}>
        <Icon name="redo" />
      </button>
      <div className="tb-sep" />
      <button className="btn" title={`${t('Insert parts from a Part Studio')} (I)`} onClick={() => useInsert.setState({ open: true })}>
        <Icon name="import" size={16} /> {t('Insert')}
      </button>
      <button className="btn" title={`${t('Mate two instances by their mate connectors')} (J)`} disabled={asm.instances.length < 2} onClick={() => startMate()}>
        <Icon name="mateConnector" size={16} /> {t('Mate')}
      </button>
      <button
        className="icon-btn"
        title={(asm.mates ?? []).length ? t('Mate relation: gear, rack and pinion, screw') : t('Add mates first: a relation ties the motions of mates')}
        disabled={!(asm.mates ?? []).length}
        onClick={() => startRelation()}
      >
        <Icon name="gear" />
      </button>
      <button
        className="icon-btn"
        title={ids.length >= 2 ? t('Group the selected instances: they move as one') : t('Select two or more instances to group them')}
        disabled={ids.length < 2}
        onClick={() => groupInstances(ids)}
      >
        <Icon name="group" />
      </button>
      <button className="icon-btn" title={allFixed ? t('Unfix') : t('Fix instance')} disabled={!ids.length} onClick={() => updateInstances(ids, (i) => void (i.fixed = !allFixed))}>
        <Icon name="lock" />
      </button>
      <button className="icon-btn" title={`${t('Delete')} (Del)`} disabled={!ids.length} onClick={() => deleteInstances(ids)}>
        <Icon name="trash" />
      </button>
      <div className="tb-sep" />
      <button className={'icon-btn' + (bomOpen ? ' active' : '')} title={t('Bill of materials (BOM)')} onClick={toggleBom}>
        <Icon name="bom" />
      </button>
    </div>
  );
}

/**
 * The contents of sub-assembly instance `path` in the Instances list: its instances (nested sub-assemblies open
 * in turn) and — when its mates act in this assembly (flexible) — its mates, those that fail here marked.
 */
function SubRows({ sub, path, depth, acting, open, toggle }: { sub: AssemblyTab; path: string; depth: number; acting: boolean; open: string[]; toggle: (id: string) => void }) {
  const selection = useEditor((s) => s.selection);
  const sources = useAssembly((s) => s.sources);
  const failed = useAssembly((s) => s.failedMates);
  const ed = useEditor.getState;
  const picked = new Set(selection.flatMap((r) => ('partId' in r ? [r.partId] : [])));
  const pad = { paddingLeft: 10 + depth * 16 };
  return (
    <>
      {sub.instances.map((c) => {
        const id = `${path}/${c.id}`;
        const ref = { kind: 'part' as const, partId: id };
        const inner = c.assemblyId ? sources.get(c.assemblyId)?.assembly : undefined;
        return (
          <div key={id}>
            <div
              className={'tree-item' + (picked.has(id) ? ' selected' : '')}
              style={pad}
              onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? ed().select(ref) : ed().setSelection([ref]))}
              onMouseEnter={() => ed().setHover(ref)}
              onMouseLeave={() => ed().setHover(null)}
            >
              <span
                className="tree-toggle"
                onClick={(e) => {
                  if (!inner) return;
                  e.stopPropagation();
                  toggle(id);
                }}
              >
                {inner && <Icon name={open.includes(id) ? 'chevronDown' : 'chevronRight'} size={12} />}
              </span>
              <span className="tree-icon">
                <Icon name={c.assemblyId ? 'assembly' : 'partItem'} size={16} />
              </span>
              <span className="tree-name" style={c.hidden ? { color: 'var(--text-3)' } : undefined}>
                {c.name}
              </span>
              {c.fixed && (
                <span className="instance-fixed" title={t('Fixed')}>
                  <Icon name="lock" size={13} />
                </span>
              )}
            </div>
            {inner && open.includes(id) && <SubRows sub={inner} path={id} depth={depth + 1} acting={acting && !!c.flexible} open={open} toggle={toggle} />}
          </div>
        );
      })}
      {acting &&
        (sub.mates ?? []).map((m) => {
          const bad = failed.includes(`${path}/${m.id}`);
          return (
            <div
              key={`${path}/${m.id}`}
              className="tree-item"
              style={pad}
              title={t('Mates of the sub-assembly (edited in its tab)')}
              onClick={() => ed().setSelection([m.a, m.b].map((e) => ({ kind: 'part' as const, partId: `${path}/${e.instance}` })))}
            >
              <span className="tree-toggle" />
              <span className="tree-icon">
                <Icon name={bad ? 'warning' : 'mateConnector'} size={16} />
              </span>
              <span className="tree-name" style={m.suppressed ? { color: 'var(--text-3)' } : undefined}>
                {m.name}
              </span>
            </div>
          );
        })}
    </>
  );
}

export function InstanceList() {
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const selection = useEditor((s) => s.selection);
  const missing = useAssembly((s) => s.missing);
  const sources = useAssembly((s) => s.sources);
  const failed = useAssembly((s) => s.failedMates);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  // sub-assemblies opened in the list (by their ids as shown: `X`, `X/Y`)
  const [open, setOpen] = useState<string[]>([]);
  if (!asm || !doc) return null;
  const ed = useEditor.getState;
  // a part of a flexible sub-assembly is picked on its own: its row is lit, not the sub-assembly's
  const selected = new Set(selectedUnits(asm, selection));
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const tree = asm.instances.some((i) => i.assemblyId);
  const studioName = (id: string) => doc.tabs.find((x) => x.id === id)?.name ?? '?';
  const rename = (id: string) => {
    if (name.trim()) updateInstances([id], (i) => void (i.name = name.trim()));
    setRenaming(null);
  };
  const menu = (e: React.MouseEvent, inst: AssemblyInstance) => {
    e.preventDefault();
    if (!selected.has(inst.id)) ed().setSelection([{ kind: 'part', partId: inst.id }]);
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: t('Rename'), icon: 'rename',
            action: () => {
              setRenaming(inst.id);
              setName(inst.name);
            },
          },
          { label: inst.fixed ? t('Unfix') : t('Fix instance'), icon: 'lock', action: () => updateInstances([inst.id], (i) => void (i.fixed = !inst.fixed)) },
          { label: inst.hidden ? t('Show') : t('Hide'), icon: inst.hidden ? 'eye' : 'eyeOff', action: () => updateInstances([inst.id], (i) => void (i.hidden = !inst.hidden)) },
          {
            label: inst.assemblyId ? t('Open sub-assembly') : t('Edit source Part Studio'),
            icon: inst.assemblyId ? 'assembly' : 'partStudio',
            action: () => useDoc.getState().update((d) => void (d.activeTab = inst.studioId), { undoable: false }),
          },
          ...(inst.assemblyId
            ? [
                {
                  // flexible (Onshape): its parts move here as its own mates allow; rigid again: they go back
                  label: inst.flexible ? t('Make rigid') : t('Make flexible'),
                  icon: 'group' as const,
                  action: () =>
                    updateInstances([inst.id], (i) => {
                      if (i.flexible) {
                        delete i.flexible;
                        delete i.flex;
                      } else i.flexible = true;
                    }),
                },
              ]
            : []),
          { separator: true, label: '' },
          { label: t('Delete'), icon: 'trash', danger: true, action: () => deleteInstances([inst.id]) },
        ],
      },
    });
  };
  return (
    <div className="panel-section instances">
      <div className="panel-header">
        {t('Instances')} <span className="count">({asm.instances.length})</span>
      </div>
      <div className="panel-body">
        {!asm.instances.length && <div className="panel-empty">{t('Insert parts from a Part Studio with the Insert button.')}</div>}
        {asm.instances.map((inst) => {
          const ref = { kind: 'part' as const, partId: inst.id };
          const broken = missing.includes(inst.id);
          const sub = inst.assemblyId ? sources.get(inst.assemblyId)?.assembly : undefined;
          // a flexible sub-assembly's own mates that cannot be satisfied here
          const failing = !!inst.flexible && failed.some((id) => id.startsWith(`${inst.id}/`));
          return (
            <div key={inst.id}>
              <div
                className={'tree-item' + (selected.has(inst.id) ? ' selected' : '')}
                title={`${inst.name} — ${studioName(inst.studioId)}${broken ? ` (${t('the source part no longer exists')})` : ''}`}
                onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? ed().select(ref) : ed().setSelection([ref]))}
                onMouseEnter={() => ed().setHover(ref)}
                onMouseLeave={() => ed().setHover(null)}
                onDoubleClick={() => {
                  setRenaming(inst.id);
                  setName(inst.name);
                }}
                onContextMenu={(e) => menu(e, inst)}
              >
                {tree && (
                  <span
                    className="tree-toggle"
                    onClick={(e) => {
                      if (!sub) return;
                      e.stopPropagation();
                      toggle(inst.id);
                    }}
                  >
                    {sub && <Icon name={open.includes(inst.id) ? 'chevronDown' : 'chevronRight'} size={12} />}
                  </span>
                )}
                <span className="tree-icon">
                  <Icon name={broken ? 'warning' : inst.assemblyId ? 'assembly' : 'partItem'} size={16} />
                </span>
                {renaming === inst.id ? (
                  <input
                    className="tree-rename"
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => rename(inst.id)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') rename(inst.id);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="tree-name" style={inst.hidden || broken ? { color: 'var(--text-3)' } : undefined}>
                    {inst.name}
                  </span>
                )}
                {failing && (
                  <span className="instance-fixed warn" title={t('Some mates of this sub-assembly cannot be satisfied here')}>
                    <Icon name="warning" size={13} />
                  </span>
                )}
                {inst.flexible && (
                  <span className="instance-fixed" title={t('Flexible sub-assembly: its parts move as its own mates allow')}>
                    <Icon name="group" size={13} />
                  </span>
                )}
                {inst.fixed && (
                  <span className="instance-fixed" title={t('Fixed')}>
                    <Icon name="lock" size={13} />
                  </span>
                )}
                <span
                  className={'eye' + (inst.hidden ? ' off' : '')}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateInstances([inst.id], (i) => void (i.hidden = !inst.hidden));
                  }}
                >
                  <Icon name={inst.hidden ? 'eyeOff' : 'eye'} size={14} />
                </span>
              </div>
              {sub && open.includes(inst.id) && <SubRows sub={sub} path={inst.id} depth={1} acting={!!inst.flexible} open={open} toggle={toggle} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A number field committing on Enter / blur. */
export function NumField({ value, onCommit, disabled, suffix }: { value: number; onCommit: (v: number) => void; disabled?: boolean; suffix: string }) {
  const [text, setText] = useState(formatNumber(value, 4));
  useEffect(() => setText(formatNumber(value, 4)), [value]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    // show the stored value: mates may keep the instance where it was (a new value updates the field again)
    setText(formatNumber(value, 4));
  };
  return (
    <div className="instance-num">
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(formatNumber(value, 4));
        }}
      />
      <span>{suffix}</span>
    </div>
  );
}

/** Placement of the selected instance: position and rotation, Fixed. */
export function InstancePanel() {
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const selection = useEditor((s) => s.selection);
  const mating = useMate((s) => s.draft !== null);
  const dragged = useDragPreview((s) => s.tab);
  // an open exploded view shows the parts apart: their placement is not edited there
  const exploded = useExplode((s) => s.view !== null);
  if (!asm || !doc || mating || exploded) return null;
  const ids = selectedUnits(asm, selection);
  // while the instance is dragged in the graphics area, its placement updates live; a part of a flexible
  // sub-assembly (`X/inner`) shows where it stands in this assembly
  const inst = ids.length === 1 ? findInstance(dragged ?? asm, useAssembly.getState().sources, ids[0]) : undefined;
  if (!inst) return null;
  const part = inst.id.includes('/');
  const unit = doc.units.length;
  const k = LENGTH_FACTOR[unit];
  const set = (fn: (i: AssemblyInstance) => void) => updateInstances([inst.id], fn);
  const axis = (label: string, v: number, onCommit: (v: number) => void, suffix: string) => (
    <div className="fd-row" key={label}>
      <label>{label}</label>
      <div className="fd-control">
        <NumField value={v} disabled={inst.fixed} onCommit={onCommit} suffix={suffix} />
      </div>
    </div>
  );
  // the typed instance leads its mated group / group unless something fixed holds them
  const place = (fn: (i: AssemblyInstance) => void) =>
    commitAssembly((a) => void editPlacement(a, useAssembly.getState().sources, inst.id, fn), undefined, inst.id);
  const setPos = (n: number) => (v: number) => place((i) => void (i.position[n] = v * k));
  const setRot = (n: number) => (v: number) => place((i) => void (i.rotation[n] = v));
  const source = doc.tabs.find((x) => x.id === inst.studioId);
  return (
    <div className="feature-dialog instance-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="fd-header">
        <Icon name={inst.assemblyId ? 'assembly' : 'partItem'} size={18} />
        <span className="fd-title">{inst.name}</span>
      </div>
      <div className="fd-body">
        <div className="instance-source">
          {t('Source')}: {source?.name ?? '?'}
        </div>
        <div className="fd-section">{t('Position')}</div>
        {(['X', 'Y', 'Z'] as const).map((a, n) => axis(a, Math.round((inst.position[n] / k) * 1e6) / 1e6, setPos(n), unit))}
        <div className="fd-section">{t('Rotation about axes')}</div>
        {(['X', 'Y', 'Z'] as const).map((a, n) => axis(a, inst.rotation[n], setRot(n), '°'))}
        {!part && source?.type === 'partStudio' && !!source.configuration?.length && (
          // its own configuration of the Part Studio (Onshape): an input left as in the Part Studio follows it
          <>
            <div className="fd-section">{t('Configuration')}</div>
            <ConfigurationFields
              studio={source}
              value={inst.configuration}
              onChange={(c) =>
                set((i) => {
                  if (c) i.configuration = c;
                  else delete i.configuration;
                })
              }
            />
          </>
        )}
        {part ? (
          // a part of a flexible sub-assembly: fixed or not as the sub-assembly has it
          <div className="fd-hint">{inst.fixed ? t('Fixed in its flexible sub-assembly: it moves with it.') : t('A part of a flexible sub-assembly: it moves as the sub-assembly mates allow.')}</div>
        ) : (
          <>
            <label className="fd-check">
              <input type="checkbox" checked={!!inst.fixed} onChange={(e) => set((i) => void (i.fixed = e.target.checked))} />
              {t('Fixed')}
            </label>
            {inst.fixed && <div className="fd-hint">{t('A fixed instance cannot be moved.')}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function InsertDialog() {
  const open = useInsert((s) => s.open);
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const studios = (doc?.tabs.filter((x) => x.type === 'partStudio') ?? []) as PartStudioTab[];
  // other assemblies go in as sub-assemblies — not one that contains this one (it would contain itself)
  const assemblies = (doc?.tabs.filter((x) => x.type === 'assembly' && asm && !containsAssembly(doc.tabs as AssemblyTab[], x.id, asm.id)) ?? []) as AssemblyTab[];
  const [studioId, setStudioId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [parts, setParts] = useState<PartMesh[] | null>(null);
  const [error, setError] = useState('');
  const studio = studios.find((s) => s.id === studioId) ?? studios[0];
  const sub = assemblies.find((a) => a.id === subId);
  useEffect(() => {
    if (!open || !doc || !studio) return;
    let alive = true;
    setParts(null);
    setError('');
    buildStudioParts(doc, studio)
      .then((p) => alive && setParts(p))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // rebuild the list when the studio (or its geometry) changes
  }, [open, studio?.id, studio?.features, doc?.units]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !doc || !asm) return null;
  const close = () => useInsert.setState({ open: false });
  const insert = (list: PartMesh[]) => {
    if (!studio) return;
    let a = asm;
    const made: string[] = [];
    for (const m of list) {
      const inst = insertInstance(doc, a, studio, parts ?? [], m);
      made.push(inst.id);
      a = activeAssembly(useDoc.getState().doc) ?? a;
    }
    useEditor.getState().setSelection(made.map((id) => ({ kind: 'part' as const, partId: id })));
    close();
  };
  const insertSub = (s: AssemblyTab) => {
    const sources = useAssembly.getState().sources;
    const inst: AssemblyInstance = {
      id: uid('in'),
      name: instanceName(asm, s.name),
      studioId: s.id,
      partId: '',
      assemblyId: s.id,
      position: insertPosition(asm, sources, { bbox: [[0, 0, 0], [0, 0, 0]] } as PartMesh),
      rotation: [0, 0, 0],
    };
    useDoc.getState().update((d) => withAssembly(d, (a) => void a.instances.push(inst)));
    useEditor.getState().setSelection([{ kind: 'part', partId: inst.id }]);
    close();
  };
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal insert-dialog" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="import" /> &nbsp;{t('Insert parts')}
          <span className="spacer" />
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body insert-body">
          {!studios.length && !assemblies.length && <div className="panel-empty">{t('The document has no Part Studios.')}</div>}
          {(!!studios.length || !!assemblies.length) && (
            <>
              <div className="insert-col">
                <div className="insert-head">{t('Part Studios')}</div>
                {studios.map((s) => (
                  <div
                    key={s.id}
                    className={'tree-item' + (!sub && s.id === studio?.id ? ' selected' : '')}
                    onClick={() => {
                      setStudioId(s.id);
                      setSubId(null);
                    }}
                  >
                    <Icon name="partStudio" size={16} /> <span className="tree-name">{s.name}</span>
                  </div>
                ))}
                {!!assemblies.length && <div className="insert-head">{t('Assemblies')}</div>}
                {assemblies.map((a) => (
                  <div key={a.id} className={'tree-item' + (a.id === sub?.id ? ' selected' : '')} onClick={() => setSubId(a.id)}>
                    <Icon name="assembly" size={16} /> <span className="tree-name">{a.name}</span>
                  </div>
                ))}
              </div>
              <div className="insert-col">
                {sub ? (
                  <>
                    <div className="insert-head">{t('Sub-assembly')}</div>
                    <div className="tree-item" title={t('Click to insert')} onClick={() => insertSub(sub)}>
                      <Icon name="assembly" size={16} /> <span className="tree-name">{sub.name}</span>
                      <span className="mate-type">{sub.instances.length}</span>
                    </div>
                    <div className="fd-hint">{t('The assembly goes in as one instance that moves as a whole; mates can reach its parts.')}</div>
                  </>
                ) : (
                  <>
                    <div className="insert-head">{t('Parts')}</div>
                    {error && <div className="fd-error">{error}</div>}
                    {!parts && !error && <div className="spinner" />}
                    {parts && !parts.length && <div className="panel-empty">{t('This Part Studio has no parts.')}</div>}
                    {parts?.map((p) => (
                      <div key={p.id} className="tree-item" title={t('Click to insert')} onClick={() => insert([p])}>
                        <span className="color-swatch" style={{ background: p.color }} /> <span className="tree-name">{p.name}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={!!sub || !parts?.length} onClick={() => parts && insert(parts)}>
            {t('Insert all parts')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Open the Insert dialog (keyboard shortcut). */
export function openInsertDialog() {
  useInsert.setState({ open: true });
}

// ---------------------------------------------------------------------------
// Mates
// ---------------------------------------------------------------------------

export const MATE_TYPES: [AssemblyMateType, string][] = [
  ['fastened', 'Fastened'],
  ['revolute', 'Revolute'],
  ['slider', 'Slider'],
  ['cylindrical', 'Cylindrical'],
  ['planar', 'Planar'],
  ['ball', 'Ball'],
  ['parallel', 'Parallel'],
  ['pinSlot', 'Pin slot'],
  ['tangent', 'Tangent'],
  ['width', 'Width'],
];

/** Mate type as shown (Onshape names). */
const mateTypeLabel = (ty: AssemblyMateType) => tIn('mate', MATE_TYPES.find(([v]) => v === ty)?.[1] ?? ty);

interface MateDraft {
  /** Mate being edited (else a new one). */
  editing?: string;
  name?: string;
  type: AssemblyMateType;
  a?: MateEnd;
  b?: MateEnd;
  /** Width mate: the second face of each pair. */
  a2?: MateEnd;
  b2?: MateEnd;
  flip: boolean;
  /** Flip chosen by the user (else the nearest one is taken when both ends are set). */
  flipSet?: boolean;
  angle: number;
  offset?: number;
  limits?: MateLimits;
}

const useMate = create<{ draft: MateDraft | null }>(() => ({ draft: null }));

/** Whether the mate dialog is open (clicks in the graphics area pick mate ends then). */
export function mateDialogOpen() {
  return useMate.getState().draft !== null;
}

/** Keys of the open mate dialog: Enter accepts, Esc cancels. Returns whether the key was used. */
export function mateDialogKey(e: KeyboardEvent): boolean {
  if (!useMate.getState().draft) return false;
  if (e.key === 'Escape') {
    document.querySelector<HTMLButtonElement>('.mate-dialog .fd-header button:last-child')?.click();
    return true;
  }
  if (e.key === 'Enter') {
    document.querySelector<HTMLButtonElement>('.mate-dialog .fd-header button:first-of-type')?.click();
    return true;
  }
  return false;
}

/** Open the mate dialog: a new mate, or an existing one to edit. */
export function startMate(m?: AssemblyMate) {
  useEditor.getState().setSelection([]);
  useMate.setState({
    draft: m
      ? { editing: m.id, name: m.name, type: m.type, a: m.a, b: m.b, a2: m.a2, b2: m.b2, flip: m.flip, flipSet: true, angle: m.angle ?? 0, offset: m.offset, limits: m.limits }
      : { type: 'fastened', flip: true, angle: 0 },
  });
}

/** Selection → mate end: a face / edge / vertex of an instance, or one of its explicit mate connectors. */
function endOf(r: SelRef): MateEnd | null {
  if (r.kind === 'face' || r.kind === 'edge' || r.kind === 'vertex') return { instance: r.partId, connector: { kind: r.kind, index: r.index } };
  if (r.kind === 'plane') {
    const c = parseInstanceConnector(r.planeId);
    return c ? { instance: c.instance, connector: { kind: 'connector', featureId: c.featureId } } : null;
  }
  return null;
}

/** Back to a selection reference (to keep the picked connectors highlighted). */
function refOfEnd(e: MateEnd, instanceConnector: (i: string, f: string) => string): SelRef {
  const c = e.connector;
  if (c.kind === 'connector') return { kind: 'plane', planeId: instanceConnector(e.instance, c.featureId) };
  return { kind: c.kind, partId: e.instance, index: c.index, sig: { type: '', center: [0, 0, 0], size: 0 } } as SelRef;
}

/** The assembly with the draft mate in place (and solved). */
function withDraft(asm: AssemblyTab, d: MateDraft): { tab: AssemblyTab; mate: AssemblyMate | null; failed: string[] } {
  const tab = structuredClone(asm) as AssemblyTab;
  if (!d.a || !d.b || (d.type === 'width' && (!d.a2 || !d.b2))) return { tab, mate: null, failed: [] };
  const sources = useAssembly.getState().sources;
  const mate: AssemblyMate = {
    id: d.editing ?? uid('mt'),
    name: d.name ?? mateName(tab, d.type),
    type: d.type,
    a: d.a,
    b: d.b,
    ...(d.type === 'width' ? { a2: d.a2, b2: d.b2 } : d.type === 'pinSlot' && d.a2 ? { a2: d.a2 } : {}),
    flip: d.flipSet ? d.flip : nearestFlip(sources, tab, d.a, d.b, d.type),
    ...(d.angle ? { angle: d.angle } : {}),
    ...(d.offset && MATE_OFFSET.includes(d.type) ? { offset: d.offset } : {}),
  };
  // only the limits the mate type has
  const z = MATE_Z_LIMITS.includes(d.type);
  const a = MATE_ANGLE_LIMITS.includes(d.type);
  if (d.limits && (z || a))
    mate.limits = {
      ...(z ? { zMin: d.limits.zMin, zMax: d.limits.zMax } : {}),
      ...(a ? { aMin: d.limits.aMin, aMax: d.limits.aMax } : {}),
    };
  const mates = tab.mates ?? [];
  const i = mates.findIndex((m) => m.id === mate.id);
  if (i >= 0) mates[i] = mate;
  else mates.push(mate);
  tab.mates = mates;
  const failed = applySolve(tab, sources);
  return { tab, mate, failed };
}

function endLabel(doc: CadDocument, asm: AssemblyTab, e: MateEnd | undefined): string {
  if (!e) return '';
  const inst = findInstance(asm, useAssembly.getState().sources, e.instance);
  const c = e.connector;
  let what: string;
  if (c.kind === 'connector') {
    const studio = doc.tabs.find((x) => x.id === inst?.studioId);
    const f = studio?.type === 'partStudio' ? studio.features.find((x) => x.id === c.featureId) : undefined;
    what = f?.name ?? t('Mate connector');
  } else what = t(c.kind === 'face' ? 'Face' : c.kind === 'edge' ? 'Edge' : 'Vertex');
  return `${what} — ${inst?.name ?? '?'}`;
}

export function MateDialog() {
  const draft = useMate((s) => s.draft);
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const sources = useAssembly((s) => s.sources);
  // picks in the graphics area fill the first, then the second connector
  useEffect(() => {
    if (!draft) return;
    return useEditor.subscribe((s, prev) => {
      if (s.selection === prev.selection) return;
      const d = useMate.getState().draft;
      if (!d) return;
      const picked = [d.a, d.a2, d.b, d.b2].filter((x): x is MateEnd => !!x);
      const faces = FACE_MATES.includes(d.type);
      const fresh = s.selection
        .map(endOf)
        .filter((e): e is MateEnd => !!e && (!faces || e.connector.kind === 'face') && !picked.some((p) => JSON.stringify(p) === JSON.stringify(e)));
      if (!fresh.length) return;
      const e = fresh[fresh.length - 1];
      // the fields in turn (width: both faces of the slot, then both faces of the tab; pin slot: then an edge along
      // the slot); then the last one again
      const order = (d.type === 'width' ? ['a', 'a2', 'b', 'b2'] : d.type === 'pinSlot' ? ['a', 'b', 'a2'] : ['a', 'b']) as ('a' | 'a2' | 'b' | 'b2')[];
      const key = order.find((k) => !d[k]) ?? order[order.length - 1];
      if (d.type === 'pinSlot' && key === 'a2' && e.connector.kind !== 'edge') return;
      useMate.setState({ draft: { ...d, [key]: e } });
    });
  }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the picked connectors selected (highlighted) and preview the solved assembly
  useEffect(() => {
    if (!draft || !asm) return;
    const refs = [draft.a, draft.a2, draft.b, draft.b2].filter((x): x is MateEnd => !!x).map((e) => refOfEnd(e, (i, f) => `${i}|${f}`));
    useEditor.setState({ selection: refs });
    if (draft.a && draft.b) useEditor.setState({ build: composeAssembly(withDraft(asm, draft).tab, sources).build });
  }, [draft, asm, sources]);
  if (!draft || !asm || !doc) return null;
  const close = () => {
    useMate.setState({ draft: null });
    useEditor.getState().setSelection([]);
    requestRebuild();
  };
  const preview = withDraft(asm, draft);
  const ok = () => {
    if (!preview.mate) return;
    const mate = preview.mate;
    commitAssembly((a) => {
      const mates = a.mates ?? [];
      const i = mates.findIndex((m) => m.id === mate.id);
      if (i >= 0) mates[i] = mate;
      else mates.push(mate);
      a.mates = mates;
    });
    useMate.setState({ draft: null });
    useEditor.getState().setSelection([]);
  };
  const set = (patch: Partial<MateDraft>) => useMate.setState({ draft: { ...draft, ...patch } });
  const flipNow = preview.mate?.flip ?? draft.flip;
  const turnable = draft.type === 'fastened' || draft.type === 'slider' || draft.type === 'pinSlot';
  const faceMate = FACE_MATES.includes(draft.type);
  // selection fields: two ends; width — the two faces of the slot, then the two of the tab
  const fields: ['a' | 'a2' | 'b' | 'b2', string][] =
    draft.type === 'width'
      ? [
          ['a', t('Width: first face (stays)')],
          ['a2', t('Width: second face')],
          ['b', t('Tab: first face (moves)')],
          ['b2', t('Tab: second face')],
        ]
      : [
          ['a', t('First (stays)')],
          ['b', t('Second (moves)')],
          ...(draft.type === 'pinSlot' ? ([['a2', t('Slot direction: an edge (optional)')]] as ['a2', string][]) : []),
        ];
  const activeField = fields.find(([k]) => !draft[k])?.[0];
  const conflict = !!preview.mate && preview.failed.includes(preview.mate.id);
  const unit = doc.units.length;
  const k = LENGTH_FACTOR[unit];
  const zLimits = MATE_Z_LIMITS.includes(draft.type);
  const aLimits = MATE_ANGLE_LIMITS.includes(draft.type);
  const setLimit = (patch: MateLimits) => set({ limits: { ...draft.limits, ...patch } });
  // limits start around the current placement: ±10 mm along Z, ±45° about it
  const defaultLimits = (): MateLimits => {
    const cur = preview.mate ? mateValues(sources, preview.tab, preview.mate) : null;
    const z = Math.round(cur?.z ?? 0);
    const a = Math.round(cur?.angle ?? 0);
    return { zMin: z - 10, zMax: z + 10, aMin: Math.max(-180, a - 45), aMax: Math.min(180, a + 45) };
  };
  return (
    <div className="feature-dialog mate-dialog" onKeyDown={(e) => e.stopPropagation()}>
      <div className="fd-header">
        <Icon name="mateConnector" size={18} />
        <span className="fd-title">{draft.name ?? t('Mate')}</span>
        <button className="icon-btn" title={`${t('Accept')} (Enter)`} disabled={!preview.mate} onClick={ok}>
          <Icon name="check" size={18} />
        </button>
        <button className="icon-btn" title={`${t('Cancel')} (Esc)`} onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="fd-body">
        <div className="fd-row">
          <label>{t('Mate type')}</label>
          <div className="fd-control">
            <select value={draft.type} onChange={(e) => set({ type: e.target.value as AssemblyMateType })}>
              {MATE_TYPES.map(([v]) => (
                <option key={v} value={v}>
                  {mateTypeLabel(v)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="fd-hint">
          {t('Degrees of freedom')}: {MATE_DOF[draft.type]}
        </div>
        <div className="fd-section">{faceMate ? t('Faces') : t('Mate connectors')}</div>
        {fields.map(([k, label]) => (
          <div key={k} className={'sel-field' + (k === activeField ? ' active' : '')} onClick={() => set({ [k]: undefined, flipSet: false })}>
            <div className="sel-label">{label}</div>
            {draft[k] ? (
              endLabel(doc, asm, draft[k])
            ) : (
              <span className="sel-empty">
                {draft.type === 'width'
                  ? t('Select a planar face')
                  : draft.type === 'tangent'
                    ? t('Select a face: planar, cylindrical, spherical, conical or toroidal')
                    : k === 'a2'
                      ? t('Select a straight edge of the first instance along the slot')
                      : t('Select a face, edge, vertex or mate connector')}
              </span>
            )}
          </div>
        ))}
        <div className="fd-row">
          {draft.type !== 'width' && (
            <button className="btn" disabled={!preview.mate} onClick={() => set({ flip: !flipNow, flipSet: true })}>
              <Icon name="flip" size={16} /> {draft.type === 'tangent' ? t('Other side') : t('Flip primary axis')}
            </button>
          )}
          {turnable && (
            <button className="btn" disabled={!preview.mate} onClick={() => set({ angle: ((draft.angle ?? 0) + 90) % 360 })}>
              {t('Rotate 90°')}
            </button>
          )}
        </div>
        {MATE_OFFSET.includes(draft.type) &&
          numRow(t('Offset'), (draft.offset ?? 0) / k, (v) => set({ offset: v * k || undefined }), unit, t('Distance of the second mate connector along the Z axis of the first'))}
        {(zLimits || aLimits) && (
          <label className="fd-check">
            <input type="checkbox" checked={!!draft.limits} disabled={!preview.mate} onChange={(e) => set({ limits: e.target.checked ? defaultLimits() : undefined })} />
            {t('Limits')}
          </label>
        )}
        {draft.limits && zLimits && (
          <>
            {numRow(t('Axial minimum'), (draft.limits.zMin ?? 0) / k, (v) => setLimit({ zMin: v * k }), unit)}
            {numRow(t('Axial maximum'), (draft.limits.zMax ?? 0) / k, (v) => setLimit({ zMax: v * k }), unit)}
          </>
        )}
        {draft.limits && aLimits && (
          <>
            {numRow(t('Rotational minimum'), draft.limits.aMin ?? -180, (v) => setLimit({ aMin: Math.max(-180, Math.min(180, v)) }), '°')}
            {numRow(t('Rotational maximum'), draft.limits.aMax ?? 180, (v) => setLimit({ aMax: Math.max(-180, Math.min(180, v)) }), '°')}
          </>
        )}
        {conflict && <div className="fd-error">{t('This mate conflicts with other mates or fixed instances')}</div>}
      </div>
    </div>
  );
}

function numRow(label: string, value: number, onCommit: (v: number) => void, suffix: string, title?: string) {
  return (
    <div className="fd-row" key={label} title={title}>
      <label>{label}</label>
      <div className="fd-control">
        <NumField value={Math.round(value * 1e6) / 1e6} onCommit={onCommit} suffix={suffix} />
      </div>
    </div>
  );
}

/** Mates of the assembly (under the instances). */
export function MateList() {
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const failed = useAssembly((s) => s.failedMates);
  if (!asm || !doc) return null;
  const mates = asm.mates ?? [];
  const groups = asm.groups ?? [];
  const relations = asm.relations ?? [];
  const mateName = (id: string) => mates.find((m) => m.id === id)?.name ?? '?';
  const relationMenu = (e: React.MouseEvent, r: MateRelation) => {
    e.preventDefault();
    const update = (fn: (x: MateRelation) => MateRelation | null) => commitAssembly((a) => void (a.relations = (a.relations ?? []).flatMap((x) => (x.id === r.id ? (fn(x) ?? []) : [x]))));
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: t('Edit'), icon: 'edit', action: () => startRelation(r) },
          { label: r.suppressed ? t('Unsuppress') : t('Suppress'), icon: r.suppressed ? 'unsuppress' : 'suppress', action: () => update((x) => ({ ...x, suppressed: !x.suppressed || undefined })) },
          { separator: true, label: '' },
          { label: t('Delete'), icon: 'trash', danger: true, action: () => update(() => null) },
        ],
      },
    });
  };
  const typeLabel = mateTypeLabel;
  const instName = (id: string) => findInstance(asm, useAssembly.getState().sources, id)?.name ?? '?';
  const updateGroup = (id: string, fn: (g: AssemblyGroup, a: AssemblyTab) => AssemblyGroup | null) =>
    commitAssembly((a) => {
      a.groups = (a.groups ?? []).flatMap((g) => (g.id === id ? (fn(g, a) ?? []) : [g]));
    });
  const groupMenu = (e: React.MouseEvent, g: AssemblyGroup) => {
    e.preventDefault();
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: t('Update to the current placement'), icon: 'rollback',
            action: () => updateGroup(g.id, (x, a) => ({ ...makeGroup(a, x.members.map((m) => m.instance), x.id, x.name), ...(x.suppressed ? { suppressed: true } : {}) })),
          },
          { label: g.suppressed ? t('Unsuppress') : t('Suppress'), icon: g.suppressed ? 'unsuppress' : 'suppress', action: () => updateGroup(g.id, (x) => ({ ...x, suppressed: !x.suppressed || undefined })) },
          { separator: true, label: '' },
          { label: t('Ungroup'), icon: 'trash', danger: true, action: () => updateGroup(g.id, () => null) },
        ],
      },
    });
  };
  const update = (id: string, fn: (m: AssemblyMate) => void) =>
    commitAssembly((a) => {
      const m = (a.mates ?? []).find((x) => x.id === id);
      if (m) fn(m);
    });
  const menu = (e: React.MouseEvent, m: AssemblyMate) => {
    e.preventDefault();
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: t('Edit'), icon: 'edit', action: () => startMate(m) },
          ...(animatableMotions(m.type).length && !m.suppressed ? [{ label: t('Animate'), icon: 'animate' as const, action: () => startAnimation(m) }] : []),
          { label: t('Flip primary axis'), icon: 'flip', action: () => update(m.id, (x) => void (x.flip = !x.flip)) },
          { label: m.suppressed ? t('Unsuppress') : t('Suppress'), icon: m.suppressed ? 'unsuppress' : 'suppress', action: () => update(m.id, (x) => void (x.suppressed = !x.suppressed)) },
          { separator: true, label: '' },
          {
            label: t('Delete'), icon: 'trash', danger: true,
            action: () =>
              commitAssembly((a) => {
                a.mates = (a.mates ?? []).filter((x) => x.id !== m.id);
                // relations of the mate go with it
                a.relations = (a.relations ?? []).filter((r) => r.a !== m.id && r.b !== m.id);
              }),
          },
        ],
      },
    });
  };
  return (
    <div className="panel-section mates">
      <div className="panel-header">
        {t('Mates')} <span className="count">({mates.length + groups.length + relations.length})</span>
      </div>
      <div className="panel-body">
        {groups.map((g) => {
          const bad = failed.includes(g.id) && !g.suppressed;
          return (
            <div
              key={g.id}
              className="tree-item"
              title={`${t('Group')}: ${g.members.map((m) => instName(m.instance)).join(', ')}${bad ? ` (${t('cannot be satisfied')})` : ''}`}
              onClick={() => useEditor.getState().setSelection(g.members.map((m) => ({ kind: 'part', partId: m.instance })))}
              onContextMenu={(e) => groupMenu(e, g)}
            >
              <span className="tree-icon">
                <Icon name={bad ? 'warning' : 'group'} size={16} />
              </span>
              <span className="tree-name" style={g.suppressed ? { color: 'var(--text-3)', textDecoration: 'line-through' } : undefined}>
                {g.name.replace(/^Group(?= \d+$)/, t('Group'))}
              </span>
              <span className="mate-type">{g.members.length}</span>
            </div>
          );
        })}
        {mates.map((m) => {
          const bad = failed.includes(m.id) && !m.suppressed;
          return (
            <div
              key={m.id}
              className="tree-item"
              title={`${typeLabel(m.type)}: ${instName(m.a.instance)} — ${instName(m.b.instance)}${bad ? ` (${t('cannot be satisfied')})` : ''}`}
              onClick={() => useEditor.getState().setSelection([{ kind: 'part', partId: m.a.instance }, { kind: 'part', partId: m.b.instance }])}
              onDoubleClick={() => startMate(m)}
              onContextMenu={(e) => menu(e, m)}
            >
              <span className="tree-icon">
                <Icon name={bad ? 'warning' : 'mateConnector'} size={16} />
              </span>
              <span className="tree-name" style={m.suppressed ? { color: 'var(--text-3)', textDecoration: 'line-through' } : undefined}>
                {m.name}
              </span>
              <span className="mate-type">{typeLabel(m.type)}</span>
            </div>
          );
        })}
        {relations.map((r) => {
          const bad = failed.includes(r.id) && !r.suppressed;
          return (
            <div
              key={r.id}
              className="tree-item"
              title={`${relationTypeLabel(r.type)}: ${mateName(r.a)}${r.b !== r.a ? ` — ${mateName(r.b)}` : ''}${bad ? ` (${t('cannot be satisfied')})` : ''}`}
              onDoubleClick={() => startRelation(r)}
              onContextMenu={(e) => relationMenu(e, r)}
            >
              <span className="tree-icon">
                <Icon name={bad ? 'warning' : 'gear'} size={16} />
              </span>
              <span className="tree-name" style={r.suppressed ? { color: 'var(--text-3)', textDecoration: 'line-through' } : undefined}>
                {r.name.replace(/^(Gear|Rack and pinion|Screw)(?= \d+$)/, (s) => tIn('relation', s))}
              </span>
              <span className="mate-type">{relationTypeLabel(r.type)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { Vec3 };
