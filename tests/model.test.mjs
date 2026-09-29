import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("3D interaction fixture is self-contained and has valid buffer bounds", async () => {
  const model = JSON.parse(await readFile(new URL("../public/models/interaction-demo.gltf", import.meta.url), "utf8"));
  assert.equal(model.asset.version, "2.0");
  assert.match(model.asset.generator, /NOT engineering CAD/);
  for (const buffer of model.buffers) {
    assert.ok(buffer.uri.startsWith("data:application/octet-stream;base64,"));
    assert.equal(Buffer.from(buffer.uri.split(",")[1], "base64").length, buffer.byteLength);
  }
  for (const view of model.bufferViews) assert.ok(view.byteOffset + view.byteLength <= model.buffers[view.buffer].byteLength);
  for (const node of model.nodes) assert.ok(model.meshes[node.mesh]);
});
