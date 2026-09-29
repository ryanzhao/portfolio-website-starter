CREATE TABLE designer_fonts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  family TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK(weight IN (400,500,600,700)),
  style TEXT NOT NULL CHECK(style IN ('normal','italic')),
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 5242880),
  status TEXT NOT NULL CHECK(status IN ('reserved','ready','published')),
  createdAt INTEGER NOT NULL
);
CREATE INDEX designer_fonts_owner ON designer_fonts(owner, createdAt);
