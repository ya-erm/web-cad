import { describe, expect, it, vi } from 'vitest';
import { createLoginAttempt, createYandexClient, hashSecret, normalizeYandexProfile, YANDEX_CALLBACK } from './yandex.mjs';

describe('Yandex OAuth transport', () => {
  it('generates independent state, browser binding and PKCE secrets', () => {
    const first = createLoginAttempt();
    const second = createLoginAttempt();
    expect(new Set([first.state, first.browserBinding, first.verifier, second.state, second.browserBinding, second.verifier]).size).toBe(6);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.stateHash).toBe(hashSecret(first.state));
    expect(first.bindingHash).toBe(hashSecret(first.browserBinding));
    const client = createYandexClient({ clientId: 'id', clientSecret: 'secret' });
    const url = new URL(client.authorizeUrl(first.state, first.challenge));
    expect(url.origin).toBe('https://oauth.yandex.ru');
    expect(url.searchParams.get('redirect_uri')).toBe(YANDEX_CALLBACK);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('login:info login:email login:avatar');
    expect(url.href).not.toContain('secret');
    expect(url.href).not.toContain(first.verifier);
  });

  it('exchanges code on the server and returns only a minimal profile', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'provider-token', refresh_token: 'refresh-secret' }))
      .mockResolvedValueOnce(Response.json({
        id: '123', display_name: ' Анна ', default_email: 'a@example.test',
        is_avatar_empty: false, default_avatar_id: '123/abc-def', birthday: 'unused',
      }));
    const client = createYandexClient({ clientId: 'id', clientSecret: 'secret', request });
    const profile = await client.profileFromCode('code', 'verifier', AbortSignal.timeout(5000));
    expect(profile).toEqual({ provider: 'yandex', subject: '123', displayName: 'Анна', email: 'a@example.test',
      avatarUrl: 'https://avatars.yandex.net/get-yapic/123/abc-def/islands-68' });
    const options = request.mock.calls[0][1]!;
    expect(options.redirect).toBe('error');
    expect((options.body as URLSearchParams).get('code_verifier')).toBe('verifier');
    expect(request.mock.calls[1][1]!.headers).toEqual({ Authorization: 'OAuth provider-token' });
    expect(JSON.stringify(profile)).not.toMatch(/provider-token|refresh-secret|birthday/);
  });

  it('does not fetch a profile after a failed token exchange or follow redirects', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret upstream diagnostic', { status: 400 }));
    const client = createYandexClient({ clientId: 'id', clientSecret: 'secret', request });
    await expect(client.profileFromCode('code', 'verifier', AbortSignal.timeout(5000))).rejects.toThrow('Yandex OAuth request failed');
    expect(request).toHaveBeenCalledOnce();
  });

  it('cancels token requests through the caller deadline', async () => {
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal);
      options?.signal?.throwIfAborted();
      return Response.json({});
    });
    controller.abort();
    const client = createYandexClient({ clientId: 'id', clientSecret: 'secret', request });
    await expect(client.profileFromCode('code', 'verifier', controller.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });

  it('requires a stable provider ID and accepts missing email/avatar', () => {
    expect(() => normalizeYandexProfile({ default_email: 'a@example.test' })).toThrow('Yandex user ID missing');
    expect(normalizeYandexProfile({ id: '1', login: 'user' })).toMatchObject({ subject: '1', email: null, avatarUrl: null });
    expect(normalizeYandexProfile({ id: '1', is_avatar_empty: true, default_avatar_id: 'placeholder' }).avatarUrl).toBeNull();
    expect(normalizeYandexProfile({ id: '1', is_avatar_empty: false, default_avatar_id: '../evil' }).avatarUrl).toBeNull();
  });
});
