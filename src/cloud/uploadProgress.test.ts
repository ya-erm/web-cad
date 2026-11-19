import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { putCloudObject } from './uploadProgress';
class UploadRequest {
  static current: UploadRequest;
  status = 0;
  withCredentials = true;
  timeout = 0;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() {
    UploadRequest.current = this;
  }
}
beforeEach(() => vi.stubGlobal('XMLHttpRequest', UploadRequest));
afterEach(() => vi.unstubAllGlobals());
describe('signed upload progress', () => {
  it('reports bytes and accepts HTTP success without cookies', async () => {
    const progress = vi.fn(),
      body = new Blob(['1234567890']);
    const result = putCloudObject('https://storage.invalid/signed', body, progress);
    const request = UploadRequest.current;
    expect(request.open).toHaveBeenCalledWith('PUT', 'https://storage.invalid/signed');
    expect(request.withCredentials).toBe(false);
    expect(request.timeout).toBe(120000);
    expect(request.send).toHaveBeenCalledWith(body);
    request.upload.onprogress?.({ loaded: 4 } as ProgressEvent);
    expect(progress).toHaveBeenLastCalledWith(4);
    request.status = 200;
    request.onload?.();
    await result;
    expect(progress).toHaveBeenLastCalledWith(10);
  });
  it.each(['http', 'network', 'timeout'] as const)('rejects %s failure rather than confirming an upload', async (kind) => {
    const progress = vi.fn(),
      result = putCloudObject('https://storage.invalid/signed', new Blob(['body']), progress);
    const failed = expect(result).rejects.toThrow('Upload failed. Your local document is safe.');
    const request = UploadRequest.current;
    if (kind === 'http') {
      request.status = 403;
      request.onload?.();
    } else if (kind === 'network') request.onerror?.();
    else request.ontimeout?.();
    await failed;
    expect(progress).not.toHaveBeenCalled();
  });
  it('aborts a pending PUT and removes its signal listener after completion', async () => {
    const controller = new AbortController();
    const result = putCloudObject('https://storage.invalid/signed', new Blob(['body']), vi.fn(), controller.signal);
    const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const request = UploadRequest.current;
    controller.abort();
    await failed;
    expect(request.abort).toHaveBeenCalledOnce();
    const completed = new AbortController();
    const success = putCloudObject('https://storage.invalid/signed', new Blob(['body']), vi.fn(), completed.signal);
    const next = UploadRequest.current;
    next.status = 200;
    next.onload?.();
    await success;
    completed.abort();
    expect(next.abort).not.toHaveBeenCalled();
  });
});
