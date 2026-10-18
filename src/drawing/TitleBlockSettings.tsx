import { useState } from 'react';
import type { DrawingData, DrawingTitleBlock } from '../core/types';
import { t } from '../i18n';
import { titleBlockLimits, titleBlockSize } from './sheet';

function TableDimension({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="drawing-field">
      <span>{label}</span>
      <input
        type="number" min={min} max={max} step="0.1" value={draft ?? String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const number = Number(raw);
          if (raw.trim() && Number.isFinite(number) && number >= min && number <= max) onChange(number);
        }}
        onBlur={(e) => {
          const raw = e.target.value;
          const number = Number(raw);
          if (raw.trim() && Number.isFinite(number)) {
            const bounded = Math.min(max, Math.max(min, number));
            if (bounded !== value) onChange(bounded);
          }
          setDraft(null);
        }}
      />
    </label>
  );
}

export function TitleBlockSettings({ drawing, onChange }: { drawing: DrawingData; onChange: (config: DrawingTitleBlock, key?: string) => void }) {
  const config = drawing.titleBlock ?? { template: 'custom' };
  const [width, height] = titleBlockSize(drawing);
  const limits = titleBlockLimits(drawing);
  return (
    <>
      <label className="drawing-field">
        <span>{t('Title block template')}</span>
        <select value={config.template} onChange={(e) => onChange({ ...config, template: e.target.value as DrawingTitleBlock['template'] })}>
          <option value="gost">{t('GOST · form 1')}</option>
          <option value="custom">{t('Custom title block')}</option>
        </select>
      </label>
      {config.template === 'gost' ? (
        <p className="drawing-panel-hint">{t('GOST R 2.104-2023 · form 1 · 185 × 55 mm. Fixed table dimensions.')}</p>
      ) : (
        <>
          <div className="drawing-field-grid">
            <TableDimension label={t('Table width (mm)')} value={width} min={limits.minWidth} max={limits.maxWidth} onChange={(value) => onChange({ ...config, width: value }, 'title-block-width')} />
            <TableDimension label={t('Table height (mm)')} value={height} min={limits.minHeight} max={limits.maxHeight} onChange={(value) => onChange({ ...config, height: value }, 'title-block-height')} />
          </div>
          <p className="drawing-panel-hint">{t('Dimensions are in millimetres. The table stays within the sheet frame.')}</p>
        </>
      )}
    </>
  );
}
