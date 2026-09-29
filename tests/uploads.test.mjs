import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("upload sessions persist, reserve quota atomically, enforce ownership and cancel multipart safely", async () => {
  const uploads = await import("../src/lib/uploads.ts").catch(() => ({}));
  assert.equal(typeof uploads.beginUpload, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, cf: false, compatibilityDate: "2026-09-18",
    script: "export default { fetch() { return new Response(null, {status:404}); } }",
    r2Buckets: ["ORIGINALS"], d1Databases: ["UPLOADS"],
  }));
  try {
    const db = await runtime.getD1Database("UPLOADS");
    const bucket = await runtime.getR2Bucket("ORIGINALS");
    const migration = await readFile(new URL("../migrations/0001_uploads.sql", import.meta.url), "utf8");
    await db.batch(migration.split(";").map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
    const fontMigration = await readFile(new URL("../migrations/0009_designer_fonts.sql", import.meta.url), "utf8");
    await db.batch(fontMigration.split(";").map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
    const owner = "admin-test-subject";
    const file = { filename: "test.mp4", mimeType: "video/mp4", size: 9 * 1024 * 1024 };
    const id = crypto.randomUUID();
    const quota = file.size * 2;
    const [first, retry] = await Promise.all([0, 1].map(() => uploads.beginUpload(db, bucket, owner, id, file, quota)));
    assert.equal(retry.uploadId, first.uploadId);
    assert.equal(first.status, "uploading");
    assert.ok(first.uploadId);
    assert.equal(first.objectKey, `originals/${id}`);
    assert.equal((await uploads.beginUpload(db, bucket, owner, id, file, quota)).uploadId, first.uploadId);
    assert.equal((await uploads.readUpload(db, owner, id)).id, id);
    await assert.rejects(uploads.readUpload(db, "someone-else", id), { status: 404 });
    await assert.rejects(uploads.beginUpload(db, bucket, "someone-else", id, file, quota), { status: 404 });
    await assert.rejects(uploads.beginUpload(db, bucket, owner, id, { ...file, size: file.size - 1 }, quota), { status: 409 });
    assert.deepEqual(uploads.uploadPartRange(first, 2), { offset: 8 * 1024 * 1024, length: 1024 * 1024 });
    for (const part of [0, -1, 3, 1.5, "1"]) assert.throws(() => uploads.uploadPartRange(first, part));
    const attempts = await Promise.allSettled([0, 1].map(() => uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), file, quota)));
    assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(attempts.find(x => x.status === "rejected").reason.status, 413);
    await assert.rejects(uploads.cancelUpload(db, bucket, "someone-else", id), { status: 404 });
    assert.equal((await uploads.cancelUpload(db, bucket, owner, id)).status, "cancelled");
    assert.equal((await uploads.cancelUpload(db, bucket, owner, id)).status, "cancelled");
    await assert.rejects(bucket.resumeMultipartUpload(first.objectKey, first.uploadId).uploadPart(1, "x"));
    assert.equal((await uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), file, quota)).status, "uploading");
    assert.throws(() => uploads.uploadPartRange({ ...first, expiresAt: 1 }, 1), { status: 409 });
    assert.throws(() => uploads.uploadPartRange({ ...first, status: "cancelled" }, 1), { status: 409 });
    await db.prepare("UPDATE upload_sessions SET createdAt = 1, expiresAt = 2 WHERE status = 'uploading'").run();
    const expired = await db.prepare("SELECT id FROM upload_sessions WHERE status = 'uploading' LIMIT 1").first();
    await assert.rejects(uploads.beginUpload(db, bucket, owner, expired.id, file, quota), { status: 409 });
    assert.equal((await uploads.cancelUpload(db, bucket, owner, expired.id)).status, "cancelled");
    await assert.rejects(uploads.beginUpload(db, bucket, owner, "../bad", file, quota));
    await assert.rejects(uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), file, NaN));
  } finally { await runtime.dispose(); }
});

test("multipart completion is retryable and rejects disguised files without deleting originals", async () => {
  const uploads = await import("../src/lib/uploads.ts");
  assert.equal(typeof uploads.completeUpload, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, cf: false, compatibilityDate: "2026-09-18",
    script: "export default { fetch() { return new Response(null, {status:404}); } }",
    r2Buckets: ["ORIGINALS"], d1Databases: ["UPLOADS"],
  }));
  try {
    const db = await runtime.getD1Database("UPLOADS");
    const bucket = await runtime.getR2Bucket("ORIGINALS");
    for (const path of ["0001_uploads.sql", "0002_upload_completion.sql", "0009_designer_fonts.sql"]) {
      const sql = await readFile(new URL(`../migrations/${path}`, import.meta.url), "utf8");
      await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    }
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
    const owner = "admin-test-subject";
    const metadata = { filename: "pixel.png", mimeType: "image/png", size: png.length };
    const session = await uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), metadata, 1024 * 1024);
    const part = await bucket.resumeMultipartUpload(session.objectKey, session.uploadId).uploadPart(1, png);
    await assert.rejects(uploads.completeUpload(db, bucket, "another-owner", session.id, [part]), { status: 404 });
    for (const parts of [null, [], [part, part], [{ ...part, partNumber: 2 }], [{ ...part, etag: "" }], [{ ...part, publicUrl: "evil" }]]) {
      await assert.rejects(uploads.completeUpload(db, bucket, owner, session.id, parts), { status: 400 });
    }
    const done = await uploads.completeUpload(db, bucket, owner, session.id, [part]);
    assert.equal(done.status, "processing_pending");
    assert.equal(done.storageVersion, (await bucket.head(session.objectKey)).version);
    assert.equal((await uploads.completeUpload(db, bucket, owner, session.id, [part])).storageVersion, done.storageVersion);
    await assert.rejects(uploads.completeUpload(db, bucket, owner, session.id, [{ ...part, etag: "changed" }]), { status: 409 });
    await assert.rejects(uploads.cancelUpload(db, bucket, owner, session.id), { status: 409 });
    assert.deepEqual(Buffer.from(await (await bucket.get(session.objectKey)).arrayBuffer()), png);
    // S3 UploadPart sends a quoted HTTP ETag, unlike the Workers binding.
    const s3Session = await uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), metadata, 1024 * 1024);
    const s3Part = await bucket.resumeMultipartUpload(s3Session.objectKey, s3Session.uploadId).uploadPart(1, png);
    const receipt = { ...s3Part, etag: `"${s3Part.etag}"` };
    assert.equal((await uploads.completeUpload(db, bucket, owner, s3Session.id, [receipt])).status, "processing_pending");
    const badBytes = Buffer.from("This is not a PNG");
    const bad = await uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), { ...metadata, size: badBytes.length }, 1024 * 1024);
    const badPart = await bucket.resumeMultipartUpload(bad.objectKey, bad.uploadId).uploadPart(1, badBytes);
    await assert.rejects(uploads.completeUpload(db, bucket, owner, bad.id, [badPart]), { name: "MediaValidationError" });
    assert.equal((await uploads.readUpload(db, owner, bad.id)).status, "rejected");
    assert.ok(await bucket.head(bad.objectKey));
    const wrongReceipt = await uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), metadata, 1024 * 1024);
    await bucket.resumeMultipartUpload(wrongReceipt.objectKey, wrongReceipt.uploadId).uploadPart(1, png);
    await assert.rejects(uploads.completeUpload(db, bucket, owner, wrongReceipt.id, [{ partNumber: 1, etag: "incorrect-receipt" }]));
    assert.equal((await uploads.readUpload(db, owner, wrongReceipt.id)).status, "completing");
    assert.equal((await uploads.cancelUpload(db, bucket, owner, wrongReceipt.id)).status, "cancelled");
    // Simulate lost response after R2 completion, before D1 records inspection.
    const interrupted = await uploads.beginUpload(db, bucket, owner, crypto.randomUUID(), metadata, 1024 * 1024);
    const multipart = bucket.resumeMultipartUpload(interrupted.objectKey, interrupted.uploadId);
    const interruptedPart = await multipart.uploadPart(1, png);
    await multipart.complete([interruptedPart]);
    await db.prepare("UPDATE upload_sessions SET status = 'completing', completionParts = ? WHERE id = ?").bind(JSON.stringify([interruptedPart]), interrupted.id).run();
    await assert.rejects(uploads.cancelUpload(db, bucket, owner, interrupted.id), { status: 409 });
    assert.ok(await bucket.head(interrupted.objectKey));
    assert.equal((await uploads.completeUpload(db, bucket, owner, interrupted.id, [interruptedPart])).status, "processing_pending");
  } finally { await runtime.dispose(); }
});
