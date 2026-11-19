import { folderTrail, type LibraryFolder } from '../store/library';
import type { CloudDocument } from './client';
export type CloudItem = { kind: 'document' | 'folder'; id: string };
export function cloudFolderPreview<T extends { folderId: string; modified: number }>(folders: LibraryFolder[], documents: T[], id: string) {
  const all = documents
    .filter((d) => d.folderId === id || folderTrail(folders, d.folderId).some((f) => f.id === id))
    .sort((a, b) => b.modified - a.modified);
  return { shown: all.length > 4 ? all.slice(0, 3) : all, more: all.length > 4 ? all.length - 3 : 0, count: all.length };
}
export function canMoveCloudItem(
  folders: LibraryFolder[],
  documents: Pick<CloudDocument, 'id' | 'folderId'>[],
  item: CloudItem,
  target: string,
): boolean {
  if (target && !folders.some((f) => f.id === target)) return false;
  if (item.kind === 'document') {
    const d = documents.find((d) => d.id === item.id);
    return !!d && d.folderId !== target;
  }
  const f = folders.find((f) => f.id === item.id);
  return !!f && f.parentId !== target && target !== f.id && !folderTrail(folders, target).some((p) => p.id === f.id);
}
export function cloudFolderRows(folders: LibraryFolder[], parent = '', depth = 0): { folder: LibraryFolder; depth: number }[] {
  return folders
    .filter((f) => f.parentId === parent)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((folder) => [{ folder, depth }, ...cloudFolderRows(folders, folder.id, depth + 1)]);
}
