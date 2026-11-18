import { createHash, randomBytes } from 'node:crypto';

export const YANDEX_CALLBACK = 'https://api.cad.ya-erm.ru/auth/yandex/callback';
export const YANDEX_SCOPES = ['login:info', 'login:email', 'login:avatar'];

/** Generate opaque secrets for an OAuth attempt. Persist only hashes of state/binding. */
export function createLoginAttempt() {
  const state = randomBytes(32).toString('base64url');
  const browserBinding = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  return {
    state, browserBinding, verifier,
    stateHash: hashSecret(state), bindingHash: hashSecret(browserBinding),
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

/** @param {string} secret */
export function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Transport only: callers must validate and atomically consume state/browser binding
 * before redeeming a code. No provider tokens or secrets are returned to the browser.
 * @param {{clientId: string, clientSecret: string, request?: typeof fetch}} options
 */
export function createYandexClient({ clientId, clientSecret, request = fetch }) {
  if (!clientId?.trim() || !clientSecret?.trim()) throw new Error('OAuth credentials are missing');
  return {
    /** @param {string} state @param {string} challenge */
    authorizeUrl(state, challenge) {
      const url = new URL('https://oauth.yandex.ru/authorize');
      url.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: YANDEX_CALLBACK,
        scope: YANDEX_SCOPES.join(' '), state,
        code_challenge: challenge, code_challenge_method: 'S256',
      }).toString();
      return url.href;
    },
    /** @param {string} code @param {string} verifier @param {AbortSignal} signal */
    async profileFromCode(code, verifier, signal) {
      if (!code || !verifier) throw new Error('Invalid OAuth attempt');
      const tokenResponse = await request('https://oauth.yandex.ru/token', {
        method: 'POST', redirect: 'error', signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, code_verifier: verifier,
          redirect_uri: YANDEX_CALLBACK,
        }),
      });
      const tokens = await checkedJson(tokenResponse);
      if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Invalid OAuth token response');
      const profileResponse = await request('https://login.yandex.ru/info?format=json', {
        headers: { Authorization: `OAuth ${tokens.access_token}` },
        redirect: 'error', signal,
      });
      const profile = await checkedJson(profileResponse);
      // Never retain provider access_token, refresh_token or unused personal data.
      return normalizeYandexProfile(profile);
    },
  };
}

/** @param {Response} response @returns {Promise<Record<string, unknown>>} */
async function checkedJson(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Yandex OAuth request failed');
  }
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Yandex OAuth response');
  return /** @type {Record<string, unknown>} */ (data);
}

/** @param {Record<string, unknown>} profile */
export function normalizeYandexProfile(profile) {
  if (typeof profile.id !== 'string' || !/^[0-9]{1,64}$/.test(profile.id)) throw new Error('Yandex user ID missing');
  const name = [profile.display_name, profile.real_name, profile.login].find(v => typeof v === 'string' && v.trim());
  const avatarId = profile.default_avatar_id;
  const avatarUrl = profile.is_avatar_empty === false && typeof avatarId === 'string'
    && /^[a-zA-Z0-9_-]{1,128}(?:\/[a-zA-Z0-9_-]{1,128})?$/.test(avatarId)
    ? `https://avatars.yandex.net/get-yapic/${avatarId}/islands-68` : null;
  return {
    provider: 'yandex', subject: profile.id,
    displayName: typeof name === 'string' ? name.trim().slice(0, 200) : 'Пользователь',
    email: typeof profile.default_email === 'string' ? profile.default_email.slice(0, 320) : null,
    avatarUrl,
  };
}
