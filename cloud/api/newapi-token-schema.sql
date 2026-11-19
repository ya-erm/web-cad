-- Personal agent tokens: store only SHA-256 digests, never bearer secrets.
CREATE TABLE auth_api_tokens (
  user_id Utf8 NOT NULL,
  id Utf8 NOT NULL,
  token_hash Utf8,
  name Utf8,
  scopes Utf8,
  created_at Timestamp,
  expires_at Timestamp,
  PRIMARY KEY (user_id, id)
) WITH (TTL = Interval("PT0S") ON expires_at);
