import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("stored derivative verification hashes actual private bytes and rejects mismatches", async () => {
  const api = await import("../src/lib/derivative-verification.ts").catch(() => ({}));
  assert.equal(typeof api.verifyDerivative, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: "2026-09-18", script: "export default {fetch(){return new Response(null)}}", r2Buckets: ["ORIGINALS"], d1Databases: ["UPLOADS"] }));
  try {
    const bucket = await runtime.getR2Bucket("ORIGINALS");
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).webp().toBuffer();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const file = { key: `derivatives/${crypto.randomUUID()}/${sha256}/detail.webp`, size: bytes.length, sha256, mimeType: "image/webp" };
    const stored = await bucket.put(file.key, bytes);
    assert.deepEqual(await api.verifyDerivative(bucket, file), { key: file.key, version: stored.version, etag: stored.etag });
    await assert.rejects(api.verifyDerivative(bucket, { ...file, size: 1 }));
    await assert.rejects(api.verifyDerivative(bucket, { ...file, mimeType: "video/mp4" }));
    const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
    await bucket.put(file.key, changed);
    await assert.rejects(api.verifyDerivative(bucket, file));
    const processing = await import("../src/lib/processing.ts");
    assert.equal(typeof processing.completeProcessing, "function");
    const db = await runtime.getD1Database("UPLOADS");
    for (const name of ["0001_uploads.sql", "0002_upload_completion.sql", "0003_processing.sql", "0004_processing_result.sql", "0005_processing_verified.sql"]) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    }
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO upload_sessions (id, owner, filename, mimeType, size, kind, objectKey, status, createdAt, expiresAt, storageVersion, storageEtag)
      VALUES (?, 'owner', 'image.png', 'image/png', 100, 'image', ?, 'processing_pending', 1, 2, 'v', 'e')`).bind(id, `originals/${id}`).run();
    const job = await processing.claimProcessingJob(db);
    const declaration = { mimeType: "image/webp", size: bytes.length, sha256, width: 10, height: 10 };
    const result = await processing.registerProcessingResult(db, id, job.leaseToken, { files: [{ ...declaration, role: "thumbnail" }, { ...declaration, role: "detail" }] });
    await assert.rejects(processing.completeProcessing(db, bucket, id, job.leaseToken));
    for (const variant of result.files) await bucket.put(variant.key, bytes);
    assert.equal((await processing.completeProcessing(db, bucket, id, job.leaseToken)).status, "ready");
    assert.deepEqual(await processing.completeProcessing(db, bucket, id, job.leaseToken), { assetId: id, status: "ready" });
    const { handleProcessorRequest } = await import("../src/lib/processor-http.ts");
    const reply = await handleProcessorRequest(new Request("https://admin.example.test/api/processor", {
      method: "POST", headers: { authorization: `Bearer ${"a".repeat(64)}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", assetId: id, leaseToken: job.leaseToken }),
    }), { PROCESSOR_TOKEN: "a".repeat(64) }, async () => ({ UPLOADS: db, ORIGINALS: bucket }));
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { job: { assetId: id, status: "ready" }, published: false });
    const row = await db.prepare("SELECT verifiedObjects FROM processing_jobs WHERE assetId = ?").bind(id).first();
    assert.equal(JSON.parse(row.verifiedObjects).length, 2);
    const preview = await import("../src/lib/private-preview.ts").catch(() => ({}));
    assert.equal(typeof preview.readPrivateVariant, "function");
    const asset = await preview.readPrivateVariant(db, bucket, "owner", id, "detail");
    assert.equal(asset.mimeType, "image/webp");
    assert.deepEqual(Buffer.from(await asset.object.arrayBuffer()), bytes);
    for (const [header, start, end] of [["bytes=2-8", 2, 9], ["bytes=4-", 4, bytes.length], ["bytes=-5", bytes.length - 5, bytes.length], ["bytes=0-999999", 0, bytes.length]]) {
      const partial = await preview.readPrivateVariant(db, bucket, "owner", id, "detail", header);
      assert.deepEqual(partial.range, { offset: start, length: end - start });
      assert.deepEqual(Buffer.from(await partial.object.arrayBuffer()), bytes.subarray(start, end));
    }
    for (const header of ["bytes=999999-", "bytes=9-2", "bytes=-0", "bytes=0-1,4-5", "bytes=1e2-", "items=0-1"]) {
      await assert.rejects(preview.readPrivateVariant(db, bucket, "owner", id, "detail", header), { status: 416 });
    }
    const { handlePrivatePreview } = await import("../src/lib/private-preview-http.ts");
    const env = { ACCESS_ISSUER: "https://test.cloudflareaccess.com", ACCESS_AUDIENCE: "test", ADMIN_EMAILS: "owner@example.test", ADMIN_ORIGIN: "https://admin.example.test" };
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
    const token = await new SignJWT({ email: "owner@example.test" }).setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("owner").setIssuer(env.ACCESS_ISSUER).setAudience(env.ACCESS_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const httpPreview = range => handlePrivatePreview(new Request(`${env.ADMIN_ORIGIN}/api/admin/media?assetId=${id}&role=detail`, {
      headers: { "Cf-Access-Jwt-Assertion": token, ...(range ? { Range: range } : {}) },
    }), env, async () => ({ UPLOADS: db, ORIGINALS: bucket }), keys);
    const partialResponse = await httpPreview("bytes=2-8");
    assert.equal(partialResponse.status, 206);
    assert.equal(partialResponse.headers.get("content-range"), `bytes 2-8/${bytes.length}`);
    assert.equal(partialResponse.headers.get("content-length"), "7");
    assert.equal(partialResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(partialResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await partialResponse.arrayBuffer()), bytes.subarray(2, 9));
    assert.equal((await httpPreview("bytes=999999-")).status, 416);
    const fullResponse = await httpPreview();
    assert.equal(fullResponse.status, 200);
    assert.deepEqual(Buffer.from(await fullResponse.arrayBuffer()), bytes);
    await assert.rejects(preview.readPrivateVariant(db, bucket, "another-owner", id, "detail"), { status: 404 });
    await assert.rejects(preview.readPrivateVariant(db, bucket, "owner", id, "original"), { status: 404 });
    await bucket.put(result.files[1].key, bytes);
    await assert.rejects(preview.readPrivateVariant(db, bucket, "owner", id, "detail"), { status: 409 });
    await assert.rejects(processing.completeProcessing(db, bucket, id, crypto.randomUUID()), { status: 409 });
  } finally { await runtime.dispose(); }
});
