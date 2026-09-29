CREATE TABLE IF NOT EXISTS processing_jobs (
  assetId TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'failed', 'ready')),
  attempts INTEGER NOT NULL DEFAULT 0,
  leaseToken TEXT,
  leaseExpiresAt INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS processing_jobs_claim ON processing_jobs(status, leaseExpiresAt, createdAt);
