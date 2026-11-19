import type { DocumentSummary } from '../core/types';
import { useDoc } from '../store/docStore';
import { useFolder } from '../store/folderStore';
import { useVersions, copiedVersionIds, withCopiedVersions } from '../store/versions';
import * as db from '../store/persistence';
import { folderTrail } from '../store/library';
import {
  CloudFailure,
  cloudRequest,
  uploadCloudDocument,
  type CloudList,
  downloadCloudSnapshot,
  recoverCloudAcknowledgement,
  hasPendingCloudUpload,
  pendingCloudUploads,
} from './client';
import { unifiedLibrary } from './library';
import { useCloudSync } from './syncState';
import { SyncQueue, dirtyDocument, SYNC_POLL_INTERVAL, SYNC_GLOBAL_INTERVAL, SYNC_MAX_WAIT } from './syncCore';
import { withCloudUploadLock, cloudUploadSlotAvailable } from './uploadLock';
const publish = (remote: CloudList) => window.dispatchEvent(new CustomEvent('webcad:cloud-changed', { detail: remote }));
function runtime() {
  let stopped = false,
    running = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    timerDue: number | undefined,
    account: string | null = null,
    queue = new SyncQueue();
  let remote: CloudList | null = null,
    lastPoll = 0,
    pollRetryAt = 0,
    pollFailures = 0,
    controller = new AbortController();
  const remoteSeen = new Map<string, string>();
  const thumbnails = new Map<
    string,
    {
      revision: string;
      hash: string;
      url: string | null | undefined;
      at: number;
    }
  >();
  let unsavedSince = 0;
  const signature = (value: CloudList) => JSON.stringify({ ...value, documents: value.documents.map(({ thumbnailUrl, ...d }) => d) });
  const wake = (delay = 100) => {
    if (stopped || running) return;
    const due = Date.now() + delay;
    if (timer && timerDue !== undefined && timerDue <= due) return;
    if (timer) clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(() => {
      timer = undefined;
      timerDue = undefined;
      void tick();
    }, delay);
  };
  const reset = () => {
    controller.abort();
    controller = new AbortController();
    remote = null;
    lastPoll = 0;
    pollRetryAt = 0;
    pollFailures = 0;
    queue = new SyncQueue();
    remoteSeen.clear();
    thumbnails.clear();
    unsavedSince = 0;
  };
  const authExpired = () => {
    useCloudSync.getState().setAccount(null);
    window.dispatchEvent(new Event('webcad:sync-auth-expired'));
    window.dispatchEvent(new Event('webcad:account-changed'));
  };
  const folderTarget = async (summary: DocumentSummary, signal: AbortSignal) => {
    const owner = account;
    if (!remote || !owner) throw new Error('Sign in to use cloud documents.');
    const local = await db.listLibraryFolders();
    signal.throwIfAborted();
    const merged = unifiedLibrary(local, [], remote);
    let parent = '';
    for (const folder of folderTrail(merged.folders, summary.folderId ?? '')) {
      const found =
        merged.folders.find((f) => f.id === folder.id)?.cloudId ??
        (folder.cloudSource?.userId === owner ? folder.cloudSource.folderId : undefined);
      if (found && remote.folders.some((f) => f.id === found)) {
        parent = found;
        continue;
      }
      const id = folder.id,
        now = Date.now();
      const response = await cloudRequest<{
        folder?: {
          id: string;
          name: string;
          parentId: string;
          created: number;
          modified: number;
        };
      }>('/cloud/folder', { id, name: folder.name, parentId: parent, modified: now, expectedUserId: owner }, signal);
      signal.throwIfAborted();
      if (!response.folder) throw new Error('Cloud is unavailable. Local documents are safe.');
      remote.folders.push(response.folder);
      parent = id;
      await db.rememberLibraryFolders(
        [{ ...folder, cloudSource: { userId: owner, folderId: id } }],
        {},
        () => !signal.aborted && useCloudSync.getState().accountId === owner,
      );
    }
    return parent;
  };
  const reconcile = async (locals: DocumentSummary[], signal: AbortSignal) => {
    const owner = account;
    if (!remote || !owner) return;
    const localFolders = await db.listLibraryFolders();
    signal.throwIfAborted();
    const merged = unifiedLibrary(localFolders, locals, remote);
    await db.rememberLibraryFolders(
      merged.folders.map(({ cloudId, ...f }) => ({ ...f, ...(cloudId ? { cloudSource: { userId: owner, folderId: cloudId } } : {}) })),
      {},
      () => !signal.aborted && useCloudSync.getState().accountId === owner,
    );
    const changed: string[] = [];
    const allowed = () => !signal.aborted && useCloudSync.getState().accountId === owner && useCloudSync.getState().enabled;
    const recoveredIds = new Set<string>();
    // Also revisit committed uploads of documents deleted locally during PUT.
    const recoveryIds = new Set([
      ...pendingCloudUploads(owner),
      ...locals.filter((local) => hasPendingCloudUpload(local.id, owner)).map((local) => local.id),
    ]);
    for (const id of recoveryIds) {
      signal.throwIfAborted();
      const recovered = await withCloudUploadLock(
        async () => {
          for (const cloud of remote!.documents) if (await recoverCloudAcknowledgement(id, cloud, owner)) return true;
          return false;
        },
        { signal, ifAvailable: true },
      );
      if (recovered) recoveredIds.add(id);
    }
    for (const local of locals) {
      signal.throwIfAborted();
      if (recoveredIds.has(local.id)) continue;
      const source = local.cloudSource;
      if (!source || source.userId !== owner) continue;
      let cloud = remote.documents.find((d) => d.id === source.documentId);
      if (!cloud) continue;
      if ((source.cloudModified ?? 0) > cloud.modified) {
        lastPoll = 0;
        continue;
      }
      if (cloud.trashed) {
        if (dirtyDocument(local)) {
          queue.failed(local, 'conflict', Date.now());
        } else if (!local.trashed && useDoc.getState().doc?.id !== local.id)
          await db.compareCloudSummary(local, { trashed: cloud.trashed }, () => allowed() && useDoc.getState().doc?.id !== local.id);
        continue;
      }
      if (local.trashed) continue;
      const grouped = merged.documents.find((d) => d.locals.some((l) => l.id === local.id));
      let folderId = grouped?.folderId ?? local.folderId ?? '';
      const contentDirty = source.savedModified !== local.modified || (local.versionsModified ?? 0) !== (source.savedVersionsModified ?? 0);
      if (!contentDirty && cloud.revision === source.revision && local.name === cloud.name && (local.folderId ?? '') === folderId) {
        if (source.savedName !== local.name || source.savedFolderId !== folderId || source.cloudModified !== cloud.modified)
          await db.compareCloudSummary(
            local,
            {
              cloudSource: {
                ...source,
                cloudModified: cloud.modified,
                savedName: local.name,
                savedFolderId: folderId,
                savedVersionsModified: local.versionsModified ?? 0,
              },
            },
            allowed,
          );
        continue;
      }
      const remoteChanged = cloud.revision !== source.revision || cloud.modified !== source.cloudModified;
      if (remoteChanged && dirtyDocument(local)) {
        queue.failed(local, 'conflict', Date.now());
        continue;
      }
      if (!remoteChanged) {
        if (!dirtyDocument(local) && source.savedName === undefined)
          await db.compareCloudSummary(
            local,
            {
              cloudSource: {
                ...source,
                savedName: local.name,
                savedFolderId: local.folderId ?? '',
                savedVersionsModified: local.versionsModified ?? 0,
              },
            },
            allowed,
          );
        continue;
      }
      if (useDoc.getState().doc?.id === local.id) {
        if (remoteSeen.get(local.id) !== cloud.revision + ':' + cloud.modified) changed.push(local.id);
        continue;
      }
      if (!dirtyDocument(local)) {
        const snapshot =
          cloud.revision === source.revision
            ? await db.cloudUploadSnapshot(local.id)
            : await downloadCloudSnapshot(cloud.id, signal, owner);
        if ('document' in snapshot) {
          cloud = snapshot.document;
          const index = remote.documents.findIndex((d) => d.id === cloud!.id);
          if (index >= 0) remote.documents[index] = { ...remote.documents[index], ...cloud };
          if (cloud.folderId && !remote.folders.some((f) => f.id === cloud!.folderId)) {
            lastPoll = 0;
            continue;
          }
          folderId =
            unifiedLibrary(localFolders, locals, remote).documents.find((d) => d.locals.some((l) => l.id === local.id))?.folderId ??
            folderId;
        }
        const copies = cloud.revision === source.revision ? null : copiedVersionIds(snapshot.versions);
        const candidate = {
          ...(copies ? withCopiedVersions(snapshot.doc, copies) : snapshot.doc),
          id: local.id,
          name: cloud.name,
          modified: cloud.modified,
        };
        const versions = copies
          ? snapshot.versions.map((v) => ({
              ...v,
              id: v.kind === 'workspace' ? v.id : (copies.get(v.id) ?? v.id),
              ...(v.base ? { base: copies.get(v.base) ?? v.base } : {}),
              tabs: withCopiedVersions({ ...candidate, tabs: v.tabs }, copies).tabs,
            }))
          : snapshot.versions;
        const incoming = {
          userId: owner,
          documentId: cloud.id,
          revision: cloud.revision,
          savedModified: candidate.modified,
          cloudModified: cloud.modified,
          savedName: cloud.name,
          savedFolderId: folderId,
          savedVersionsModified: local.versionsModified ?? 0,
        };
        await db.replaceCleanCloudDocument(
          local,
          candidate,
          versions,
          incoming,
          folderId,
          () =>
            !signal.aborted &&
            useCloudSync.getState().accountId === owner &&
            useCloudSync.getState().enabled &&
            useDoc.getState().doc?.id !== local.id,
        );
      }
    }
    useCloudSync.setState({ remoteChanges: changed });
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    const state = useCloudSync.getState();
    if (state.accountId !== account) {
      account = state.accountId;
      reset();
    }
    const signal = controller.signal;
    try {
      if (!account) {
        useCloudSync.setState({ phase: 'signed_out', pending: 0, currentDocId: null });
        return;
      }
      if (!state.enabled) {
        useCloudSync.setState({ phase: 'paused', currentDocId: null });
        return;
      }
      if (!navigator.onLine) {
        useCloudSync.setState({ phase: 'offline', currentDocId: null });
        return;
      }
      if (document.hidden) return;
      const owner = account;
      const open = useDoc.getState();
      if (open.doc && open.saving) {
        if (!unsavedSince) unsavedSince = Date.now();
        if (Date.now() - unsavedSince >= SYNC_MAX_WAIT) {
          await open.flushSave();
          unsavedSince = Date.now();
        }
      } else unsavedSince = 0;
      let locals = await db.listDocuments();
      if ((!remote || Date.now() - lastPoll >= SYNC_POLL_INTERVAL) && Date.now() >= pollRetryAt) {
        const fresh = await cloudRequest<CloudList>('/cloud/list', undefined, signal);
        signal.throwIfAborted();
        if (fresh.userId !== owner) throw new CloudFailure('account_changed', 409);
        const before = remote ? signature(remote) : '';
        let rotated = false;
        for (const doc of fresh.documents) {
          const cached = thumbnails.get(doc.id);
          if (cached && cached.hash === doc.thumbnailHash && cached.revision === doc.revision && Date.now() - cached.at < 480000)
            doc.thumbnailUrl = cached.url;
          else {
            rotated = rotated || !!cached;
            thumbnails.set(doc.id, { revision: doc.revision, hash: doc.thumbnailHash, url: doc.thumbnailUrl, at: Date.now() });
          }
        }
        remote = fresh;
        lastPoll = Date.now();
        pollFailures = 0;
        pollRetryAt = 0;
        await reconcile(locals, signal);
        locals = await db.listDocuments();
        signal.throwIfAborted();
        if (before !== signature(remote) || rotated) publish(remote);
      }
      signal.throwIfAborted();
      if (!remote) return;
      const diskIds = new Set(Object.keys(useFolder.getState().links));
      let work = queue.update(locals, owner, diskIds, Date.now());
      useCloudSync.setState({ pending: work.pending.length + work.conflicts.length, conflicts: work.conflicts });
      const candidate = queue.ready(work.pending, Date.now());
      if (!candidate) {
        useCloudSync.setState({
          phase: work.conflicts.length ? 'conflict' : queue.hasErrors() ? 'error' : work.pending.length ? 'waiting' : 'synced',
          currentDocId: null,
        });
        return;
      }
      await withCloudUploadLock(
        async (lockSignal) => {
          const joined = lockSignal ? AbortSignal.any([signal, lockSignal]) : signal;
          joined.throwIfAborted();
          if (!cloudUploadSlotAvailable(owner, Date.now(), SYNC_GLOBAL_INTERVAL)) return;
          if (useCloudSync.getState().accountId !== owner || !useCloudSync.getState().enabled || document.hidden) return;
          const saved = await db.listDocuments();
          const latestWork = queue.update(saved, owner, new Set(Object.keys(useFolder.getState().links)), Date.now());
          const fresh = queue.ready(latestWork.pending, Date.now());
          if (fresh?.id !== candidate.id) return;
          if (!fresh || fresh.trashed || useFolder.getState().links[fresh.id] || !dirtyDocument(fresh)) return;
          if (useDoc.getState().doc?.id === fresh.id && useDoc.getState().saveError) return;
          useCloudSync.setState({ phase: 'syncing', currentDocId: fresh.id, error: null });
          try {
            const target = await folderTarget(fresh, joined);
            const uploaded = await uploadCloudDocument(fresh, target, false, undefined, undefined, {
              automatic: true,
              expectedUserId: owner,
              signal: joined,
              lockHeld: true,
            });
            if (joined.aborted || useCloudSync.getState().accountId !== owner) return;
            queue.succeeded(fresh.id, Date.now());
            if (remote) {
              const index = remote.documents.findIndex((d) => d.id === uploaded.id),
                doc = { ...uploaded, ...(fresh.thumbnail ? { thumbnailUrl: fresh.thumbnail } : {}) };
              if (index < 0) remote.documents.push(doc);
              else remote.documents[index] = doc;
              publish(remote);
            }
            useCloudSync.setState({ lastSyncedAt: Date.now(), error: null });
          } catch (error) {
            if (joined.aborted) return;
            if (error instanceof CloudFailure && (error.status === 401 || error.code === 'account_changed')) {
              authExpired();
              return;
            }
            const conflict = error instanceof CloudFailure && error.status === 409;
            queue.failed(fresh, conflict ? 'conflict' : 'error', Date.now());
            useCloudSync.setState({
              phase: conflict ? 'conflict' : 'error',
              error: conflict
                ? 'Cloud changes need your attention.'
                : error instanceof CloudFailure && error.code === 'storage_cleanup_pending'
                  ? 'Cloud upload is paused until old snapshots are cleaned up.'
                  : error instanceof Error && !(error instanceof TypeError) && !(error instanceof CloudFailure)
                    ? error.message
                    : 'Cloud is unavailable. Local documents are safe.',
            });
          }
        },
        { signal, ifAvailable: true },
      );
    } catch (error) {
      if (signal.aborted || stopped) return;
      if (error instanceof CloudFailure && (error.status === 401 || error.message === 'account_changed')) authExpired();
      else {
        pollRetryAt = Date.now() + Math.min(300000, 15000 * 2 ** Math.min(pollFailures++, 5));
        useCloudSync.setState({ phase: navigator.onLine ? 'error' : 'offline', error: 'Cloud is unavailable. Local documents are safe.' });
      }
    } finally {
      running = false;
      wake(1000);
    }
  };
  const changed = (state: ReturnType<typeof useCloudSync.getState>, previous: ReturnType<typeof useCloudSync.getState>) => {
    if (state.accountId !== previous.accountId) {
      account = state.accountId;
      reset();
    } else if (!state.enabled) controller.abort();
    else if (!previous.enabled) controller = new AbortController();
    wake();
  };
  const visibility = () => {
    if (document.hidden) controller.abort();
    else {
      controller = new AbortController();
      wake();
    }
  };
  const online = () => {
    controller.abort();
    controller = new AbortController();
    lastPoll = 0;
    pollRetryAt = 0;
    wake();
  };
  const retry = (event: Event) => {
    const id = (event as CustomEvent<string | undefined>).detail;
    queue.retry(id);
    if (id && remote) {
      const local = useDoc.getState().docs.find((d) => d.id === id),
        cloud = remote.documents.find((d) => d.id === local?.cloudSource?.documentId);
      if (cloud) remoteSeen.set(id, cloud.revision + ':' + cloud.modified);
    }
    lastPoll = 0;
    pollRetryAt = 0;
    wake();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === 'webcad.cloudSync.enabled') useCloudSync.getState().setEnabled(event.newValue !== '0');
    wake();
  };
  const unsub = useCloudSync.subscribe(changed),
    unsubDoc = useDoc.subscribe(() => wake()),
    unsubVersions = useVersions.subscribe(() => wake()),
    unsubFolder = useFolder.subscribe(() => wake());
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', online);
  window.addEventListener('offline', online);
  window.addEventListener('storage', storage);
  window.addEventListener('webcad:sync-retry', retry);
  wake();
  return () => {
    stopped = true;
    controller.abort();
    if (timer) clearTimeout(timer);
    unsub();
    unsubDoc();
    unsubVersions();
    unsubFolder();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', online);
    window.removeEventListener('storage', storage);
    window.removeEventListener('webcad:sync-retry', retry);
  };
}
let running:
  | {
      stop: () => void;
      users: number;
    }
  | undefined;
export function startCloudSync(): () => void {
  if (!running) running = { stop: runtime(), users: 0 };
  const instance = running;
  instance.users++;
  return () => {
    if (--instance.users === 0) {
      instance.stop();
      if (running === instance) running = undefined;
    }
  };
}
