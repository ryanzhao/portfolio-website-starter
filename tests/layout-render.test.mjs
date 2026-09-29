import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { layoutBlockCss } from '../src/lib/layout-render.ts';

test('responsive renderer preserves default flow, isolates desktop geometry, and fixes preview viewport', () => {
  const block = { elements: { title: { x:10, y:20, width:60, fontSize:40 } }, overrides: { mobile:{ elements:{title:{fontSize:22}} } } };
  const desktop = layoutBlockCss('hero', block, 'desktop');
  assert.match(desktop, /left:10%/); assert.match(desktop, /position:static/);
  const mobile = layoutBlockCss('hero', block, 'mobile');
  assert.doesNotMatch(mobile, /left:|top:|width:|@media/); assert.match(mobile, /font-size:22px/);
  const responsive = layoutBlockCss('hero', block);
  assert.match(responsive, /min-width:1024px/); assert.match(responsive, /max-width:767px/);
  assert.doesNotMatch(layoutBlockCss('hero', {elements:{}}), /position:absolute/);
});
test('media crop keeps native video control geometry and text frames grow without clipping', () => {
  const css = layoutBlockCss('hero', { elements: { 'media:home.hero': {fit:'cover', zoom:2,focusX:25,focusY:75}, title:{height:10,text:'</style><script>bad</script>'} } }, 'desktop');
  assert.match(css, /object-view-box:inset\(37.5% 37.5% 12.5% 12.5%\)/);
  assert.match(css, />img\{transform:scale\(2\)/); assert.doesNotMatch(css, />video\{transform:/);
  assert.match(css, /min-height:10%/); assert.doesNotMatch(css, /<script>|overflow:hidden/);
});
test('rendering retains semantic tags, escapes plain text, and shows no editing marks in preview', async () => {
  async function load(name, dependencies={}) {
    const file = new URL(`../src/components/${name}.tsx`, import.meta.url);
    const {outputText}=ts.transpileModule(await readFile(file,'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}});
    const exports={}; const require=createRequire(file);
    new Function('require','exports',outputText)(id=>dependencies[id] ?? require(id.startsWith('../lib/') ? `${id}.ts` : id),exports);
    return exports;
  }
  const context=await load('layout-context');
  const {LayoutElement,LayoutBlock}=await load('layout-element',{'./layout-context':context});
  const title=createElement(LayoutElement,{as:'h1',htmlId:'portfolio-title',id:'title',blockId:'hero',label:'Title'},'Original');
  const original=renderToStaticMarkup(title);
  assert.match(original, /^<h1/); assert.match(original, />Original<\/h1>$/); assert.doesNotMatch(original,/data-layout-selected|<style/);
  const layout={schemaVersion:1,blocks:{hero:{elements:{title:{text:'<script>alert(1)</script>'}},overrides:{mobile:{elements:{title:{text:'Phone'}}}}}}};
  const rendered=renderToStaticMarkup(createElement(context.LayoutProvider,{layout,viewport:'mobile'},createElement(LayoutBlock,{id:'hero'},title)));
  assert.match(rendered, />Phone<\/h1>/); assert.doesNotMatch(rendered,/data-layout-selected|<script>/);
  const escaped=renderToStaticMarkup(createElement(context.LayoutProvider,{layout,viewport:'desktop'},title));
  assert.match(escaped, /&lt;script&gt;/);
});
