import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { beginUpload, completeUpload } from "../src/lib/uploads.ts";
import { handleProcessorRequest } from "../src/lib/processor-http.ts";
import { runProcessorJob } from "../scripts/processor-run.mjs";
import { readPrivateVariant } from "../src/lib/private-preview.ts";

const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import {publishDesignAsset} from './src/lib/designer/resources.ts';
  export default {async fetch(request,storage) {
    const {owner,id}=await request.json(); let document;
    const client={getDocument:async()=>document,mutate:async mutations=>{document=mutations[0].createIfNotExists;return {transactionId:'local-test'};}};
    try {return Response.json({media:await publishDesignAsset(storage,client,owner,id),document});}
    catch(error){return Response.json({error:error.message},{status:error.status||500});}
  }};` }, bundle: true, write: false, format: "esm", platform: "neutral", external: ["node:*"],
  conditions: ["workerd", "browser"], mainFields: ["browser", "module", "main"],
  // Font parsing is outside this model-only harness and must never be invoked.
  plugins: [{ name: "unused-font-parser", setup(builder) {
    builder.onResolve({ filter: /fontkit/ }, () => ({ path: "fontkit", namespace: "unused" }));
    builder.onLoad({ filter: /.*/, namespace: "unused" }, () => ({ contents: "export default {create(){throw new Error('font parser outside model test');}};" }));
  } }] });
const runtime = () => new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
  compatibilityDate: "2026-09-18", compatibilityFlags: ["nodejs_compat"], script: bundle.outputFiles[0].text,
  r2Buckets: ["ORIGINALS", "PUBLISHED", "BACKUPS"], d1Databases: ["UPLOADS"] }));
async function migrate(db, includeModel = true) {
  for (const name of (await readdir(new URL("../migrations/", import.meta.url))).filter(name => name.endsWith(".sql") && (includeModel || !name.startsWith("0010"))).sort()) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
}

test("model migration preserves image upload, processing, tags and resume foreign keys", async () => {
  const mf = runtime();
  try {
    const db = await mf.getD1Database("UPLOADS");
    await migrate(db, false);
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO upload_sessions (id,owner,filename,mimeType,size,kind,objectKey,uploadId,status,createdAt,expiresAt) VALUES (?,'owner','image.png','image/png',123,'image','original-test','multipart-id','uploading',1,9999999999999)").bind(id).run();
    await db.prepare("INSERT INTO processing_jobs (assetId,status,createdAt) VALUES (?,'failed',1)").bind(id).run();
    await db.prepare("INSERT INTO asset_tags (assetId,tags,revision) VALUES (?,'[\"retained\"]',3)").bind(id).run();
    await db.prepare("INSERT INTO upload_resume (assetId,partHashes) VALUES (?,'[\"hash\"]')").bind(id).run();
    await db.prepare("INSERT INTO upload_part_receipts (assetId,partNumber,etag) VALUES (?,1,'receipt')").bind(id).run();
    const tables = ["upload_sessions", "processing_jobs", "asset_tags", "upload_resume", "upload_part_receipts"];
    const before = await Promise.all(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()));
    const sql = await readFile(new URL("../migrations/0010_step_models.sql", import.meta.url), "utf8");
    await db.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    const after = await Promise.all(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()));
    assert.deepEqual(after.map(result => result.results), before.map(result => result.results));
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally { await mf.dispose(); }
});

test("real STEP upload through local processor, private preview and explicit GLB publication", {
  skip: !process.env.STEP_PYTHON_PATH,
}, async () => {
  const mf = runtime();
  try {
    const UPLOADS = await mf.getD1Database("UPLOADS"), ORIGINALS = await mf.getR2Bucket("ORIGINALS"), PUBLISHED = await mf.getR2Bucket("PUBLISHED");
    await migrate(UPLOADS);
    const directory = await mkdtemp(join(tmpdir(), "portfolio-step-pipeline-")), source = join(directory, "fixture.step");
    await promisify(execFile)(process.env.STEP_PYTHON_PATH, ["-I", "-c", "import cadquery as cq,sys; cq.exporters.export(cq.Workplane('XY').box(10,20,30),sys.argv[1])", source], { windowsHide: true, timeout: 120000 });
    const originalBytes = await readFile(source), id = crypto.randomUUID();
    const upload = await beginUpload(UPLOADS, ORIGINALS, "owner", id, { filename: "fixture.step", mimeType: "model/step", size: originalBytes.length }, 100 * 1024 ** 2);
    const part = await ORIGINALS.resumeMultipartUpload(upload.objectKey, upload.uploadId).uploadPart(1, originalBytes);
    const completed = await completeUpload(UPLOADS, ORIGINALS, "owner", id, [part]);
    assert.equal(completed.status, "processing_pending");
    assert.equal(completed.kind, "model");
    const env = { PROCESSOR_TOKEN: "a".repeat(64), R2_ACCOUNT_ID: "b".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "synthetic-test-key" };
    const actions = [];
    const transport = async (url, init) => {
      if (init.method === "PUT") {
        const chunks = []; for await (const chunk of init.body) chunks.push(chunk);
        await ORIGINALS.put(new URL(url).pathname.slice("/openmpd/".length), Buffer.concat(chunks));
        return new Response(null, { status: 200 });
      }
      actions.push(JSON.parse(init.body).action);
      return handleProcessorRequest(new Request(url, init), env, async () => ({ UPLOADS, ORIGINALS }));
    };
    const result = await runProcessorJob("https://admin.example.test", env.PROCESSOR_TOKEN, directory, { fetch: transport });
    assert.equal(result.status, "ready");
    assert.equal(result.published, false);
    assert.deepEqual(actions, ["claim", "source", "register", "authorize-result", "complete"]);
    const preview = await readPrivateVariant(UPLOADS, ORIGINALS, "owner", id, "model");
    const glb = Buffer.from(await preview.object.arrayBuffer());
    assert.equal(preview.mimeType, "model/gltf-binary");
    assert.equal(preview.width, undefined);
    assert.equal(glb.toString("ascii", 0, 4), "glTF");
    await assert.rejects(readPrivateVariant(UPLOADS, ORIGINALS, "other", id, "model"), { status: 404 });
    await assert.rejects(readPrivateVariant(UPLOADS, ORIGINALS, "owner", id, "original"));
    assert.equal((await PUBLISHED.list()).objects.length, 0);
    // Re-upload a completed GLB: validate and preserve its bytes without CAD conversion.
    const glbId = crypto.randomUUID();
    const direct = await beginUpload(UPLOADS, ORIGINALS, "owner", glbId, { filename: "ready.glb", mimeType: "model/gltf-binary", size: glb.length }, 100 * 1024 ** 2);
    const glbPart = await ORIGINALS.resumeMultipartUpload(direct.objectKey, direct.uploadId).uploadPart(1, glb);
    await completeUpload(UPLOADS, ORIGINALS, "owner", glbId, [glbPart]);
    const python = process.env.STEP_PYTHON_PATH;
    try {
      delete process.env.STEP_PYTHON_PATH;
      assert.equal((await runProcessorJob("https://admin.example.test", env.PROCESSOR_TOKEN, directory, { fetch: transport })).status, "ready");
    } finally { process.env.STEP_PYTHON_PATH = python; }
    const directPreview = await readPrivateVariant(UPLOADS, ORIGINALS, "owner", glbId, "model");
    assert.deepEqual(Buffer.from(await directPreview.object.arrayBuffer()), glb);
    assert.equal((await PUBLISHED.list()).objects.length, 0);
    const publish = owner => mf.dispatchFetch("https://test.invalid/publish", { method: "POST", body: JSON.stringify({ owner, id }) });
    assert.equal((await publish("other")).status, 404);
    const response = await publish("owner");
    assert.equal(response.status, 200, await response.clone().text());
    const released = await response.json();
    assert.equal(released.media.kind, "model");
    assert.equal(released.document.variants.length, 1);
    const publicFiles = (await PUBLISHED.list()).objects;
    assert.equal(publicFiles.length, 1);
    assert.ok(publicFiles[0].key.endsWith("/model.glb"));
    assert.deepEqual(Buffer.from(await (await PUBLISHED.get(publicFiles[0].key)).arrayBuffer()), glb);
    assert.equal(await PUBLISHED.get(upload.objectKey), null);
    assert.deepEqual(Buffer.from(await (await ORIGINALS.get(upload.objectKey)).arrayBuffer()), originalBytes);
    await ORIGINALS.put(preview.object.key, "corrupted GLB");
    await assert.rejects(readPrivateVariant(UPLOADS, ORIGINALS, "owner", id, "model"));
    assert.notEqual((await publish("owner")).status, 200);
    assert.deepEqual(Buffer.from(await (await PUBLISHED.get(publicFiles[0].key)).arrayBuffer()), glb, "failed replacement preserves published GLB");
  } finally { await mf.dispose(); }
});
