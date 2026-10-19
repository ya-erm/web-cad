import { useEffect, useState } from 'react';
import type { LengthUnit } from '../core/types';
import { useEditor } from '../store/editorStore';
import { activeAssembly, activeTab, newAssemblyTab, newDrawingTab, newPartStudio, useDoc } from '../store/docStore';
import { AssemblyToolbar, InsertDialog, InstanceList, InstancePanel, MateDialog, MateList, selectedInstances } from '../assembly/AssemblyUI';
import { RelationDialog } from '../assembly/RelationUI';
import { AnimateDialog } from '../assembly/AnimateUI';
import { BomPanel, ExplodeDialog, ExplodedViewList } from '../assembly/BomExplodeUI';
import { requestRebuild, startRebuildLoop } from '../store/rebuild';
import { restoreDraft, startDraftPersistence } from '../store/draftPersistence';
import { saveThumbnail } from '../store/persistence';
import { allowFolder, useFolder } from '../store/folderStore';
import { getEngine } from '../viewport/engineRef';
import { Toolbar } from './Toolbar';
import { FeatureTree } from './FeatureTree';
import { PartsList } from './PartsList';
import { FeatureDialog } from './FeatureDialog';
import { SketchPatternPanel } from './SketchPatternPanel';
import { SketchTransformPanel } from './SketchTransformPanel';
import { SketchDialog } from './SketchDialog';
import { RightPanels } from './RightPanels';
import { Viewport } from './Viewport';
import { ContextMenu, ExportDialog, MeasurePanel, Toast } from './Overlays';
import { handleKey } from './keyboard';
import { exportSketch } from './exporting';
import { DrawingEditor } from '../drawing/DrawingEditor';
import { Icon } from './icons';
import { t } from '../i18n';
import { AppSettingsItems } from './AppSettings';
import { VersionBanner, VersionsButton } from './VersionsPanel';
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
      <Icon name="folder" size={13} /> {link.name}
    </span>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  const doc = useDoc((s) => s.doc)!;
  const saving = useDoc((s) => s.saving);
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
      <span className="save-state">{saving ? t('Saving…') : t('Saved')}</span>
      <FolderState docId={doc.id} />
      <VersionsButton />
      <div className="spacer" />
      <button className="icon-btn" title={`${t('Help')} (F1)`} onClick={() => openHelp(contextHelpPage())}>
        <Icon name="help" size={18} />
      </button>
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
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const sv = sketch?.solve;
  const sketchHasEntities = useEditor((s) => (s.editing?.draft.type === 'sketch' ? s.editing.draft.params.entities.length > 0 : false));
  return (
    <div className="bottombar">
      <div className="menu-wrap" style={{ display: 'flex' }}>
        <div className="tab" title={t('Add tab')} onClick={() => setMenu(!menu)}>
          <Icon name="plus" size={14} />
        </div>
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
      {doc.tabs.map((tab) => (
        <div
          key={tab.id}
          className={'tab' + (tab.id === doc.activeTab ? ' active' : '')}
          onClick={() =>
            tab.id !== doc.activeTab &&
            update(
              (d) => {
                d.activeTab = tab.id;
              },
              { undoable: false },
            )
          }
          onDoubleClick={() => setRenaming(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            useEditor.setState({
              contextMenu: {
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: t('Rename'), icon: 'rename', action: () => setRenaming(tab.id) },
                  {
                    label: t('Delete'), icon: 'trash',
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
            tab.name
          )}
        </div>
      ))}
      <div className="status">
        {sketch?.hint && <span>{t(sketch.hint)}</span>}
        {sv && (sketchHasEntities || null) && (
          <span className={'sk-state ' + (!sv.ok || sv.conflicting.length ? 'over' : sv.dof === 0 ? 'full' : 'under')}>
            {!sv.ok || sv.conflicting.length
              ? t('Over defined')
              : sv.dof === 0
                ? t('Fully defined')
                : `${t('Under defined')}: ${sv.dof} ${t('degrees of freedom')}`}
          </span>
        )}
        {building ? <div className="spinner" /> : build && <span>{Math.round(build.timeMs)} ms</span>}
        <span>{doc.units.length}</span>
      </div>
    </div>
  );
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
      if (e && d && !useEditor.getState().editing && !useDoc.getState().readOnly) void saveThumbnail(d.id, e.thumbnail());
    }, 15000);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('webcad:export-sketch', onExportSketch);
      window.removeEventListener('webcad:read-only', onReadOnly);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    useEditor.setState({ editing: null, sketch: null, selection: [], hover: null, build: null, activeField: null });
    // continue an unfinished sketch / feature dialog after a reload
    restoreDraft();
    startDraftPersistence();
    requestRebuild();
  }, [tabId]);
  if (!doc || !tab) return null;
  const back = () => {
    const e = getEngine();
    if (e && !useDoc.getState().readOnly) void saveThumbnail(doc.id, e.thumbnail());
    useEditor.setState({ editing: null, sketch: null, selection: [], build: null });
    onBack();
  };
  return (
    <div className={'editor' + (tab.type === 'drawing' ? ' editor-drawing' : '') + (readOnly ? ' editor-viewing' : '')}>
      <TopBar onBack={back} />
      <VersionBanner />
      {tab.type === 'partStudio' && <Toolbar />}
      {tab.type === 'assembly' && <AssemblyToolbar />}
      <div className="workspace">
        {tab.type === 'assembly' ? (
          <>
            <div className="left-panel">
              <InstanceList />
              <MateList />
              <ExplodedViewList />
            </div>
            <div className="graphics">
              <Viewport />
              <InstancePanel />
              <MateDialog />
              <RelationDialog />
              <AnimateDialog />
              <ExplodeDialog />
              <BomPanel />
              <InsertDialog />
              <Toast />
            </div>
          </>
        ) : tab.type === 'partStudio' ? (
          <>
            <div className="left-panel">
              <FeatureTree />
              <PartsList />
            </div>
            <div className="graphics">
              <Viewport />
              <FeatureDialog />
              <SketchPatternPanel />
              <SketchTransformPanel />
              <SketchDialog />
              <RightPanels />
              <MeasurePanel />
              <Toast />
            </div>
          </>
        ) : (
          <DrawingEditor key={tab.id} tabId={tab.id} />
        )}
      </div>
      <BottomBar />
      <ContextMenu />
      <ExportDialog />
    </div>
  );
}
