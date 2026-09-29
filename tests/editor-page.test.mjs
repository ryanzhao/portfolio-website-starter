import { test } from 'node:test';
import assert from 'node:assert/strict';

test('editor isolates pending and invalid slots, enforces ownership and never falls through to public media for a draft', async () => {
  const { readEditorPage } = await import('../src/lib/editor-page.ts');
  const assetId = crypto.randomUUID();
  const client = { getDocument: async id => {
    if (id === 'drafts.placement-home.hero') return { slotId: 'home.hero', assetId, alt: 'Synthetic', caption: '', _rev: 'r1' };
    if (id === 'drafts.placement-home.portrait') throw new Error('private service detail');
    return undefined;
  } };
  const db = { prepare: sql => ({ bind: (id, owner) => ({ first: async () =>
    sql.includes('SELECT *') && id === assetId && owner === 'owner' ? { id, kind: 'image', status: 'processing_pending' } : null }) }) };
  await assert.rejects(readEditorPage(db, {}, client, 'owner', '/unknown'));
  const page = await readEditorPage(db, {}, client, 'owner', '/');
  assert.equal(page.states['home.hero'].status, 'pending');
  assert.equal(page.media['home.hero'], null);
  assert.equal(page.states['home.portrait'].status, 'error');
  assert.equal(page.states['home.electronics.secondary'].status, 'empty');
  assert.deepEqual(page.publishSlots, []);
  assert.doesNotMatch(JSON.stringify(page), /private service detail/);
  const other = await readEditorPage(db, {}, client, 'other', '/');
  assert.equal(other.states['home.hero'].status, 'error');
  assert.doesNotMatch(JSON.stringify(other), /Synthetic|r1/);
});

test('published fallback is displayed and an unchanged retained draft is not an unpublished change', async () => {
  const { readEditorPage } = await import('../src/lib/editor-page.ts');
  const assetId = crypto.randomUUID();
  const placement = {slotId:'home.hero',assetId,alt:'Synthetic image',caption:''};
  const files = ['thumbnail','detail'].map(role => ({role,mimeType:'image/webp',size:100,width:10,height:10,sha256:'a'.repeat(64),key:`derivatives/${assetId}/${'a'.repeat(64)}/${role}.webp`}));
  let draft;
  const client = {getDocument:async id => id === 'drafts.placement-home.hero' ? draft : id === 'placement-home_hero' ? {...placement,_type:'mediaPlacement',_rev:'pub1',kind:'image',variants:files} : undefined};
  const db = {prepare:sql => ({bind:() => ({first:async () => sql.includes('SELECT *') ? {id:assetId,kind:'image',status:'processing_pending'} : sql.includes('resultManifest') ? {status:'ready',resultManifest:JSON.stringify({files}),verifiedObjects:JSON.stringify(files.map(file=>({key:file.key,version:'v1',etag:'e1'})))} : {status:'ready'} })})};
  const bucket = {get:async () => ({version:'v1',size:100,body:new ReadableStream(),arrayBuffer:async()=>new ArrayBuffer(100)})};
  const fallback = await readEditorPage(db,bucket,client,'owner','/');
  assert.match(fallback.media['home.hero'].src,/^\/api\/media\?/);
  assert.equal(fallback.states['home.hero'].status,'published');
  draft = {...placement,_rev:'draft1'};
  const unchanged = await readEditorPage(db,bucket,client,'owner','/');
  assert.equal(unchanged.states['home.hero'].status,'published');
  assert.deepEqual(unchanged.publishSlots,[]);
  draft = {...draft,caption:'Changed caption'};
  const changed = await readEditorPage(db,bucket,client,'owner','/');
  assert.equal(changed.states['home.hero'].status,'draft');
  assert.equal(changed.publishSlots[0].previousRevision,'pub1');
});
