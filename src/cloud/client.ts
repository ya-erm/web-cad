import type { LibraryFolder } from '../store/library';
import type { DocumentSummary } from '../core/types';
import * as db from '../store/persistence';
import { useDoc } from '../store/docStore';
import { projectText, readProject } from '../store/folderStore';
import { fileVersions, importVersions, copiedVersionIds, withCopiedVersions } from '../store/versions';
import { putCloudObject } from './uploadProgress';

const API = 'https://api.cad.ya-erm.ru';
export interface CloudDocument {
  trashed?: number;
  id: string;
  name: string;
  folderId: string;
  revision: string;
  created: number;
  modified: number;
  size: number;
  thumbnailSize: number;
  hash: string;
  thumbnailHash: string;
  thumbnailUrl?: string | null;
}
export interface CloudList {
  userId: string;
  folders: LibraryFolder[];
  documents: CloudDocument[];
}
export class CloudFailure extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export async function cloudRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new CloudFailure(data.error ?? 'cloud_unavailable', response.status);
  return data as T;
}
export const listCloud = () => cloudRequest<CloudList>('/cloud/list');
export const saveCloudFolder = (folder: LibraryFolder, expectedModified?: number) =>
  cloudRequest('/cloud/folder', { ...folder, expectedModified });
export const deleteCloudFolder = (id: string) => cloudRequest('/cloud/folder', { id, remove: true });
export const renameCloudDocument = (doc: CloudDocument, name: string) =>
  cloudRequest<{ document: CloudDocument }>('/cloud/document', {
    id: doc.id,
    revision: doc.revision,
    modified: doc.modified,
    folderId: doc.folderId,
    name,
  });
export const moveCloudDocument = (doc: CloudDocument, folderId: string) =>
  cloudRequest<{ document: CloudDocument }>('/cloud/document', {
    id: doc.id,
    revision: doc.revision,
    modified: doc.modified,
    folderId,
  });

export const trashCloudDocument = (doc: CloudDocument, trashed: boolean) =>
  cloudRequest<{ document: CloudDocument }>('/cloud/document', {
    id: doc.id,
    revision: doc.revision,
    modified: doc.modified,
    folderId: doc.folderId,
    trashed,
  });

/** Trash the logical cloud document before changing any of its local variants. */
export async function setDocumentTrash(summary: DocumentSummary, trashed: boolean) {
  const source = summary.cloudSource;
  let locals = [summary];
  if (source) {
    const remote = await listCloud();
    if (remote.userId !== source.userId) throw new Error('Connect to organise cloud documents.');
    const doc = remote.documents.find((d) => d.id === source.documentId);
    if (!doc) throw new Error('Document not found');
    const changed = await trashCloudDocument(doc, trashed);
    locals = useDoc
      .getState()
      .docs.filter(
        (d) => d.id === source.documentId || (d.cloudSource?.userId === source.userId && d.cloudSource.documentId === source.documentId),
      );
    for (const local of locals)
      if (local.cloudSource)
        await db.markCloudCopy(local.id, {
          ...local.cloudSource,
          cloudModified: changed.document.modified,
        });
  }
  for (const local of locals) await (trashed ? useDoc.getState().trashDocument(local.id) : useDoc.getState().restoreDocument(local.id));
}

export async function blobHash(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Card images are small, independently downloadable WebP objects; the geometry cache is excluded. */
export async function cloudThumbnail(source?: string): Promise<Blob | null> {
  if (!source) return null;
  const image = new Image();
  image.src = source;
  await image.decode();
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 280;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 480, 280);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  } finally {
    image.src = '';
  }
}

export interface CloudUploadProgress {
  phase: 'preparing' | 'uploading' | 'committing';
  loaded: number;
  total: number;
}
export interface UploadOptions {
  onProgress?: (progress: CloudUploadProgress) => void;
  signal?: AbortSignal;
}

export async function uploadCloudDocument(
  summary: DocumentSummary,
  folderId: string,
  asCopy = false,
  expectedRevision?: string,
  expectedModified?: number,
  options: UploadOptions = {},
): Promise<CloudDocument> {
  options.signal?.throwIfAborted();
  options.onProgress?.({ phase: 'preparing', loaded: 0, total: 0 });
  if (!asCopy && summary.cloudSource?.revision && summary.cloudSource.cloudModified === undefined && expectedModified === undefined)
    throw new Error('Confirm updating the existing cloud version.');
  await useDoc.getState().flushSave();
  if (useDoc.getState().saveError) throw new Error('Save your changes before uploading.');
  const doc = await db.loadDocument(summary.id);
  if (!doc) throw new Error('Document not found');
  const source = {
    ...doc,
    id: asCopy ? crypto.randomUUID() : (summary.cloudSource?.documentId ?? doc.id),
  };
  const text = projectText(source, await fileVersions(doc.id));
  if (new Blob([text]).size > 100 * 1024 * 1024) throw new Error('The project is too large to upload.');
  const compressed = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const thumbnail = await cloudThumbnail(await db.getThumbnail(doc.id)).catch(() => null);
  if (compressed.size > 20 * 1024 * 1024 || (thumbnail?.size ?? 0) > 1024 * 1024) throw new Error('The project is too large to upload.');
  const hash = await blobHash(compressed),
    thumbnailHash = thumbnail ? await blobHash(thumbnail) : '';
  const prepared = await cloudRequest<{
    userId: string;
    uploadId: string;
    projectUrl: string;
    thumbnailUrl: string | null;
  }>('/cloud/prepare', {
    documentId: source.id,
    name: source.name,
    folderId,
    expectedRevision: asCopy ? '' : (expectedRevision ?? summary.cloudSource?.revision ?? ''),
    expectedModified: asCopy ? undefined : (expectedModified ?? summary.cloudSource?.cloudModified),
    size: compressed.size,
    thumbnailSize: thumbnail?.size ?? 0,
    hash,
    thumbnailHash,
  });
  const total = compressed.size + (thumbnail?.size ?? 0);
  let uploaded = 0;
  options.onProgress?.({ phase: 'uploading', loaded: 0, total });
  const put = async (url: string, body: Blob) => {
    if (options.onProgress) {
      await putCloudObject(
        url,
        body,
        (loaded) =>
          options.onProgress!({
            phase: 'uploading',
            loaded: uploaded + loaded,
            total,
          }),
        options.signal,
      );
      uploaded += body.size;
      return;
    }
    const result = await fetch(url, {
      method: 'PUT',
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
    if (!result.ok) throw new Error('Upload failed. Your local document is safe.');
  };
  await put(prepared.projectUrl, compressed);
  if (thumbnail && prepared.thumbnailUrl) await put(prepared.thumbnailUrl, thumbnail);
  options.signal?.throwIfAborted();
  options.onProgress?.({ phase: 'committing', loaded: total, total });
  const result = await cloudRequest<{ document: CloudDocument }>('/cloud/commit', { uploadId: prepared.uploadId });
  if (!asCopy && prepared.userId) {
    await db.markCloudCopy(summary.id, {
      userId: prepared.userId,
      documentId: result.document.id,
      revision: result.document.revision,
      savedModified: doc.modified,
      cloudModified: result.document.modified,
    });
    await useDoc.getState().loadList();
  }
  return result.document;
}

/** Cloud opening makes a local copy; changed local files and drafts are never replaced. */
export async function openCloudDocument(id: string): Promise<string> {
  const result = await cloudRequest<{
    userId: string;
    document: CloudDocument;
    url: string;
    thumbnailUrl: string | null;
  }>('/cloud/open', {
    id,
  });
  const existing = (await db.listDocuments()).find(
    (d) =>
      !d.trashed &&
      d.cloudSource?.userId === result.userId &&
      d.cloudSource.documentId === id &&
      d.cloudSource.revision === result.document.revision,
  );
  if (existing && existing.name === result.document.name && existing.cloudSource?.savedModified === existing.modified) return existing.id;
  const response = await fetch(result.url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error('Download failed. Try again.');
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024 || (await blobHash(blob)) !== result.document.hash)
    throw new Error('The downloaded project is damaged.');
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 100 * 1024 * 1024) throw new Error('The project is too large to open.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const parsed = readProject(JSON.parse(await new Blob(chunks).text()), result.document.name);
  const copies = copiedVersionIds(parsed.versions);
  const candidate = {
    ...withCopiedVersions(parsed.doc, copies),
    id: result.document.id,
    name: result.document.name,
  };
  const localId = (await db.addDocumentIfAbsent(candidate)) ? candidate.id : await useDoc.getState().importDocument(candidate);
  await importVersions(localId, parsed.versions, false, copies);
  await db.markCloudCopy(localId, {
    userId: result.userId,
    documentId: id,
    revision: result.document.revision,
    savedModified: (await db.loadDocument(localId))?.modified,
    cloudModified: result.document.modified,
  });
  if (result.thumbnailUrl) {
    try {
      const image = await fetch(result.thumbnailUrl, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(10000),
      });
      const picture = await image.blob();
      if (image.ok && picture.size <= 1024 * 1024 && (await blobHash(picture)) === result.document.thumbnailHash) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(picture);
        });
        await db.saveThumbnail(localId, data);
      }
    } catch {
      /* A missing card image never prevents opening the model. */
    }
  }
  await useDoc.getState().loadList();
  return localId;
}

/** Explicitly detach a copy of a disk document into the managed library. */
export async function copyDocumentToLibrary(id: string): Promise<string> {
  const source = await db.loadDocument(id);
  if (!source) throw new Error('Document not found');
  const versions = await fileVersions(id),
    copies = copiedVersionIds(versions);
  const copy = await useDoc.getState().importDocument(withCopiedVersions(source, copies), await db.getThumbnail(id));
  await importVersions(copy, versions, false, copies);
  return copy;
}
