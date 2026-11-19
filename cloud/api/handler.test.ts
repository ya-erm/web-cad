import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHandler } from './index.mjs';

function setup() {
  const settings = vi.fn(() => ({ ydbConnectionString: 'grpcs://example.test:2135/database', bucket: 'test-bucket' }));
  const ydb = vi.fn(async () => {});
  const storage = vi.fn(async () => {});
  const log = vi.fn();
  return { settings, ydb, storage, log, handle: createHandler({ settings, ydb, storage, log }) };
}

describe('private cloud API', () => {
  it('loads through the CommonJS entry point used by Cloud Functions', async () => {
    const { handler } = createRequire(import.meta.url)('./index.js');
    const result = await handler({ httpMethod: 'GET', path: '/health' }, {});
    expect(result.statusCode).toBe(200);
  });
  it('routes browser token management through its authentication checks', async () => {
    const { handle } = setup();
    expect((await handle({ path: '/auth/tokens', httpMethod: 'GET' }, {})).statusCode).toBe(401);
    expect((await handle({ path: '/auth/tokens/revoke', httpMethod: 'POST' }, {})).statusCode).toBe(403);
  });
  it('liveness does not depend on cloud credentials or availability', async () => {
    const { handle, settings, ydb, storage } = setup();
    const result = await handle({ httpMethod: 'GET', path: '/health' }, {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: 'ok' });
    expect(settings).not.toHaveBeenCalled();
    expect(ydb).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it('refuses unknown routes and mutating methods without accessing data', async () => {
    const { handle, ydb, storage } = setup();
    expect((await handle({ httpMethod: 'POST', path: '/ready' }, {})).statusCode).toBe(405);
    expect((await handle({ httpMethod: 'GET', path: '/documents' }, {})).statusCode).toBe(404);
    expect((await handle({}, {})).statusCode).toBe(404);
    expect(ydb).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it('fails closed without service credentials or valid configuration', async () => {
    const { handle, settings, ydb } = setup();
    expect((await handle({ httpMethod: 'GET', path: '/ready' }, {})).statusCode).toBe(503);
    settings.mockImplementation(() => {
      throw new Error('private configuration');
    });
    const result = await handle({ httpMethod: 'GET', path: '/ready' }, { token: { access_token: 'secret' } });
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain('private configuration');
    expect(ydb).not.toHaveBeenCalled();
  });

  it('passes the current invocation token on each call and prevents caching', async () => {
    const { handle, ydb, storage } = setup();
    for (const token of ['first', 'refreshed']) {
      const result = await handle({ httpMethod: 'GET', path: '/ready' }, { token: { access_token: token } });
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ status: 'ok', checks: { ydb: 'ok', storage: 'ok' } });
      expect(result.headers['Cache-Control']).toBe('no-store');
      expect(ydb).toHaveBeenLastCalledWith('grpcs://example.test:2135/database', token, expect.any(AbortSignal));
      expect(storage).toHaveBeenLastCalledWith('test-bucket', token, expect.any(AbortSignal));
    }
  });

  it.each(['ydb', 'storage'] as const)('reports %s outage without leaking SDK errors', async (failed) => {
    const ctx = setup();
    ctx[failed].mockRejectedValue(new Error('Bearer secret-token https://private-endpoint'));
    const result = await ctx.handle({ httpMethod: 'GET', path: '/ready' }, { token: { access_token: 'secret-token' } });
    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body).checks[failed]).toBe('unavailable');
    expect(result.body).not.toMatch(/secret-token|private-endpoint/);
    expect(JSON.stringify(ctx.log.mock.calls)).not.toMatch(/secret-token|private-endpoint/);
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({ level: 'WARN', message: 'Readiness check' }));
    expect(ctx.ydb).toHaveBeenCalledOnce();
    expect(ctx.storage).toHaveBeenCalledOnce();
  });
});
