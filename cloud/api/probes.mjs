import { Driver } from '@ydbjs/core';
import { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
import { query } from '@ydbjs/query';

/** @param {string} connectionString @param {string} token @param {AbortSignal} signal */
export async function checkYdb(connectionString, token, signal) {
  // A short-lived driver uses the current invocation's token, including on warm starts.
  const driver = new Driver(connectionString, {
    credentialsProvider: new AccessTokenCredentialsProvider({ token }),
    'ydb.sdk.application': 'webcad-cloud-api',
  });
  const sql = query(driver, { poolOptions: { maxSize: 1 } });
  try {
    await driver.ready(signal);
    const result = /** @type {Array<Array<{ok: number}>>} */ (
      await sql`SELECT 1 AS ok`.signal(signal).timeout(5000).idempotent(true)
    );
    if (result[0]?.[0]?.ok !== 1) throw new Error('Unexpected YDB probe result');
  } finally {
    try {
      await sql[Symbol.asyncDispose]();
    } finally {
      driver.close();
    }
  }
}

/** @param {string} bucket @param {string} token @param {AbortSignal} signal */
export async function checkStorage(bucket, token, signal) {
  // List permission is enough for a read-only probe. Do not read or create documents.
  const url = new URL(`https://storage.yandexcloud.net/${encodeURIComponent(bucket)}`);
  url.searchParams.set('list-type', '2');
  url.searchParams.set('max-keys', '1');
  const result = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal,
  });
  await result.body?.cancel();
  if (!result.ok) throw new Error('Object Storage probe failed');
}
