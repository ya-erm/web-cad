import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudUploadSlotAvailable, recordCloudUploadTime, withCloudUploadLock } from './uploadLock';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
describe('shared upload lane', () => {
  it('uses the same account timestamp in separate scheduler instances', () => {
    expect(cloudUploadSlotAvailable('u', 100000, 15000)).toBe(true);
    recordCloudUploadTime('u', 100000);
    expect(cloudUploadSlotAvailable('u', 114999, 15000)).toBe(false);
    expect(cloudUploadSlotAvailable('u', 115000, 15000)).toBe(true);
    expect(cloudUploadSlotAvailable('other', 100001, 15000)).toBe(true);
  });
  it('does not run a background upload while another tab owns the lane', async () => {
    let held = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          options: {
            ifAvailable?: boolean;
          },
          callback: (lock: object | null) => unknown,
        ) => {
          if (held && options.ifAvailable) return callback(null);
          held = true;
          try {
            return await callback({});
          } finally {
            held = false;
          }
        },
      },
    });
    let release!: () => void;
    const active = withCloudUploadLock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const background = vi.fn();
    expect(await withCloudUploadLock(background, { ifAvailable: true })).toBeUndefined();
    expect(background).not.toHaveBeenCalled();
    release();
    await active;
    await withCloudUploadLock(background, { ifAvailable: true });
    expect(background).toHaveBeenCalledTimes(1);
  });
  it('does not enter an upload after logout aborted its epoch', async () => {
    const controller = new AbortController();
    controller.abort();
    const upload = vi.fn();
    await expect(withCloudUploadLock(upload, { signal: controller.signal })).rejects.toBeDefined();
    expect(upload).not.toHaveBeenCalled();
  });
  it('uses valid native lock options and rechecks the epoch when the callback starts', async () => {
    const controller = new AbortController();
    let abortBeforeCallback = false;
    const request = vi.fn(
      async (_name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: object) => unknown) => {
        if (options.ifAvailable && options.signal) throw new DOMException('signal with ifAvailable is forbidden', 'NotSupportedError');
        if (abortBeforeCallback) controller.abort();
        return callback({});
      },
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const upload = vi.fn(async () => 42);
    expect(await withCloudUploadLock(upload, { ifAvailable: true, signal: controller.signal })).toBe(42);
    expect(request.mock.calls[0][1]).toEqual({ ifAvailable: true });
    upload.mockClear();
    abortBeforeCallback = true;
    await expect(withCloudUploadLock(upload, { ifAvailable: true, signal: controller.signal })).rejects.toBeDefined();
    expect(upload).not.toHaveBeenCalled();
    const manualController = new AbortController();
    abortBeforeCallback = false;
    await withCloudUploadLock(upload, { signal: manualController.signal });
    expect(request.mock.calls[2][1]).toEqual({ signal: manualController.signal });
  });
});
