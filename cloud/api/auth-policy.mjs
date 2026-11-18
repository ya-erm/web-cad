// Agreed authentication lifetimes; YDB TTL deletes rows after their expires_at.
export const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
export const SESSION_RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OAUTH_ATTEMPT_LIFETIME_MS = 10 * 60 * 1000;
