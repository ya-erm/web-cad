// What a subfolder's card shows of the documents in it.

import { within, type FolderFile } from '../store/localFolder';

/**
 * The documents a subfolder's card shows (all of them — its own subfolders' too —, the latest first): the only one
 * whole, two to four in a 2 × 2 grid; more than four — three of them, and "+N" for the rest (`more`).
 */
export function folderPreview(files: FolderFile[], dir: string): { shown: FolderFile[]; more: number; count: number } {
  const all = files.filter((f) => within(f.name, dir)).sort((a, b) => b.modified - a.modified);
  return all.length > 4 ? { shown: all.slice(0, 3), more: all.length - 3, count: all.length } : { shown: all, more: 0, count: all.length };
}
