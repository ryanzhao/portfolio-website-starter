import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import * as inspection from "../src/lib/media-inspection.ts";

test("private R2 inspection reads stored bytes and leaves rejected originals untouched", async () => {
  assert.equal(typeof inspection.inspectPrivateObject, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: "2026-09-18",
    cf: false,
    script: "export default { fetch() { return new Response(null, { status: 404 }); } }",
    r2Buckets: ["ORIGINALS"],
  }));
  try {
    const bucket = await runtime.getR2Bucket("ORIGINALS");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
    const declared = { filename: "pixel.png", mimeType: "image/png", size: png.length };
    const key = "originals/" + crypto.randomUUID();
    await assert.rejects(inspection.inspectPrivateObject(bucket, key, declared), { name: "MediaValidationError" });
    const original = await bucket.put(key, png);
    const result = await inspection.inspectPrivateObject(bucket, key, declared);
    assert.equal(result.processingStatus, "processing_pending");
    assert.equal(result.storageVersion, original.version);
    assert.equal(result.storageEtag, original.etag);
    // Force a real storage replacement between HEAD and GET. Even identical
    // bytes/ETag must not silently validate a different storage version.
    for (const replacement of [png, Buffer.from("changed bytes")]) {
      await bucket.put(key, png);
      const changingBucket = {
        head: name => bucket.head(name),
        get: async (name, options) => {
          await bucket.put(name, replacement);
          return bucket.get(name, options);
        },
      };
      await assert.rejects(inspection.inspectPrivateObject(changingBucket, key, declared), { name: "MediaValidationError" });
    }
    // The storage response reports full size but transfers only the bounded prefix.
    const large = Buffer.concat([png, Buffer.alloc(128 * 1024)]);
    await bucket.put(key, large);
    assert.equal((await inspection.inspectPrivateObject(bucket, key, { ...declared, size: large.length })).size, large.length);
    await bucket.put(key, png);
    await assert.rejects(inspection.inspectPrivateObject(bucket, key, { ...declared, size: png.length + 1 }), { name: "MediaValidationError" });
    await assert.rejects(inspection.inspectPrivateObject(bucket, "../" + key, declared), { name: "MediaValidationError" });
    await bucket.put(key, "<script>not a photograph</script>");
    const invalid = { ...declared, size: (await bucket.head(key)).size };
    await assert.rejects(inspection.inspectPrivateObject(bucket, key, invalid), { name: "MediaValidationError" });
    assert.equal(await (await bucket.get(key)).text(), "<script>not a photograph</script>");
  } finally {
    await runtime.dispose();
  }
});
