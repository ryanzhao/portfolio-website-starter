import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

test("local image derivatives decode, resize and strip private EXIF", async () => {
  const api = await import("../scripts/local-images.mjs").catch(() => ({}));
  assert.equal(typeof api.imageVariants, "function");
  const original = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "red" } })
    .jpeg().withExif({ IFD0: { Artist: "Private owner" } }).toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const variants = await api.imageVariants(original);
  assert.deepEqual(variants.map(v => v.width), [480, 1200]);
  for (const variant of variants) {
    const metadata = await sharp(variant.bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.width, variant.width);
    assert.equal(metadata.height, variant.height);
    assert.match(variant.sha256, /^[a-f0-9]{64}$/);
  }
  await assert.rejects(api.imageVariants(Buffer.from("not an image")));
  const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: "blue" } }).png().toBuffer();
  const smallVariants = await api.imageVariants(small);
  assert.deepEqual(smallVariants.map(v => v.role), ["thumbnail", "detail"]);
  assert.deepEqual(smallVariants.map(v => v.width), [100, 100]);
  const { validateProcessingResult } = await import("../src/lib/processing-result.ts");
  const files = smallVariants.map(({ bytes, ...file }) => { assert.equal(file.size, bytes.length); return file; });
  assert.equal(validateProcessingResult(crypto.randomUUID(), "image", { files }).files.length, 2);
});
