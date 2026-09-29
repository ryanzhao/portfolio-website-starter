CREATE TABLE admin_write_limits (
  owner TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('uploads', 'drafts', 'publication')),
  window INTEGER NOT NULL CHECK(window >= 0),
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(owner, category)
);
