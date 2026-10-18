import { useEffect, useRef, useState } from 'react';
import { Engine } from '../viewport/engine';
import { getEngine, setEngine } from '../viewport/engineRef';
import { useEditor, type SectionState } from '../store/editorStore';
import { useDoc } from '../store/docStore';
import { formatNumber, LENGTH_FACTOR } from '../core/expr';
import type { Vec3 } from '../core/types';
import { Icon } from './icons';
import { t } from '../i18n';

const SECTION_PLANES: Record<'top' | 'front' | 'right', { normal: Vec3; label: string }> = {
  top: { normal: [0, 0, 1], label: 'Top' },
  front: { normal: [0, -1, 0], label: 'Front' },
  right: { normal: [1, 0, 0], label: 'Right' },
};

/** Section plane from the current selection (planar face or plane), if any. */
function selectedSectionPlane(): { normal: Vec3; origin: Vec3 } | null {
  const e = getEngine();
  for (const r of useEditor.getState().selection) {
    const p = e?.planeOf(r);
    if (p) return p;
  }
  return null;
}

function startSection() {
  const sel = selectedSectionPlane();
  const s: SectionState = sel
    ? { source: 'face', normal: sel.normal, origin: sel.origin, offset: 0, flip: false }
    : { source: 'front', normal: SECTION_PLANES.front.normal, origin: [0, 0, 0], offset: 0, flip: false };
  useEditor.setState({ section: s });
}

/** Onshape-like section view panel: plane, offset (slider + value), side. */
function SectionPanel({ s }: { s: SectionState }) {
  const units = useDoc((d) => d.doc?.units.length ?? 'mm');
  const k = LENGTH_FACTOR[units];
  const set = (patch: Partial<SectionState>) => useEditor.setState({ section: { ...s, ...patch } });
  const [lo, hi] = getEngine()?.extentAlong(s.normal, s.origin) ?? [-50, 50];
  const [text, setText] = useState<string | null>(null);
  const hasSel = useEditor((st) => st.selection.length > 0);
  return (
    <div className="section-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="section-head">
        <Icon name="sectionView" size={16} /> {t('Section view')}
        <span className="spacer" />
        <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('Close')} onClick={() => useEditor.setState({ section: null })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="segmented">
        {(['top', 'front', 'right'] as const).map((p) => (
          <button key={p} className={s.source === p ? 'on' : ''} onClick={() => set({ source: p, normal: SECTION_PLANES[p].normal, origin: [0, 0, 0], offset: 0 })}>
            {t(SECTION_PLANES[p].label)}
          </button>
        ))}
        <button
          className={s.source === 'face' ? 'on' : ''}
          disabled={!hasSel}
          data-tip={t('Select a planar face or a plane first')}
          onClick={() => {
            const p = selectedSectionPlane();
            if (p) set({ source: 'face', normal: p.normal, origin: p.origin, offset: 0 });
            else useEditor.getState().showToast('Select a planar face or a plane first', 'info');
          }}
        >
          {t('Selected')}
        </button>
      </div>
      <div className="section-row">
        <input
          type="range"
          min={Math.min(lo, s.offset)}
          max={Math.max(hi, s.offset)}
          step={(hi - lo) / 400 || 0.1}
          value={s.offset}
          onChange={(e) => set({ offset: Number(e.target.value) })}
        />
        <input
          type="text"
          className="section-offset"
          value={text ?? `${formatNumber(s.offset / k, 3)} ${units}`}
          onFocus={(e) => {
            setText(formatNumber(s.offset / k, 4));
            e.target.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = parseFloat((text ?? '').replace(',', '.'));
            if (Number.isFinite(v)) set({ offset: v * k });
            setText(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <label className="fd-check">
        <input type="checkbox" checked={s.flip} onChange={(e) => set({ flip: e.target.checked })} />
        {t('Keep the other side')}
      </label>
    </div>
  );
}

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const kernelReady = useEditor((s) => s.kernelReady);
  const perspective = useEditor((s) => s.perspective);
  const section = useEditor((s) => s.section);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const engine = new Engine(ref.current);
    setEngine(engine);
    if (import.meta.env.DEV) (window as unknown as { __engine: Engine }).__engine = engine;
    return () => {
      setEngine(null);
      engine.dispose();
    };
  }, []);
  const view = useEditor.getState().view;
  return (
    <>
      <div className="viewport" ref={ref} />
      <div className="view-menu">
        <button className="icon-btn" title={`${t('Zoom to fit')} (F)`} onClick={() => view({ kind: 'fit' })}>
          <Icon name="zoomFit" size={18} />
        </button>
        <button className="icon-btn" title={`${t('View normal to')} (N)`} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n' }))}>
          <Icon name="viewNormal" size={18} />
        </button>
        <button
          className={'icon-btn' + (section ? ' active' : '')}
          title={t('Section view')}
          onClick={() => (section ? useEditor.setState({ section: null }) : startSection())}
        >
          <Icon name="sectionView" size={18} />
        </button>
        <div className="menu-wrap">
          <button className="icon-btn" title={t('Views')} onClick={() => setMenu(!menu)}>
            <Icon name="cube" size={18} />
          </button>
          {menu && (
            <div className="dropdown" onMouseLeave={() => setMenu(false)}>
              {(
                [
                  ['front', 'Front', 'Shift+1'],
                  ['back', 'Back', 'Shift+2'],
                  ['left', 'Left', 'Shift+3'],
                  ['right', 'Right', 'Shift+4'],
                  ['top', 'Top', 'Shift+5'],
                  ['bottom', 'Bottom', 'Shift+6'],
                  // the axonometric views apart from the six principal ones
                  ['|', '', ''],
                  ['iso', 'Isometric', ''],
                  ['dimetric', 'Dimetric', ''],
                  ['trimetric', 'Trimetric', ''],
                ] as const
              ).map(([v, label, sc]) =>
                v === '|' ? (
                  <div key="axonometric" className="dropdown-sep" />
                ) : (
                  <div
                    key={v}
                    className="dropdown-item"
                    onClick={() => {
                      view({ kind: 'std', view: v });
                      setMenu(false);
                    }}
                  >
                    {t(label)} <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>{sc}</span>
                  </div>
                ),
              )}
              <div className="dropdown-sep" />
              <div
                className="dropdown-item"
                onClick={() => {
                  useEditor.setState({ perspective: !perspective });
                  setMenu(false);
                }}
              >
                {perspective ? '✓ ' : ''}
                {t('Perspective')}
              </div>
              <div
                className="dropdown-item"
                onClick={() => {
                  useEditor.setState({ showPlanes: !useEditor.getState().showPlanes });
                  setMenu(false);
                }}
              >
                {t('Show planes')} <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>P</span>
              </div>
              <div
                className="dropdown-item"
                onClick={() => {
                  useEditor.setState({ showSketches: !useEditor.getState().showSketches });
                  setMenu(false);
                }}
              >
                {t('Show sketches')} <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>Shift+H</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {section && <SectionPanel s={section} />}
      {!kernelReady && (
        <div className="loading-overlay">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="spinner" /> {t('Loading geometry kernel…')}
          </div>
        </div>
      )}
    </>
  );
}
