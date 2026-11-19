import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LengthUnit } from '../core/types';
import { useEditor } from '../store/editorStore';
import { activeAssembly, activeTab, newAssemblyTab, newDrawingTab, newPartStudio, useDoc } from '../store/docStore';
import { AssemblyToolbar, closeMateInsertDialogs, InsertDialog, InstanceList, InstancePanel, MateDialog, MateList, selectedInstances } from '../assembly/AssemblyUI';
import { closeRelationDialog, RelationDialog } from '../assembly/RelationUI';
import { AnimateDialog, animationOpen, closeAnimation } from '../assembly/AnimateUI';
import { BomPanel, closeBom, closeExploded, ExplodeDialog, ExplodedViewList } from '../assembly/BomExplodeUI';
import { explodeActive } from '../assembly/explode';
import { ErrorBoundary } from './ErrorBoundary';
import { requestRebuild, startRebuildLoop } from '../store/rebuild';
import { restoreDraft, startDraftPersistence } from '../store/draftPersistence';
import { saveThumbnail } from '../store/persistence';
import { allowFolder, syncThumbnail, useFolder } from '../store/folderStore';
import { baseOf } from '../store/localFolder';
import { getEngine } from '../viewport/engineRef';
import { Toolbar } from './Toolbar';
import { FeatureTree } from './FeatureTree';
import { PartsList } from './PartsList';
import { LeftPanel } from './LeftPanel';
import { FeatureDialog } from './FeatureDialog';
import { SketchPatternPanel } from './SketchPatternPanel';
import { SketchTransformPanel } from './SketchTransformPanel';
import { SketchDialog } from './SketchDialog';
import { RightPanels } from './RightPanels';
import { Viewport } from './Viewport';
import { ContextMenu, ExportDialog, MeasurePanel, Toast } from './Overlays';
import { MaterialDialog } from './MaterialDialog';
import { handleKey } from './keyboard';
import { exportSketch } from './exporting';
import { DrawingEditor } from '../drawing/DrawingEditor';
import { Icon } from './icons';
import { t } from '../i18n';
import { AppSettingsItems } from './AppSettings';
import { AccountButton } from './AccountButton';
import { CompareBanner, VersionBanner, VersionsButton } from './VersionsPanel';

import { APP_VERSION, appVersionTitle } from './version';
import { reorderTabs } from './tabOrder';
import { useTabReorder } from './useTabReorder';
import { contextHelpPage, openHelp } from '../help/context';

/** A document that is a file of a folder on the computer: its file, or a button to allow writing it again. */
function FolderState({ docId }: { docId: string }) {
  const link = useFolder((s) => s.links[docId]);
  const folder = useFolder((s) => s.folders.find((f) => f.id === link?.folder));
  const failed = useFolder((s) => s.writeError === docId);
  if (!link || !folder) return null;
  return failed ? (
    <button className="btn small folder-warn" title={t('Changes are kept in the browser; allow the folder to write them to the file')} onClick={() => void allowFolder(folder.id)}>
      <Icon name="warning" size={14} /> {t('Allow writing to the folder')}
    </button>
  ) : (
    <span className="save-state folder-file" title={`${t('A file of the folder on this computer')}: ${folder.dir.name}/${link.name}`}>
      <Icon name="folder" size={13} /> {baseOf(link.name)}
    </span>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  const loading = useEditor((s) => !s.build && s.building);
  const doc = useDoc((s) => s.doc)!;
  const saving = useDoc((s) => s.saving);
  const saveError = useDoc((s) => s.saveError);
  const update = useDoc((s) => s.update);
  const [name, setName] = useState(doc.name);
  const [menu, setMenu] = useState<'doc' | null>(null);
  useEffect(() => setName(doc.name), [doc.name]);
  return (
    <div className="topbar">
      <button className="icon-btn" title={t('Back to documents')} onClick={onBack}>
        <div className="brand-logo">◆</div>
      </button>
      <input
        className="doc-title"
        value={name}
        size={Math.max(12, name.length + 2)}
        onChange={(e) => setName(e.target.value)}
        onBlur={() =>
          name.trim() &&
          name !== doc.name &&
          update((d) => {
            d.name = name.trim();
          })
        }
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <VersionsButton />
      <FolderState docId={doc.id} />
      {/* last, both words in one cell (the other one invisible): nothing moves when the state changes */}
      {saveError ? (
        // the edits are only in memory: why, and a click saves again now
        <button
          className="save-state save-error"
          role="alert"
          title={`${t(saveError)}. ${t('The edits are kept in this tab: do not close it. Click to save again.')}`}
          onClick={() => void useDoc.getState().flushSave()}
        >
          <Icon name="warning" size={13} /> {t('Not saved')}
        </button>
      ) : (
        <span className="save-state save-state-fixed" role="status">
          <span className={saving ? '' : 'off'}>{t('Saving…')}</span>
          <span className={saving ? 'off' : ''}>{t('Saved')}</span>
        </span>
      )}
      <div className="spacer" />
      <button className="icon-btn" title={`${t('Help')} (F1)`} onClick={() => openHelp(contextHelpPage())}>
        <Icon name="help" size={18} />
      </button>
      <AccountButton />
      <div className="menu-wrap">
        <button className="btn small" onClick={() => setMenu(menu ? null : 'doc')}>
          <Icon name="gear" size={14} /> {t('Settings')}
        </button>
        {menu === 'doc' && (
          <div className="dropdown" onMouseLeave={() => setMenu(null)}>
            <div className="dropdown-label">{t('Units')}</div>
            {(['mm', 'cm', 'm', 'in', 'ft'] as LengthUnit[]).map((u) => (
              <div
                key={u}
                className="dropdown-item"
                onClick={() =>
                  update((d) => {
                    d.units.length = u;
                  })
                }
              >
                <span className="menu-icon">{doc.units.length === u ? '✓' : ''}</span>
                {u}
              </div>
            ))}
            <div className="dropdown-sep" />
            <AppSettingsItems />
          </div>
        )}
      </div>
      <button
        className="btn small primary"
        disabled={loading}
        onClick={() => {
          const selection = useEditor.getState().selection;
          // an assembly: the instances of whatever is selected on them
          const sel = activeAssembly(useDoc.getState().doc)
            ? selectedInstances(selection)
            : selection.filter((r) => r.kind === 'part').map((r) => (r as { partId: string }).partId);
          useEditor.setState({ exportOpen: { partIds: sel } });
        }}
      >
        <Icon name="export" size={14} /> {t('Export')}
      </button>
    </div>
  );
}

function BottomBar() {
  const doc = useDoc((s) => s.doc)!;
  const update = useDoc((s) => s.update);
  const building = useEditor((s) => s.building);
  const build = useEditor((s) => s.build);
  const sketch = useEditor((s) => s.sketch);
  const editing = useEditor((s) => s.editing);
  const readOnly = useDoc((s) => s.readOnly);
  const [reorderNotice, setReorderNotice] = useState('');
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [tabList, setTabList] = useState(false);
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false });
  const stripRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const reorderSettling = useRef(false);
  const reorderFocusFrame = useRef(0);
  useEffect(() => () => { cancelAnimationFrame(reorderFocusFrame.current); reorderSettling.current = false; }, [doc.id]);
  const canReorder = !readOnly && !editing && !sketch && !renaming && doc.tabs.length > 1;
  const moveTab = (source: string, target: string, after: boolean, inList = false) => {
    const current = useDoc.getState(), editor = useEditor.getState();
    if (!current.doc || current.doc.id !== doc.id || current.readOnly || editor.editing || editor.sketch || renaming) return;
    const next = reorderTabs(current.doc.tabs, source, target, after);
    if (next === current.doc.tabs) return;
    cancelAnimationFrame(reorderFocusFrame.current);
    reorderSettling.current = true;
    current.update((draft) => { draft.tabs = reorderTabs(draft.tabs, source, target, after); });
    reorderFocusFrame.current = requestAnimationFrame(() => {
      const surface = inList ? listRef.current : contentRef.current;
      const element = [...(surface?.querySelectorAll<HTMLElement>('[data-reorder-tab]') ?? [])].find((tab) => tab.dataset.reorderTab === source);
      element?.focus({ preventScroll: true });
      reorderSettling.current = false;
      reorderFocusFrame.current = 0;
    });
    setReorderNotice(`${t('Tab position')}: ${next.findIndex((tab) => tab.id === source) + 1} / ${next.length}`);
  };
  const reorder = useTabReorder(doc.id, canReorder, moveTab, () => { setTabList(true); setMenu(false); });
  const orderClass = (id: string, vertical: boolean) =>
    (reorder.source === id ? ' tab-reorder-source' : '') +
    (reorder.target?.id === id && reorder.target.vertical === vertical ? ` tab-drop-${reorder.target.after ? 'after' : 'before'}` : '');
  const reorderKey = (event: React.KeyboardEvent<HTMLElement>, id: string, vertical: boolean) => {
    if (event.ctrlKey || event.metaKey || !event.altKey || !event.shiftKey || ![vertical ? 'ArrowUp' : 'ArrowLeft', vertical ? 'ArrowDown' : 'ArrowRight'].includes(event.key)) return false;
    event.preventDefault(); event.stopPropagation();
    if (canReorder) {
      const index = doc.tabs.findIndex((tab) => tab.id === id), after = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const target = doc.tabs[index + (after ? 1 : -1)];
      if (target) {
        moveTab(id, target.id, after, vertical);
      }
    }
    return true;
  };
  // Rebuilding a model must not reset a strip the user is browsing.
  const tabLayout = JSON.stringify(doc.tabs.map(({ id, name }) => [id, name]));
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const content = contentRef.current;
    if (!strip || !content) return;
    const measure = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const next = { overflow: max > 1, left: strip.scrollLeft > 1, right: strip.scrollLeft < max - 1 };
      setScroll((prev) => (prev.overflow === next.overflow && prev.left === next.left && prev.right === next.right ? prev : next));
    };
    const reveal = () => {
      const tab = content.querySelector<HTMLElement>('.tab.active');
      if (tab) {
        // Scroll only the strip, never the editor or the document around it.
        const left = tab.offsetLeft;
        if (left < strip.scrollLeft) strip.scrollLeft = left;
        else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth;
      }
      measure();
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      e.preventDefault();
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 24 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1;
      strip.scrollLeft += e.deltaY * unit;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    observer.observe(content);
    strip.addEventListener('scroll', measure);
    strip.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', measure);
      strip.removeEventListener('wheel', wheel);
    };
  }, [doc.id, doc.activeTab, tabLayout, renaming]);
  useEffect(() => {
    if (!tabList) return;
    const list = listRef.current;
    const selected = list?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    selected?.focus();
    const outside = (e: PointerEvent) => {
      if (!list?.contains(e.target as Node) && !listButtonRef.current?.contains(e.target as Node)) setTabList(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [tabList]);
  const selectTab = (id: string) => {
    if (id !== doc.activeTab)
      update(
        (d) => {
          d.activeTab = id;
        },
        { undoable: false },
      );
  };
  const scrollTabs = (direction: number) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: direction * Math.max(80, strip.clientWidth * 0.75), behavior: 'smooth' });
  };
  const sv = sketch?.solve;
  const sketchHasEntities = useEditor((s) => (s.editing?.draft.type === 'sketch' ? s.editing.draft.params.entities.length > 0 : false));
  return (
    <div className="bottombar">
      <div className="document-tabs" data-reorder-doc={doc.id}>
        <span className="tab-reorder-announcement" role="status" aria-live="polite">{reorderNotice}</span>
        <div className="menu-wrap tab-add-wrap">
          <button
            className="tab tab-control"
            aria-label={t('Add tab')}
            title={t('Add tab')}
            aria-expanded={menu}
            onClick={() => {
              setMenu(!menu);
              setTabList(false);
            }}
          >
            <Icon name="plus" size={14} />
          </button>
          {menu && (
            <div className="dropdown left" style={{ top: 'auto', bottom: 'calc(100% + 4px)' }} onMouseLeave={() => setMenu(false)}>
              <div
                className="dropdown-item"
                onClick={() => {
                  const n = doc.tabs.filter((x) => x.type === 'partStudio').length + 1;
                  const ps = newPartStudio(`Part Studio ${n}`);
                  update((d) => {
                    d.tabs.push(ps);
                    d.activeTab = ps.id;
                  });
                  setMenu(false);
                }}
              >
                <Icon name="partStudio" size={16} /> {t('Part Studio')}
              </div>
              <div
                className="dropdown-item"
                onClick={() => {
                  const n = doc.tabs.filter((x) => x.type === 'drawing').length + 1;
                  const dw = newDrawingTab(`Drawing ${n}`, doc.name);
                  update((d) => {
                    d.tabs.push(dw);
                    d.activeTab = dw.id;
                  });
                  setMenu(false);
                }}
              >
                <Icon name="drawing" size={16} /> {t('Drawing')}
              </div>
              <div
                className="dropdown-item"
                onClick={() => {
                  const n = doc.tabs.filter((x) => x.type === 'assembly').length + 1;
                  const as = newAssemblyTab(`Assembly ${n}`);
                  update((d) => {
                    d.tabs.push(as);
                    d.activeTab = as.id;
                  });
                  setMenu(false);
                }}
              >
                <Icon name="assembly" size={16} /> {t('Assembly')}
              </div>
            </div>
          )}
        </div>
        {scroll.overflow && (
          <button className="tab tab-control" aria-label={t('Scroll tabs left')} title={t('Scroll tabs left')} disabled={!scroll.left} onClick={() => scrollTabs(-1)}>
            <Icon name="chevronLeft" size={14} />
          </button>
        )}
        <div className="document-tab-strip" ref={stripRef} role="tablist" aria-label={t('Tabs')}>
          <div className="document-tab-content" ref={contentRef}>
            {doc.tabs.map((tab) => (
              <div
                key={tab.id}
                className={'tab' + (tab.id === doc.activeTab ? ' active' : '') + orderClass(tab.id, false)}
                data-reorder-tab={tab.id}
                data-reorder-vertical="false"
                onPointerDown={(event) => reorder.onPointerDown(event, tab.id)}
                onClickCapture={reorder.onClickCapture}
                role="tab"
                aria-selected={tab.id === doc.activeTab}
                aria-keyshortcuts={canReorder ? 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight' : undefined}
                aria-description={canReorder ? t('Reorder with Alt+Shift+arrow keys.') : undefined}
                tabIndex={tab.id === doc.activeTab ? 0 : -1}
                title={tab.name}
                onClick={() => selectTab(tab.id)}
                onFocus={(e) => {
                  const strip = stripRef.current;
                  if (strip) {
                    const tab = e.currentTarget;
                    if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft;
                    else if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth - strip.clientWidth;
                  }
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (reorderKey(e, tab.id, false)) return;
                  // Global undo/redo must work while a tab keeps focus after reordering.
                  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) return;
                  e.stopPropagation();
                  const index = doc.tabs.findIndex((x) => x.id === tab.id);
                  const next =
                    e.key === 'ArrowRight'
                      ? (index + 1) % doc.tabs.length
                      : e.key === 'ArrowLeft'
                        ? (index + doc.tabs.length - 1) % doc.tabs.length
                        : e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? doc.tabs.length - 1
                            : null;
                  if (next !== null) {
                    e.preventDefault();
                    selectTab(doc.tabs[next].id);
                    contentRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
                  } else if (e.key === 'F2') {
                    e.preventDefault();
                    setRenaming(tab.id);
                  }
                }}
                onDoubleClick={() => setRenaming(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (reorder.dragging.current) return;
                  useEditor.setState({
                    contextMenu: {
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { label: t('Rename'), icon: 'rename', action: () => setRenaming(tab.id) },
                        {
                          label: t('Delete'),
                          icon: 'trash',
                          danger: true,
                          disabled: doc.tabs.length <= 1,
                          action: () =>
                            update((d) => {
                              d.tabs = d.tabs.filter((x) => x.id !== tab.id);
                              if (d.activeTab === tab.id) d.activeTab = d.tabs[0].id;
                            }),
                        },
                      ],
                    },
                  });
                }}
              >
                {canReorder && <span className="tab-drag-handle" title={t('Drag to reorder tabs. Alt+Shift+arrows also move a tab.')} aria-hidden="true"><Icon name="menu" size={12} /></span>}
                <Icon name={tab.type} size={14} />
                {renaming === tab.id ? (
                  <input
                    className="tree-rename"
                    autoFocus
                    defaultValue={tab.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v)
                        update((d) => {
                          const x = d.tabs.find((y) => y.id === tab.id);
                          if (x) x.name = v;
                        });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="document-tab-name">{tab.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
        {scroll.overflow && (
          <button className="tab tab-control" aria-label={t('Scroll tabs right')} title={t('Scroll tabs right')} disabled={!scroll.right} onClick={() => scrollTabs(1)}>
            <Icon name="chevronRight" size={14} />
          </button>
        )}
        <div className="menu-wrap tab-list-wrap">
          <button
            ref={listButtonRef}
            data-tab-list-toggle="true"
            className="tab tab-control"
            aria-label={t('All tabs')}
            title={t('All tabs')}
            aria-expanded={tabList}
            aria-haspopup="dialog"
            onClick={() => {
              setTabList(!tabList);
              setMenu(false);
            }}
          >
            <Icon name="menu" size={14} />
          </button>
          {tabList && (
            <div
              ref={listRef}
              className="dropdown document-tab-list"
              role="dialog"
              aria-label={t('All tabs')}
              onBlur={(e) => {
                if (!reorder.dragging.current && !reorderSettling.current && !e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== listButtonRef.current) setTabList(false);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) return;
                e.stopPropagation();
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setTabList(false);
                  listButtonRef.current?.focus();
                }
                const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  e.key === 'ArrowDown'
                    ? (index + 1) % items.length
                    : e.key === 'ArrowUp'
                      ? (index + items.length - 1) % items.length
                      : e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? items.length - 1
                          : null;
                if (next !== null) {
                  e.preventDefault();
                  items[next]?.focus();
                }
              }}
            >
              <div className="dropdown-label">
                {t('All tabs')} ({doc.tabs.length})
              </div>
              {doc.tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={'dropdown-item' + orderClass(tab.id, true)}
                  data-reorder-tab={tab.id}
                  data-reorder-vertical="true"
                  onPointerDown={(event) => reorder.onPointerDown(event, tab.id)}
                  onClickCapture={reorder.onClickCapture}
                  onKeyDown={(event) => { reorderKey(event, tab.id, true); }}
                  aria-current={tab.id === doc.activeTab}
                  aria-keyshortcuts={canReorder ? 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
                  aria-description={canReorder ? t('Reorder with Alt+Shift+arrow keys.') : undefined}
                  title={tab.name}
                  onClick={() => {
                    selectTab(tab.id);
                    setTabList(false);
                    contentRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[doc.tabs.findIndex((x) => x.id === tab.id)]?.focus();
                  }}
                >
                  {canReorder && <span className="tab-drag-handle" title={t('Drag to reorder tabs. Alt+Shift+arrows also move a tab.')} aria-hidden="true"><Icon name="menu" size={12} /></span>}
                  <Icon name={tab.type} size={16} />
                  <span className="document-tab-list-name">{tab.name}</span>
                  <span className="menu-icon">{tab.id === doc.activeTab ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="status">
        {sketch?.hint && (
          <span className="status-hint" title={t(sketch.hint)}>
            {t(sketch.hint)}
          </span>
        )}
        {sv && (sketchHasEntities || null) && (
          <span className={'sk-state ' + (!sv.ok || sv.conflicting.length ? 'over' : sv.dof === 0 ? 'full' : 'under')}>
            {!sv.ok || sv.conflicting.length ? t('Over defined') : sv.dof === 0 ? t('Fully defined') : `${t('Under defined')}: ${sv.dof} ${t('degrees of freedom')}`}
          </span>
        )}
        {building ? (
          <div className="spinner" />
        ) : (
          build && <span title={t('Model rebuild time: how long the last rebuild of the features took')}>{Math.round(build.timeMs)} ms</span>
        )}
        <span
          title={`${t('Document units')}: ${doc.units.length}, ${doc.units.angle}\n${t('Numbers without units in fields and dimensions are in these units; change them in Settings')}`}
        >
          {doc.units.length}
        </span>
        <span className="app-version" title={appVersionTitle()}>
          {APP_VERSION}
        </span>
      </div>
    </div>
  );
}

/**
 * What an error boundary closes before drawing its part again: the dialog being edited (nothing changes in the
 * document), the windows and menus, the assembly's dialogs — so that what failed is not drawn the same way at once.
 */
function closePanels() {
  const ed = useEditor.getState();
  if (ed.editing) ed.cancelEditing();
  useEditor.setState({ contextMenu: null, exportOpen: null, materialOpen: null, measure: null });
  closeMateInsertDialogs();
  closeRelationDialog();
  if (animationOpen()) closeAnimation();
  if (explodeActive()) closeExploded();
  closeBom();
}

export function Editor({ onBack }: { onBack: () => void }) {
  const doc = useDoc((s) => s.doc);
  const readOnly = useDoc((s) => s.readOnly);
  const tab = activeTab(doc);
  const tabId = tab?.id;
  useEffect(() => {
    startRebuildLoop();
    const onKey = (e: KeyboardEvent) => handleKey(e);
    window.addEventListener('keydown', onKey);
    const onExportSketch = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const d = useDoc.getState().doc;
      const s = useEditor.getState().build?.sketches.find((x) => x.featureId === id);
      const f = activeTab(d)?.type === 'partStudio' ? (activeTab(d) as { features: { id: string; name: string }[] }).features.find((x) => x.id === id) : null;
      if (d && s) exportSketch(d, s.entities, f?.name ?? 'sketch', 'dxf');
    };
    window.addEventListener('webcad:export-sketch', onExportSketch);
    // an edit of a version being viewed
    const onReadOnly = () => {
      useEditor.setState({ editing: null, sketch: null });
      useEditor.getState().showToast('A version is open for viewing: return to the workspace to edit', 'error');
    };
    window.addEventListener('webcad:read-only', onReadOnly);
    // periodic thumbnail for the documents page (of the workspace, not of a version being viewed)
    const timer = setInterval(() => {
      const e = getEngine();
      const d = useDoc.getState().doc;
      // (a document of a folder: its file keeps the picture too)
      if (e && d && useEditor.getState().build && !useEditor.getState().building && !useEditor.getState().editing && !useDoc.getState().readOnly) void saveThumbnail(d.id, e.thumbnail()).then(() => syncThumbnail(d.id));
    }, 15000);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('webcad:export-sketch', onExportSketch);
      window.removeEventListener('webcad:read-only', onReadOnly);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    useEditor.setState({ editing: null, sketch: null, selection: [], hover: null, build: null, loadingPreview: null, buildProgress: null, activeField: null });
    // continue an unfinished sketch / feature dialog after a reload
    restoreDraft();
    startDraftPersistence();
    requestRebuild();
  }, [tabId]);
  if (!doc || !tab) return null;
  const back = () => {
    const e = getEngine();
    if (e && useEditor.getState().build && !useEditor.getState().building && !useDoc.getState().readOnly) void saveThumbnail(doc.id, e.thumbnail()).then(() => syncThumbnail(doc.id));
    useEditor.setState({ editing: null, sketch: null, selection: [], build: null, loadingPreview: null, buildProgress: null });
    onBack();
  };
  return (
    <div className={'editor' + (tab.type === 'drawing' ? ' editor-drawing' : '') + (readOnly ? ' editor-viewing' : '')}>
      <TopBar onBack={back} />
      {/* banners under the top bar (a grid row of their own, empty without them) */}
      <div className="editor-banners">
        <VersionBanner />
        <CompareBanner />
      </div>
      {tab.type === 'partStudio' && <Toolbar />}
      {tab.type === 'assembly' && <AssemblyToolbar />}
      <div className="workspace">
        {/* a part that fails to draw shows a card in its place; the model and the rest keep working */}
        {tab.type === 'assembly' ? (
          <>
            <LeftPanel
              key="assembly"
              kind="assembly"
              top={
                <ErrorBoundary scope="panel" name="Instance list">
                  <InstanceList />
                </ErrorBoundary>
              }
              bottom={
                <ErrorBoundary scope="panel" name="Assembly lists">
                  <MateList />
                  <ExplodedViewList />
                </ErrorBoundary>
              }
            />
            <div className="graphics">
              <ErrorBoundary scope="panel" name="Graphics area">
                <Viewport />
              </ErrorBoundary>
              <ErrorBoundary scope="panel" name="Assembly dialogs" onReset={closePanels}>
                <InstancePanel />
                <MateDialog />
                <RelationDialog />
                <AnimateDialog />
                <ExplodeDialog />
                <BomPanel />
                <InsertDialog />
              </ErrorBoundary>
              <Toast />
            </div>
          </>
        ) : tab.type === 'partStudio' ? (
          <>
            <LeftPanel
              key="partStudio"
              kind="partStudio"
              top={
                <ErrorBoundary scope="panel" name="Feature list">
                  <FeatureTree />
                </ErrorBoundary>
              }
              bottom={
                <ErrorBoundary scope="panel" name="Parts list">
                  <PartsList />
                </ErrorBoundary>
              }
            />
            <div className="graphics">
              <ErrorBoundary scope="panel" name="Graphics area">
                <Viewport />
              </ErrorBoundary>
              <ErrorBoundary scope="panel" name="Feature dialog" onReset={closePanels}>
                <FeatureDialog />
                <SketchPatternPanel />
                <SketchTransformPanel />
                <SketchDialog />
                <RightPanels />
                <MeasurePanel />
              </ErrorBoundary>
              <Toast />
            </div>
          </>
        ) : (
          <ErrorBoundary scope="panel" name="Drawing">
            <DrawingEditor key={tab.id} tabId={tab.id} />
          </ErrorBoundary>
        )}
      </div>
      <BottomBar />
      <ErrorBoundary scope="panel" name="Menus and windows" onReset={closePanels}>
        <ContextMenu />
        <ExportDialog />
        <MaterialDialog />
      </ErrorBoundary>
    </div>
  );
}
