import { create } from 'zustand';
export type CloudSyncPhase = 'signed_out' | 'paused' | 'waiting' | 'syncing' | 'offline' | 'error' | 'conflict' | 'synced';
export const CLOUD_SYNC_SETTING = 'webcad.cloudSync.enabled';
export interface CloudSyncState {
  enabled: boolean;
  accountId: string | null;
  phase: CloudSyncPhase;
  pending: number;
  currentDocId: string | null;
  lastSyncedAt: number | null;
  error: string | null;
  conflicts: string[];
  remoteChanges: string[];
  setEnabled(enabled: boolean): void;
  setAccount(id: string | null): void;
  retry(id?: string): void;
}
const enabled = (() => {
  try {
    return localStorage.getItem(CLOUD_SYNC_SETTING) !== '0';
  } catch {
    return true;
  }
})();
export const useCloudSync = create<CloudSyncState>((set, get) => ({
  enabled,
  accountId: null,
  phase: 'signed_out',
  pending: 0,
  currentDocId: null,
  lastSyncedAt: null,
  error: null,
  conflicts: [],
  remoteChanges: [],
  setEnabled(value) {
    try {
      localStorage.setItem(CLOUD_SYNC_SETTING, value ? '1' : '0');
    } catch {
      /* Optional persistence. */
    }
    set({ enabled: value, phase: !get().accountId ? 'signed_out' : value ? 'waiting' : 'paused' });
  },
  setAccount(id) {
    if (get().accountId === id) return;
    set({
      pending: 0,
      lastSyncedAt: null,
      accountId: id,
      phase: !id ? 'signed_out' : get().enabled ? 'waiting' : 'paused',
      error: null,
      conflicts: [],
      remoteChanges: [],
      currentDocId: null,
    });
  },
  retry(id) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('webcad:sync-retry', { detail: id }));
  },
}));
