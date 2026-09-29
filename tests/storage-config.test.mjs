import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("preview storage bindings isolate originals, publication and backups without remote development", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.r2_buckets, [
    { binding: "ORIGINALS", bucket_name: "replace-with-your-private-originals-bucket", remote: false },
    { binding: "PUBLISHED", bucket_name: "replace-with-your-public-derivatives-bucket", remote: false },
    { binding: "BACKUPS", bucket_name: "replace-with-your-private-backups-bucket", remote: false },
  ]);
  assert.deepEqual(config.d1_databases, [{ binding: "UPLOADS", database_name: "replace-with-your-local-d1-database",
    database_id: "00000000-0000-0000-0000-000000000000", migrations_dir: "migrations", remote: false }]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
});
