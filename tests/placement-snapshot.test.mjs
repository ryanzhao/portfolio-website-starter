import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("placement snapshots retain exact versions privately without overwrite", async () => {
  const api = await import("../src/lib/placement-snapshot.ts").catch(() => ({}));
  assert.equal(typeof api.writePlacementSnapshot, "function");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: "2026-09-18", script: "export default {fetch(){return new Response(null)}}", r2Buckets: ["BACKUPS"] }));
  try {
    const bucket = await runtime.getR2Bucket("BACKUPS");
    const candidate = { revision: "draft-1", kind: "image", placement: { slotId: "home.hero", assetId: crypto.randomUUID(), alt: "New", caption: "" } };
    const previous = { ...candidate, revision: "published-1", placement: { ...candidate.placement, alt: "Previous" } };
    const saved = await api.writePlacementSnapshot(bucket, candidate, previous);
    assert.equal(typeof api.readPlacementSnapshot, "function");
    assert.deepEqual(await api.readPlacementSnapshot(bucket, saved.sha256), { candidate, previous, version: saved.version });
    await assert.rejects(api.readPlacementSnapshot(bucket, "../originals/private"), { status: 400 });
    await assert.rejects(api.readPlacementSnapshot(bucket, "0".repeat(64)), { status: 404 });
    for (const text of [" ".repeat(32769), "not-json", JSON.stringify({ formatVersion: 2, candidate, previous }),
      JSON.stringify({ formatVersion: 1, candidate, previous, token: "unexpected" })]) {
      const hash = createHash("sha256").update(text).digest("hex");
      await bucket.put(`snapshots/placements/${hash}.json`, text);
      await assert.rejects(api.readPlacementSnapshot(bucket, hash));
    }
    assert.match(saved.key, /^snapshots\/placements\/[a-f0-9]{64}\.json$/);
    const object = await bucket.get(saved.key);
    assert.equal(object.httpMetadata.cacheControl, "no-store");
    assert.deepEqual(await object.json(), { formatVersion: 1, candidate, previous });
    assert.deepEqual(await api.writePlacementSnapshot(bucket, candidate, previous), saved);
    assert.notEqual((await api.writePlacementSnapshot(bucket, candidate, null)).key, saved.key);
    await assert.rejects(api.writePlacementSnapshot(bucket, { ...candidate, token: "secret" }, previous));
    await assert.rejects(api.writePlacementSnapshot(bucket, candidate, { ...previous, placement: { ...previous.placement, slotId: "home.portrait" } }));
    const changed = await bucket.put(saved.key, "corrupt");
    await assert.rejects(api.readPlacementSnapshot(bucket, saved.sha256), { status: 409 });
    await assert.rejects(api.writePlacementSnapshot(bucket, candidate, previous));
    assert.equal((await bucket.head(saved.key)).version, changed.version);
  } finally { await runtime.dispose(); }
});
