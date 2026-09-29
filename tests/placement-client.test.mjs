import { test } from "node:test";
import assert from "node:assert/strict";

test("placement client preserves revision and does not retry conflicting writes", async () => {
  const api = await import("../src/lib/placement-client.ts").catch(() => ({}));
  assert.equal(typeof api.saveDraft, "function");
  const placement = { slotId: "home.hero", assetId: crypto.randomUUID(), alt: "Photo", caption: "" };
  let calls = 0;
  const transport = async (url, init) => {
    calls++;
    assert.equal(url, "/api/admin/placements");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(JSON.parse(init.body), { placement, revision: "rev-1" });
    return Response.json({ error: "版本冲突" }, { status: 409 });
  };
  await assert.rejects(api.saveDraft(placement, "rev-1", transport), /版本冲突/);
  assert.equal(calls, 1);
});
