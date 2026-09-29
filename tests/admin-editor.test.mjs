import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('slot editing is absent publicly, accessible only inside the editor, and hidden in preview', async () => {
  const file = new URL('../src/components/admin-editor-context.tsx', import.meta.url);
  const source = await readFile(file, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function('require', 'exports', outputText)(createRequire(file), exports);
  const button = createElement(exports.AdminSlotButton, { slotId: 'home.hero' });
  assert.equal(renderToStaticMarkup(button), '');
  const value = { editing: true, states: { 'home.hero': { status: 'pending', message: '等待电脑处理' } }, selectSlot() {} };
  const render = () => renderToStaticMarkup(createElement(exports.AdminEditorContext.Provider, { value }, button));
  assert.match(render(), /button/);
  assert.match(render(), /首页 · 首屏主图/);
  assert.match(render(), /等待电脑处理/);
  value.editing = false;
  assert.equal(render(), '');
});

test('formal editor uses cloud library and existing guarded save/publication clients, not browser storage', async () => {
  const editor = await readFile(new URL('../src/components/admin-editor.tsx', import.meta.url), 'utf8');
  const library = await readFile(new URL('../src/components/admin-library.tsx', import.meta.url), 'utf8');
  assert.match(editor, /saveDraft\(/);
  assert.match(editor, /AdminPublish/);
  assert.match(editor, /beforeunload/);
  assert.match(editor, /showModal\(/);
  assert.match(library, /\/api\/admin\/library/);
  assert.match(library, /tagRevision/);
  assert.match(library, /uploadFiles\(/);
  assert.doesNotMatch(editor + library, /localStorage|sessionStorage/);
});

test('library distinguishes expired incomplete uploads without expiring saved originals', async () => {
  const file = new URL('../src/components/admin-library.tsx', import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function('require', 'exports', outputText)(createRequire(file), exports);
  assert.match(exports.assetStatus({status:'uploading',expiresAt:1},2), /过期/);
  assert.doesNotMatch(exports.assetStatus({status:'uploading',expiresAt:3},2), /过期/);
  assert.match(exports.assetStatus({status:'processing_pending',expiresAt:1,processingStatus:'ready'},2), /可预览/);
  assert.match(exports.assetStatus({status:'processing_pending',expiresAt:1,processingStatus:'failed'},2), /失败/);
});

test('library accepts either kind without a slot filter and preserves explicit restrictions', async () => {
  const file = new URL('../src/components/admin-library.tsx', import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const require = createRequire(file);
  const item = { id: 'test-image', filename: 'sample.png', kind: 'image', status: 'processing_pending', processingStatus: 'ready', createdAt: 0, size: 1, tags: [] };
  const exports = {};
  let stateIndex = 0;
  new Function('require', 'exports', outputText)(name => name === 'react' ? { ...require(name), useEffect() {}, useState(initial) { return [stateIndex++ === 0 ? [item] : initial, () => {}]; } } : require(name), exports);
  const render = kinds => { stateIndex = 0; return renderToStaticMarkup(createElement(exports.AdminLibrary, { kinds, onSelect() {}, onBusyChange() {}, onDirtyChange() {} })); };
  assert.match(render(undefined), /<button type="button">使用此素材<\/button>/);
  assert.match(render(['image']), /<button type="button">使用此素材<\/button>/);
  assert.match(render(['video']), /<button type="button" disabled="">使用此素材<\/button>/);
  assert.match(render([]), /此位置不支持该素材类型/);
  item.kind = 'video';
  assert.match(render(undefined), /<button type="button">使用此素材<\/button>/);
  item.status = 'uploading';
  assert.match(render(undefined), /原件校验完成后才能使用/);
});
