import { test } from "node:test";
import assert from "node:assert/strict";

test("draft read restricts IDs and returns only editor fields with the revision", async () => {
  const api = await import("../src/lib/placement-draft.ts");
  assert.equal(typeof api.readPlacementDraft, "function");
  let calls = 0;
  let document;
  const client = { getDocument: async id => {
    calls++; assert.equal(id, "drafts.placement-home.hero"); return document;
  } };
  await assert.rejects(api.readPlacementDraft(client, "../secret"));
  assert.equal(calls, 0);
  assert.deepEqual(await api.readPlacementDraft(client, "home.hero"), { revision: null, placement: null });
  const placement = { slotId: "home.hero", assetId: crypto.randomUUID(), alt: "Image", caption: "" };
  document = { ...placement, _rev: "rev-1", privateOriginalKey: "secret", owner: "private" };
  assert.deepEqual(await api.readPlacementDraft(client, "home.hero"), { revision: "rev-1", placement });
  for (const corrupt of [{ _rev: "" }, { alt: { privateOriginalKey: "secret" } }, { assetId: "../private" }, { slotId: "home.portrait" }]) {
    document = { ...placement, _rev: "rev-1", ...corrupt };
    await assert.rejects(api.readPlacementDraft(client, "home.hero"));
  }
});
test("placement writes target only deterministic drafts with revision protection", async () => {
  const api = await import("../src/lib/placement-draft.ts").catch(() => ({}));
  assert.equal(typeof api.placementDraftMutation, "function");
  const input = { slotId: "home.hero", assetId: crypto.randomUUID(), alt: " Test image ", caption: "" };
  const create = api.placementDraftMutation(input, "image", null);
  assert.equal(create.create._id, "drafts.placement-home.hero");
  assert.equal(create.create._type, "mediaPlacement");
  assert.equal(create.create.alt, "Test image");
  const update = api.placementDraftMutation(input, "image", "revision-1");
  assert.equal(update.patch.id, create.create._id);
  assert.equal(update.patch.ifRevisionID, "revision-1");
  assert.deepEqual(update.patch.set, { ...input, alt: "Test image" });
  assert.throws(() => api.placementDraftMutation(input, "video", null));
  for (const revision of [undefined, "", 42, "a".repeat(257)]) assert.throws(() => api.placementDraftMutation(input, "image", revision));
  assert.throws(() => api.placementDraftMutation({ ...input, privateOriginalKey: "secret" }, "image", null));
});

test("draft save checks upload ownership and completed inspection before sending a mutation", async () => {
  const api = await import("../src/lib/placement-draft.ts");
  assert.equal(typeof api.savePlacementDraft, "function");
  const id = crypto.randomUUID();
  const input = { slotId: "home.hero", assetId: id, alt: "Image", caption: "" };
  let status = "uploading", mutations = 0;
  // Narrow boundary doubles: verify bound owner/ID and outgoing Sanity mutation, not cloud behavior.
  const db = { prepare: () => ({ bind: (asset, owner) => ({ first: async () =>
    asset === id && owner === "owner" ? { id, kind: "image", status, storageVersion: "v1", storageEtag: "e1" } : null }) }) };
  const client = { mutate: async mutationsList => { mutations++; assert.equal(mutationsList.length, 1); assert.ok(mutationsList[0].create._id.startsWith("drafts.")); return { transactionId: "local-check" }; } };
  await assert.rejects(api.savePlacementDraft(db, client, "owner", input, null), { status: 409 });
  status = "processing_pending";
  await assert.rejects(api.savePlacementDraft(db, client, "other", input, null), { status: 404 });
  assert.equal(mutations, 0);
  assert.deepEqual(await api.savePlacementDraft(db, client, "owner", input, null), { transactionId: "local-check" });
  assert.equal(mutations, 1);
});
