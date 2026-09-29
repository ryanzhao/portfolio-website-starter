import { test } from "node:test";
import assert from "node:assert/strict";

test("publication mutation guards both versions and projects only public fields", async () => {
  const api = await import("../src/lib/publication-mutation.ts").catch(() => ({}));
  assert.equal(typeof api.publicationMutations, "function");
  const id = crypto.randomUUID();
  const candidate = { revision: "draft1", kind: "image", placement: { slotId: "home.hero", assetId: id, alt: "Image", caption: "" } };
  const files = ["thumbnail", "detail"].map(role => ({ role, mimeType: "image/webp", width: 10, height: 10, size: 100, sha256: "a".repeat(64), key: `derivatives/${id}/${"a".repeat(64)}/${role}.webp`, version: "r2version" }));
  const fresh = api.publicationMutations(candidate, files, null);
  assert.equal(fresh[0].patch.ifRevisionID, "draft1");
  assert.equal(fresh[0].patch.id, "drafts.placement-home.hero");
  assert.equal(fresh[1].create._id, "placement-home_hero");
  assert.equal(fresh[1].create.variants.length, 2);
  assert.equal(JSON.stringify(fresh[1]).includes("r2version"), false);
  const update = api.publicationMutations(candidate, files, "public1");
  assert.equal(update[1].patch.ifRevisionID, "public1");
  assert.equal(update[2].createOrReplace._id, "placement-home_hero");
  for (const revision of [undefined, "", "bad revision"]) assert.throws(() => api.publicationMutations(candidate, files, revision));
  assert.throws(() => api.publicationMutations(candidate, [{ ...files[0], key: "originals/private" }, files[1]], null));
  assert.throws(() => api.publicationMutations(candidate, [files[0]], null));
});
