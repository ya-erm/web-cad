// A subfolder's card: its only document whole, a 2 × 2 grid of up to four, three and "+N" when there are more.

import { describe, expect, it } from 'vitest';
import type { FolderFile } from '../store/localFolder';
import { folderPreview } from './folderPreview';

const file = (name: string, modified: number): FolderFile => ({ name, title: name.replace(/.*\//, '').replace(/\.webcad\.json$/, ''), modified, size: 1 });

describe('folder preview', () => {
  const files = [
    file('Top.webcad.json', 9),
    file('Parts/A.webcad.json', 1),
    file('Parts/B.webcad.json', 5),
    file('Parts/Bolts/C.webcad.json', 3),
    file('Parts/Bolts/D.webcad.json', 7),
    file('Parts/Bolts/E.webcad.json', 2),
    file('Partsbin/F.webcad.json', 8),
  ];

  it('one document: it alone', () => {
    expect(folderPreview(files, 'Partsbin')).toEqual({ shown: [files[6]], more: 0, count: 1 });
  });

  it('up to four (nested ones too): all of them, the latest first', () => {
    const p = folderPreview(files, 'Parts/Bolts');
    expect(p.shown.map((f) => f.title)).toEqual(['D', 'C', 'E']);
    expect(p.more).toBe(0);
  });

  it('more than four: three and "+" the rest', () => {
    const p = folderPreview(files, 'Parts');
    expect(p.count).toBe(5);
    expect(p.shown.map((f) => f.title)).toEqual(['D', 'B', 'C']);
    expect(p.more).toBe(2);
  });

  it('an empty folder', () => {
    expect(folderPreview(files, 'Empty')).toEqual({ shown: [], more: 0, count: 0 });
  });
});
