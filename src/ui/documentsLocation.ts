export interface DocumentsLocation {
  view: string;
  path: string;
}
export function documentsHash(location: DocumentsLocation): string {
  if (location.view === 'library') return '#/library' + (location.path ? '/' + encodeURIComponent(location.path) : '');
  if (location.view === 'trash') return '#/trash';
  if (location.view === 'folders') return '#/folders';
  if (location.view.startsWith('folder:'))
    return '#/files/' + encodeURIComponent(location.view.slice(7)) + (location.path ? '/' + encodeURIComponent(location.path) : '');
  return '#/documents';
}
export function documentsLocation(hash: string): DocumentsLocation | null {
  try {
    if (hash === '#/documents' || hash === '' || hash === '#/') return { view: 'docs', path: '' };
    if (hash === '#/trash') return { view: 'trash', path: '' };
    if (hash === '#/folders') return { view: 'folders', path: '' };
    const library = /^#\/library(?:\/([^?]*))?$/.exec(hash);
    if (library) return { view: 'library', path: decodeURIComponent(library[1] ?? '') };
    const disk = /^#\/files\/([^/]+)(?:\/(.*))?$/.exec(hash);
    if (disk) return { view: 'folder:' + decodeURIComponent(disk[1]), path: decodeURIComponent(disk[2] ?? '') };
  } catch {
    /* Malformed addresses do not replace the saved location. */
  }
  return null;
}
