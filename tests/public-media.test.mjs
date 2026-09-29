import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("public media restricts keys, checks stored checksum and serves byte ranges", async () => {
  const api = await import("../src/lib/public-media.ts").catch(() => ({}));
  assert.equal(typeof api.readPublicMedia, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: "2026-09-18", script: "export default {fetch(){return new Response(null)}}", r2Buckets: ["PUBLISHED"] }));
  try {
    const bucket = await runtime.getR2Bucket("PUBLISHED");
    const bytes = new TextEncoder().encode("synthetic transport fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = `derivatives/${crypto.randomUUID()}/${sha256}/detail.webp`;
    await bucket.put(key, bytes, { sha256, httpMetadata: { contentType: "image/webp" } });
    const result = await api.readPublicMedia(bucket, key, "bytes=2-5");
    assert.deepEqual(result.range, { offset: 2, length: 4 });
    assert.deepEqual(Buffer.from(await result.object.arrayBuffer()), Buffer.from(bytes.slice(2, 6)));
    assert.equal(result.mimeType, "image/webp");
    const http = await import("../src/lib/public-media-http.ts").catch(() => ({}));
    assert.equal(typeof http.handlePublicMedia, "function");
    let calls = 0;
    const storage = async () => { calls++; return bucket; };
    const request = new Request(`https://site.example/api/media?key=${encodeURIComponent(key)}`, { headers: { range: "bytes=2-5" } });
    const disabled = await http.handlePublicMedia(request, {}, storage);
    assert.equal(disabled.status, 404);
    assert.equal(disabled.headers.get("cache-control"), "no-store");
    assert.equal(calls, 0);
    const enabled = { PUBLIC_MEDIA_ENABLED: "true" };
    const response = await http.handlePublicMedia(request, enabled, storage);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes 2-5/${bytes.length}`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes.slice(2, 6)));
    const head = await http.handlePublicMedia(new Request(request.url, { method: "HEAD" }), enabled, storage);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(bytes.length));
    assert.equal(await head.text(), "");
    assert.equal((await http.handlePublicMedia(new Request(`${request.url}&key=originals/private`), enabled, storage)).status, 400);
    await assert.rejects(api.readPublicMedia(bucket, "originals/private"), { status: 404 });
    await assert.rejects(api.readPublicMedia(bucket, key, "bytes=99999-"), { status: 416 });
    await bucket.put(key, "replaced without matching hash");
    await assert.rejects(api.readPublicMedia(bucket, key), { status: 409 });
  } finally { await runtime.dispose(); }
});
