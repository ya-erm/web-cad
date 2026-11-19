import type { DocumentSummary } from '../core/types';
export const SYNC_IDLE = 30000;
export const SYNC_DOCUMENT_INTERVAL = 60000;
export const SYNC_GLOBAL_INTERVAL = 15000;
export const SYNC_POLL_INTERVAL = 60000;
export const SYNC_MAX_WAIT = 120000;
export type SyncProblem = 'conflict' | 'error';
export const cloudBaseline = (doc: DocumentSummary) => `${doc.cloudSource?.revision ?? ''}:${doc.cloudSource?.cloudModified ?? ''}`;
export const dirtyDocument = (doc: DocumentSummary) =>
  !doc.cloudSource ||
  doc.cloudSource.savedModified !== doc.modified ||
  (doc.versionsModified ?? 0) !== (doc.cloudSource.savedVersionsModified ?? 0) ||
  (doc.cloudSource.savedName !== undefined && doc.cloudSource.savedName !== doc.name) ||
  (doc.cloudSource.savedFolderId !== undefined && doc.cloudSource.savedFolderId !== (doc.folderId ?? ''));
/** Scheduling contains no I/O: every pending change is recoverable from persisted summaries. */
export class SyncQueue {
  private seen = new Map<
    string,
    {
      fingerprint: string;
      first: number;
      due: number;
    }
  >();
  private retryAt = new Map<string, number>();
  private failures = new Map<string, number>();
  private blocks = new Map<
    string,
    {
      baseline: string;
      kind: SyncProblem;
    }
  >();
  private last = new Map<string, number>();
  private globalLast = 0;
  private idle: number;
  private interval: number;
  private globalInterval: number;
  constructor(idle = SYNC_IDLE, interval = SYNC_DOCUMENT_INTERVAL, globalInterval = SYNC_GLOBAL_INTERVAL) {
    this.idle = idle;
    this.interval = interval;
    this.globalInterval = globalInterval;
  }
  update(docs: DocumentSummary[], user: string, diskIds: Set<string>, now: number) {
    const candidates = docs.filter((d) => !d.trashed && !diskIds.has(d.id) && (!d.cloudSource || d.cloudSource.userId === user));
    const groups = new Map<string, DocumentSummary[]>();
    for (const doc of candidates) {
      const key = doc.cloudSource?.documentId ?? doc.id;
      groups.set(key, [...(groups.get(key) ?? []), doc]);
    }
    const pending: DocumentSummary[] = [];
    const conflicts: string[] = [];
    for (const group of groups.values()) {
      const dirty = group.filter(dirtyDocument);
      if (dirty.length > 1) {
        conflicts.push(...dirty.map((d) => d.id));
        continue;
      }
      if (!dirty.length) continue;
      const doc = dirty[0],
        seen = this.seen.get(doc.id),
        block = this.blocks.get(doc.id);
      if (block && block.baseline !== cloudBaseline(doc)) this.blocks.delete(doc.id);
      const fingerprint = JSON.stringify([doc.modified, doc.versionsModified ?? 0, doc.name, doc.folderId ?? '']);
      if (!seen || seen.fingerprint !== fingerprint) {
        const first = seen?.first ?? now;
        this.seen.set(doc.id, {
          fingerprint,
          first,
          due: Math.min(Math.max(now, Math.max(doc.modified, doc.versionsModified ?? 0) + this.idle), first + SYNC_MAX_WAIT),
        });
      }
      if (this.blocks.get(doc.id)?.kind === 'conflict') {
        conflicts.push(doc.id);
        continue;
      }
      pending.push(doc);
    }
    const live = new Set(candidates.filter(dirtyDocument).map((d) => d.id));
    for (const key of this.seen.keys())
      if (!live.has(key)) {
        this.seen.delete(key);
        this.blocks.delete(key);
        this.retryAt.delete(key);
        this.failures.delete(key);
      }
    return { pending: pending.sort((a, b) => (this.seen.get(a.id)?.due ?? 0) - (this.seen.get(b.id)?.due ?? 0)), conflicts };
  }
  ready(docs: DocumentSummary[], now: number) {
    if (now < this.globalLast + this.globalInterval) return undefined;
    return docs.find(
      (d) =>
        now >=
        Math.max(
          this.seen.get(d.id)?.due ?? Infinity,
          this.retryAt.get(d.id) ?? 0,
          (this.last.get(d.id) ?? d.cloudSource?.cloudModified ?? 0) + this.interval,
        ),
    );
  }
  succeeded(id: string, now: number) {
    this.globalLast = now;
    this.last.set(id, now);
    this.failures.delete(id);
    this.retryAt.delete(id);
    this.blocks.delete(id);
  }
  failed(doc: DocumentSummary, kind: SyncProblem, now: number) {
    this.blocks.set(doc.id, { baseline: cloudBaseline(doc), kind });
    const n = (this.failures.get(doc.id) ?? 0) + 1;
    this.failures.set(doc.id, n);
    this.retryAt.set(doc.id, now + Math.min(300000, 15000 * 2 ** Math.min(n - 1, 5)));
    this.globalLast = now;
  }
  retry(id?: string) {
    if (id) {
      this.blocks.delete(id);
      this.retryAt.delete(id);
      this.failures.delete(id);
    } else {
      this.blocks.clear();
      this.retryAt.clear();
      this.failures.clear();
    }
  }
  hasErrors() {
    return [...this.blocks.values()].some((b) => b.kind === 'error');
  }
}
