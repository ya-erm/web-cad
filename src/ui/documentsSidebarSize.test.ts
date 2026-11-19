import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentsSidebarWidth, loadDocumentsSidebarWidth, saveDocumentsSidebarWidth, DOCUMENTS_SIDEBAR_KEY } from './documentsSidebarSize';
afterEach(() => vi.unstubAllGlobals());
describe('document navigator width', () => {
  it('keeps usable minimum and maximum widths', () => {
    expect(documentsSidebarWidth(1, 1500)).toBe(180);
    expect(documentsSidebarWidth(1000, 1500)).toBe(600);
  });
  it('leaves document room on narrow windows without destroying the preferred width', () => {
    const preferred = 580;
    expect(documentsSidebarWidth(preferred, 700)).toBe(380);
    expect(documentsSidebarWidth(preferred, 1500)).toBe(580);
    expect(documentsSidebarWidth(preferred, 375)).toBe(180);
  });
  it('remembers and resets its own width', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    });
    saveDocumentsSidebarWidth(360);
    expect(loadDocumentsSidebarWidth()).toBe(360);
    saveDocumentsSidebarWidth(null);
    expect(loadDocumentsSidebarWidth()).toBe(220);
  });
  it.each(['broken', '0', '2000', 'Infinity'])('ignores invalid saved values (%s)', (v) => {
    vi.stubGlobal('localStorage', { getItem: () => v });
    expect(loadDocumentsSidebarWidth()).toBe(220);
  });
  it('works when browser storage is restricted', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadDocumentsSidebarWidth()).toBe(220);
    expect(() => saveDocumentsSidebarWidth(360)).not.toThrow();
  });
});
