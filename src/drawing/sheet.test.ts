import { describe, expect, it } from 'vitest';
import type { DrawingData } from '../core/types';
import { primBounds } from '../export/prim2d';
import { setLang } from '../i18n';
import { frameRect, SHEETS, titleBlockContent, titleBlockPrims, titleBlockRect, titleBlockSize } from './sheet';
import { writeSVG } from '../export/svg';

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

  it('keeps the GOST main table at 185 × 55 mm on every sheet and ignores custom dimensions', () => {
    for (const sheet of Object.keys(SHEETS) as DrawingData['sheet'][]) {
      for (const landscape of [true, false]) {
        const d: DrawingData = { ...drawing, sheet, landscape, titleBlock: { template: 'gost', width: 250, height: 80 } };
        expect(titleBlockSize(d)).toEqual([185, 55]);
        const rect = titleBlockRect(d);
        const bounds = primBounds(titleBlockContent(d, extra));
        expect(bounds.min).toEqual([rect.x0, rect.y0]);
        expect(bounds.max).toEqual([rect.x1, rect.y1]);
      }
    }
  });

  it('uses form 1 column widths and register rows, and renders the GOST fields', () => {
    const d: DrawingData = { ...drawing, titleBlock: {
      template: 'gost', material: 'Сталь 20', mass: '0.4 kg', organization: 'WebCAD', revision: '2', letter: 'АБ',
      checkedBy: 'Петров', technicalControl: 'Сидоров', standardsControl: 'Иванов', approvedBy: 'Орлов',
    } };
    const rect = titleBlockRect(d);
    const prims = titleBlockContent(d, extra);
    const hasLine = (a: number[], b: number[]) => prims.some((p) => p.t === 'line' &&
      p.a[0] === rect.x0 + a[0] && p.a[1] === rect.y0 + a[1] && p.b[0] === rect.x0 + b[0] && p.b[1] === rect.y0 + b[1]);
    expect(hasLine([65, 0], [65, 55])).toBe(true);
    expect(hasLine([65, 40], [185, 40])).toBe(true);
    expect(hasLine([135, 0], [135, 40])).toBe(true);
    expect(hasLine([7, 30], [7, 55])).toBe(true);
    expect(hasLine([0, 30], [65, 30])).toBe(true);
    expect(prims.flatMap((p) => p.t === 'text' ? [p.text] : [])).toEqual(expect.arrayContaining([
      'Сталь 20', '0.4 kg', 'WebCAD', '2', 'А', 'Б', 'Петров', 'Сидоров', 'Иванов', 'Орлов', 'Разраб.', '№ докум.',
    ]));
  });

  it('scales custom tables and anchors them to the inner bottom-right corner', () => {
    for (const [width, height] of [[100, 35], [140, 45], [250, 90], [390, 150]]) {
      const d: DrawingData = { ...drawing, titleBlock: { template: 'custom', width, height } };
      expect(titleBlockSize(d)).toEqual([width, height]);
      const rect = titleBlockRect(d);
      const frame = frameRect(d);
      expect(rect.x1).toBe(frame.x1);
      expect(rect.y0).toBe(frame.y0);
      const bounds = primBounds(titleBlockContent(d, extra));
      expect(bounds.min[0]).toBeCloseTo(rect.x0);
      expect(bounds.min[1]).toBeCloseTo(rect.y0);
      expect(bounds.max[0]).toBeCloseTo(rect.x1);
      expect(bounds.max[1]).toBeCloseTo(rect.y1);
    }
  });

  it('bounds invalid and oversized custom dimensions and retains the requested dimensions', () => {
    for (const invalid of [undefined, NaN, Infinity]) {
      expect(titleBlockSize({ ...drawing, titleBlock: { template: 'custom', width: invalid, height: invalid } })).toEqual([185, 55]);
    }
    expect(titleBlockSize({ ...drawing, titleBlock: { template: 'custom', width: -5, height: 0 } })).toEqual([100, 35]);
    const d: DrawingData = { ...drawing, sheet: 'A4', landscape: false, titleBlock: { template: 'custom', width: 250, height: 90 } };
    expect(titleBlockSize(d)).toEqual([185, 90]);
    expect(titleBlockSize({ ...d, sheet: 'A3' })).toEqual([250, 90]);
    expect(d.titleBlock?.width).toBe(250);
    expect(titleBlockSize({ ...d, titleBlock: { template: 'custom', width: 9999, height: 9999 } })).toEqual([185, 287]);
  });

  it('exports the same custom dimensions and GOST content as the preview', () => {
    const d: DrawingData = { ...drawing, titleBlock: { template: 'custom', width: 140, height: 45 } };
    const svg = writeSVG(titleBlockPrims(d, extra), { width: 420, height: 297 });
    expect(svg).toContain('275,5 415,5 415,50 275,50');
    expect(svg).toContain('CAD-001.01');
    const gost = writeSVG(titleBlockPrims({ ...d, titleBlock: { template: 'gost', material: 'Сталь 20' } }, extra));
    expect(gost).toContain('Сталь 20');
    expect(gost).toContain('Разраб.');
    expect(gost).not.toContain('Название</text>');
  });
});
