import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultSite} from '../src/lib/designer/defaults.ts';
import {createPage} from '../src/lib/designer/operations.ts';
import {saveDesigner,readDesignerState,readPublishedSite,publishDesigner,restoreDesigner,designerHistory,publicationIssues} from '../src/lib/designer/store.ts';
function fixture(){
  const docs=new Map(),objects=new Map();let rev=0,fail=false,race=false;
  const client={getDocument:async id=>structuredClone(docs.get(id)),fetch:async(_query,{ids})=>ids.map(id=>structuredClone(docs.get(id))).filter(Boolean),mutate:async mutations=>{
    if(race){race=false;docs.get('drafts.designer-site')._rev='race';}
    const next=structuredClone(docs);
    for(const m of mutations){const create=m.create??m.createIfNotExists;
      if(create){if(next.has(create._id)){if(m.createIfNotExists)continue;throw Object.assign(new Error('conflict'),{statusCode:409});}next.set(create._id,{...structuredClone(create),_rev:`r${++rev}`});}
      else{const old=next.get(m.patch.id);if(!old||old._rev!==m.patch.ifRevisionID)throw Object.assign(new Error('conflict'),{statusCode:409});next.set(m.patch.id,{...old,...structuredClone(m.patch.set),_rev:`r${++rev}`});}}
    docs.clear();for(const e of next)docs.set(...e);
  }};
  const bucket={put:async(key,text,options)=>{if(fail)throw new Error('backup down');if(!objects.has(key))objects.set(key,{text,customMetadata:options.customMetadata,version:crypto.randomUUID(),uploaded:new Date()});},get:async key=>{const o=objects.get(key);return o?{...o,size:Buffer.byteLength(o.text),text:async()=>o.text}:null;},head:async key=>objects.get(key),list:async({prefix,limit,cursor})=>{const entries=[...objects].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));const offset=Number(cursor??0);return {objects:entries.slice(offset,offset+limit).map(([key,o])=>({key,uploaded:o.uploaded})),truncated:offset+limit<entries.length,cursor:String(offset+limit)};}};
  return {client,bucket,docs,objects,fail:()=>{fail=true},race:()=>{race=true}};
}
const fallback=async()=>createDefaultSite();
test('publication checks the rotated box at supported device dimensions',()=>{
  const site=createDefaultSite();site.pages[0].blocks[0].elements[0].styles.desktop={x:0,y:0,width:100,height:100,rotation:45};
  assert.ok(publicationIssues(site).some(issue=>issue.includes('超出区块')));
  site.pages[0].blocks[0].elements[0].styles.desktop.rotation=0;assert.equal(publicationIssues(site).filter(issue=>issue.includes('超出区块')).length,0);
});
test('approved home hero bleed does not waive other overflow',()=>{
  const site=createDefaultSite(),hero=site.pages[0].blocks[0],image=hero.elements[0];
  image.styles.desktop={x:0,y:-99.94,width:100,height:160.24};
  assert.equal(publicationIssues(site).length,0);
  image.id='another-image';
  assert.ok(publicationIssues(site).some(issue=>issue.includes('超出区块')));
});
test('large private sites stage immutable chunks below transaction limit then activate one CAS root',async()=>{
  const f=fixture(),site=createDefaultSite();
  for(let p=0;p<8;p++){const page=createPage(`large ${p}`,`/large-${p}`);page.blocks=[];for(let b=0;b<3;b++)page.blocks.push({id:`large-${p}-${b}`,name:'block',type:'flow',styles:{desktop:{}},elements:Array.from({length:100},(_,i)=>({id:`large-${p}-${b}-${i}`,name:'text',type:'text',text:'a'.repeat(2000),styles:{desktop:{}}}))});site.pages.push(page);}
  const payloads=[],original=f.client.mutate;f.client.mutate=async ops=>{payloads.push(Buffer.byteLength(JSON.stringify({mutations:ops})));return original(ops);};
  const state=await saveDesigner(f.client,site,null,fallback);assert.ok(payloads.length>=3);assert.ok(payloads.every(n=>n<4_000_000));assert.equal(state.site.pages.length,24);
  payloads.length=0;site.pages[0].name='changed';await saveDesigner(f.client,site,state.revision,fallback);assert.ok(payloads.reduce((a,b)=>a+b,0)<200_000);
});
test('private immutable drafts, selected atomic publication, verified restore and source tamper detection',async()=>{
  const f=fixture(),site=createDefaultSite();const added=createPage('Private notes','/notes');added.blocks[0].elements=[];site.pages.push(added);
  let state=await saveDesigner(f.client,site,null,fallback);
  assert.equal(await readPublishedSite(f.client),null);assert.ok([...f.docs.keys()].filter(k=>k!=='drafts.designer-site').every(k=>k.startsWith('designerPrivate.')));
  await assert.rejects(()=>saveDesigner(f.client,site,null,fallback),e=>e.status===409);
  state=await publishDesigner(f.client,f.bucket,'owner',{revision:state.revision,publishedRevision:null,scope:[added.id],confirmed:true},fallback,async()=>{});
  assert.ok(state.publishedSite.pages.some(p=>p.id===added.id));const publicRevision=state.publishedRevision;
  const changed=structuredClone(state.site);changed.pages.find(p=>p.id===added.id).name='Changed';state=await saveDesigner(f.client,changed,state.revision,fallback);
  const history=await designerHistory(f.bucket,'owner');assert.equal(history.items.length,1);assert.equal((await designerHistory(f.bucket,'other')).items.length,0);
  await assert.rejects(()=>restoreDesigner(f.client,f.bucket,'other',{id:history.items[0].id,revision:state.revision,version:'draft',scope:[],confirmed:true},fallback),e=>e.status===404);
  state=await restoreDesigner(f.client,f.bucket,'owner',{id:history.items[0].id,revision:state.revision,version:'draft',scope:[added.id],confirmed:true},fallback);
  assert.equal(state.site.pages.find(p=>p.id===added.id).name,'Private notes');assert.equal(state.publishedRevision,publicRevision);
  const part=[...f.docs].find(([id])=>id.startsWith('designerPrivate.')&&f.docs.get('drafts.designer-site').manifest.pages.includes(id));part[1].payload.name='tampered';
  await assert.rejects(()=>readDesignerState(f.client,fallback),e=>e.status===409);
});
test('backup failure, missing resource and a racing draft prevent public mutation',async()=>{
  for(const failure of ['backup','resource','race']){const f=fixture(),state=await saveDesigner(f.client,createDefaultSite(),null,fallback);if(failure==='backup')f.fail();if(failure==='race')f.race();
    await assert.rejects(()=>publishDesigner(f.client,f.bucket,'owner',{revision:state.revision,publishedRevision:null,scope:['header'],confirmed:true},fallback,async()=>{if(failure==='resource')throw new Error('not published');}));
    assert.equal(f.docs.has('designer-site'),false);
  }
});
test('publishing deletion removes recycled private text from public immutable chunks',async()=>{
  const f=fixture(),site=createDefaultSite(),page=createPage('Secret draft','/secret');page.deleted=true;page.blocks[0].elements=[{id:'recycled-secret',name:'secret',type:'text',text:'PRIVATE-TEXT-UNPUBLISHED',styles:{desktop:{}}}];site.pages.push(page);
  const state=await saveDesigner(f.client,site,null,fallback);
  await publishDesigner(f.client,f.bucket,'owner',{revision:state.revision,publishedRevision:null,scope:[page.id],confirmed:true},fallback,async()=>{});
  for(const [id,doc]of f.docs)if(id.startsWith('designer-part-'))assert.ok(!JSON.stringify(doc).includes('PRIVATE-TEXT-UNPUBLISHED'));
});
