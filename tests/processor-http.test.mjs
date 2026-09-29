import { test } from "node:test";
import assert from "node:assert/strict";

test("processor HTTP authenticates and validates before opening storage", async () => {
  const api = await import("../src/lib/processor-http.ts").catch(() => ({}));
  assert.equal(typeof api.handleProcessorRequest, "function");
  const env = { PROCESSOR_TOKEN: "a".repeat(64) };
  let calls = 0;
  const storage = async () => { calls++; throw new Error("private connection details"); };
  const request = (body, token = env.PROCESSOR_TOKEN) => new Request("https://admin.example.test/api/processor", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  for (const [req, status] of [[request({ action: "claim" }, "bad"), 401], [request({ action: "delete" }), 400],
    [request({ action: "claim", owner: "attacker" }), 400], [request({ action: "renew", assetId: "bad" }), 400]]) {
    const response = await api.handleProcessorRequest(req, env, storage);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
  const response = await api.handleProcessorRequest(request({ action: "claim" }), env, storage);
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.ok(!(await response.text()).includes("private connection"));
});
