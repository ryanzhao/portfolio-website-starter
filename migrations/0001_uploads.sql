CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  filename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 2147483648),
  kind TEXT NOT NULL CHECK(kind IN ('image', 'video')),
  objectKey TEXT NOT NULL UNIQUE,
  uploadId TEXT,
  status TEXT NOT NULL CHECK(status IN ('uploading', 'completing', 'processing_pending', 'rejected', 'cancelling', 'cancelled')),
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL CHECK(expiresAt > createdAt)
);
CREATE INDEX upload_sessions_owner_status ON upload_sessions(owner, status);
