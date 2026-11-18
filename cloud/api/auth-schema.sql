-- Authentication tables approved by the user; run as webcad-deployer.
-- Lifetimes: OAuth attempts 10 minutes, sessions 180 days.
-- Sliding session expiry is renewed by the application at most once per day.
-- expires_at is set by the application; TTL cleanup never replaces expiry checks.

CREATE TABLE auth_users (
  user_id Utf8 NOT NULL,
  display_name Utf8,
  email Utf8,
  avatar_url Utf8,
  created_at Timestamp,
  PRIMARY KEY (user_id)
);

-- One internal WebCAD user can have several external login identities.
-- The provider and its stable subject identify a login, never the email address.
CREATE TABLE auth_identities (
  provider Utf8 NOT NULL,
  provider_subject Utf8 NOT NULL,
  user_id Utf8,
  created_at Timestamp,
  PRIMARY KEY (provider, provider_subject)
);

-- Only a SHA-256 hash of the random session secret is persisted.
-- Account/session creation must use a transaction, including identity uniqueness.
CREATE TABLE auth_sessions (
  token_hash Utf8 NOT NULL,
  user_id Utf8,
  created_at Timestamp,
  expires_at Timestamp,
  PRIMARY KEY (token_hash)
) WITH (TTL = Interval("PT0S") ON expires_at);

-- Short-lived, one-time OAuth attempts, bound to the initiating browser.
-- Consume an attempt atomically; do not store access/refresh tokens here.
CREATE TABLE auth_requests (
  state_hash Utf8 NOT NULL,
  browser_binding_hash Utf8,
  provider Utf8,
  pkce_verifier Utf8,
  created_at Timestamp,
  expires_at Timestamp,
  PRIMARY KEY (state_hash)
) WITH (TTL = Interval("PT0S") ON expires_at);
