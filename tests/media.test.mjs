import { test } from "node:test";
import assert from "node:assert/strict";

test("stored upload inspection checks actual length and file signature without declaring readiness", async () => {
  const media = await import("../src/lib/media-inspection.ts");
  assert.equal(typeof media.inspectStoredUpload, "function");
  // Complete 1x1 PNG; no owner media or cloud fixtures needed.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
  const declared = { filename: "pixel.png", mimeType: "image/png", size: png.length };
  assert.deepEqual(await media.inspectStoredUpload(declared, png.length, png), { ...declared, kind: "image", processingStatus: "processing_pending" });
  for (const [input, length, bytes] of [
    [declared, png.length - 1, png],
    [declared, png.length + 1, png],
    [declared, NaN, png],
    [declared, png.length, Buffer.from("<svg onload='alert(1)'></svg>")],
    [declared, png.length, png.subarray(0, 3)],
    [{ ...declared, filename: "pixel.jpg", mimeType: "image/jpeg" }, png.length, png],
    [declared, png.length, Buffer.alloc(0)],
    [declared, png.length, new Uint8Array(65537)],
  ]) {
    await assert.rejects(media.inspectStoredUpload(input, length, bytes), { name: "MediaValidationError" });
  }
});

test("upload metadata and placements reject unsafe or incompatible input", async () => {
  const media = await import("../src/lib/media.ts").catch(() => ({}));
  assert.equal(typeof media.validateUpload, "function", "upload contract must exist");
  const valid = { filename: "experiment.jpg", mimeType: "image/jpeg", size: 1024 };
  assert.deepEqual(media.validateUpload(valid), { ...valid, kind: "image" });
  assert.equal(media.validateUpload({ filename: "demo.mp4", mimeType: "video/mp4", size: 100 * 1024 * 1024 }).kind, "video");
  for (const value of [null, [], {}, { ...valid, filename: "../private.jpg" }, { ...valid, filename: "C:\\private.jpg" }, { ...valid, filename: "bad\u0000.jpg" }, { ...valid, filename: "bad.svg" }, { ...valid, mimeType: "image/svg+xml" }, { ...valid, size: 0 }, { ...valid, size: -1 }, { ...valid, size: 1.1 }, { ...valid, size: Number.MAX_SAFE_INTEGER }, { ...valid, size: "1024" }]) {
    assert.throws(() => media.validateUpload(value), { name: "MediaValidationError" });
  }
  assert.throws(() => media.validateUpload({ filename: "demo.mov", mimeType: "video/quicktime", size: 1024 }));
  assert.throws(() => media.validateUpload(valid, { image: 512, video: 2048 }));
  assert.equal(new Set(media.mediaSlots.map(s => s.id)).size, media.mediaSlots.length);
  assert.ok(media.mediaSlots.length >= 20);
  const placement = { slotId: "home.hero", assetId: "d88b3683-9f17-448f-9f50-d18ee9c40f37", alt: "Engine test stand", caption: "" };
  assert.deepEqual(media.validatePlacement(placement, "image"), placement);
  assert.throws(() => media.validatePlacement(placement, "video"));
  assert.throws(() => media.validatePlacement({ ...placement, slotId: "unknown" }, "image"));
  assert.throws(() => media.validatePlacement({ ...placement, assetId: "../../private" }, "image"));
  assert.throws(() => media.validatePlacement({ ...placement, alt: "" }, "image"));
  assert.throws(() => media.validatePlacement({ ...placement, publicUrl: "https://attacker.example" }, "image"));
});

test('STEP declarations and stored headers stay private and require CAD decoding', async () => {
  const {validateUpload,validatePlacement}=await import('../src/lib/media.ts');
  const {inspectStoredUpload}=await import('../src/lib/media-inspection.ts');
  const bytes=Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;");
  const input={filename:'assembly.STP',mimeType:'model/step',size:bytes.length};
  assert.equal(validateUpload(input).kind,'model');
  assert.equal((await inspectStoredUpload(input,bytes.length,bytes)).processingStatus,'processing_pending');
  for(const size of [196334*1024,2*1024**3])assert.equal(validateUpload({...input,size}).kind,'model');
  for(const changed of [{filename:'x.glb'},{mimeType:'application/octet-stream'},{filename:'../x.step'},{size:2*1024**3+1}])assert.throws(()=>validateUpload({...input,...changed}));
  for(const content of ['<script>evil</script>','ISO-10303-21; no schema', 'ISO-10303-21;HEADER;FILE_SCHEMA((\x00))']){
    const bad=Buffer.from(content);await assert.rejects(inspectStoredUpload({...input,size:bad.length},bad.length,bad));
  }
  assert.throws(()=>validatePlacement({slotId:'home.hero',assetId:crypto.randomUUID(),alt:'CAD',caption:''},'model'));
});
