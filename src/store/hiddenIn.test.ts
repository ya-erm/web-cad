// What a tab hides in the graphics area: an assembly — its default planes until they are shown, not its origin.

import { describe, expect, it } from 'vitest';
import type { AssemblyTab, DrawingTab, PartStudioTab } from '../core/types';
import { hiddenIn } from './docStore';

const asm = (extra: Partial<AssemblyTab> = {}): AssemblyTab => ({ id: 'A', type: 'assembly', name: 'Assembly 1', instances: [], ...extra });
const studio = (extra: Partial<PartStudioTab> = {}): PartStudioTab => ({ id: 'S', type: 'partStudio', name: 'Part Studio 1', features: [], rollback: null, parts: {}, ...extra });

describe('hiddenIn', () => {
  it('hides an assembly’s default planes until shown, its origin stays', () => {
    expect([...hiddenIn(asm())].sort()).toEqual(['front', 'right', 'top']);
    expect(hiddenIn(asm({ hidden: ['origin', 'right'] }))).toEqual(['origin', 'right']);
    expect(hiddenIn(asm({ hidden: [] }))).toEqual([]);
  });

  it('a Part Studio hides only what its eyes hide', () => {
    expect(hiddenIn(studio())).toEqual([]);
    expect(hiddenIn(studio({ hidden: ['top', 'f1'] }))).toEqual(['top', 'f1']);
  });

  it('gives the same array while the tab does not change (no redraw on other edits)', () => {
    expect(hiddenIn(asm())).toBe(hiddenIn(asm({ name: 'Other' })));
    expect(hiddenIn(studio())).toBe(hiddenIn(studio({ name: 'Other' })));
    expect(hiddenIn({ id: 'D', type: 'drawing', name: 'Drawing 1' } as DrawingTab)).toEqual([]);
    expect(hiddenIn(null)).toEqual([]);
  });
});
