import { describe, it, expect } from 'vitest';
import { documentsHash, documentsLocation } from './documentsLocation';
import { documentTime } from './documentTime';
describe('document navigation and dates', () => {
  it.each([
    { view: 'library', path: '' },
    { view: 'library', path: 'folder-1' },
    { view: 'folder:disk', path: 'Parts/Гайки и болты' },
    { view: 'trash', path: '' },
    { view: 'docs', path: '' },
  ])('round trips %j', (location) => expect(documentsLocation(documentsHash(location))).toEqual(location));
  it('does not treat a document or help address as folder navigation', () => {
    expect(documentsLocation('#/doc/example')).toBeNull();
    expect(documentsLocation('#/help/ru/documents')).toBeNull();
    expect(documentsLocation('#/library/%zz')).toBeNull();
  });
  it('uses padded local dates with seconds and 24-hour time', () => {
    expect(documentTime(new Date(2026, 10, 19, 23, 5, 7).getTime())).toBe('19.11.2026 23:05:07');
    expect(documentTime(new Date(2026, 0, 2, 0, 0, 1).getTime())).toBe('02.01.2026 00:00:01');
  });
});
