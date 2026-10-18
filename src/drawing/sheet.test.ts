import { describe, expect, it } from 'vitest';
import type { DrawingData } from '../core/types';
import { primBounds } from '../export/prim2d';
import { setLang } from '../i18n';
import { SHEETS, titleBlockPrims, titleBlockRect } from './sheet';

const drawing: DrawingData = {
  sheet: 'A3', landscape: true, views: [], dimensions: [], notes: [],
  title: 'Опорная пластина\nдля крепления датчика', author: 'Инженер', designation: 'CAD-001.01',
};
const extra = { scale: '1:2', units: 'mm', date: '18.10.2026' };

describe('drawing title block', () => {
  it('keeps text and table within the frame on every sheet and orientation', () => {
    for (const sheet of Object.keys(SHEETS) as DrawingData['sheet'][]) {
      for (const landscape of [true, false]) {
        const d = { ...drawing, sheet, landscape };
        const rect = titleBlockRect(d);
        // First two primitives are the paper boundary and the sheet frame.
        const bounds = primBounds(titleBlockPrims(d, extra).slice(2));
        expect(bounds.min[0]).toBeGreaterThanOrEqual(rect.x0 - 0.01);
        expect(bounds.min[1]).toBeGreaterThanOrEqual(rect.y0 - 0.01);
        expect(bounds.max[0]).toBeLessThanOrEqual(rect.x1 + 0.01);
        expect(bounds.max[1]).toBeLessThanOrEqual(rect.y1 + 0.01);
      }
    }
  });

  it('preserves multiline titles and localizes labels', () => {
    setLang('ru');
    expect(titleBlockPrims(drawing, extra, (key) => key).some((p) => p.t === 'text' && p.text === 'Designation')).toBe(true);
    const text = titleBlockPrims(drawing, extra).flatMap((p) => p.t === 'text' ? [p.text] : []);
    expect(text).toEqual(expect.arrayContaining(['Название', 'Обозначение', 'Автор', 'Масштаб', 'Опорная пластина', 'для крепления датчика', 'CAD-001.01']));
    setLang('en');
    expect(titleBlockPrims(drawing, extra).some((p) => p.t === 'text' && p.text === 'Designation')).toBe(true);
    setLang('ru');
  });

  it('bounds very long names and unbroken codes without crossing cell boundaries', () => {
    const d = { ...drawing, title: 'Очень длинное наименование детали '.repeat(30), designation: 'W'.repeat(200), author: 'W'.repeat(200) };
    const text = titleBlockPrims(d, extra).filter((p) => p.t === 'text');
    expect(text.some((p) => p.text.endsWith('…'))).toBe(true);
    const rect = titleBlockRect(d);
    for (const p of text) {
      const bounds = primBounds([p]);
      const right = p.p[0] < rect.x0 + 130 ? (p.p[1] < rect.y0 + 18 ? rect.x0 + 85 : rect.x0 + 130) : rect.x1;
      // The date occupies the other cell on the bottom row.
      if (p.text === extra.date || p.text === 'Дата') continue;
      expect(bounds.max[0]).toBeLessThanOrEqual(right);
      expect(bounds.min[1]).toBeGreaterThan(rect.y0);
    }
  });

  it('renders older drawings without a designation and both projection conventions', () => {
    const old = { ...drawing, designation: undefined };
    expect(titleBlockPrims(old, extra).some((p) => p.t === 'text' && p.text === '—')).toBe(true);
    expect(titleBlockPrims({ ...old, projection: 'third' }, extra).some((p) => p.t === 'text' && p.text === 'ISO A · 3')).toBe(true);
  });
});
