import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runCloudCommand } from './cloud-agent.mjs';
const host = () => ({ call: vi.fn().mockResolvedValue({ ok: true }), out: vi.fn() });
describe('agent cloud CLI', () => {
  it('keeps conflicts explicit and forwards the exact pair of revision clocks', async () => {
    const h = host();
    await expect(runCloudCommand(['upload', 'doc', '--expected-revision', 'r2'], h)).rejects.toThrow('both');
    expect(h.call).not.toHaveBeenCalled();
    await runCloudCommand(['upload', 'doc', '--expected-revision', 'r2', '--expected-modified', '123', '--folder', 'f'], h);
    expect(h.call).toHaveBeenCalledWith('cloudUpload', 'doc', { expectedRevision: 'r2', expectedModified: 123, folderId: 'f' });
    await expect(
      runCloudCommand(['upload', 'doc', '--copy', '--expected-revision', 'r2', '--expected-modified', '123'], h),
    ).rejects.toThrow('--copy');
  });
  it('does not silently resume a paused queue and bounds optional waiting', async () => {
    const h = host();
    await runCloudCommand(['sync'], h);
    expect(h.call).toHaveBeenLastCalledWith('cloudSync', {});
    await runCloudCommand(['sync', '--resume', '--wait', '60000'], h);
    expect(h.call).toHaveBeenLastCalledWith('cloudSync', { enabled: true, waitMs: 60000 });
    await expect(runCloudCommand(['sync', '--pause', '--resume'], h)).rejects.toThrow('Choose');
    await expect(runCloudCommand(['sync', '--wait', '120001'], h)).rejects.toThrow('120000');
  });
  it('rejects missing values, duplicate flags and unexpected positional arguments before RPC', async () => {
    const h = host();
    for (const args of [
      ['upload', '--folder'],
      ['list', 'anything'],
      ['mkdir', 'name', '--parent', 'p', '--parent', 'q'],
      ['sync', '--wait', 'NaN'],
      ['status', '--force'],
    ])
      await expect(runCloudCommand(args, h)).rejects.toThrow();
    expect(h.call).not.toHaveBeenCalled();
  });
  it('refuses to overwrite an existing download before requesting the project', async () => {
    const dir = 'temp/cloud-cli-tests/' + randomUUID();
    mkdirSync(dir, { recursive: true });
    const file = dir + '/model.json';
    writeFileSync(file, 'original');
    try {
      const h = host();
      await expect(runCloudCommand(['download', 'id', file], h)).rejects.toThrow();
      expect(h.call).not.toHaveBeenCalled();
      expect(readFileSync(file, 'utf8')).toBe('original');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('writes a downloaded project and cleans only its own reserved output after failure', async () => {
    const dir = 'temp/cloud-cli-tests/' + randomUUID();
    mkdirSync(dir, { recursive: true });
    const file = dir + '/model.json';
    try {
      const h = host();
      h.call.mockRejectedValueOnce(new Error('offline'));
      await expect(runCloudCommand(['download', 'id', file], h)).rejects.toThrow('offline');
      expect(existsSync(file)).toBe(false);
      h.call.mockResolvedValueOnce({ mime: 'application/json', base64: Buffer.from('{"versions":[1]}').toString('base64') });
      await runCloudCommand(['download', 'id', file], h);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ versions: [1] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('reads an upload file before calling the selected browser and leaves source untouched', async () => {
    const dir = 'temp/cloud-cli-tests/' + randomUUID();
    mkdirSync(dir, { recursive: true });
    const file = dir + '/model.json';
    writeFileSync(file, '{"id":"file-id","tabs":[]}');
    try {
      const h = host();
      await runCloudCommand(['upload-file', file, '--folder', 'f'], h);
      expect(h.call).toHaveBeenCalledWith('cloudUploadFile', { id: 'file-id', tabs: [] }, { folderId: 'f' });
      expect(readFileSync(file, 'utf8')).toBe('{"id":"file-id","tabs":[]}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
