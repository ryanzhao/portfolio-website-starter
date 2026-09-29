import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("processing leases exclude concurrent workers and permit expired work to retry", async () => {
  const api = await import("../src/lib/processing.ts").catch(() => ({}));
  assert.equal(typeof api.claimProcessingJob, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: "2026-09-18", script: "export default {fetch(){return new Response(null)}}", d1Databases: ["UPLOADS"], r2Buckets: ["ORIGINALS"] }));
  try {
    const db = await runtime.getD1Database("UPLOADS");
    for (const name of ["0001_uploads.sql", "0002_upload_completion.sql", "0003_processing.sql", "0004_processing_result.sql"]) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    }
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO upload_sessions (id, owner, filename, mimeType, size, kind, objectKey, status, createdAt, expiresAt, storageVersion, storageEtag)
      VALUES (?, 'owner', 'test.png', 'image/png', 68, 'image', ?, 'processing_pending', 1, 2, 'version', 'etag')`).bind(id, `originals/${id}`).run();
    const results = await Promise.all([api.claimProcessingJob(db, 1000), api.claimProcessingJob(db, 1000)]);
    const job = results.find(Boolean);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(job.assetId, id);
    assert.equal(job.attempts, 1);
    assert.equal(typeof api.registerProcessingResult, "function");
    const file = { mimeType: "image/webp", size: 100, sha256: "a".repeat(64), width: 100, height: 50 };
    const manifest = { files: [{ ...file, role: "thumbnail" }, { ...file, role: "detail" }] };
    const registered = await api.registerProcessingResult(db, id, job.leaseToken, manifest, 1001);
    const signing = await import("../src/lib/result-signing.ts").catch(() => ({}));
    assert.equal(typeof signing.signResultUpload, "function");
    const signEnv = { R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret" };
    const grant = await signing.signResultUpload(db, id, job.leaseToken, "detail", signEnv, 1001);
    const signedUrl = new URL(grant.url);
    assert.equal(signedUrl.pathname, `/openmpd/${registered.files[1].key}`);
    assert.equal(grant.headers["if-none-match"], "*");
    assert.equal(grant.headers["content-length"], "100");
    assert.ok(signedUrl.searchParams.get("X-Amz-SignedHeaders").includes("if-none-match"));
    await assert.rejects(signing.signResultUpload(db, id, crypto.randomUUID(), "detail", signEnv, 1001), { status: 409 });
    await assert.rejects(signing.signResultUpload(db, id, job.leaseToken, "../originals", signEnv, 1001));
    assert.deepEqual(await api.registerProcessingResult(db, id, job.leaseToken, manifest, 1001), registered);
    await assert.rejects(api.registerProcessingResult(db, id, crypto.randomUUID(), manifest, 1001), { status: 409 });
    await assert.rejects(api.registerProcessingResult(db, id, job.leaseToken, { files: manifest.files.map(f => ({ ...f, size: 101 })) }, 1001), { status: 409 });
    assert.equal(typeof api.processingSource, "function");
    const bucket = await runtime.getR2Bucket("ORIGINALS");
    const original = await bucket.put(`originals/${id}`, new Uint8Array(68));
    await db.prepare("UPDATE upload_sessions SET storageVersion = ?, storageEtag = ? WHERE id = ?").bind(original.version, original.etag, id).run();
    const source = await api.processingSource(db, bucket, id, job.leaseToken, 1001);
    assert.equal((await source.arrayBuffer()).byteLength, 68);
    const { handleProcessorRequest } = await import("../src/lib/processor-http.ts");
    const request = token => new Request("https://admin.example.test/api/processor", {
      method: "POST", headers: { authorization: `Bearer ${"a".repeat(64)}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "source", assetId: id, leaseToken: token }),
    });
    // Endpoint uses real wall time, unlike the deterministic lease unit checks.
    await db.prepare("UPDATE processing_jobs SET leaseExpiresAt = ? WHERE assetId = ?").bind(Date.now() + 60000, id).run();
    const response = await handleProcessorRequest(request(job.leaseToken), { PROCESSOR_TOKEN: "a".repeat(64) }, async () => ({ UPLOADS: db, ORIGINALS: bucket }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal((await response.arrayBuffer()).byteLength, 68);
    const registerResponse = await handleProcessorRequest(new Request("https://admin.example.test/api/processor", {
      method: "POST", headers: { authorization: `Bearer ${"a".repeat(64)}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "register", assetId: id, leaseToken: job.leaseToken, result: manifest }),
    }), { PROCESSOR_TOKEN: "a".repeat(64) }, async () => ({ UPLOADS: db, ORIGINALS: bucket }));
    assert.equal(registerResponse.status, 200);
    assert.equal(registerResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual(await registerResponse.json(), { result: registered, ready: false });
    const grantResponse = await handleProcessorRequest(new Request("https://admin.example.test/api/processor", {
      method: "POST", headers: { authorization: `Bearer ${"a".repeat(64)}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "authorize-result", assetId: id, leaseToken: job.leaseToken, role: "detail" }),
    }), { PROCESSOR_TOKEN: "a".repeat(64), ...signEnv }, async () => ({ UPLOADS: db, ORIGINALS: bucket }));
    assert.equal(grantResponse.status, 200);
    assert.equal(grantResponse.headers.get("cache-control"), "no-store");
    assert.equal((await grantResponse.json()).headers["if-none-match"], "*");
    // Real loopback HTTP transport with production handler and local D1/R2.
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const request = new Request(`http://127.0.0.1${incoming.url}`, {
          method: incoming.method, headers: incoming.headers, body: Buffer.concat(chunks),
        });
        const reply = await handleProcessorRequest(request, { PROCESSOR_TOKEN: "a".repeat(64) }, async () => ({ UPLOADS: db, ORIGINALS: bucket }));
        outgoing.writeHead(reply.status, Object.fromEntries(reply.headers));
        if (reply.body) Readable.fromWeb(reply.body).pipe(outgoing); else outgoing.end();
      } catch { outgoing.writeHead(500); outgoing.end(); }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { downloadSource } = await import("../scripts/processor-download.mjs");
      const folder = await mkdtemp(join(tmpdir(), "portfolio-http-source-"));
      const destination = join(folder, "original");
      const origin = `http://127.0.0.1:${server.address().port}`;
      assert.equal(await downloadSource(origin, "a".repeat(64), job, destination), 68);
      assert.deepEqual(await readFile(destination), Buffer.alloc(68));
      await assert.rejects(downloadSource(origin, "b".repeat(64), job, join(folder, "denied")));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    const denied = await handleProcessorRequest(request(crypto.randomUUID()), { PROCESSOR_TOKEN: "a".repeat(64) }, async () => ({ UPLOADS: db, ORIGINALS: bucket }));
    assert.equal(denied.status, 409);
    await db.prepare("UPDATE processing_jobs SET leaseExpiresAt = ? WHERE assetId = ?").bind(job.leaseExpiresAt, id).run();
    await assert.rejects(api.processingSource(db, bucket, id, crypto.randomUUID(), 1001), { status: 409 });
    await bucket.put(`originals/${id}`, new Uint8Array(68));
    await assert.rejects(api.processingSource(db, bucket, id, job.leaseToken, 1001), { status: 409 });
    assert.equal(await api.claimProcessingJob(db, 1001), null);
    const retry = await api.claimProcessingJob(db, job.leaseExpiresAt + 1);
    assert.equal(retry.attempts, 2);
    assert.notEqual(retry.leaseToken, job.leaseToken);
    assert.equal(typeof api.renewProcessingLease, "function");
    await assert.rejects(api.renewProcessingLease(db, id, job.leaseToken, retry.leaseExpiresAt - 1), { status: 409 });
    const renewed = await api.renewProcessingLease(db, id, retry.leaseToken, retry.leaseExpiresAt - 1);
    assert.ok(renewed.leaseExpiresAt > retry.leaseExpiresAt);
    await assert.rejects(api.renewProcessingLease(db, id, retry.leaseToken, renewed.leaseExpiresAt), { status: 409 });
    const last = await api.claimProcessingJob(db, renewed.leaseExpiresAt + 1);
    assert.equal(last.attempts, 3);
    assert.equal(await api.claimProcessingJob(db, last.leaseExpiresAt + 1), null);
    const failed = await db.prepare("SELECT status, leaseToken FROM processing_jobs WHERE assetId = ?").bind(id).first();
    assert.deepEqual(failed, { status: "failed", leaseToken: null });
    assert.equal((await db.prepare("SELECT status FROM upload_sessions WHERE id = ?").bind(id).first()).status, "processing_pending");
  } finally { await runtime.dispose(); }
});
