import { test } from "node:test";
import assert from "node:assert/strict";

test("server content client requires credentials and uses uncached raw document access", async () => {
  const api = await import("../src/lib/content-client.ts").catch(() => ({}));
  assert.equal(typeof api.contentClient, "function");
  const env = { SANITY_PROJECT_ID: "test1234", SANITY_DATASET: "production", SANITY_WRITE_TOKEN: "test-only-not-a-real-token" };
  for (const missing of ["SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_WRITE_TOKEN"]) {
    assert.throws(() => api.contentClient({ ...env, [missing]: "" }), { status: 503 });
  }
  const config = api.contentClient(env).config();
  assert.equal(config.useCdn, false);
  assert.equal(config.perspective, "raw");
  assert.equal(config.projectId, env.SANITY_PROJECT_ID);
  assert.equal(config.dataset, env.SANITY_DATASET);
  assert.equal(config.token, env.SANITY_WRITE_TOKEN);
  assert.equal(config.apiVersion, "2026-09-19");
});
