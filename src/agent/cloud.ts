// Agent cloud actions use the target tab's session; credentials and signed URLs never leave the tab.
import type { CadDocument, DocumentSummary } from '../core/types';
import { docId } from '../core/ids';
import * as db from '../store/persistence';
import { useDoc } from '../store/docStore';
import { projectText, readProject, useFolder } from '../store/folderStore';
import { copiedVersionIds, importVersions, withCopiedVersions } from '../store/versions';
import { folderTrail, type LibraryFolder } from '../store/library';
import {
  cloudRequest,
  listCloud,
  downloadCloudSnapshot,
  openCloudDocument,
  uploadCloudDocument,
  type CloudDocument,
  type CloudList,
} from '../cloud/client';
import { useCloudSync } from '../cloud/syncState';
import { withCloudUploadLock } from '../cloud/uploadLock';
import { dirtyDocument } from '../cloud/syncCore';

const MAX_WAIT = 120000;
type Account = { id: string; displayName: string };
type Session = { account: Account; signal: AbortSignal; guard(): void };
export interface CloudUploadOptions {
  folderId?: string;
  asCopy?: boolean;
  expectedRevision?: string;
  expectedModified?: number;
}
export interface CloudSyncOptions {
  enabled?: boolean;
  retry?: boolean;
  waitMs?: number;
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
function id(value: unknown, label: string, root = false): asserts value is string {
  if (!(root && value === '') && !validId(value)) throw new Error(`${label} must be a valid id${root ? ' or an empty root id' : ''}.`);
}
function optionsObject(value: unknown, keys: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('Invalid cloud options.');
}
function uploadOptions(value: CloudUploadOptions): void {
  optionsObject(value, ['folderId', 'asCopy', 'expectedRevision', 'expectedModified']);
  if (value.folderId !== undefined) id(value.folderId, 'folderId', true);
  if (value.asCopy !== undefined && typeof value.asCopy !== 'boolean') throw new Error('asCopy must be a boolean.');
  if (value.expectedRevision !== undefined) id(value.expectedRevision, 'expectedRevision');
  if (value.expectedModified !== undefined && (!Number.isSafeInteger(value.expectedModified) || value.expectedModified < 0))
    throw new Error('expectedModified must be a non-negative timestamp.');
  if ((value.expectedRevision === undefined) !== (value.expectedModified === undefined))
    throw new Error('Supply expectedRevision and expectedModified together.');
  if (value.asCopy && value.expectedRevision !== undefined) throw new Error('A separate copy cannot replace an existing revision.');
}
function safeError(error: unknown): string | null {
  if (typeof error !== 'string' || !error) return null;
  return /https?:\/\//i.test(error) ? 'Cloud operation failed. Local documents are safe.' : error;
}
function publish(data: CloudList): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('webcad:cloud-changed', { detail: data }));
}
function safeDocument(document: CloudDocument) {
  return {
    id: document.id,
    name: document.name,
    folderId: document.folderId,
    revision: document.revision,
    created: document.created,
    modified: document.modified,
    size: document.size,
    thumbnailSize: document.thumbnailSize,
    hash: document.hash,
    thumbnailHash: document.thumbnailHash,
    ...(document.trashed ? { trashed: document.trashed } : {}),
    ...(document.uploadedAt !== undefined ? { uploadedAt: document.uploadedAt } : {}),
  };
}
const safeFolder = (folder: LibraryFolder) => ({
  id: folder.id,
  name: folder.name,
  parentId: folder.parentId,
  created: folder.created,
  modified: folder.modified,
});
function stateSnapshot(account: Account | null) {
  const state = useCloudSync.getState(),
    error = safeError(state.error);
  return {
    enabled: state.enabled,
    phase: state.phase,
    pending: state.pending,
    currentDocId: state.currentDocId,
    lastSyncedAt: state.lastSyncedAt,
    error,
    errors: error ? [error] : [],
    conflicts: [...state.conflicts],
    remoteChanges: [...state.remoteChanges],
    account,
  };
}
async function sessionAccount(signal?: AbortSignal): Promise<Account | null> {
  const result = await cloudRequest<{ user: null | { id: string; displayName: string } }>('/auth/session', undefined, signal);
  if (result.user === null) return null;
  if (!validId(result.user?.id) || typeof result.user.displayName !== 'string') throw new Error('Invalid account response.');
  return { id: result.user.id, displayName: result.user.displayName };
}
async function withSession<T>(operation: (session: Session) => Promise<T>): Promise<T> {
  const controller = new AbortController(),
    initial = useCloudSync.getState().accountId;
  const unsubscribe = useCloudSync.subscribe((next, previous) => {
    if (next.accountId !== previous.accountId) controller.abort();
  });
  try {
    const account = await sessionAccount(controller.signal);
    if (!account) throw new Error('Sign in on the target WebCAD tab to use cloud documents.');
    const guard = () => {
      controller.signal.throwIfAborted();
      if (initial !== account.id || useCloudSync.getState().accountId !== account.id)
        throw new Error('The account changed or is not ready. Try again on the signed-in tab.');
    };
    guard();
    return await operation({ account, signal: controller.signal, guard });
  } finally {
    unsubscribe();
  }
}
function laneSession(session: Session, signal?: AbortSignal): Session {
  return {
    ...session,
    signal: signal ?? session.signal,
    guard: () => {
      session.guard();
      signal?.throwIfAborted();
    },
  };
}
async function remoteList(session: Session): Promise<CloudList> {
  const data = await listCloud();
  session.guard();
  if (data.userId !== session.account.id) throw new Error('The account changed. Try again on the signed-in tab.');
  return data;
}
export async function cloudStatus() {
  const account = await sessionAccount();
  return stateSnapshot(account);
}
export async function cloudList() {
  return withSession(async (session) => {
    const data = await remoteList(session);
    return { userId: data.userId, folders: data.folders.map(safeFolder), documents: data.documents.map(safeDocument) };
  });
}
async function selectedDocument(value?: string): Promise<DocumentSummary> {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 512))
    throw new Error('Document id or name must be a non-empty string.');
  const docs = (await db.listDocuments()).filter((document) => !document.trashed);
  if (value === undefined) {
    const current = useDoc.getState().doc?.id;
    const found = docs.find((document) => document.id === current);
    if (!found) throw new Error('Open a document or supply its id or unique name.');
    return found;
  }
  const exact = docs.find((document) => document.id === value);
  if (exact) return exact;
  const matches = docs.filter((document) => document.name === value);
  if (matches.length > 1) throw new Error('Ambiguous document name. Supply the document id.');
  if (!matches.length) throw new Error('Document not found.');
  return matches[0];
}
function folderName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\\/\u0000-\u001f]/.test(name))
    throw new Error('Invalid folder name.');
}
async function createFolder(session: Session, name: string, parentId: string, data: CloudList): Promise<LibraryFolder> {
  session.guard();
  if (parentId && !data.folders.some((folder) => folder.id === parentId)) throw new Error('Destination folder not found.');
  const existing = data.folders.find(
    (folder) => folder.parentId === parentId && folder.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  if (existing) return existing;
  const result = await cloudRequest<{ folder: LibraryFolder }>(
    '/cloud/folder',
    { id: crypto.randomUUID(), name: name.trim(), parentId, expectedUserId: session.account.id },
    session.signal,
  );
  session.guard();
  if (!result.folder || !validId(result.folder.id) || result.folder.parentId !== parentId || result.folder.name !== name.trim())
    throw new Error('Invalid cloud folder response.');
  data.folders.push(result.folder);
  publish(data);
  return result.folder;
}
async function destination(session: Session, summary: DocumentSummary, options: CloudUploadOptions, data: CloudList): Promise<string> {
  if (options.folderId !== undefined) {
    if (options.folderId && !data.folders.some((folder) => folder.id === options.folderId))
      throw new Error('Destination folder not found.');
    return options.folderId;
  }
  const connected = summary.cloudSource && data.documents.find((document) => document.id === summary.cloudSource!.documentId);
  if (connected) return connected.folderId;
  const folders = await db.listLibraryFolders();
  session.guard();
  const trail = folderTrail(folders, summary.folderId ?? '');
  for (const folder of trail) folderName(folder.name);
  let parent = '';
  for (const folder of trail) {
    const linked =
      folder.cloudSource?.userId === session.account.id && data.folders.find((remote) => remote.id === folder.cloudSource!.folderId);
    const canonical = linked || (await createFolder(session, folder.name, parent, data));
    session.guard();
    await db.rememberLibraryFolders(
      [{ ...folder, cloudSource: { userId: session.account.id, folderId: canonical.id } }],
      {},
      () => !session.signal.aborted && useCloudSync.getState().accountId === session.account.id,
    );
    parent = canonical.id;
  }
  return parent;
}
async function upload(session: Session, summary: DocumentSummary, options: CloudUploadOptions, lockHeld = false) {
  if (summary.cloudSource && summary.cloudSource.userId !== session.account.id)
    throw new Error('This local copy belongs to another cloud account. Make an independent local copy first.');
  const execute = async (signal?: AbortSignal) => {
    const active = laneSession(session, signal);
    active.guard();
    const data = await remoteList(active),
      target = await destination(active, summary, options, data);
    active.guard();
    const document = await uploadCloudDocument(
      summary,
      target,
      options.asCopy ?? false,
      options.expectedRevision,
      options.expectedModified,
      { expectedUserId: active.account.id, signal: active.signal, lockHeld: true },
    );
    active.guard();
    const previous = data.documents.find((entry) => entry.id === document.id);
    const canonical = {
      ...document,
      ...(previous?.thumbnailHash === document.thumbnailHash ? { thumbnailUrl: previous?.thumbnailUrl } : {}),
    };
    data.documents = [...data.documents.filter((entry) => entry.id !== document.id), canonical];
    publish(data);
    return { localId: summary.id, document: safeDocument(document) };
  };
  const result = lockHeld ? await execute(session.signal) : await withCloudUploadLock(execute, { signal: session.signal });
  if (!result) throw new Error('Cloud upload is busy.');
  return result;
}
export async function cloudUpload(idOrName?: string, options: CloudUploadOptions = {}) {
  uploadOptions(options);
  if (idOrName !== undefined && (typeof idOrName !== 'string' || !idOrName.trim()))
    throw new Error('Document id or name must be a non-empty string.');
  return withSession(async (session) => {
    const summary = await selectedDocument(idOrName);
    session.guard();
    return upload(session, summary, options);
  });
}
export async function cloudDownload(cloudId: string) {
  id(cloudId, 'cloudId');
  return withSession(async (session) => {
    const snapshot = await downloadCloudSnapshot(cloudId, session.signal, session.account.id);
    session.guard();
    const text = projectText(
        { ...snapshot.doc, id: snapshot.document.id, name: snapshot.document.name },
        snapshot.versions,
        snapshot.thumbnail,
      ),
      bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const fileName = (snapshot.document.name.replace(/[\\/\u0000-\u001f]/g, '_').trim() || 'document') + '.webcad.json';
    return { fileName, mime: 'application/json', base64: btoa(binary) };
  });
}
export async function cloudOpen(cloudId: string) {
  id(cloudId, 'cloudId');
  return withSession(async (session) => {
    const result = await withCloudUploadLock(
      async (lockSignal) => {
        const active = laneSession(session, lockSignal);
        active.guard();
        const localId = await openCloudDocument(cloudId, { expectedUserId: active.account.id, signal: active.signal });
        active.guard();
        const local = (await db.listDocuments()).find((document) => document.id === localId);
        active.guard();
        if (!local?.cloudSource || local.cloudSource.userId !== active.account.id)
          throw new Error('The downloaded document is unavailable.');
        return {
          localId,
          document: { id: cloudId, name: local.name, revision: local.cloudSource.revision, modified: local.cloudSource.cloudModified },
        };
      },
      { signal: session.signal },
    );
    if (!result) throw new Error('Cloud upload is busy.');
    return result;
  });
}
export async function cloudUploadFile(raw: unknown, options: { folderId?: string } = {}) {
  optionsObject(options, ['folderId']);
  if (options.folderId !== undefined) id(options.folderId, 'folderId', true);
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    throw new Error('Invalid project file.');
  }
  if (typeof text !== 'string' || new Blob([text]).size > 100 * 1024 * 1024) throw new Error('Invalid or oversized project file.');
  const parsed = readProject(raw, 'Imported project');
  if (
    typeof parsed.doc.name !== 'string' ||
    !Number.isFinite(parsed.doc.created) ||
    !Number.isFinite(parsed.doc.modified) ||
    !parsed.doc.units ||
    typeof parsed.doc.units !== 'object'
  )
    throw new Error('Invalid project file.');
  for (const version of parsed.versions)
    if (!version || typeof version.id !== 'string' || !version.id || !Array.isArray(version.tabs) || !version.units)
      throw new Error('Invalid project version.');
  return withSession(async (session) => {
    const result = await withCloudUploadLock(
      async (lockSignal) => {
        const active = laneSession(session, lockSignal);
        const data = await remoteList(active);
        if (options.folderId && !data.folders.some((folder) => folder.id === options.folderId))
          throw new Error('Destination folder not found.');
        active.guard();
        const copies = copiedVersionIds(parsed.versions),
          now = Date.now();
        const candidate: CadDocument = { ...withCopiedVersions(parsed.doc, copies), id: docId(), created: now, modified: now };
        // addDocumentIfAbsent avoids overwriting anything even on the unlikely id collision.
        while (!(await db.addDocumentIfAbsent(candidate))) {
          active.guard();
          candidate.id = docId();
        }
        await db.markCloudCopy(candidate.id, { userId: active.account.id, documentId: candidate.id, revision: '' });
        try {
          // Complete the independent local copy before any network upload; it remains recoverable on failure.
          if (parsed.thumbnail) await db.saveThumbnail(candidate.id, parsed.thumbnail);
          await importVersions(candidate.id, parsed.versions, false, copies);
          await useDoc.getState().loadList();
          active.guard();
          const summary = (await db.listDocuments()).find((document) => document.id === candidate.id);
          if (!summary) throw new Error('Imported document not found.');
          return await upload(active, summary, options, true);
        } catch (error) {
          throw new Error(
            `Cloud upload failed. Local copy ${candidate.id} is preserved. ${safeError(error instanceof Error ? error.message : '') ?? ''}`.trim(),
          );
        }
      },
      { signal: session.signal },
    );
    if (!result) throw new Error('Cloud upload is busy.');
    return result;
  });
}
export async function cloudSync(options: CloudSyncOptions = {}) {
  optionsObject(options, ['enabled', 'retry', 'waitMs']);
  for (const field of ['enabled', 'retry'] as const)
    if (options[field] !== undefined && typeof options[field] !== 'boolean') throw new Error(`${field} must be a boolean.`);
  const waitMs = options.waitMs ?? 0;
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT) throw new Error('waitMs must be between 0 and 120000.');
  return withSession(async (session) => {
    if (options.enabled !== undefined) useCloudSync.getState().setEnabled(options.enabled);
    if (options.retry !== false) useCloudSync.getState().retry();
    const started = Date.now();
    let lastSavedCheck = -Infinity,
      persistedDirty = true;
    const complete = async () => {
      const state = useCloudSync.getState();
      if (!state.enabled || state.phase !== 'synced' || state.pending || state.conflicts.length || state.remoteChanges.length) return false;
      if (Date.now() - lastSavedCheck >= 500) {
        const docs = await db.listDocuments();
        session.guard();
        const links = useFolder.getState().links;
        persistedDirty = docs.some(
          (doc) =>
            !doc.trashed && !links[doc.id] && (!doc.cloudSource || doc.cloudSource.userId === session.account.id) && dirtyDocument(doc),
        );
        lastSavedCheck = Date.now();
      }
      return !persistedDirty;
    };
    let completed = await complete();
    while (waitMs && useCloudSync.getState().enabled && !completed && Date.now() - started < waitMs) {
      session.guard();
      if (useCloudSync.getState().conflicts.length || useCloudSync.getState().phase === 'offline') break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, waitMs - (Date.now() - started))));
      completed = await complete();
    }
    session.guard();
    return { ...stateSnapshot(session.account), completed };
  });
}
export async function cloudCreateFolder(name: string, parentId = '') {
  folderName(name);
  id(parentId, 'parentId', true);
  return withSession(async (session) => safeFolder(await createFolder(session, name, parentId, await remoteList(session))));
}
