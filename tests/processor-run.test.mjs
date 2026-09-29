import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";

// Isolated harness only, never mounted in the application or deployed.
const worker = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { copyPublishedVariant } from './src/lib/publish-media.ts';
  import { publishPlacement } from './src/lib/publish-placement.ts';
  export default { async fetch(request, env) {
    const { owner, id, role, candidate, failAt } = await request.json();
    if (candidate) {
      let commits = 0;
      const client = { getDocument: async documentId => documentId.startsWith('drafts.') ? { ...candidate.placement, _rev: candidate.revision } : undefined,
        mutate: async mutations => {
          commits++;
          const snapshots = await env.BACKUPS.list();
          if (snapshots.objects.length !== 1) throw new Error('missing snapshot');
          for (const file of mutations[1].create.variants) if (!await env.PUBLISHED.head(file.key)) throw new Error('missing copy');
          return { transactionId: 'test-transaction' };
        } };
      const storage = { ...env };
      if (failAt === 'snapshot') storage.BACKUPS = { put: async () => { throw new Error('snapshot unavailable'); } };
      if (failAt === 'copy') storage.PUBLISHED = { put: async () => { throw new Error('copy unavailable'); } };
      try { return Response.json(await publishPlacement(storage, client, owner, candidate.placement.slotId, failAt === 'revision' ? 'outdated' : candidate.revision, null)); }
      catch (error) { return Response.json({ error: error.message, commits }, { status: error.status || 503 }); }
    }
    try { return Response.json(await copyPublishedVariant(env.UPLOADS, env.ORIGINALS, env.PUBLISHED, owner, id, role)); }
    catch (error) { return Response.json({ error: error.message }, { status: error.status || 500 }); }
  }};` }, bundle: true, write: false, format: "esm", platform: "neutral", external: ["node:*"], conditions: ["workerd", "browser"], mainFields: ["browser", "module", "main"] });

for (const kind of ["image", "video"]) test(`PC runner claims, downloads, processes, uploads and verifies a private ${kind} job`, {
  skip: kind === "video" && (!process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH),
}, async () => {
  const api = await import("../scripts/processor-run.mjs").catch(() => ({}));
  assert.equal(typeof api.runProcessorJob, "function");
  const { handleProcessorRequest } = await import("../src/lib/processor-http.ts");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: "2026-09-18", compatibilityFlags: ["nodejs_compat"], script: worker.outputFiles[0].text,
    r2Buckets: ["ORIGINALS", "PUBLISHED", "BACKUPS"], d1Databases: ["UPLOADS"] }));
  try {
    const UPLOADS = await runtime.getD1Database("UPLOADS"), ORIGINALS = await runtime.getR2Bucket("ORIGINALS");
    for (const name of ["0001_uploads.sql", "0002_upload_completion.sql", "0003_processing.sql", "0004_processing_result.sql", "0005_processing_verified.sql"]) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      await UPLOADS.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => UPLOADS.prepare(s)));
    }
    const id = crypto.randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "portfolio-pc-run-"));
    let bytes;
    if (kind === "video") {
      const input = join(directory, "test-video.mp4");
      await promisify(execFile)(process.env.FFMPEG_PATH, ["-v", "error", "-n", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", input], { windowsHide: true });
      bytes = await readFile(input);
    } else bytes = await sharp({ create: { width: 100, height: 50, channels: 3, background: "blue" } }).png().toBuffer();
    const original = await ORIGINALS.put(`originals/${id}`, bytes);
    await UPLOADS.prepare(`INSERT INTO upload_sessions (id, owner, filename, mimeType, size, kind, objectKey, status, createdAt, expiresAt, storageVersion, storageEtag)
      VALUES (?, 'owner', ?, ?, ?, ?, ?, 'processing_pending', 1, 2, ?, ?)`)
      .bind(id, kind === "video" ? "video.mp4" : "image.png", kind === "video" ? "video/mp4" : "image/png", bytes.length, kind, `originals/${id}`, original.version, original.etag).run();
    const env = { PROCESSOR_TOKEN: "a".repeat(64), R2_ACCOUNT_ID: "b".repeat(32), R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "synthetic-test-key" };
    const actions = [];
    const access = { clientId: `${"b".repeat(32)}.access`, clientSecret: `cfast_${"c".repeat(48)}` };
    const transport = async (url, init) => {
      if (init.method === "PUT") {
        assert.equal(init.headers.authorization, undefined);
        assert.equal(init.headers["CF-Access-Client-Id"], undefined);
        assert.equal(init.headers["CF-Access-Client-Secret"], undefined);
        const chunks = []; for await (const chunk of init.body) chunks.push(chunk);
        await ORIGINALS.put(new URL(url).pathname.slice("/openmpd/".length), Buffer.concat(chunks));
        return new Response(null, { status: 200 });
      }
      actions.push(JSON.parse(init.body).action);
      assert.equal(init.headers["CF-Access-Client-Id"], access.clientId);
      assert.equal(init.headers["CF-Access-Client-Secret"], access.clientSecret);
      const response = await handleProcessorRequest(new Request(url, init), env, async () => ({ UPLOADS, ORIGINALS }));
      if (JSON.parse(init.body).action === "source") {
        assert.equal(response.headers.get("x-source-size"), String(bytes.length));
        response.headers.delete("content-length"); // Live edge responses may be chunked.
      }
      return response;
    };
    const result = await api.runProcessorJob("https://admin.example.test", env.PROCESSOR_TOKEN, directory, { fetch: transport, access });
    assert.equal(result.status, "ready");
    assert.equal(result.assetId, id);
    assert.equal(result.published, false);
    const { readPrivateVariant } = await import("../src/lib/private-preview.ts");
    const privateMedia = await readPrivateVariant(UPLOADS, ORIGINALS, "owner", id, kind === "video" ? "video" : "detail", "bytes=0-31");
    assert.equal(privateMedia.mimeType, kind === "video" ? "video/mp4" : "image/webp");
    assert.equal((await privateMedia.object.arrayBuffer()).byteLength, 32);
    const candidateApi = await import("../src/lib/placement-candidate.ts").catch(() => ({}));
    assert.equal(typeof candidateApi.readPlacementCandidate, "function");
    const placement = { slotId: "home.cad", assetId: id, alt: "Test", caption: "" };
    const { mediaSlots } = await import("../src/lib/media.ts");
    placement.slotId = mediaSlots.find(slot => slot.kinds.includes(kind)).id;
    const client = { getDocument: async documentId => documentId === `drafts.placement-${placement.slotId}` ? ({ ...placement, _rev: "r1", originalKey: "private" }) : undefined };
    const candidate = await candidateApi.readPlacementCandidate(UPLOADS, ORIGINALS, client, "owner", placement.slotId, "r1");
    assert.deepEqual(candidate, { revision: "r1", placement, kind });
    const draftPageApi = await import("../src/lib/draft-page.ts").catch(() => ({}));
    assert.equal(typeof draftPageApi.readDraftPage, "function");
    const path = mediaSlots.find(slot => slot.id === placement.slotId).path;
    const previewPage = await draftPageApi.readDraftPage(UPLOADS, ORIGINALS, client, "owner", path);
    assert.equal(previewPage.media[placement.slotId].kind, kind);
    assert.match(previewPage.media[placement.slotId].src, /^\/api\/admin\/media\?/);
    assert.equal(previewPage.revisions[placement.slotId], "r1");
    assert.equal(previewPage.publicRevisions[placement.slotId], null);
    assert.equal(JSON.stringify(previewPage).includes("originalKey"), false);
    await assert.rejects(draftPageApi.readDraftPage(UPLOADS, ORIGINALS, client, "owner", "https://other.test"));
    await assert.rejects(candidateApi.readPlacementCandidate(UPLOADS, ORIGINALS, client, "owner", placement.slotId, "old"), { status: 409 });
    await assert.rejects(candidateApi.readPlacementCandidate(UPLOADS, ORIGINALS, client, "other", placement.slotId, "r1"), { status: 404 });
    const copyApi = await import("../src/lib/publish-media.ts").catch(() => ({}));
    assert.equal(typeof copyApi.copyPublishedVariant, "function");
    const PUBLISHED = await runtime.getR2Bucket("PUBLISHED");
    const nativeCopy = async (owner, role) => {
      const response = await runtime.dispatchFetch("https://test.invalid/copy", { method: "POST", body: JSON.stringify({ owner, id, role }) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
      return result;
    };
    const role = kind === "video" ? "video" : "detail";
    const copied = await nativeCopy("owner", role);
    const supporting = await nativeCopy("owner", kind === "video" ? "poster" : "thumbnail");
    const { publicationMutations } = await import("../src/lib/publication-mutation.ts");
    const publication = publicationMutations(candidate, [supporting, copied], null);
    assert.equal(publication[1].create.variants.length, 2);
    if (kind === "video") assert.ok(publication[1].create.variants[1].duration > 0);
    const releaseResponse = await runtime.dispatchFetch("https://test.invalid/publish", { method: "POST", body: JSON.stringify({ owner: "owner", candidate }) });
    assert.equal(releaseResponse.status, 200);
    const release = await releaseResponse.json();
    assert.equal(release.transactionId, "test-transaction");
    assert.match(release.snapshot.key, /^snapshots\/placements\//);
    for (const failAt of ["snapshot", "copy", "revision"]) {
      const failed = await runtime.dispatchFetch("https://test.invalid/publish", { method: "POST", body: JSON.stringify({ owner: "owner", candidate, failAt }) });
      assert.equal(failed.status, failAt === "revision" ? 409 : 503);
      assert.equal((await failed.json()).commits, 0, `${failAt} must stop before Sanity mutation`);
    }
    const publicObject = await PUBLISHED.get(copied.key);
    assert.ok(publicObject.size > 0);
    assert.deepEqual(publicObject.customMetadata, {});
    await publicObject.body.cancel();
    assert.deepEqual(await nativeCopy("owner", role), copied);
    await assert.rejects(nativeCopy("other", role), { status: 404 });
    await assert.rejects(nativeCopy("owner", "original"), { status: 404 });
    // Restore the snapshot produced by the real publication workflow using processed media.
    // Only Sanity's transaction service is simulated; R2/D1 and image/video decoding are real locally.
    const recoveryStart = performance.now();
    const { restorePlacementDraft } = await import('../src/lib/placement-recovery.ts');
    const { readPlacementSnapshot } = await import('../src/lib/placement-snapshot.ts');
    const BACKUPS = await runtime.getR2Bucket('BACKUPS');
    const changedDraft = { ...placement, alt: 'Unpublished edits to preserve', _rev: 'edited' };
    let restoredDraft = changedDraft;
    const recoveryClient = { getDocument: async key => key === `drafts.placement-${placement.slotId}` ? restoredDraft : undefined,
      mutate: async mutations => {
        assert.equal(mutations.length, 1);
        assert.equal(mutations[0].patch.id, `drafts.placement-${placement.slotId}`);
        assert.equal(mutations[0].patch.ifRevisionID, restoredDraft._rev);
        restoredDraft = { ...mutations[0].patch.set, _rev: 'restored' };
        return { transactionId: 'local-recovery' };
      } };
    const publicVersion = (await PUBLISHED.head(copied.key)).version;
    const recovery = await restorePlacementDraft({ UPLOADS, ORIGINALS, BACKUPS }, recoveryClient, 'owner', {
      snapshotId: release.snapshot.sha256, version: release.snapshot.version, side: 'candidate',
      slotId: placement.slotId, revision: 'edited', confirmed: true,
    });
    assert.equal(recovery.published, false);
    assert.equal(restoredDraft.alt, placement.alt);
    assert.equal((await readPlacementSnapshot(BACKUPS, recovery.preservedSnapshot)).candidate.placement.alt, changedDraft.alt);
    assert.equal((await PUBLISHED.head(copied.key)).version, publicVersion, 'restoration must not replace public media');
    const restoredPage = await draftPageApi.readDraftPage(UPLOADS, ORIGINALS, recoveryClient, 'owner', path);
    assert.equal(restoredPage.revisions[placement.slotId], 'restored');
    assert.equal(restoredPage.media[placement.slotId].kind, kind);
    const restoredMedia = await readPrivateVariant(UPLOADS, ORIGINALS, 'owner', id, role);
    assert.deepEqual(Buffer.from(await restoredMedia.object.arrayBuffer()), Buffer.from(await (await PUBLISHED.get(copied.key)).arrayBuffer()));
    console.log(`LOCAL recovery drill ${kind}: ${Math.round(performance.now()-recoveryStart)} ms; missing assets 0; preserved previous draft; cloud Sanity not exercised`);
    const bad = await PUBLISHED.put(copied.key, "bad-existing-object");
    await assert.rejects(nativeCopy("owner", role));
    assert.equal((await PUBLISHED.head(copied.key)).version, bad.version, "never overwrite conflicting public bytes");
    assert.deepEqual(actions, ["claim", "source", "register", "authorize-result", "authorize-result", "complete"]);
    assert.equal((await UPLOADS.prepare("SELECT status FROM processing_jobs WHERE assetId = ?").bind(id).first()).status, "ready");
    assert.deepEqual(Buffer.from(await (await ORIGINALS.get(`originals/${id}`)).arrayBuffer()), bytes);
    assert.equal(await api.runProcessorJob("https://admin.example.test", env.PROCESSOR_TOKEN, directory, { fetch: transport, access }), null);
    await assert.rejects(api.runProcessorJob("https://attacker.test/path", env.PROCESSOR_TOKEN, directory, { fetch: transport }));
    const count = actions.length;
    await assert.rejects(api.runProcessorJob("https://admin.example.test", env.PROCESSOR_TOKEN, directory, { fetch: transport, signal: AbortSignal.abort() }));
    assert.equal(actions.length, count, "cancelled runner must not claim another job");
  } finally { await runtime.dispose(); }
});
