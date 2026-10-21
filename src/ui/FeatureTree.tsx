import { useEffect, useRef, useState } from 'react';
import type { Draft } from 'immer';
import type { Feature, FeatureFolder, PartStudioTab, SelRef, SketchData } from '../core/types';
import { getEngine } from '../viewport/engineRef';
import { FIELD_SPECS } from '../core/fieldSpecs';
import { FEATURE_LABELS } from '../core/features';
import { configuredFeatures, pruneConfiguration, setConfigured } from '../core/config';
import { ConfigChooser } from './ConfigPanel';
import { computeRegions } from '../sketch/regions';
import { isTextCounter } from '../sketch/text';
import { uid } from '../core/ids';
import { useEditor, sameRef, type ContextMenuItem } from '../store/editorStore';
import { activeStudio, effectiveRollback, useDoc, withStudio } from '../store/docStore';
import { Icon } from './icons';
import { featureIcon } from './FeatureDialog';
import { t, tName } from '../i18n';

/** Features shown in the graphics area besides parts (an eye to hide them): a Derived feature — with its sketches. */
function canHide(f: Feature | undefined) {
  if (!f) return false;
  return f.type === 'sketch' || f.type === 'plane' || f.type === 'helix' || f.type === 'mateConnector' || (f.type === 'derived' && !!f.params.sketches?.length);
}

function toggleHidden(ids: string[]) {
  useDoc.getState().update(
    (d) =>
      withStudio(d, (s) => {
        const h = new Set(s.hidden ?? []);
        const hide = ids.some((id) => !h.has(id));
        for (const id of ids) {
          if (hide) h.add(id);
          else h.delete(id);
        }
        s.hidden = [...h];
      }),
    { undoable: false },
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      className="tree-rename"
      autoFocus
      onFocus={(e) => e.target.select()}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(v.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const studioUpdate = (fn: (s: Draft<PartStudioTab>) => void, key?: string) =>
  useDoc.getState().update((d) => withStudio(d, fn), { key });

/** Drop deleted feature ids from folders and remove empty folders. */
function cleanFolders(s: Draft<PartStudioTab>) {
  if (!s.folders) return;
  const ids = new Set(s.features.map((f) => f.id));
  for (const f of s.folders) f.featureIds = f.featureIds.filter((id) => ids.has(id));
  s.folders = s.folders.filter((f) => f.featureIds.length > 0);
}

function folderOf(studio: PartStudioTab, featureId: string): FeatureFolder | undefined {
  return studio.folders?.find((f) => f.featureIds.includes(featureId));
}

/**
 * Whether the feature list's search finds a feature: by its name (as shown, or as stored), its type (in the interface
 * language or in English) or, a variable, by `#name`.
 */
export function featureMatches(f: Feature, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const label = FEATURE_LABELS[f.type] ?? f.type;
  return [tName(f.name), f.name, t(label), label, f.type === 'variable' ? `#${f.params.name}` : ''].some((x) => x.toLowerCase().includes(s));
}

export function FeatureTree() {
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const statuses = useEditor((s) => s.build?.statuses);
  const editing = useEditor((s) => s.editing);
  const selection = useEditor((s) => s.selection);
  // the feature that made the face or edge under the cursor in the graphics area (Onshape): its row is marked;
  // an edge's — the later of its faces' features (the hole's rim: the hole)
  const originCandidates = useEditor((s) => {
    const h = s.hover;
    if (s.editing || !h || (h.kind !== 'face' && h.kind !== 'edge')) return '';
    const part = s.build?.parts.find((p) => p.id === h.partId);
    const ff = part?.faceFeatures;
    if (!part || !ff) return '';
    if (h.kind === 'face') return ff[h.index] ?? '';
    return part.faces.flatMap((f, i) => (f.edges?.includes(h.index) && ff[i] ? [ff[i]] : [])).join(' ');
  });
  const ed = useEditor.getState;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [showDefault, setShowDefault] = useState(true);
  const [dragRollback, setDragRollback] = useState<number | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; kind: 'before' | 'folder' } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragIds = useRef<string[]>([]);
  const deleteSelectedRef = useRef<() => void>(() => {});
  /** The one feature selected in the list (Shift+N renames it). */
  const selRef = useRef<string[]>([]);
  selRef.current = sel;
  /** The list filtered by a name or a type of feature (the search field open: a string). */
  const [filter, setFilter] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (useEditor.getState().editing) return;
      // Shift+N: rename the feature selected (Onshape)
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN' && selRef.current.length === 1) {
        e.preventDefault();
        setRenaming(selRef.current[0]);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      deleteSelectedRef.current();
    };
    // clicking in the graphics area ends the feature-list selection
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.graphics')) setSel([]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  if (!studio) return null;
  // as the chosen configuration has them (which are disabled); same ids and order as the studio's own
  const features = configuredFeatures(studio);
  const rollback = effectiveRollback(studio);
  const hidden = new Set(studio.hidden ?? []);
  const originFeature = originCandidates
    ? originCandidates.split(' ').reduce((a, b) => (features.findIndex((f) => f.id === b) > features.findIndex((f) => f.id === a) ? b : a))
    : null;
  const folders = studio.folders ?? [];
  const indexOf = (id: string) => features.findIndex((f) => f.id === id);

  const setRollback = (n: number) =>
    studioUpdate((s) => {
      s.rollback = n >= s.features.length ? null : n;
    });

  // ---------------------------------------------------------------- selection
  /** Region refs of a sketch (Onshape: picking a sketch in the list picks all its regions — letters without their counters). */
  const sketchRegionRefs = (sketchId: string): SelRef[] => {
    const sk = useEditor.getState().build?.sketches.find((x) => x.featureId === sketchId);
    if (!sk) return [];
    try {
      const regions = computeRegions(sk.entities);
      return regions.filter((r) => !isTextCounter(r, regions)).map((r) => ({ kind: 'region' as const, sketchId, key: r.key }));
    } catch {
      return [];
    }
  };

  /**
   * While the sketch dialog waits for its plane, a plane picked in the list goes there (Onshape): a default
   * plane, or a plane feature above the sketch. True when the click was taken.
   */
  const pickSketchPlane = (plane: SketchData['plane']): boolean => {
    const s = ed();
    if (s.editing?.draft.type !== 'sketch' || s.sketch?.tool !== 'plane') return false;
    if (plane.kind === 'feature' && features.findIndex((x) => x.id === plane.featureId) >= s.editing.index) {
      s.showToast(t('The sketch can only use a plane that comes before it in the feature list'), 'error');
      return true;
    }
    getEngine()?.sketchEditor.setPlane(plane);
    return true;
  };

  const clickFeature = (e: React.MouseEvent, f: Feature) => {
    const edState = ed();
    // (a plane built before the feature being edited: the later ones do not exist for it)
    const before = !!edState.editing && indexOf(f.id) < edState.editing.index;
    if (f.type === 'plane' && (pickSketchPlane({ kind: 'feature', featureId: f.id }) || (before && edState.pickIntoField({ kind: 'plane', planeId: f.id }, 'plane')))) return;
    if (f.type === 'sketch' && edState.editing && edState.activeField && edState.editing.draft.type !== 'sketch') {
      const spec = FIELD_SPECS[edState.editing.draft.type]?.[edState.activeField];
      if (spec?.accepts.includes('region')) {
        const field = edState.activeField;
        const regions = sketchRegionRefs(f.id);
        edState.updateDraft((d) => {
          const params = d.params as unknown as Record<string, SelRef[]>;
          const cur = params[field] ?? [];
          params[field] = [...cur, ...regions.filter((r) => !cur.some((c) => sameRef(c, r)))];
        });
        return;
      }
    }
    if (e.shiftKey && anchor) {
      const a = indexOf(anchor);
      const b = indexOf(f.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(features.slice(lo, hi + 1).map((x) => x.id));
    } else if (e.metaKey || e.ctrlKey) {
      setSel(sel.includes(f.id) ? sel.filter((x) => x !== f.id) : [...sel, f.id]);
      setAnchor(f.id);
    } else {
      setSel([f.id]);
      setAnchor(f.id);
      if (f.type === 'plane') ed().select({ kind: 'plane', planeId: f.id }, false);
      // selecting a sketch selects its regions, ready for Extrude / Revolve
      if (f.type === 'sketch' && !edState.editing) ed().setSelection(sketchRegionRefs(f.id));
    }
  };

  const contiguous = (ids: string[]) => {
    const idx = ids.map(indexOf).sort((a, b) => a - b);
    return idx.length > 0 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  };

  // ---------------------------------------------------------------- operations
  const addToNewFolder = (ids: string[]) => {
    if (!contiguous(ids)) {
      ed().showToast('Only consecutive features can be grouped', 'error');
      return;
    }
    const ordered = [...ids].sort((a, b) => indexOf(a) - indexOf(b));
    const n = folders.length + 1;
    const id = uid('fo');
    studioUpdate((s) => {
      s.folders = (s.folders ?? []).map((fo) => ({ ...fo, featureIds: fo.featureIds.filter((x) => !ordered.includes(x)) }));
      s.folders.push({ id, name: `${t('Folder')} ${n}`, featureIds: ordered });
      cleanFolders(s);
    });
    setRenaming(id);
  };

  const removeFromFolder = (ids: string[]) =>
    studioUpdate((s) => {
      for (const fo of s.folders ?? []) fo.featureIds = fo.featureIds.filter((x) => !ids.includes(x));
      cleanFolders(s);
    });

  const deleteFeatures = (ids: string[]) =>
    studioUpdate((s) => {
      for (const id of ids) {
        const idx = s.features.findIndex((y) => y.id === id);
        if (idx < 0) continue;
        s.features.splice(idx, 1);
        if (s.rollback !== null && idx < s.rollback) s.rollback--;
      }
      cleanFolders(s);
      // their configured parameters go too
      pruneConfiguration(s);
    });

  deleteSelectedRef.current = () => {
    if (!sel.length) return;
    deleteFeatures(sel);
    setSel([]);
  };

  // a configured suppression is set for the chosen configuration
  const setSuppressed = (ids: string[], v: boolean) =>
    studioUpdate((s) => {
      for (const f of s.features) if (ids.includes(f.id) && !setConfigured(s, f.id, 'suppressed', String(v))) f.suppressed = v;
    });

  /** Move features (keeping their order) before `beforeId` (or to the end) and optionally into a folder. */
  const moveFeatures = (ids: string[], beforeId: string | null, intoFolder?: string) =>
    studioUpdate((s) => {
      const moving = s.features.filter((f) => ids.includes(f.id));
      if (!moving.length) return;
      const rest = s.features.filter((f) => !ids.includes(f.id));
      let at = beforeId ? rest.findIndex((f) => f.id === beforeId) : rest.length;
      if (at < 0) at = rest.length;
      rest.splice(at, 0, ...moving);
      s.features = rest;
      for (const fo of s.folders ?? []) fo.featureIds = fo.featureIds.filter((x) => !ids.includes(x));
      const target = intoFolder ? s.folders?.find((fo) => fo.id === intoFolder) : beforeId ? s.folders?.find((fo) => fo.featureIds.includes(beforeId)) : undefined;
      if (target) {
        target.featureIds.push(...ids);
        target.featureIds.sort((a, b) => s.features.findIndex((f) => f.id === a) - s.features.findIndex((f) => f.id === b));
      }
      cleanFolders(s);
    });

  // ---------------------------------------------------------------- context menus
  const featureMenu = (e: React.MouseEvent, f: Feature, i: number) => {
    e.preventDefault();
    const ids = sel.includes(f.id) && sel.length > 1 ? sel : [f.id];
    if (!sel.includes(f.id)) {
      setSel([f.id]);
      setAnchor(f.id);
    }
    const inFolder = ids.some((id) => folderOf(studio, id));
    const anySuppressed = features.some((x) => ids.includes(x.id) && x.suppressed);
    const visualIds = ids.filter((id) => canHide(features.find((x) => x.id === id)));
    const items: ContextMenuItem[] =
      ids.length > 1
        ? [
            { label: t('Add to new folder'), icon: 'folder', action: () => addToNewFolder(ids) },
            ...(inFolder ? [{ label: t('Remove from folder'), icon: 'folder', action: () => removeFromFolder(ids) }] : []),
            { label: anySuppressed ? t('Unsuppress') : t('Suppress'), icon: anySuppressed ? 'unsuppress' : 'suppress', action: () => setSuppressed(ids, !anySuppressed) },
            ...(visualIds.length ? [{ label: t('Hide') + ' / ' + t('Show'), icon: 'eye', action: () => toggleHidden(visualIds) }] : []),
            { separator: true, label: '' },
            { label: `${t('Delete')} (${ids.length})`, icon: 'trash', danger: true, action: () => deleteFeatures(ids) },
          ]
        : [
            { label: t('Edit'), icon: 'edit', action: () => ed().editFeature(f.id), disabled: !!editing },
            { label: t('Rename'), icon: 'rename', action: () => setRenaming(f.id) },
            { label: f.suppressed ? t('Unsuppress') : t('Suppress'), icon: f.suppressed ? 'unsuppress' : 'suppress', action: () => setSuppressed([f.id], !f.suppressed) },
            { label: t('Roll to here'), icon: 'rollback', action: () => setRollback(i + 1) },
            ...(rollback < features.length ? [{ label: t('Roll to end'), icon: 'rollback', action: () => setRollback(features.length) }] : []),
            ...(visualIds.length ? [{ label: hidden.has(f.id) ? t('Show') : t('Hide'), icon: hidden.has(f.id) ? 'eye' : 'eyeOff', action: () => toggleHidden([f.id]) }] : []),
            ...(f.type === 'sketch'
              ? [{ label: t('Export DXF'), icon: 'download', action: () => window.dispatchEvent(new CustomEvent('webcad:export-sketch', { detail: f.id })) }]
              : []),
            { label: t('Add to new folder'), icon: 'folder', action: () => addToNewFolder([f.id]) },
            ...(inFolder ? [{ label: t('Remove from folder'), icon: 'folder', action: () => removeFromFolder([f.id]) }] : []),
            { separator: true, label: '' },
            { label: t('Delete'), icon: 'trash', danger: true, action: () => deleteFeatures([f.id]) },
          ];
    useEditor.setState({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  };

  const folderMenu = (e: React.MouseEvent, fo: FeatureFolder) => {
    e.preventDefault();
    const anySuppressed = features.some((x) => fo.featureIds.includes(x.id) && x.suppressed);
    const visualIds = fo.featureIds.filter((id) => canHide(features.find((x) => x.id === id)));
    const items: ContextMenuItem[] = [
      { label: t('Rename'), icon: 'rename', action: () => setRenaming(fo.id) },
      { label: fo.collapsed ? t('Expand') : t('Collapse'), icon: fo.collapsed ? 'chevronDown' : 'chevronRight', action: () => toggleFolder(fo.id) },
      { label: t('Select contents'), icon: 'select', action: () => setSel([...fo.featureIds]) },
      { label: anySuppressed ? t('Unsuppress') : t('Suppress'), icon: anySuppressed ? 'unsuppress' : 'suppress', action: () => setSuppressed(fo.featureIds, !anySuppressed) },
      ...(visualIds.length ? [{ label: t('Hide') + ' / ' + t('Show'), icon: 'eye', action: () => toggleHidden(visualIds) }] : []),
      { label: t('Ungroup'), icon: 'folder', action: () => studioUpdate((s) => void (s.folders = (s.folders ?? []).filter((x) => x.id !== fo.id))) },
      { separator: true, label: '' },
      { label: t('Delete folder and features'), icon: 'trash', danger: true, action: () => deleteFeatures(fo.featureIds) },
    ];
    useEditor.setState({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  };

  const toggleFolder = (id: string) =>
    studioUpdate((s) => {
      const fo = s.folders?.find((x) => x.id === id);
      if (fo) fo.collapsed = !fo.collapsed;
    }, `fold-${id}`);

  // ---------------------------------------------------------------- rollback bar drag
  const onRollbackDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = listRef.current;
    if (!el) return;
    const move = (ev: PointerEvent) => {
      const items = [...el.querySelectorAll<HTMLElement>('[data-findex]')];
      let n = 0;
      for (const it of items) {
        const r = it.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) n = Number(it.dataset.findex) + 1;
      }
      setDragRollback(n);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      move(ev);
      setDragRollback((n) => {
        if (n !== null) setRollback(n);
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------------------------------------------------------------- drag & drop reorder
  const dndProps = (f: Feature) => ({
    draggable: !editing && renaming !== f.id,
    onDragStart: (e: React.DragEvent) => {
      dragIds.current = sel.includes(f.id) ? [...sel].sort((a, b) => indexOf(a) - indexOf(b)) : [f.id];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', f.id);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragIds.current.length || dragIds.current.includes(f.id)) return;
      e.preventDefault();
      if (dropTarget?.id !== f.id || dropTarget.kind !== 'before') setDropTarget({ id: f.id, kind: 'before' });
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      if (dragIds.current.length) moveFeatures(dragIds.current, f.id);
      dragIds.current = [];
    },
    onDragEnd: () => {
      dragIds.current = [];
      setDropTarget(null);
    },
  });

  // ---------------------------------------------------------------- rendering
  const shownRollback = dragRollback ?? (editing ? editing.index : rollback);
  let barShown = false;
  const bar = () => {
    barShown = true;
    return (
      <div
        key="rollback"
        className={'rollback-bar' + (dragRollback !== null ? ' drop-target' : '')}
        data-tip={t('Rollback bar')}
        onPointerDown={onRollbackDrag}
      />
    );
  };

  const planeItem = (id: 'top' | 'front' | 'right', label: string) => {
    const ref = { kind: 'plane' as const, planeId: id };
    const isSel = selection.some((r) => sameRef(r, ref));
    return (
      <div
        key={id}
        className={'tree-item' + (hidden.has(id) ? ' hidden-item' : '') + (isSel ? ' selected' : '')}
        style={{ paddingLeft: 22 }}
        onClick={() => pickSketchPlane({ kind: 'std', name: id }) || ed().pickIntoField(ref, 'plane') || ed().select(ref)}
        onMouseEnter={() => ed().setHover(ref)}
        onMouseLeave={() => ed().setHover(null)}
        onDoubleClick={() => {
          if (ed().editing) return;
          ed().setSelection([ref]);
          ed().startFeature('sketch');
        }}
      >
        <span className="tree-icon">
          <Icon name="planeItem" size={16} />
        </span>
        <span className="tree-name">{t(label)}</span>
        <span
          className={'eye' + (hidden.has(id) ? ' off' : '')}
          title={hidden.has(id) ? t('Show') : t('Hide')}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden([id]);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon name={hidden.has(id) ? 'eyeOff' : 'eye'} size={14} />
        </span>
      </div>
    );
  };

  const featureRow = (f: Feature, i: number, indent: boolean) => {
    const st = statuses?.[f.id];
    const isEditing = editing?.featureId === f.id;
    const rolled = i >= shownRollback && !isEditing;
    const featRef = f.type === 'plane' ? { kind: 'plane' as const, planeId: f.id } : null;
    const isSel = sel.includes(f.id) || (featRef ? selection.some((r) => sameRef(r, featRef)) : false);
    return (
      <div
        key={f.id}
        data-findex={i}
        className={
          'tree-item' +
          (isEditing ? ' editing' : '') +
          (f.suppressed ? ' suppressed' : '') +
          (rolled ? ' rolled' : '') +
          (hidden.has(f.id) ? ' hidden-item' : '') +
          (isSel ? ' selected' : '') +
          (originFeature === f.id ? ' origin-hover' : '') +
          (dropTarget?.id === f.id ? ' drop-before' : '')
        }
        style={indent ? { paddingLeft: 26 } : undefined}
        onClick={(e) => clickFeature(e, f)}
        // the faces it made light up (Onshape); a plane — itself
        onMouseEnter={() => (featRef ? ed().setHover(featRef) : useEditor.setState({ hoverFeatures: [f.id] }))}
        onMouseLeave={() => (featRef ? ed().setHover(null) : useEditor.setState({ hoverFeatures: null }))}
        onDoubleClick={() => !editing && ed().editFeature(f.id)}
        onContextMenu={(e) => featureMenu(e, f, i)}
        data-tip={st?.error ? t(st.error) : st?.warning ? t(st.warning) : undefined}
        {...dndProps(f)}
      >
        <span className="tree-icon">
          {/* the one being edited: as its dialog has it now */}
          <Icon name={featureIcon(isEditing && editing ? editing.draft : f)} size={16} />
        </span>
        {renaming === f.id ? (
          <RenameInput
            value={f.name}
            onDone={(v) => {
              setRenaming(null);
              if (v)
                studioUpdate((s) => {
                  const x = s.features.find((y) => y.id === f.id);
                  if (x) x.name = v;
                });
            }}
          />
        ) : (
          <span className="tree-name">
            {tName(f.name)}
            {f.type === 'variable' && (
              <span style={{ color: 'var(--text-3)' }}>
                {' '}
                #{f.params.name} = {f.params.value}
              </span>
            )}
          </span>
        )}
        {st && !st.ok && <span className="status-dot error" />}
        {st?.ok && st.warning && <span className="status-dot warn" />}
        {canHide(f) && (
          <span
            className={'eye' + (hidden.has(f.id) ? ' off' : '')}
            title={hidden.has(f.id) ? t('Show') : t('Hide')}
            onClick={(e) => {
              e.stopPropagation();
              toggleHidden([f.id]);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Icon name={hidden.has(f.id) ? 'eyeOff' : 'eye'} size={14} />
          </span>
        )}
      </div>
    );
  };

  const folderRow = (fo: FeatureFolder, firstIndex: number) => {
    const memberStatuses = fo.featureIds.map((id) => statuses?.[id]);
    const hasError = memberStatuses.some((s) => s && !s.ok);
    const allSuppressed = fo.featureIds.every((id) => features.find((x) => x.id === id)?.suppressed);
    const isSel = fo.featureIds.length > 0 && fo.featureIds.every((id) => sel.includes(id));
    return (
      <div
        key={`folder-${fo.id}-${firstIndex}`}
        className={
          'tree-item tree-folder' +
          (isSel ? ' selected' : '') +
          (allSuppressed ? ' suppressed' : '') +
          // a collapsed folder stands for the feature under the cursor in it
          (fo.collapsed && originFeature && fo.featureIds.includes(originFeature) ? ' origin-hover' : '') +
          (dropTarget?.id === fo.id ? ' drop-into' : '')
        }
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) setSel([...new Set([...sel, ...fo.featureIds])]);
          else setSel([...fo.featureIds]);
        }}
        onDoubleClick={() => setRenaming(fo.id)}
        onContextMenu={(e) => folderMenu(e, fo)}
        // the faces its features made light up
        onMouseEnter={() => useEditor.setState({ hoverFeatures: [...fo.featureIds] })}
        onMouseLeave={() => useEditor.setState({ hoverFeatures: null })}
        onDragOver={(e) => {
          if (!dragIds.current.length) return;
          e.preventDefault();
          if (dropTarget?.id !== fo.id) setDropTarget({ id: fo.id, kind: 'folder' });
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(null);
          const ids = dragIds.current;
          dragIds.current = [];
          if (!ids.length) return;
          // append right after the folder's last member
          const last = [...fo.featureIds].sort((a, b) => indexOf(b) - indexOf(a))[0];
          const after = features[indexOf(last) + 1]?.id ?? null;
          moveFeatures(ids, after && !ids.includes(after) ? after : null, fo.id);
        }}
      >
        <span
          className="tree-icon"
          onClick={(e) => {
            e.stopPropagation();
            toggleFolder(fo.id);
          }}
        >
          <Icon name={fo.collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
        </span>
        <span className="tree-icon">
          <Icon name="folder" size={16} />
        </span>
        {renaming === fo.id ? (
          <RenameInput
            value={fo.name}
            onDone={(v) => {
              setRenaming(null);
              if (v)
                studioUpdate((s) => {
                  const x = s.folders?.find((y) => y.id === fo.id);
                  if (x) x.name = v;
                });
            }}
          />
        ) : (
          <span className="tree-name">
            {fo.name} <span style={{ color: 'var(--text-3)' }}>({fo.featureIds.length})</span>
          </span>
        )}
        {hasError && <span className="status-dot error" />}
      </div>
    );
  };

  const rows: React.ReactNode[] = [];
  let prevFolder: string | null = null;
  // the search: the features whose name or type has the text (their folders open), no rollback bar
  const q = filter?.trim().toLowerCase() ?? '';
  const found = q ? new Set(features.filter((f) => featureMatches(f, q)).map((f) => f.id)) : null;
  features.forEach((f, i) => {
    if (found && !found.has(f.id)) return;
    const fo = folderOf(studio, f.id);
    if (fo && fo.id !== prevFolder) rows.push(folderRow(fo, i));
    prevFolder = fo?.id ?? null;
    if (i === shownRollback && !barShown && !found) {
      // inside a collapsed folder the bar is drawn after the folder header
      rows.push(bar());
    }
    if (fo?.collapsed && !found) return;
    rows.push(featureRow(f, i, !!fo));
  });
  if (!barShown && !found) rows.push(bar());
  if (found && !found.size)
    rows.push(
      <div key="none" className="tree-empty">
        {t('No features found')}
      </div>,
    );
  if (editing?.isNew) {
    const at = rows.findIndex((r) => (r as { key?: string })?.key === 'rollback');
    rows.splice(
      at < 0 ? rows.length : at,
      0,
      <div key="new" className="tree-item editing">
        <span className="tree-icon">
          <Icon name={featureIcon(editing.draft)} size={16} />
        </span>
        <span className="tree-name">{tName(editing.draft.name)}</span>
      </div>,
    );
  }

  return (
    <div className="panel-section features">
      <div className="panel-header">
        {t('Features')} <span className="count">({found ? `${found.size} / ${features.length}` : features.length})</span>
        <span className="spacer" />
        {sel.length > 1 && (
          <button className="icon-btn" style={{ width: 22, height: 22 }} data-tip={t('Add to new folder')} onClick={() => addToNewFolder(sel)}>
            <Icon name="folder" size={14} />
          </button>
        )}
        <button
          className={'icon-btn' + (filter !== null ? ' active' : '')}
          style={{ width: 22, height: 22 }}
          data-tip={t('Search features')}
          onClick={() => setFilter(filter === null ? '' : null)}
        >
          <Icon name="search" size={14} />
        </button>
      </div>
      {filter !== null && (
        <div className="tree-search">
          <input
            autoFocus
            value={filter}
            placeholder={t('Feature name or type')}
            aria-label={t('Search features')}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setFilter(null);
            }}
          />
        </div>
      )}
      <ConfigChooser studio={studio} />
      <div
        className="panel-body"
        ref={listRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSel([]);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="tree-group" onClick={() => setShowDefault(!showDefault)}>
          <Icon name={showDefault ? 'chevronDown' : 'chevronRight'} size={12} /> {t('Default geometry')}
        </div>
        {showDefault && (
          <>
            <div
              className={'tree-item' + (hidden.has('origin') ? ' hidden-item' : '') + (selection.some((r) => r.kind === 'origin') ? ' selected' : '')}
              style={{ paddingLeft: 22 }}
              onClick={() => ed().pickIntoField({ kind: 'origin' }, 'origin') || ed().select({ kind: 'origin' })}
            >
              <span className="tree-icon">
                <Icon name="origin" size={16} />
              </span>
              <span className="tree-name">{t('Origin')}</span>
              <span
                className={'eye' + (hidden.has('origin') ? ' off' : '')}
                title={hidden.has('origin') ? t('Show') : t('Hide')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHidden(['origin']);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Icon name={hidden.has('origin') ? 'eyeOff' : 'eye'} size={14} />
              </span>
            </div>
            {planeItem('top', 'Top')}
            {planeItem('front', 'Front')}
            {planeItem('right', 'Right')}
          </>
        )}
        {rows}
      </div>
    </div>
  );
}
