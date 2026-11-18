-- Metadata only. Project archives and images are stored in private Object Storage.
CREATE TABLE cloud_folders (
  user_id Utf8 NOT NULL,
  id Utf8 NOT NULL,
  payload Utf8,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE cloud_documents (
  user_id Utf8 NOT NULL,
  id Utf8 NOT NULL,
  payload Utf8,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE cloud_uploads (
  user_id Utf8 NOT NULL,
  id Utf8 NOT NULL,
  payload Utf8,
  expires_at Timestamp,
  PRIMARY KEY (user_id, id)
) WITH (TTL = Interval("PT0S") ON expires_at);
