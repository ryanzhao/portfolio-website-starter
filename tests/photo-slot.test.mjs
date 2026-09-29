import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

test("photo slots retain placeholders and render supplied media without changing slot classes", async () => {
  const file = new URL("../src/components/photo-slot.tsx", import.meta.url);
  const source = await readFile(file, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  const require = createRequire(file);
  new Function("require", "exports", outputText)(id => id === './admin-editor-context' ? { AdminSlotButton: () => null } : id === './layout-element' ? { LayoutElement: () => null } : require(id), exports);
  const props = { slotId: "home.hero", label: "Hero", className: "hero-photo" };
  const empty = renderToStaticMarkup(await exports.PhotoSlot({ ...props, media: null }));
  assert.match(empty, /IMAGE TO BE ADDED/);
  const image = renderToStaticMarkup(await exports.PhotoSlot({ ...props, media: { kind: "image", src: "/api/media?key=test", alt: "Real project", caption: "Test caption" } }));
  assert.match(image, /<img/);
  assert.match(image, /alt="Real project"/);
  assert.match(image, /hero-photo/);
  assert.doesNotMatch(image, /IMAGE TO BE ADDED/);
  const video = renderToStaticMarkup(await exports.PhotoSlot({ ...props, media: { kind: "video", src: "/api/media?key=video", poster: "/api/media?key=poster", alt: "Test video", caption: "" } }));
  assert.match(video, /<video[^>]*controls=""/);
  assert.doesNotMatch(video, /autoPlay/);
});
