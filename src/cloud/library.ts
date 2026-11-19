import type { DocumentSummary } from '../core/types';
import { folderTrail, type LibraryFolder } from '../store/library';
import type { CloudDocument, CloudList } from './client';
import { dirtyDocument } from './syncCore';
export interface UnifiedFolder extends LibraryFolder {
  cloudId?: string;
}
export interface LibraryDocument {
  id: string;
  name: string;
  folderId: string;
  modified: number;
  thumbnail?: string;
  locals: DocumentSummary[];
  cloud?: CloudDocument;
}
const pathKey = (folders: LibraryFolder[], id: string) =>
  folderTrail(folders, id)
    .map((f) => f.name.toLocaleLowerCase())
    .join('/');

/** One visible entry per logical document. Old local variants remain stored and selectable. */
export function unifiedLibrary(localFolders: LibraryFolder[], localDocuments: DocumentSummary[], remote: CloudList | null, trash = false) {
  const folders: UnifiedFolder[] = localFolders.map((f) => ({ ...f }));
  const remoteToLocal = new Map<string, string>();
  if (remote) {
    const sorted = [...remote.folders].sort((a, b) => folderTrail(remote.folders, a.id).length - folderTrail(remote.folders, b.id).length);
    for (const f of sorted) {
      const path = pathKey(remote.folders, f.id);
      const match =
        localFolders.find((l) => l.cloudSource?.userId === remote.userId && l.cloudSource.folderId === f.id) ??
        localFolders.find((l) => l.id === f.id) ??
        localFolders.find((l) => pathKey(localFolders, l.id) === path);
      const id = match?.id ?? f.id,
        parentId = remoteToLocal.get(f.parentId) ?? '';
      remoteToLocal.set(f.id, id);
      const combined = { ...f, id, parentId, cloudId: f.id };
      const index = folders.findIndex((l) => l.id === id);
      if (index < 0) folders.push(combined);
      else folders[index] = combined;
    }
  }
  const groups = new Map<string, LibraryDocument>();
  for (const cloud of remote?.documents ?? []) {
    groups.set(cloud.id, {
      id: cloud.id,
      name: cloud.name,
      folderId: remoteToLocal.get(cloud.folderId) ?? '',
      modified: cloud.modified,
      thumbnail: cloud.thumbnailUrl ?? undefined,
      cloud,
      locals: [],
    });
  }
  const primaryIds = new Set(localDocuments.map((d) => d.id));
  const owners = new Map<string, Set<string>>();
  for (const doc of localDocuments)
    if (doc.cloudSource) {
      const source = doc.cloudSource;
      const set = owners.get(source.documentId) ?? new Set<string>();
      set.add(source.userId);
      owners.set(source.documentId, set);
    }
  for (const local of localDocuments) {
    const source = local.cloudSource;
    const identity = source?.documentId ?? local.id;
    // A previous account's cache is a local document here; never attach it to another account's remote object.
    const key =
      source && remote && source.userId !== remote.userId
        ? `${source.userId}:${local.id}`
        : !remote && (owners.get(identity)?.size ?? 0) > 1
          ? `${source?.userId ?? 'local'}:${identity}`
          : identity;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: key,
        name: local.name,
        folderId: local.folderId ?? '',
        modified: local.modified,
        thumbnail: local.thumbnail,
        locals: [],
      };
      groups.set(key, group);
    }
    group.locals.push(local);
    if (group.cloud?.trashed && !local.trashed && dirtyDocument(local)) group.folderId = local.folderId ?? '';
    group.modified = Math.max(group.modified, local.modified);
    group.thumbnail ??= local.thumbnail;
    if (!group.cloud && (local.id === identity || !primaryIds.has(identity))) group.name = local.name;
  }
  for (const group of groups.values())
    group.locals.sort((a, b) => Number(b.id === group.id) - Number(a.id === group.id) || b.modified - a.modified);
  return {
    folders,
    documents: [...groups.values()]
      .filter((group) => {
        const trashed = Boolean(group.cloud ? group.cloud.trashed : group.locals.length && group.locals.every((local) => local.trashed));
        const dirtySurvivor = Boolean(group.cloud?.trashed) && group.locals.some((local) => !local.trashed && dirtyDocument(local));
        return trashed === trash || (!trash && dirtySurvivor);
      })
      .sort((a, b) => b.modified - a.modified),
  };
}

export function recentDocuments(documents: DocumentSummary[], diskIds = new Set<string>()): DocumentSummary[] {
  const visible = documents.filter((d) => !d.trashed);
  const grouped = unifiedLibrary(
    [],
    visible.filter((d) => !diskIds.has(d.id)),
    null,
  ).documents;
  return [...grouped.map((g) => g.locals[0]), ...visible.filter((d) => diskIds.has(d.id))].sort((a, b) => b.modified - a.modified);
}

export function libraryDocumentStatus(doc: LibraryDocument): string {
  const local = doc.locals[0];
  if (!doc.cloud) return local?.cloudSource ? 'Local copy; cloud unavailable' : 'Only on this device';
  if (!local) return 'In cloud';
  if (local.cloudSource) {
    if (
      local.cloudSource.revision !== doc.cloud.revision ||
      (local.cloudSource.cloudModified !== undefined && local.cloudSource.cloudModified !== doc.cloud.modified)
    )
      return 'Cloud version changed';
    if (local.cloudSource.savedModified !== undefined) return dirtyDocument(local) ? 'Unsaved cloud changes' : 'Saved in cloud';
  }
  return 'On this device and in cloud';
}
