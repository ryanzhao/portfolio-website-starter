import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("publication control starts unconfirmed and keeps disabled publication explicit", async () => {
  const source = await readFile(new URL("../src/components/admin-publish.tsx", import.meta.url), "utf8").catch(() => "");
  assert.ok(source, "publication control must exist");
  const exports = {};
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText)(createRequire(import.meta.url), exports);
  const html = renderToStaticMarkup(createElement(exports.AdminPublish, { enabled: false, slots: [{ id: "home.hero", label: "首页主图", revision: "r1", previousRevision: null }] }));
  assert.match(html, /公开发布尚未启用/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /首页主图/);
  assert.match(html, /aria-describedby="publish-slot-label"/);
  assert.match(html, /<p[^>]*id="publish-slot-label"[^>]*class="[^"]*break-words[^"]*"[^>]*>当前选择：首页主图<\/p>/);
});
