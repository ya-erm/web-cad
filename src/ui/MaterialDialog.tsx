// Assign material (Onshape): a part's material from the library (its density for the mass) or one of the user's own —
// a name and a density; for all the parts it was opened for.

import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { activeStudio, useDoc, withStudio } from '../store/docStore';
import { DEFAULT_DENSITY, findMaterial, MATERIALS } from '../core/materials';
import { formatNumber } from '../core/expr';
import { Icon } from './icons';
import { t } from '../i18n';

export function MaterialDialog() {
  const open = useEditor((s) => s.materialOpen);
  const doc = useDoc((s) => s.doc);
  const build = useEditor((s) => s.build);
  const studio = activeStudio(doc);
  const first = open && studio ? studio.parts[open.partIds[0]] : undefined;
  // the current choice: a library id, or "custom" with a name and a density
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [density, setDensity] = useState('');
  useEffect(() => {
    if (!open) return;
    const lib = first?.material ? findMaterial(first.material, t) : undefined;
    setChoice(lib && Math.abs(lib.density - (first?.density ?? lib.density)) < 1e-9 ? lib.id : first?.material || first?.density ? 'custom' : '');
    setName(first?.material ?? '');
    setDensity(first?.density ? String(first.density) : '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !studio) return null;
  const close = () => useEditor.setState({ materialOpen: null });
  const names = open.partIds.map((id) => build?.parts.find((p) => p.id === id)?.name ?? id);
  const d = parseFloat(density.replace(',', '.'));
  const valid = choice === '' || (choice === 'custom' ? name.trim() !== '' && d > 0 : true);
  const apply = () => {
    const lib = MATERIALS.find((m) => m.id === choice);
    const patch = choice === '' ? { material: undefined, density: undefined } : lib ? { material: t(lib.name), density: lib.density } : { material: name.trim(), density: d };
    useDoc.getState().update((doc) =>
      withStudio(doc, (s) => {
        for (const id of open.partIds) {
          const meta = { ...(s.parts[id] ?? {}), ...patch };
          if (meta.material === undefined) delete meta.material;
          if (meta.density === undefined) delete meta.density;
          s.parts[id] = meta;
        }
      }),
    );
    close();
  };
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div
        className="modal material-dialog"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && valid) apply();
        }}
      >
        <div className="modal-header">
          <Icon name="massProps" /> &nbsp;{t('Material')}
          <span className="spacer" />
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ color: 'var(--text-2)' }}>
            {t('Parts')}: {names.join(', ')}
          </div>
          <div className="material-list">
            <label className={'material-row' + (choice === '' ? ' on' : '')}>
              <input type="radio" checked={choice === ''} onChange={() => setChoice('')} />
              <span>{t('No material')}</span>
              <span className="material-density">{t('mass as steel')} · {formatNumber(DEFAULT_DENSITY, 3)} g/cm³</span>
            </label>
            {MATERIALS.map((m) => (
              <label key={m.id} className={'material-row' + (choice === m.id ? ' on' : '')}>
                <input type="radio" checked={choice === m.id} onChange={() => setChoice(m.id)} />
                <span>{t(m.name)}</span>
                <span className="material-density">{formatNumber(m.density, 3)} g/cm³</span>
              </label>
            ))}
            <label className={'material-row' + (choice === 'custom' ? ' on' : '')}>
              <input type="radio" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
              <span>{t('Custom')}</span>
            </label>
          </div>
          {choice === 'custom' && (
            <>
              <div className="fd-row">
                <label>{t('Name')}</label>
                <div className="fd-control">
                  <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
              <div className="fd-row">
                <label>{t('Density')}, g/cm³</label>
                <div className="fd-control">
                  <input type="text" className={density && !(d > 0) ? 'invalid' : ''} value={density} onChange={(e) => setDensity(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={close}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={!valid} onClick={apply}>
            {t('Apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
