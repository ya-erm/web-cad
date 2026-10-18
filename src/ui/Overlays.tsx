import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { activeAssembly, activeStudio, useDoc } from '../store/docStore';
import { kernel } from '../kernel/client';
import type { MeasureResult } from '../kernel/protocol';
import { formatNumber, LENGTH_FACTOR } from '../core/expr';
import { download, exportAssembly, exportParts, safeName, type ExportKind } from './exporting';
import { useAssembly } from '../assembly/sources';
import { Icon, type IconName } from './icons';
import { t } from '../i18n';

export function ContextMenu() {
  const menu = useEditor((s) => s.contextMenu);
  useEffect(() => {
    if (!menu) return;
    const close = () => useEditor.setState({ contextMenu: null });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 30 - (menu.palette ? 90 : 0));
  return (
    <div className="context-menu" style={{ left: x, top: Math.max(4, y) }} onPointerDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="dropdown-sep" />
        ) : (
          <div
            key={i}
            className={'dropdown-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '')}
            onClick={() => {
              useEditor.setState({ contextMenu: null });
              it.action?.();
            }}
          >
            <span className="menu-icon">{it.icon && <Icon name={it.icon as IconName} size={16} />}</span>
            {it.label}
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          </div>
        ),
      )}
      {menu.palette && (
        <>
          <div className="dropdown-sep" />
          <div className="dropdown-label">{t('Change color')}</div>
          <div className="palette">
            {menu.palette.colors.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  useEditor.setState({ contextMenu: null });
                  menu.palette!.onPick(c);
                }}
              />
            ))}
          </div>
          <label className="palette-custom">
            <input
              type="color"
              defaultValue="#a9bfd6"
              onChange={(e) => menu.palette!.onPick(e.target.value)}
            />
            {t('Custom color…')}
          </label>
        </>
      )}
    </div>
  );
}

export function Toast() {
  const toast = useEditor((s) => s.toast);
  if (!toast) return null;
  return <div className={'toast' + (toast.kind === 'error' ? ' error' : '')}>{t(toast.text)}</div>;
}

export function MeasurePanel() {
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editing);
  const build = useEditor((s) => s.build);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const [res, setRes] = useState<MeasureResult | null>(null);
  useEffect(() => {
    if (!studio || editing || !selection.length || selection.length > 2) {
      setRes(null);
      return;
    }
    let cancelled = false;
    kernel()
      .measure({ studioKey: studio.id, refs: selection })
      .then((r) => !cancelled && setRes(r))
      .catch(() => !cancelled && setRes(null));
    return () => {
      cancelled = true;
    };
  }, [selection, editing, build, studio?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!res || !res.items.length || !doc) return null;
  const u = doc.units.length;
  const f = LENGTH_FACTOR[u];
  const fmt = (v: number, kind: string) => {
    switch (kind) {
      case 'length':
        return `${formatNumber(v / f, 3)} ${u}`;
      case 'area':
        return `${formatNumber(v / f ** 2, 3)} ${u}²`;
      case 'volume':
        return `${formatNumber(v / f ** 3, 3)} ${u}³`;
      case 'mass': {
        const partId = selection[0]?.kind === 'part' ? selection[0].partId : null;
        const density = (partId && studio?.parts[partId]?.density) || 7.85;
        return `${formatNumber((v * density) / 1000, 4)} kg (ρ=${density})`;
      }
      case 'angle':
        return `${formatNumber((v * 180) / Math.PI, 3)}°`;
      default:
        return formatNumber(v, 4);
    }
  };
  return (
    <div className="measure-panel">
      {res.items.map((it) => (
        <div key={it.label} className="mrow">
          <span>{t(it.label)}</span>
          <span>{fmt(it.value, it.kind)}</span>
        </div>
      ))}
      {res.centerOfMass && (
        <div className="mrow">
          <span>{t('Center of mass')}</span>
          <span>{res.centerOfMass.map((v) => formatNumber(v / f, 2)).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

const RES: Record<string, [number, number]> = {
  coarse: [0.1, 0.5],
  medium: [0.02, 0.25],
  fine: [0.005, 0.1],
};

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const build = useEditor((s) => s.build);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const asm = activeAssembly(doc);
  const [kind, setKind] = useState<ExportKind | 'project'>('step');
  const [res, setRes] = useState('medium');
  const [unit, setUnit] = useState<'mm' | 'in'>('mm');
  const [busy, setBusy] = useState(false);
  if (!open || (!studio && !asm) || !doc) return null;
  const close = () => useEditor.setState({ exportOpen: null });
  // an assembly exports its instances (the selected ones, else the shown ones) where they stand
  const instances = asm ? asm.instances.filter((i) => (open.partIds.length ? open.partIds.includes(i.id) : !i.hidden)) : [];
  const parts = asm ? instances : (build?.parts ?? []).filter((p) => (open.partIds.length ? open.partIds.includes(p.id) : !p.hidden));
  // the whole document for WebCAD (tabs, feature history), not geometry for other programs
  const project = kind === 'project';
  const run = async () => {
    if (project) {
      download(JSON.stringify(doc), `${safeName(doc.name)}.webcad.json`, 'application/json');
      return close();
    }
    setBusy(true);
    try {
      const [tol, ang] = RES[res];
      const name = parts.length === 1 ? parts[0].name : asm ? `${doc.name} — ${asm.name}` : doc.name;
      const opts = { tolerance: tol, angularTolerance: ang, unit, baseName: name };
      if (asm) await exportAssembly(asm, useAssembly.getState().sources, instances.map((i) => i.id), kind as ExportKind, opts);
      else if (studio) await exportParts(studio.id, parts.map((p) => p.id), kind as ExportKind, opts);
      close();
    } catch (e) {
      useEditor.getState().showToast(String((e as Error).message ?? e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <Icon name="export" /> &nbsp;{project ? t('Export') : asm ? t('Export assembly') : t('Export parts')}
          <span className="spacer" />
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="fd-row">
            <label>{t('Format')}</label>
            <div className="fd-control">
              <select value={kind} onChange={(e) => setKind(e.target.value as ExportKind | 'project')}>
                <option value="step">STEP (.step)</option>
                <option value="stl">STL binary (.stl)</option>
                <option value="stl-ascii">STL ASCII (.stl)</option>
                <option value="obj">OBJ (.obj)</option>
                <option value="3mf">3MF (.3mf)</option>
                <option value="project">{t('WebCAD project (.webcad.json)')}</option>
              </select>
            </div>
          </div>
          {project && <div className="fd-hint">{t('The whole document — every tab with its feature history — to open again in WebCAD (Import project).')}</div>}
          {kind !== 'step' && !project && (
            <div className="fd-row">
              <label>{t('Resolution')}</label>
              <div className="fd-control">
                <div className="segmented" style={{ flex: 1 }}>
                  {['coarse', 'medium', 'fine'].map((r) => (
                    <button key={r} className={res === r ? 'on' : ''} onClick={() => setRes(r)}>
                      {t(r[0].toUpperCase() + r.slice(1))}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {!project && (
            <>
              <div className="fd-row">
                <label>{t('Units')}</label>
                <div className="fd-control">
                  <select value={unit} onChange={(e) => setUnit(e.target.value as 'mm' | 'in')}>
                    <option value="mm">mm</option>
                    <option value="in">inch</option>
                  </select>
                </div>
              </div>
              <div style={{ color: 'var(--text-2)' }}>
                {asm ? t('Instances') : t('Parts')}: {parts.map((p) => p.name).join(', ') || '—'}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={busy || (!project && !parts.length)} onClick={run}>
            {busy ? <div className="spinner" /> : <Icon name="download" size={16} />} {t('Export')}
          </button>
        </div>
      </div>
    </div>
  );
}
