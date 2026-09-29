import { test } from "node:test";
import assert from "node:assert/strict";

test("processing results whitelist variants and construct immutable private keys", async () => {
  const api = await import("../src/lib/processing-result.ts").catch(() => ({}));
  assert.equal(typeof api.validateProcessingResult, "function");
  const id = crypto.randomUUID();
  const file = { role: "detail", mimeType: "image/webp", size: 100, sha256: "a".repeat(64), width: 480, height: 240 };
  const input = { files: [{ ...file, role: "thumbnail" }, file] };
  const result = api.validateProcessingResult(id, "image", input);
  assert.equal(result.files[1].key, `derivatives/${id}/${file.sha256}/detail.webp`);
  for (const bad of [{ files: [file] }, { ...input, published: true }, { files: [{ ...file, role: "thumbnail" }, { ...file, path: "C:/private" }] },
    { files: [{ ...file, role: "thumbnail" }, { ...file, size: 0 }] }, { files: [{ ...file, role: "thumbnail" }, { ...file, width: Infinity }] }]) {
    assert.throws(() => api.validateProcessingResult(id, "image", bad));
  }
  assert.throws(() => api.validateProcessingResult("../bad", "image", input));
  const video = { files: [{ ...file, role: "poster" }, { ...file, role: "video", mimeType: "video/mp4", duration: 1 }] };
  assert.equal(api.validateProcessingResult(id, "video", video).files[1].key.endsWith("/video.mp4"), true);
});
