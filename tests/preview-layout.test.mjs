import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

test("homepage passes private preview media into the existing photo slots", async () => {
  const source = await readFile(new URL("../src/components/canva-home.tsx", import.meta.url), "utf8");
  const exports = {};
  const require = createRequire(import.meta.url);
  const photo = () => null;
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText)(id => {
    if (id === "@/components/photo-slot") return { PhotoSlot: photo };
    if (id === "@/lib/portfolio") return { portfolioSections: [], journeyLanes: [] };
    if (id === "@/components/cad-viewer") return { CadViewer: () => null };
    if (id === "./layout-element") return { LayoutBlock: ({ children }) => children, LayoutElement: ({ children }) => children };
    return require(id);
  }, exports);
  const media = { "home.hero": { kind: "image", src: "/api/admin/media?assetId=test", alt: "Draft", caption: "" } };
  const hero = exports.CanvaHome({ media }).props.children[0].props.children[0];
  const resolved = hero.type === photo ? hero : hero.type(hero.props);
  assert.equal(resolved.props.media, media["home.hero"]);
});
