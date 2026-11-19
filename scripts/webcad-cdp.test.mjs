import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdpCall, cdpStatus } from './webcad-cdp.mjs';

const endpoint = 'http://127.0.0.1:9222';
const page = (id = 'a', url = 'https://cad.ya-erm.ru/') => ({
  id,
  url,
  type: 'page',
  title: 'My drawing',
  webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
});
let fetcher, sockets;
class Socket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.close = vi.fn();
    this.send = vi.fn();
    sockets.push(this);
  }
  emit(type, data) {
    this.dispatchEvent(type === 'message' ? new MessageEvent(type, { data: JSON.stringify(data) }) : new Event(type));
  }
}
const list = (entries) => fetcher.mockResolvedValue({ ok: true, json: async () => entries });
async function connected(promise) {
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0];
  socket.emit('open');
  return { socket, promise };
}
beforeEach(() => {
  fetcher = vi.fn();
  sockets = [];
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubEnv('WEBCAD_URL', '');
  list([page()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('CDP target discovery and selection', () => {
  it('returns bridge-compatible status without opening sockets, filtering unrelated targets', async () => {
    list([
      page(),
      page('local', 'http://localhost:5173/'),
      page('foreign', 'https://unrelated.test'),
      { ...page('worker'), type: 'worker' },
      page('lookalike', 'https://cad.ya-erm.ru.evil.test'),
      page('insecure', 'http://cad.ya-erm.ru/'),
    ]);
    expect(await cdpStatus(endpoint)).toEqual({
      base: endpoint,
      status: {
        ok: true,
        appConnected: true,
        tabs: ['a', 'local'].map((id) => ({ id, document: 'My drawing', browser: 'Chrome (CDP)' })),
        queued: 0,
      },
    });
    expect(sockets).toHaveLength(0);
    expect(fetcher.mock.calls[0][0].href).toBe(endpoint + '/json/list');
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });
  it('permits only the exact explicitly configured extra origin', async () => {
    vi.stubEnv('WEBCAD_URL', 'https://preview.example.test/app/');
    list([page('preview', 'https://preview.example.test/app'), page('other', 'https://other.example.test/')]);
    expect((await cdpStatus(endpoint)).status.tabs.map((t) => t.id)).toEqual(['preview']);
  });
  it('requires an explicit tab with multiple candidates and rejects foreign ids', async () => {
    list([page(), page('b')]);
    await expect(cdpCall(endpoint, undefined, 'cloudStatus', [])).rejects.toThrow('--tab');
    await expect(cdpCall(endpoint, 'foreign', 'cloudStatus', [])).rejects.toThrow('not available');
    expect(sockets).toHaveLength(0);
  });
  it('explains when no existing WebCAD tab is available', async () => {
    list([]);
    expect((await cdpStatus(endpoint)).status.appConnected).toBe(false);
    await expect(cdpCall(endpoint, undefined, 'cloudStatus', [])).rejects.toThrow('No WebCAD tab');
  });
  it.each([
    'ftp://localhost:9222',
    'http://user:secret@localhost:9222',
    'http://localhost:9222/?secret=value',
    'http://localhost:9222/path',
  ])('rejects unsafe endpoint without leaking it', async (endpoint) => {
    await expect(cdpStatus(endpoint)).rejects.toThrow('CDP endpoint must be an HTTP(S) origin.');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'ws://evil.test:9222/devtools/page/a',
    'ws://127.0.0.1:9999/devtools/page/a',
    'wss://127.0.0.1:9222/devtools/page/a',
    'ws://user:secret@127.0.0.1:9222/devtools/page/a',
    'ws://127.0.0.1:9222/devtools/page/a?secret=value',
    'ws://127.0.0.1:9222/arbitrary',
  ])('rejects unsafe debugger socket', async (url) => {
    list([{ ...page(), webSocketDebuggerUrl: url }]);
    await expect(cdpCall(endpoint, 'a', 'cloudStatus', [])).rejects.toThrow('unsafe or unavailable');
    expect(sockets).toHaveLength(0);
  });
  it('redacts endpoint and server errors', async () => {
    fetcher.mockRejectedValue(new Error('secret=value'));
    await expect(cdpStatus(endpoint)).rejects.toThrow('Cannot read browser CDP targets.');
  });
  it('requires built-in WebSocket only for calls', async () => {
    vi.stubGlobal('WebSocket', undefined);
    expect((await cdpStatus(endpoint)).status.ok).toBe(true);
    await expect(cdpCall(endpoint, 'a', 'cloudStatus', [])).rejects.toThrow('Node.js 22');
  });
});

describe('CDP evaluation', () => {
  it('awaits existing API method with exact JSON arguments and closes socket', async () => {
    const args = ['\";window.evil=true;//', { unicode: 'Привет', nested: [1, false] }, JSON.parse('{"__proto__":{"polluted":true}}')];
    const { socket, promise } = await connected(cdpCall(endpoint, 'a', 'cloudUpload', args));
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.method).toBe('Runtime.evaluate');
    expect(sent.params).toMatchObject({ awaitPromise: true, returnByValue: true });
    const call = vi.fn(async (...received) => received);
    const result = await new Function('window', 'location', `return ${sent.params.expression}`)(
      { webcad: { cloudUpload: call } },
      { origin: 'https://cad.ya-erm.ru' },
    );
    expect(result).toEqual(args);
    expect(call).toHaveBeenCalledWith(...args);
    socket.emit('message', { method: 'Runtime.consoleAPICalled', params: {} });
    socket.emit('message', { id: 1, result: { result: { type: 'object', value: { ok: true } } } });
    expect(await promise).toEqual({ ok: true });
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('never invokes prototype methods or an API after cross-origin navigation', async () => {
    const { socket, promise } = await connected(cdpCall(endpoint, 'a', 'toString', []));
    const expression = JSON.parse(socket.send.mock.calls[0][0]).params.expression;
    const evaluate = new Function('window', 'location', `return ${expression}`);
    await expect(evaluate({ webcad: {} }, { origin: 'https://cad.ya-erm.ru' })).rejects.toThrow('unavailable');
    const fn = vi.fn();
    await expect(evaluate({ webcad: { toString: fn } }, { origin: 'https://evil.test' })).rejects.toThrow('navigated');
    expect(fn).not.toHaveBeenCalled();
    const rejected = expect(promise).rejects.toThrow('WebCAD method failed');
    socket.emit('message', { id: 1, result: { exceptionDetails: { text: 'secret=do-not-print' } } });
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it.each(['error', 'close'])('rejects socket %s with cleanup', async (kind) => {
    const { socket, promise } = await connected(cdpCall(endpoint, 'a', 'cloudStatus', []));
    const rejected = expect(promise).rejects.toThrow('Browser CDP connection');
    socket.emit(kind);
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('times out once and removes socket handlers', async () => {
    vi.useFakeTimers();
    const promise = cdpCall(endpoint, 'a', 'cloudStatus', []);
    const rejected = expect(promise).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(180000);
    await rejected;
    expect(sockets[0].close).toHaveBeenCalledOnce();
    sockets[0].emit('open');
    expect(sockets[0].send).not.toHaveBeenCalled();
  });
});
