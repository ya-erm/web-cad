// WebCAD Embed Protocol v1: who may embed the viewer, which messages it takes, what it answers — a wrong sender,
// origin, channel or version is not looked at; a file of the wrong format or size is refused before it is read; a
// request repeated gets its answer again and is never shown twice; one file at a time.

import { describe, expect, it, vi } from 'vitest';
import { allowedParentOrigin, embedParams, MAX_FILE_BYTES, PARENT_ORIGINS, readIncoming, type EmbedFile, type OutgoingMessage } from './protocol';
import { EmbedError, EmbedSession } from './session';
import { isEmbedHash } from './mode';

const ORIGIN = 'https://ya-components.vercel.app';
const CHANNEL = '0b8f2b1e-5c3a-4f7e-9d61-2a4c8e9f1b37';
const REQUEST = '7c1d9e2a-3b4f-4a5c-8d6e-9f0a1b2c3d4e';
const parent = { name: 'the page around' };
const params = { parentOrigin: ORIGIN, channel: CHANNEL };

const bytes = (n: number) => new ArrayBuffer(n);
const load = (over: Record<string, unknown> = {}, file: Record<string, unknown> = {}) => ({
  type: 'webcad:load',
  version: 1,
  channel: CHANNEL,
  requestId: REQUEST,
  file: { name: 'part.step', format: 'step', size: 10, buffer: bytes(10), ...file },
  ...over,
});
const event = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => ({ source: parent, origin: ORIGIN, data, ...over });

describe('embed address', () => {
  it('is #/embed with the query inside the hash', () => {
    expect(isEmbedHash('#/embed?parentOrigin=x&channel=y')).toBe(true);
    expect(isEmbedHash('#/embed')).toBe(true);
    expect(isEmbedHash('#/embedded')).toBe(false);
    expect(isEmbedHash('#/doc/abc')).toBe(false);
    const hash = `#/embed?${new URLSearchParams({ parentOrigin: ORIGIN, channel: CHANNEL })}`;
    expect(embedParams(hash, false)).toEqual(params);
  });

  it('takes only the listed origins exactly (localhost only on the development server)', () => {
    for (const o of PARENT_ORIGINS) expect(allowedParentOrigin(o, false)).toBe(true);
    for (const o of [
      'https://ya-components.vercel.app/',
      'http://ya-components.vercel.app',
      'https://evil-ya-components.vercel.app',
      'https://ya-components.vercel.app.evil.com',
      'https://YA-COMPONENTS.vercel.app',
      'https://user@ya-components.vercel.app',
      'null',
      '*',
      '',
    ])
      expect(allowedParentOrigin(o, false)).toBe(false);
    expect(allowedParentOrigin('http://localhost:3000', false)).toBe(false);
    expect(allowedParentOrigin('http://127.0.0.1:5177', false)).toBe(false);
    expect(allowedParentOrigin('http://localhost:3000', true)).toBe(true);
    expect(allowedParentOrigin('http://127.0.0.1:5177', true)).toBe(true);
    expect(allowedParentOrigin('http://localhost:3000/path', true)).toBe(false);
    expect(allowedParentOrigin('http://localhost.evil.com', true)).toBe(false);
    expect(allowedParentOrigin('file://localhost', true)).toBe(false);
    expect(allowedParentOrigin(undefined, true)).toBe(false);
  });

  it('needs an allowed parent origin and a UUID channel', () => {
    const q = (o: Record<string, string>) => `#/embed?${new URLSearchParams(o)}`;
    expect(embedParams(q({ parentOrigin: 'https://evil.example', channel: CHANNEL }), false)).toBeNull();
    expect(embedParams(q({ parentOrigin: ORIGIN, channel: 'not-a-uuid' }), false)).toBeNull();
    expect(embedParams(q({ parentOrigin: ORIGIN }), false)).toBeNull();
    expect(embedParams(q({ channel: CHANNEL }), false)).toBeNull();
    // the query of the page's address does not count: only the one inside the hash
    expect(embedParams('#/embed', false)).toBeNull();
  });
});

describe('incoming messages', () => {
  it('reads a load request of the page around, on its channel', () => {
    const m = readIncoming(event(load()), parent, params);
    expect(m.kind).toBe('load');
    if (m.kind === 'load') expect(m.file).toMatchObject({ name: 'part.step', format: 'step', size: 10 });
  });

  it('does not look at another sender, origin, channel, version or type', () => {
    const reason = (ev: ReturnType<typeof event>) => {
      const m = readIncoming(ev, parent, params);
      return m.kind === 'ignored' ? m.reason : m.kind;
    };
    expect(reason(event(load(), { source: {} }))).toBe('source');
    expect(reason(event(load(), { source: null }))).toBe('source');
    expect(reason(event(load(), { origin: 'https://evil.example' }))).toBe('origin');
    expect(reason(event(load(), { origin: 'https://ya-components.vercel.app.evil.com' }))).toBe('origin');
    expect(reason(event(load({ channel: '11111111-2222-4333-8444-555555555555' })))).toBe('channel');
    expect(reason(event(load({ version: 2 })))).toBe('version');
    expect(reason(event(load({ version: '1' })))).toBe('version');
    expect(reason(event(load({ type: 'webcad:run' })))).toBe('type');
    expect(reason(event(load({ requestId: 'x' })))).toBe('requestId');
    expect(reason(event('webcad:load'))).toBe('data');
    expect(reason(event(null))).toBe('data');
    expect(reason(event([load()]))).toBe('data');
    // the viewer's own window is not the page
    expect(readIncoming(event(load()), null, params).kind).toBe('ignored');
  });

  it('refuses an unknown format and a wrong size before reading the file', () => {
    const refused = (file: Record<string, unknown>) => {
      const m = readIncoming(event(load({}, file)), parent, params);
      return m.kind === 'invalid' ? `${m.code}: ${m.message}` : m.kind;
    };
    expect(refused({ format: 'obj' })).toBe('UNSUPPORTED_FORMAT: Only STEP, STL and WebCAD project files can be shown');
    expect(refused({ format: undefined })).toMatch(/^UNSUPPORTED_FORMAT/);
    expect(refused({ size: 0, buffer: bytes(0) })).toBe('INVALID_FILE: The file is empty');
    expect(refused({ size: MAX_FILE_BYTES + 1, buffer: bytes(1) })).toBe('INVALID_FILE: The file is larger than 20 MB');
    expect(refused({ size: 10.5 })).toBe('INVALID_FILE: The file size is not valid');
    expect(refused({ size: '10' })).toBe('INVALID_FILE: The file size is not valid');
    expect(refused({ size: 11 })).toBe('INVALID_FILE: The file size does not match its data');
    expect(refused({ buffer: new Uint8Array(10) })).toBe('INVALID_FILE: No file data');
    expect(refused({ buffer: 'aGVsbG8=' })).toBe('INVALID_FILE: No file data');
    expect(refused({ name: '' })).toBe('INVALID_FILE: The file name is missing or too long');
    expect(refused({ name: 'x'.repeat(256) })).toBe('INVALID_FILE: The file name is missing or too long');
    expect(readIncoming(event(load({ file: undefined })), parent, params)).toMatchObject({ kind: 'invalid', code: 'INVALID_FILE' });
    // the largest file is taken
    expect(refused({ size: MAX_FILE_BYTES, buffer: bytes(MAX_FILE_BYTES) })).toBe('load');
    for (const format of ['step', 'stl', 'webcad']) expect(refused({ format })).toBe('load');
  });
});

describe('the viewer session', () => {
  /** A session with a host whose `show` waits until released (or fails). */
  function session() {
    const sent: OutgoingMessage[] = [];
    const shown: EmbedFile[] = [];
    let release: () => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const host = {
      post: (m: OutgoingMessage) => sent.push(m),
      show: vi.fn(
        (f: EmbedFile) =>
          new Promise<void>((res, rej) => {
            shown.push(f);
            release = res;
            fail = rej;
          }),
      ),
    };
    const s = new EmbedSession(params, parent, host);
    return { s, sent, shown, host, release: () => release(), fail: (e: unknown) => fail(e) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('says it is ready on its channel', () => {
    const { s, sent } = session();
    s.ready();
    expect(sent).toEqual([{ type: 'webcad:ready', version: 1, channel: CHANNEL }]);
  });

  it('answers loaded once the file is shown; the same request again — the same answer, not shown twice', async () => {
    const { s, sent, host, release } = session();
    expect(s.receive(event(load()))).toBe('started');
    // repeated while it is being shown: it waits for the one answer
    expect(s.receive(event(load()))).toBe('waiting');
    expect(sent).toEqual([]);
    release();
    await flush();
    expect(sent).toEqual([{ type: 'webcad:loaded', version: 1, channel: CHANNEL, requestId: REQUEST }]);
    expect(s.receive(event(load()))).toBe('repeated');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(host.show).toHaveBeenCalledTimes(1);
  });

  it('takes one file at a time: another request meanwhile is refused (BUSY), then taken', async () => {
    const { s, sent, host, release } = session();
    const other = '0f0e0d0c-0b0a-4908-8706-050403020100';
    s.receive(event(load()));
    expect(s.receive(event(load({ requestId: other })))).toBe('busy');
    expect(sent[0]).toMatchObject({ type: 'webcad:error', requestId: other, error: { code: 'BUSY' } });
    release();
    await flush();
    expect(s.receive(event(load({ requestId: other })))).toBe('started');
    expect(host.show).toHaveBeenCalledTimes(2);
  });

  it('answers an error for people: its code from the viewer, a build failure without the kernel text', async () => {
    const { s, sent, fail } = session();
    s.receive(event(load()));
    fail(new EmbedError('INVALID_FILE', 'Файл STEP повреждён или загружен не полностью'));
    await flush();
    expect(sent[0]).toEqual({
      type: 'webcad:error',
      version: 1,
      channel: CHANNEL,
      requestId: REQUEST,
      error: { code: 'INVALID_FILE', message: 'Файл STEP повреждён или загружен не полностью' },
    });
    const two = session();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    two.s.receive(event(load()));
    two.fail(new Error('Standard_Failure at 0x1234 /tmp/secret'));
    await flush();
    error.mockRestore();
    expect(two.sent[0]).toMatchObject({ error: { code: 'BUILD_FAILED', message: 'Не удалось построить модель' } });
    // the next attempt is a new request: it is shown
    two.s.receive(event(load({ requestId: '9a8b7c6d-5e4f-4321-8fed-cba987654321' })));
    expect(two.host.show).toHaveBeenCalledTimes(2);
  });

  it('refuses a wrong file at once (translated) and never shows it; ignores what is not for it', () => {
    const { s, sent, host } = session();
    expect(s.receive(event(load({}, { format: 'dwg' })))).toBe('answered');
    expect(sent[0]).toMatchObject({ type: 'webcad:error', requestId: REQUEST, error: { code: 'UNSUPPORTED_FORMAT', message: 'Показать можно только файлы STEP, STL и проекты WebCAD' } });
    expect(s.receive(event(load({ requestId: '9a8b7c6d-5e4f-4321-8fed-cba987654321' }, { size: 11 })))).toBe('answered');
    expect(sent[1]).toMatchObject({ error: { code: 'INVALID_FILE', message: 'Размер файла не совпадает с его данными' } });
    expect(s.receive(event(load(), { origin: 'https://evil.example' }))).toBe('ignored');
    expect(s.receive(event(load(), { source: {} }))).toBe('ignored');
    expect(s.receive(event(load({ channel: CHANNEL.replace('0b', '1b') })))).toBe('ignored');
    expect(s.receive(event(load({ version: 2 })))).toBe('ignored');
    expect(sent).toHaveLength(2);
    expect(host.show).not.toHaveBeenCalled();
  });
});
