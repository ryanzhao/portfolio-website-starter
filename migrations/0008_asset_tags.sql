CREATE TABLE asset_tags (
  assetId TEXT PRIMARY KEY REFERENCES upload_sessions(id),
  tags TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0)
);
