import { test } from "node:test";
import assert from "node:assert/strict";

test("published placement reads only exact public IDs and safe validated media", async () => {
  const api = await import("../src/lib/published-placement.ts").catch(() => ({}));
  assert.equal(typeof api.readPublishedPlacement, "function");
  const id = crypto.randomUUID();
  const variants = ["thumbnail", "detail"].map(role => ({ role, mimeType: "image/webp", width: 10, height: 10, size: 100, sha256: "a".repeat(64), key: `derivatives/${id}/${"a".repeat(64)}/${role}.webp` }));
  let document, calls = 0;
  const client = { getDocument: async key => { calls++; assert.equal(key, "placement-home_hero"); return document; } };
  await assert.rejects(api.readPublishedPlacement(client, "drafts.secret"));
  assert.equal(calls, 0);
  assert.equal(await api.readPublishedPlacement(client, "home.hero"), null);
  const placement = { slotId: "home.hero", assetId: id, alt: "Image", caption: "" };
  document = { _type: "mediaPlacement", _rev: "r1", ...placement, kind: "image", variants, privateOriginal: "secret" };
  assert.deepEqual(await api.readPublishedPlacement(client, "home.hero"), { revision: "r1", placement, kind: "image", variants });
  document = { ...document, variants: [{ ...variants[0], key: "originals/private" }, variants[1]] };
  await assert.rejects(api.readPublishedPlacement(client, "home.hero"));
});

test("every public placement ID is a unique Sanity root ID", async () => {
  const { mediaSlots, publishedPlacementId } = await import("../src/lib/media.ts");
  const ids = mediaSlots.map(slot => publishedPlacementId(slot.id));
  assert.equal(new Set(ids).size, mediaSlots.length);
  for (const id of ids) assert.match(id, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.throws(() => publishedPlacementId("drafts.secret"));
});
