-- Extend the existing upload kind constraint while preserving every row and FK.
-- D1 runs migrations in a transaction and defer checks until the replacement exists.
-- https://developers.cloudflare.com/d1/sql-api/foreign-keys/
PRAGMA defer_foreign_keys = ON;
CREATE TABLE upload_sessions_model_migration (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  filename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 2147483648),
  kind TEXT NOT NULL CHECK(kind IN ('image', 'video', 'model')),
  objectKey TEXT NOT NULL UNIQUE,
  uploadId TEXT,
  status TEXT NOT NULL CHECK(status IN ('uploading', 'completing', 'processing_pending', 'rejected', 'cancelling', 'cancelled')),
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL CHECK(expiresAt > createdAt),
  completionParts TEXT,
  storageVersion TEXT,
  storageEtag TEXT
);
INSERT INTO upload_sessions_model_migration SELECT id, owner, filename, mimeType, size, kind, objectKey, uploadId, status, createdAt, expiresAt, completionParts, storageVersion, storageEtag FROM upload_sessions;
DROP TABLE upload_sessions;
ALTER TABLE upload_sessions_model_migration RENAME TO upload_sessions;
CREATE INDEX upload_sessions_owner_status ON upload_sessions(owner, status);
PRAGMA defer_foreign_keys = OFF;
