import { test } from "node:test";
import assert from "node:assert/strict";

test("part signing binds exact private object, multipart, size and short expiry", async () => {
  const api = await import("../src/lib/upload-signing.ts").catch(() => ({}));
  assert.equal(typeof api.signUploadPart, "function");
  const id = crypto.randomUUID();
  const upload = { id, objectKey: `originals/${id}`, uploadId: "opaque+multipart/id", status: "uploading",
    size: 8388610, expiresAt: Date.now() + 600000 };
  const env = { R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret" };
  const part = await api.signUploadPart(upload, 2, env);
  const url = new URL(part.url);
  assert.equal(url.host, `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, `/openmpd/originals/${id}`);
  assert.equal(url.searchParams.get("uploadId"), upload.uploadId);
  assert.equal(url.searchParams.get("partNumber"), "2");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;host");
  assert.match(url.searchParams.get("X-Amz-Signature"), /^[a-f0-9]{64}$/);
  assert.equal(part.length, 2);
  assert.equal(part.offset, 8388608);
  assert.ok(!part.url.includes(env.R2_SECRET_ACCESS_KEY));
  for (const invalid of [{ ...upload, status: "cancelled" }, { ...upload, expiresAt: 0 },
    { ...upload, objectKey: "../other" }]) await assert.rejects(api.signUploadPart(invalid, 1, env));
  await assert.rejects(api.signUploadPart(upload, 3, env));
  await assert.rejects(api.signUploadPart(upload, 1, {}), { status: 503 });
});
