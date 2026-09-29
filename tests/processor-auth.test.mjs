import { test } from "node:test";
import assert from "node:assert/strict";

test("processor identity requires a dedicated strong secret and rejects browser requests", async () => {
  const api = await import("../src/lib/processor-auth.ts").catch(() => ({}));
  assert.equal(typeof api.requireProcessor, "function");
  const secret = "a".repeat(64); // synthetic, never a deployed credential
  const request = (token = secret, extra = {}) => new Request("https://admin.example.test/api/processor", {
    method: "POST", headers: { authorization: `Bearer ${token}`, ...extra },
  });
  assert.throws(() => api.requireProcessor(request(), {}), { status: 503 });
  assert.throws(() => api.requireProcessor(request(), { PROCESSOR_TOKEN: "short" }), { status: 503 });
  assert.throws(() => api.requireProcessor(request("b".repeat(64)), { PROCESSOR_TOKEN: secret }), { status: 401 });
  assert.throws(() => api.requireProcessor(request(secret, { origin: "https://admin.example.test" }), { PROCESSOR_TOKEN: secret }), { status: 403 });
  assert.throws(() => api.requireProcessor(request(secret, { "sec-fetch-site": "same-origin" }), { PROCESSOR_TOKEN: secret }), { status: 403 });
  assert.doesNotThrow(() => api.requireProcessor(request(), { PROCESSOR_TOKEN: secret }));
});
