import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("resume records freeze whole-file identity and isolate immutable receipts by owner", async () => {
  const api = await import("../src/lib/upload-resume.ts").catch(() => ({}));
  assert.equal(typeof api.prepareUploadResume, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false, compatibilityDate: "2026-09-19", script: "export default {fetch(){return new Response(null)}}", d1Databases: ["UPLOADS"] }));
  try {
    const db = await runtime.getD1Database("UPLOADS");
    for (const name of ["0001_uploads.sql", "0002_upload_completion.sql", "0006_upload_resume.sql"]) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    }
    const id = crypto.randomUUID(), hashes = ["a".repeat(64), "b".repeat(64)];
    await db.prepare("INSERT INTO upload_sessions (id,owner,filename,mimeType,size,kind,objectKey,uploadId,status,createdAt,expiresAt) VALUES (?,'owner','test.mp4','video/mp4',8388610,'video',?,'multipart','uploading',?,?)")
      .bind(id, `originals/${id}`, Date.now(), Date.now()+3600000).run();
    assert.deepEqual(await api.prepareUploadResume(db, "owner", id, hashes), []);
    await assert.rejects(api.prepareUploadResume(db, "other", id, hashes), { status: 404 });
    await assert.rejects(api.prepareUploadResume(db, "owner", id, [hashes[0], "c".repeat(64)]), { status: 409 });
    await assert.rejects(api.prepareUploadResume(db, "owner", id, [hashes[0]]), { status: 400 });
    await api.acknowledgeUploadPart(db, "owner", id, 1, '"receipt-1"');
    await api.acknowledgeUploadPart(db, "owner", id, 1, '"receipt-1"');
    assert.deepEqual(await api.prepareUploadResume(db, "owner", id, hashes), [{ partNumber: 1, etag: '"receipt-1"' }]);
    await assert.rejects(api.acknowledgeUploadPart(db, "other", id, 2, "receipt-2"), { status: 404 });
    await assert.rejects(api.acknowledgeUploadPart(db, "owner", id, 1, "changed"), { status: 409 });
    await assert.rejects(api.acknowledgeUploadPart(db, "owner", id, 3, "receipt"), { status: 400 });
    await assert.rejects(api.acknowledgeUploadPart(db, "owner", id, 2, "bad\nreceipt"), { status: 400 });
    await db.prepare("UPDATE upload_sessions SET expiresAt=createdAt+1 WHERE id=?").bind(id).run();
    await assert.rejects(api.prepareUploadResume(db, "owner", id, hashes), { status: 409 });
  } finally { await runtime.dispose(); }
});
