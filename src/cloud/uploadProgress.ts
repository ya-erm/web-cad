/** Signed S3 upload without cookies; XHR exposes upload byte progress. */
export function putCloudObject(url: string, body: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      request.abort();
      finish(new DOMException('Upload aborted', 'AbortError'));
    };
    request.open('PUT', url);
    request.withCredentials = false;
    request.timeout = 120000;
    request.upload.onprogress = (event) => onProgress(Math.min(body.size, Math.max(0, event.loaded)));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(body.size);
        finish();
      } else finish(new Error('Upload failed. Your local document is safe.'));
    };
    request.onerror = request.ontimeout = () => finish(new Error('Upload failed. Your local document is safe.'));
    request.onabort = () => finish(new DOMException('Upload aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else request.send(body);
  });
}
