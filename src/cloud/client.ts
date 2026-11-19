import type { LibraryFolder } from '../store/library';
import type { DocumentSummary } from '../core/types';
import * as db from '../store/persistence';
import { useDoc } from '../store/docStore';
import { projectText, readProject } from '../store/folderStore';
import { withCloudUploadLock, recordCloudUploadTime } from './uploadLock';
import { useCloudSync } from './syncState';
import { putCloudObject } from './uploadProgress';
import { fileVersions, importVersions, copiedVersionIds, withCopiedVersions } from '../store/versions';

const API = 'https://api.cad.ya-erm.ru';
export interface CloudDocument {
  uploadedAt?: number;
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
export async function cloudRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
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
  cloudRequest<{ document: CloudDocument }>('/cloud/document', { id: doc.id, revision: doc.revision, modified: doc.modified, folderId });

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
  await withCloudUploadLock(async () => {
    const source = summary.cloudSource;
    let locals = [summary];
    if (source) {
      const remote = await listCloud();
      if (remote.userId !== source.userId) throw new Error('Connect to organise cloud documents.');
      const doc = remote.documents.find((d) => d.id === source.documentId);
      if (!doc) throw new Error('Document not found');
      const changed = await cloudRequest<{ document: CloudDocument }>('/cloud/document', {
        id: doc.id,
        revision: doc.revision,
        modified: doc.modified,
        folderId: doc.folderId,
        trashed,
        expectedUserId: source.userId,
      });
      locals = (await db.listDocuments()).filter(
        (d) => d.cloudSource?.userId === source.userId && d.cloudSource.documentId === source.documentId,
      );
      for (const local of locals) {
        const baseline = local.cloudSource!;
        if (baseline.revision === changed.document.revision && (baseline.cloudModified ?? 0) <= changed.document.modified)
          await db.compareCloudSummary(local, { cloudSource: { ...baseline, cloudModified: changed.document.modified } }, () => true);
      }
    }
    for (const local of locals) await (trashed ? useDoc.getState().trashDocument(local.id) : useDoc.getState().restoreDocument(local.id));
  });
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
  automatic?: boolean;
  expectedUserId?: string;
  signal?: AbortSignal;
  lockHeld?: boolean;
}
type PendingUpload = {
  uploadId: string;
  userId: string;
  documentId: string;
  name: string;
  folderId: string;
  hash: string;
  savedModified: number;
  savedVersionsModified: number;
  savedName: string;
  savedFolderId: string;
};
const pendingKey = (id: string) => 'webcad.cloudPending.' + id;
function readPending(id: string): PendingUpload | null {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(id)) ?? 'null');
  } catch {
    return null;
  }
}
function rememberPending(id: string, value: PendingUpload | null) {
  try {
    if (value) localStorage.setItem(pendingKey(id), JSON.stringify(value));
    else localStorage.removeItem(pendingKey(id));
  } catch {
    /* Hash/CAS recovery still protects an upload when persistence is restricted. */
  }
}
async function acknowledgeUpload(id: string, pending: PendingUpload, document: CloudDocument) {
  if (
    document.id !== pending.documentId ||
    document.revision !== pending.uploadId ||
    document.hash !== pending.hash ||
    document.name !== pending.name ||
    document.folderId !== pending.folderId
  )
    throw new CloudFailure('revision_conflict', 409);
  await db.markCloudCopy(id, {
    userId: pending.userId,
    documentId: document.id,
    revision: document.revision,
    savedModified: pending.savedModified,
    cloudModified: document.modified,
    savedVersionsModified: pending.savedVersionsModified,
    savedName: pending.savedName,
    savedFolderId: pending.savedFolderId,
  });
  const current = (await db.listDocuments()).find((d) => d.id === id);
  // A local first upload may have completed at the same instant the user moved it to the trash.
  if ((!current || current.trashed) && useCloudSync.getState().accountId === pending.userId) {
    const changed = await cloudRequest<{ document: CloudDocument }>('/cloud/document', {
      id: document.id,
      revision: document.revision,
      modified: document.modified,
      folderId: document.folderId,
      trashed: true,
      expectedUserId: pending.userId,
    });
    Object.assign(document, changed.document);
    if (current) await db.markCloudCopy(id, { ...current.cloudSource!, cloudModified: changed.document.modified });
  }
  if ((current && !current.trashed) || useCloudSync.getState().accountId === pending.userId) rememberPending(id, null);
  await useDoc.getState().loadList();
}
export const pendingCloudUploads = (userId: string): string[] => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('webcad.cloudPending.')) {
        const id = key.slice('webcad.cloudPending.'.length);
        if (readPending(id)?.userId === userId) ids.push(id);
      }
    }
  } catch {
    /* Ordinary local rows are still inspected. */
  }
  return ids;
};
export const hasPendingCloudUpload = (id: string, userId: string) => readPending(id)?.userId === userId;
/** Recover a committed immutable snapshot before classifying a new remote revision as a conflict. */
export async function recoverCloudAcknowledgement(id: string, remote: CloudDocument, userId: string): Promise<boolean> {
  const pending = readPending(id);
  if (
    !pending ||
    pending.userId !== userId ||
    pending.documentId !== remote.id ||
    pending.uploadId !== remote.revision ||
    pending.hash !== remote.hash ||
    pending.name !== remote.name ||
    pending.folderId !== remote.folderId
  )
    return false;
  await acknowledgeUpload(id, pending, remote);
  return true;
}
export async function uploadCloudDocument(
  summary: DocumentSummary,
  folderId: string,
  asCopy = false,
  expectedRevision?: string,
  expectedModified?: number,
  options: UploadOptions = {},
): Promise<CloudDocument> {
  if (!options.lockHeld) {
    const result = await withCloudUploadLock(
      (signal) =>
        uploadCloudDocument(summary, folderId, asCopy, expectedRevision, expectedModified, { ...options, signal, lockHeld: true }),
      { signal: options.signal },
    );
    if (!result) throw new Error('Cloud upload is busy.');
    return result;
  }
  let uploadOwner = options.expectedUserId ?? useCloudSync.getState().accountId;
  try {
    options.signal?.throwIfAborted();
    options.onProgress?.({ phase: 'preparing', loaded: 0, total: 0 });
    if (!options.automatic && useDoc.getState().doc?.id === summary.id) {
      await useDoc.getState().flushSave();
      if (useDoc.getState().saveError) throw new Error('Save your changes before uploading.');
    }
    const snapshot = await db.cloudUploadSnapshot(summary.id),
      doc = snapshot.doc,
      local = snapshot.summary;
    if (local.trashed) throw new CloudFailure('document_trashed', 409);
    if (options.expectedUserId && local.cloudSource && local.cloudSource.userId !== options.expectedUserId)
      throw new CloudFailure('account_changed', 409);
    const pending = asCopy ? null : readPending(summary.id);
    if (pending && (!options.expectedUserId || pending.userId === options.expectedUserId)) {
      uploadOwner = pending.userId;
      try {
        options.onProgress?.({ phase: 'committing', loaded: 0, total: 0 });
        const recovered = await cloudRequest<{ document: CloudDocument }>(
          '/cloud/commit',
          { uploadId: pending.uploadId, expectedUserId: pending.userId },
          options.signal,
        );
        await acknowledgeUpload(summary.id, pending, recovered.document);
        return recovered.document;
      } catch (error) {
        if (!(error instanceof CloudFailure) || ![404, 409].includes(error.status)) throw error;
        if (error.code === 'revision_conflict') {
          rememberPending(summary.id, null);
          throw error;
        }
        rememberPending(summary.id, null);
      }
    }
    if (!asCopy && local.cloudSource?.revision && local.cloudSource.cloudModified === undefined && expectedModified === undefined)
      throw new Error('Confirm updating the existing cloud version.');
    const source = { ...doc, id: asCopy ? crypto.randomUUID() : (local.cloudSource?.documentId ?? doc.id) };
    const text = projectText(source, snapshot.versions);
    if (new Blob([text]).size > 100 * 1024 * 1024) throw new Error('The project is too large to upload.');
    const compressed = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const thumbnail = await cloudThumbnail(local.thumbnail).catch(() => null);
    if (compressed.size > 20 * 1024 * 1024 || (thumbnail?.size ?? 0) > 1024 * 1024) throw new Error('The project is too large to upload.');
    const hash = await blobHash(compressed),
      thumbnailHash = thumbnail ? await blobHash(thumbnail) : '';
    options.signal?.throwIfAborted();
    const prepared = await cloudRequest<{ userId: string; uploadId: string; projectUrl: string; thumbnailUrl: string | null }>(
      '/cloud/prepare',
      {
        documentId: source.id,
        name: source.name,
        folderId,
        expectedRevision: asCopy ? '' : (expectedRevision ?? local.cloudSource?.revision ?? ''),
        expectedModified: asCopy ? undefined : (expectedModified ?? local.cloudSource?.cloudModified),
        size: compressed.size,
        thumbnailSize: thumbnail?.size ?? 0,
        hash,
        thumbnailHash,
        auto: options.automatic ?? false,
        ...(options.expectedUserId ? { expectedUserId: options.expectedUserId } : {}),
      },
      options.signal,
    );
    uploadOwner = prepared.userId;
    if (options.expectedUserId && prepared.userId !== options.expectedUserId) throw new CloudFailure('account_changed', 409);
    options.signal?.throwIfAborted();
    const record: PendingUpload = {
      uploadId: prepared.uploadId,
      userId: prepared.userId,
      documentId: source.id,
      name: source.name,
      folderId,
      hash,
      savedModified: doc.modified,
      savedVersionsModified: local.versionsModified ?? 0,
      savedName: local.name,
      savedFolderId: local.folderId ?? '',
    };
    if (!asCopy) rememberPending(summary.id, record);
    const total = compressed.size + (thumbnail?.size ?? 0);
    let uploaded = 0;
    options.onProgress?.({ phase: 'uploading', loaded: 0, total });
    const put = async (url: string, body: Blob) => {
      if (options.onProgress) {
        await putCloudObject(
          url,
          body,
          (loaded) => options.onProgress!({ phase: 'uploading', loaded: uploaded + loaded, total }),
          options.signal,
        );
        uploaded += body.size;
        return;
      }
      const response = await fetch(url, {
        method: 'PUT',
        body,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error('Upload failed. Your local document is safe.');
    };
    await put(prepared.projectUrl, compressed);
    if (thumbnail && prepared.thumbnailUrl) await put(prepared.thumbnailUrl, thumbnail);
    const latest = (await db.listDocuments()).find((d) => d.id === summary.id);
    if (!latest || latest.trashed) throw new CloudFailure('document_trashed', 409);
    options.signal?.throwIfAborted();
    options.onProgress?.({ phase: 'committing', loaded: total, total });
    const result = await cloudRequest<{ document: CloudDocument }>(
      '/cloud/commit',
      { uploadId: prepared.uploadId, expectedUserId: options.expectedUserId ?? prepared.userId },
      options.signal,
    );
    // A confirmed server commit is acknowledged even if pause/logout arrives just after its response.
    if (!asCopy) await acknowledgeUpload(summary.id, record, result.document);
    return result.document;
  } finally {
    if (uploadOwner) recordCloudUploadTime(uploadOwner, Date.now());
  }
}

export async function downloadCloudSnapshot(id: string, signal?: AbortSignal, expectedUserId?: string) {
  const result = await cloudRequest<{ userId: string; document: CloudDocument; url: string; thumbnailUrl: string | null }>(
    '/cloud/open',
    { id, ...(expectedUserId ? { expectedUserId } : {}) },
    signal,
  );
  if (expectedUserId && result.userId !== expectedUserId) throw new CloudFailure('account_changed', 409);
  const response = await fetch(result.url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error('Download failed. Try again.');
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024 || (await blobHash(blob)) !== result.document.hash)
    throw new Error('The downloaded project is damaged.');
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
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
  return { ...parsed, document: result.document, userId: result.userId, thumbnailUrl: result.thumbnailUrl };
}

/** Cloud opening makes a local copy; changed local files and drafts are never replaced. */
export async function openCloudDocument(id: string): Promise<string> {
  const result = await cloudRequest<{ userId: string; document: CloudDocument; url: string; thumbnailUrl: string | null }>('/cloud/open', {
    id,
  });
  const existing = (await db.listDocuments()).find(
    (d) =>
      !d.trashed &&
      d.cloudSource?.userId === result.userId &&
      d.cloudSource.documentId === id &&
      d.cloudSource.revision === result.document.revision,
  );
  if (
    existing &&
    existing.name === result.document.name &&
    existing.cloudSource?.savedModified === existing.modified &&
    (existing.versionsModified ?? 0) === (existing.cloudSource.savedVersionsModified ?? 0)
  )
    return existing.id;
  const response = await fetch(result.url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(120000) });
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
  const candidate = { ...withCopiedVersions(parsed.doc, copies), id: result.document.id, name: result.document.name };
  const localId = (await db.addDocumentIfAbsent(candidate)) ? candidate.id : await useDoc.getState().importDocument(candidate);
  await importVersions(localId, parsed.versions, false, copies);
  const importedSummary = (await db.listDocuments()).find((d) => d.id === localId);
  await db.markCloudCopy(localId, {
    savedVersionsModified: importedSummary?.versionsModified ?? 0,
    savedName: result.document.name,
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
