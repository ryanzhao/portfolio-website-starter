import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as media from '../src/lib/media.ts';

test('history UI requires reviewed differences and explicit draft-only confirmation', async()=>{
  const source = await readFile(new URL('../src/components/admin-history.tsx',import.meta.url),'utf8').catch(()=>'');
  assert.ok(source.includes('恢复为草稿，不修改线上内容'));
  assert.ok(source.includes('!review || !confirmed || busy'));
  assert.ok(source.includes('setReview(null)'));
  const result = ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(result.diagnostics?.length,0);
  const exports = {}, require = createRequire(import.meta.url);
  new Function('require','exports',ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText)(
    name=>name==='@/lib/media'?media:require(name),exports);
  const html=renderToStaticMarkup(createElement(exports.AdminHistory));
  assert.match(html,/type="checkbox"[^>]*disabled=""/);
  assert.doesNotMatch(html,/checked=""/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>确认恢复为私有草稿/);
});
