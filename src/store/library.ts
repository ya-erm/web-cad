// Folder metadata belongs to the library, never to CAD geometry or its undo history.
export interface LibraryFolder {
  id: string;
  parentId: string;
  name: string;
  created: number;
  modified: number;
}
export type LibraryChange =
  { kind: 'folder'; folder: LibraryFolder } | { kind: 'remove'; id: string } | { kind: 'document'; id: string; folderId: string };

export function folderTrail(folders: LibraryFolder[], id: string): LibraryFolder[] {
  const out: LibraryFolder[] = [],
    seen = new Set<string>();
  while (id) {
    if (seen.has(id)) throw new Error('Invalid folder tree');
    seen.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) throw new Error('Folder not found');
    out.unshift(folder);
    id = folder.parentId;
  }
  return out;
}

export function validateLibraryChange(folders: LibraryFolder[], documents: { id: string; folderId?: string }[], change: LibraryChange) {
  if (change.kind === 'remove') {
    if (!folders.some((f) => f.id === change.id)) throw new Error('Folder not found');
    if (folders.some((f) => f.parentId === change.id) || documents.some((d) => d.folderId === change.id))
      throw new Error('Only empty folders can be deleted');
  } else if (change.kind === 'document') {
    if (!documents.some((d) => d.id === change.id)) throw new Error('Document not found');
    folderTrail(folders, change.folderId);
  } else {
    const f = change.folder;
    if (!f.name.trim() || f.name.length > 120 || /[\\/\u0000-\u001f]/.test(f.name)) throw new Error('Invalid folder name');
    if (folderTrail(folders, f.parentId).some((p) => p.id === f.id)) throw new Error('A folder cannot contain itself');
    if (folders.some((p) => p.id !== f.id && p.parentId === f.parentId && p.name.toLocaleLowerCase() === f.name.trim().toLocaleLowerCase()))
      throw new Error('A folder with this name already exists');
  }
}
