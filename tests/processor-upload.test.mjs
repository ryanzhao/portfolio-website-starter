import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("PC derivative upload validates destination and streams bytes without machine credentials", async () => {
  const api = await import("../scripts/processor-upload.mjs").catch(() => ({}));
  assert.equal(typeof api.uploadResultFile, "function");
  const folder = await mkdtemp(join(tmpdir(), "portfolio-upload-"));
  const path = join(folder, "result.webp");
  await writeFile(path, new Uint8Array([1, 2, 3]));
  const key = `derivatives/${crypto.randomUUID()}/${"a".repeat(64)}/detail.webp`;
  const file = { path, key, size: 3, mimeType: "image/webp" };
  const grant = { url: `https://${"b".repeat(32)}.r2.cloudflarestorage.com/openmpd/${key}?signature=test`, method: "PUT",
    headers: { "content-length": "3", "content-type": "image/webp", "if-none-match": "*" }, expiresAt: Date.now() + 60000 };
  let calls = 0;
  const transport = async (url, init) => {
    calls++; assert.equal(url, grant.url); assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, undefined);
    const chunks = []; for await (const chunk of init.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3]));
    return new Response(null, { status: 200 });
  };
  assert.deepEqual(await api.uploadResultFile(file, grant, { fetch: transport }), { verificationRequired: true });
  await assert.rejects(api.uploadResultFile(file, { ...grant, url: "https://other.test/upload" }, { fetch: transport }));
  assert.equal(calls, 1);
});
