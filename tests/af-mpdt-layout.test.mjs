import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultSite} from '../src/lib/designer/defaults.ts';
import {afMpdtLayout} from '../scripts/af-mpdt-layout.mjs';
import {publicationIssues} from '../src/lib/designer/store.ts';
import {validateSite} from '../src/lib/designer/model.ts';

test('photo-first layout preserves supplied media and source, and stays within all five viewports',()=>{
  const site=createDefaultSite(),page=site.pages.find(p=>p.id==='project-af-mpdt');
  const model={id:'owner-model',type:'cad',name:'Owner GLB',assetId:'11111111-1111-4111-8111-111111111111',styles:{desktop:{}}};
  page.blocks[0].elements.push(model);
  const photo=page.blocks[0].elements.find(e=>e.type==='image');
  photo.assetId='22222222-2222-4222-8222-222222222222';
  const before=structuredClone(page),next=afMpdtLayout(page);
  assert.deepEqual(page,before);
  assert.equal(next.blocks[0].elements[0].assetId,photo.assetId);
  assert.equal(next.blocks[1].elements.find(e=>e.type==='cad').assetId,model.assetId);
  assert.ok(next.blocks.slice(2).every(b=>b.hidden));
  assert.deepEqual(new Set(next.blocks.flatMap(b=>b.elements.map(e=>e.id))).size,next.blocks.flatMap(b=>b.elements).length);
  site.pages[site.pages.indexOf(page)]=next;
  validateSite(site);
  assert.deepEqual(publicationIssues(site),[]);
  assert.throws(()=>afMpdtLayout(next),/already applied/);
});
