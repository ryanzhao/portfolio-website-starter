import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("private preview renders native protected media with accessible status", async () => {
  const source = await readFile(new URL("../src/components/admin-preview.tsx", import.meta.url), "utf8").catch(() => "");
  assert.ok(source, "preview component must exist");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function("require", "exports", outputText)(createRequire(import.meta.url), exports);
  const id = "12345678-1234-4123-8123-123456789abc";
  const image = renderToStaticMarkup(createElement(exports.AdminPreview, { assetId: id, kind: "image" }));
  assert.match(image, /<img/);
  assert.match(image, /role=detail/);
  assert.match(image, /alt="[^"]+"/);
  assert.match(image, /role="status"/);
  assert.doesNotMatch(image, /_next\/image/);
  const video = renderToStaticMarkup(createElement(exports.AdminPreview, { assetId: id, kind: "video" }));
  assert.match(video, /<video[^>]*controls=""/);
  assert.match(video, /preload="metadata"/);
  assert.match(video, /role=video/);
  assert.match(video, /role=poster/);
  assert.doesNotMatch(video, /autoPlay/);
});
