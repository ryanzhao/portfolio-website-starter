import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("preview configuration has no public routes or remote storage", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  for (const binding of [...(config.r2_buckets ?? []), ...(config.d1_databases ?? [])]) {
    assert.equal(binding.remote, false);
  }
  assert.ok(config.compatibility_flags.includes("nodejs_compat"));
});
