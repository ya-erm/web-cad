import { checkStorage, checkYdb } from './probes.mjs';
import { CLOUD_ROUTES, cloudHandler } from './cloud.mjs';
import { AUTH_ROUTES, authHandler } from './auth.mjs';

/** @typedef {import('./auth.mjs').AuthEvent} HttpEvent */
/** @typedef {{token?: {access_token?: string}}} FunctionContext */
/** @typedef {{ydbConnectionString: string, bucket: string}} Settings */

/** @returns {Settings} */
export function readSettings(env = process.env) {
  const connection = new URL(env.YDB_CONNECTION_STRING ?? '');
  if (connection.protocol !== 'grpcs:' || connection.pathname === '/' || connection.search) {
    throw new Error('YDB_CONNECTION_STRING must contain a secure endpoint and database path');
  }
  const bucket = env.S3_BUCKET ?? '';
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('S3_BUCKET must be a bucket name without dots');
  }
  return { ydbConnectionString: connection.href, bucket };
}

/**
 * The deployed function MUST remain private: invocation is authorized by YC IAM.
 * context.token is the function service account token, not a WebCAD user session.
 * @param {{
 *   settings?: () => Settings,
 *   ydb?: typeof checkYdb,
 *   storage?: typeof checkStorage,
 *   log?: (entry: Record<string, unknown>) => void
 * }} dependencies
 */
export function createHandler({ settings = readSettings, ydb = checkYdb, storage = checkStorage,
  log = (entry) => console.info(JSON.stringify(entry)),
} = {}) {
  /** @param {HttpEvent} event @param {FunctionContext} context */
  return async (event, context) => {
    const path = event.path;
    if (CLOUD_ROUTES.has(path ?? '')) return cloudHandler(event, context);
    if (AUTH_ROUTES.has(path ?? '')) return authHandler(event, context);
    if (path !== '/health' && path !== '/ready') return response(404, { error: 'not_found' });
    if (event.httpMethod !== 'GET') return response(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    if (path === '/health') return response(200, { status: 'ok' });

    const started = performance.now();
    const token = context.token?.access_token;
    if (!token) return response(503, { error: 'service_credentials_unavailable' });
    let config;
    try {
      config = settings();
    } catch {
      return response(503, { error: 'service_configuration_invalid' });
    }
    const signal = AbortSignal.timeout(5000);
    const results = await Promise.allSettled([
      ydb(config.ydbConnectionString, token, signal),
      storage(config.bucket, token, signal),
    ]);
    const checks = {
      ydb: results[0].status === 'fulfilled' ? 'ok' : 'unavailable',
      storage: results[1].status === 'fulfilled' ? 'ok' : 'unavailable',
    };
    const ok = checks.ydb === 'ok' && checks.storage === 'ok';
    // SDK errors may contain tokens, endpoints or object names. Never return or log them.
    log({ level: ok ? 'INFO' : 'WARN', message: 'Readiness check',
      checks, duration_ms: Math.round(performance.now() - started) });
    return response(ok ? 200 : 503, { status: ok ? 'ok' : 'unavailable', checks });
  };
}

/** @param {number} statusCode @param {object} body @param {Record<string, string>} extraHeaders */
function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

export const handler = createHandler();
