CREATE TABLE upload_resume (
  assetId TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  partHashes TEXT NOT NULL
);
CREATE TABLE upload_part_receipts (
  assetId TEXT NOT NULL REFERENCES upload_resume(assetId),
  partNumber INTEGER NOT NULL CHECK(partNumber >= 1 AND partNumber <= 256),
  etag TEXT NOT NULL,
  PRIMARY KEY (assetId, partNumber)
);
