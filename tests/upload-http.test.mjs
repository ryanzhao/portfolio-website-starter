import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("authenticated upload control lifecycle persists in local D1 and R2 without leaking private fields", async () => {
  const { handleUploadRequest } = await import("../src/lib/upload-http.ts");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: "2026-09-18", script: "export default {fetch(){return new Response(null)}}",
    r2Buckets: ["ORIGINALS"], d1Databases: ["UPLOADS"] }));
  try {
    const UPLOADS = await runtime.getD1Database("UPLOADS");
    const ORIGINALS = await runtime.getR2Bucket("ORIGINALS");
    for (const name of ["0001_uploads.sql", "0002_upload_completion.sql", "0003_processing.sql", "0006_upload_resume.sql", "0007_admin_write_limits.sql", "0009_designer_fonts.sql"]) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      await UPLOADS.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => UPLOADS.prepare(s)));
    }
    const env = { ACCESS_ISSUER: "https://test.cloudflareaccess.com", ACCESS_AUDIENCE: "test",
      ADMIN_EMAILS: "owner@example.test", ADMIN_ORIGIN: "https://admin.example.test", UPLOAD_QUOTA_BYTES: "1048576" };
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
    const sign = subject => new SignJWT({ email: env.ADMIN_EMAILS }).setSubject(subject).setIssuer(env.ACCESS_ISSUER)
      .setAudience(env.ACCESS_AUDIENCE).setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "RS256", kid: "test" }).sign(privateKey);
    const owner = await sign("owner");
    const other = await sign("other");
    const call = async (body, token = owner) => {
      const response = await handleUploadRequest(new Request(`${env.ADMIN_ORIGIN}/api/admin/uploads`, {
        method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json",
          origin: env.ADMIN_ORIGIN, "Cf-Access-Jwt-Assertion": token },
      }), env, async () => ({ UPLOADS, ORIGINALS }), keys);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json();
      for (const field of ["objectKey", "owner", "uploadId", "completionParts", "storageVersion", "storageEtag"]) {
        assert.equal(Object.hasOwn(data, field), false);
      }
      return { status: response.status, data };
    };
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64");
    const id = crypto.randomUUID();
    const file = { filename: "pixel.png", mimeType: "image/png", size: png.length };
    const begin = await call({ action: "begin", id, file });
    assert.equal(begin.status, 200);
    assert.equal(begin.data.status, "uploading");
    assert.deepEqual(await call({ action: "begin", id, file }), begin);
    assert.deepEqual(await call({ action: "read", id }), begin);
    const hashes = ["a".repeat(64)];
    assert.deepEqual(await call({ action: "prepare", id, hashes }), { status: 200, data: { parts: [] } });
    assert.equal((await call({ action: "prepare", id, hashes }, other)).status, 404);
    const list = async (token, offset = "0") => {
      const response = await handleUploadRequest(new Request(`${env.ADMIN_ORIGIN}/api/admin/uploads?offset=${offset}`, {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }), env, async () => ({ UPLOADS, ORIGINALS }), keys);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return { status: response.status, data: await response.json() };
    };
    const listed = await list(owner);
    assert.equal(listed.status, 200);
    assert.equal(listed.data.items.length, 1);
      assert.deepEqual(listed.data.quota,{totalBytes:1048576,usedBytes:file.size,remainingBytes:1048576-file.size});
    assert.equal(listed.data.items[0].id, id);
    assert.equal(listed.data.items[0].processingStatus, null);
    for (const field of ["owner", "objectKey", "uploadId", "storageEtag"]) assert.equal(field in listed.data.items[0], false);
    assert.deepEqual((await list(other)).data.items, []);
    assert.deepEqual((await list(owner, "1")).data.items, []);
    assert.equal((await list(owner, "-1")).status, 400);
    assert.equal((await call({ action: "part", id, partNumber: 1 })).status, 503);
    assert.equal((await call({ action: "part", id, partNumber: 1 }, other)).status, 404);
    for (const action of ["read", "cancel", "complete"]) {
      assert.equal((await call({ action, id }, other)).status, 404);
    }
    // Test harness supplies bytes via local R2 API; browser direct transfer is not implemented here.
    const row = await UPLOADS.prepare("SELECT * FROM upload_sessions WHERE id = ?").bind(id).first();
    const part = await ORIGINALS.resumeMultipartUpload(row.objectKey, row.uploadId).uploadPart(1, png);
    assert.equal((await call({ action: "receipt", id, ...part })).status, 200);
    assert.equal((await call({ action: "receipt", id, ...part }, other)).status, 404);
    assert.deepEqual((await call({ action: "prepare", id, hashes })).data.parts, [part]);
    await UPLOADS.prepare("UPDATE upload_sessions SET status='completing', completionParts=? WHERE id=?").bind(JSON.stringify([part]), id).run();
    assert.equal((await call({ action: "recover", id }, other)).status, 404);
    const recovered = await call({ action: "recover", id });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.status, "processing_pending");
    assert.deepEqual(await call({ action: "recover", id }), recovered);
    const completed = await call({ action: "complete", id, parts: [part] });
    assert.equal(completed.status, 200);
    assert.equal(completed.data.status, "processing_pending");
    await UPLOADS.prepare("INSERT INTO processing_jobs (assetId, status, createdAt) VALUES (?, 'pending', 1)").bind(id).run();
    for (const status of ["pending", "running", "failed", "ready"]) {
      await UPLOADS.prepare("UPDATE processing_jobs SET status = ? WHERE assetId = ?").bind(status, id).run();
      const item = (await list(owner)).data.items[0];
      assert.equal(item.processingStatus, status);
      assert.equal(item.status, "processing_pending");
      for (const field of ["leaseToken", "error", "resultManifest"]) assert.equal(field in item, false);
    }
    assert.deepEqual(await call({ action: "complete", id, parts: [part] }), completed);
    assert.equal((await call({ action: "cancel", id })).status, 409);
    assert.deepEqual(Buffer.from(await (await ORIGINALS.get(row.objectKey)).arrayBuffer()), png);
    const cancelId = crypto.randomUUID();
    assert.equal((await call({ action: "begin", id: cancelId, file })).status, 200);
    assert.equal((await call({ action: "cancel", id: cancelId })).data.status, "cancelled");
    assert.equal((await call({ action: "cancel", id: cancelId })).data.status, "cancelled");
  } finally { await runtime.dispose(); }
});

test("upload HTTP boundary authenticates before storage and rejects invalid bodies", async () => {
  const api = await import("../src/lib/upload-http.ts").catch(() => ({}));
  assert.equal(typeof api.handleUploadRequest, "function");
  const env = { ACCESS_ISSUER: "https://test.cloudflareaccess.com", ACCESS_AUDIENCE: "test",
    ADMIN_EMAILS: "owner@example.test", ADMIN_ORIGIN: "https://admin.example.test" };
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const token = await new SignJWT({ email: env.ADMIN_EMAILS }).setSubject("owner").setIssuer(env.ACCESS_ISSUER)
    .setAudience(env.ACCESS_AUDIENCE).setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "RS256", kid: "test" }).sign(privateKey);
  let calls = 0;
  const storage = async () => { calls++; throw new Error("SECRET must not escape"); };
  const request = (body, headers = {}) => new Request(`${env.ADMIN_ORIGIN}/api/admin/uploads`, {
    method: "POST", body, headers: { "content-type": "application/json", origin: env.ADMIN_ORIGIN,
      "Cf-Access-Jwt-Assertion": token, ...headers },
  });
  for (const [req, status] of [
    [request("{}", { "Cf-Access-Jwt-Assertion": "" }), 401],
    [request("{}", { origin: "https://other.test" }), 403],
    [request("{}", { "content-type": "text/plain" }), 415],
    [request("{"), 400], [request("x".repeat(131073)), 413],
    ...["null", "[]", "true", "42", '"read"'].map(body => [request(body), 400]),
    [request(JSON.stringify({ action: ["read"], id: crypto.randomUUID() })), 400],
    [request(JSON.stringify({ action: "begin", id: crypto.randomUUID(), owner: "attacker" })), 400],
  ]) {
    const response = await api.handleUploadRequest(req, env, storage, keys);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
  const response = await api.handleUploadRequest(request(JSON.stringify({ action: "read", id: crypto.randomUUID() })), env, storage, keys);
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.ok(!(await response.text()).includes("SECRET"));
});
