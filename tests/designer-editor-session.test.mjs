import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorSession,hydrateHistoryPage} from '../src/lib/designer/editor-session.ts';
import {DesignerSaveQueue} from '../src/lib/designer/save-queue.ts';
import {createDefaultSite} from '../src/lib/designer/defaults.ts';
import {copyPage,createHistory,pushHistory,undo} from '../src/lib/designer/operations.ts';

function backend(initialRevision='r1') {
  let site=createDefaultSite(),revision=initialRevision,lose=false,fail=false;
  site.pages=site.pages.slice(0,2);
  const staged=new Map(),calls=[];
  const summary=({blocks,deleted,redirectFrom,...page})=>{void blocks;void deleted;void redirectFrom;return {...page,part:`part-${page.id}`,index:`index-${page.id}`};};
  const session=(id=site.pages[0].id)=>({catalog:{schemaVersion:3,pages:site.pages.map(summary),header:{part:'header',index:'header-index'},footer:{part:'footer',index:'footer-index'},meta:'meta'},publishedCatalog:null,revision,publishedRevision:null,page:site.pages.find(p=>p.id===id),header:site.header,footer:site.footer,theme:site.theme,fonts:site.fonts});
  const fetcher=async(url,options)=>{
    if(!options?.body){const query=new URL(url,'https://test.invalid').searchParams;if(query.has('revision')&&query.get('revision')!==revision)return Response.json({error:'conflict'},{status:409});const value=session(query.get('pageId')??undefined);return value.page?Response.json(value):Response.json({error:'missing'},{status:404});}
    const body=JSON.parse(options.body);calls.push(body);
    if(body.action==='initialize'){revision='r1';return Response.json(session());}
    if(body.revision!==revision)return Response.json({error:'conflict'},{status:409});
    if(body.action==='stagePage'||body.action==='stageShared'){const receipt=`receipt-${calls.length}`;staged.set(receipt,body);return Response.json({receipt,...body.action==='stagePage'?{summary:summary(body.page)}:{ref:body.key==='meta'?'meta':{part:body.key,index:body.key+'-index'}}});}
    assert.equal(body.action,'commit');if(fail){fail=false;return Response.json({error:'simulated failure'},{status:500});}
    const next=structuredClone(site);
    for(const receipt of body.receipts){const part=staged.get(receipt);assert.equal(part.revision,revision);if(part.action==='stagePage'){const index=next.pages.findIndex(p=>p.id===part.page.id);if(index<0)next.pages.push(part.page);else next.pages[index]=part.page;}else if(part.key==='meta')Object.assign(next,part.value);else next[part.key]=part.value;}
    next.pages=next.pages.filter(p=>!body.deletePageIds.includes(p.id));
    assert.deepEqual(new Set(body.order),new Set(next.pages.map(p=>p.id)),'commit order must cover active catalog exactly');
    next.pages=body.order.map(id=>next.pages.find(p=>p.id===id));site=next;revision=`r${Number(revision.slice(1))+1}`;
    if(lose){lose=false;throw new TypeError('commit response lost');}
    return Response.json(session());
  };
  return {fetcher,calls,session:()=>session(),site:()=>site,loseNextCommit:()=>{lose=true;},failNextCommit:()=>{fail=true;}};
}

test('server object-key ordering does not cause migration, save or lost-response conflicts',async()=>{
  const server=backend(null),sorted=value=>JSON.parse(JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v));
  const fetcher=async(...args)=>{const response=await server.fetcher(...args);return Response.json(sorted(await response.json()),{status:response.status});};
  const adapter=new EditorSession(server.session(),fetcher),queue=new DesignerSaveQueue(adapter.state,()=>{},adapter.request);
  try{
    const next=structuredClone(adapter.state.site);next.pages.push(copyPage(next.pages[0],'/ordered-response'));
    queue.update(next);assert.equal(await queue.flush(),true);assert.equal(server.site().pages.length,3);
    const second=structuredClone(next);second.pages[0].name='Lost response with reordered JSON';server.loseNextCommit();queue.update(second);
    assert.equal(await queue.flush(),true);assert.equal(queue.pending,false);assert.equal(server.site().pages[0].name,second.pages[0].name);
  }finally{queue.dispose();}
});

test('lost commit response reconciles adapter baseline before saving an undo',async()=>{
  const server=backend(),adapter=new EditorSession(server.session(),server.fetcher),original=structuredClone(adapter.state.site);
  const queue=new DesignerSaveQueue(adapter.state,()=>{},adapter.request);
  try{const edited=structuredClone(original);edited.pages[0].name='Changed';server.loseNextCommit();queue.update(edited);assert.equal(await queue.flush(),true);assert.equal(adapter.state.revision,queue.versions.revision);
    queue.update(original);assert.equal(await queue.flush(),true);assert.equal(server.site().pages[0].name,original.pages[0].name);assert.equal(server.calls.filter(c=>c.action==='stagePage').length,2);
  }finally{queue.dispose();}
});

test('directory placeholders are never staged, including attempted metadata edits',async()=>{
  const server=backend(),adapter=new EditorSession(server.session(),server.fetcher),site=structuredClone(adapter.state.site),unloaded=site.pages[1];
  assert.equal(unloaded.blocks.length,0);assert.ok(server.site().pages[1].blocks.length>0);
  site.pages[0].name='Home edit';await adapter.request('',{body:JSON.stringify({site,revision:'r1'})});
  assert.deepEqual(server.calls.filter(c=>c.action==='stagePage').map(c=>c.page.id),[site.pages[0].id]);assert.ok(server.site().pages[1].blocks.length>0);
  unloaded.name='Unsafe directory edit';await assert.rejects(adapter.request('',{body:JSON.stringify({site,revision:adapter.state.revision})}),/尚未完整读取/);
  assert.ok(server.site().pages[1].blocks.length>0);
});

test('undoing an already saved new page recycles it instead of sending invalid order',async()=>{
  const server=backend(),adapter=new EditorSession(server.session(),server.fetcher),original=structuredClone(adapter.state.site),next=structuredClone(original),added=copyPage(next.pages[0],'/new-copy');next.pages.push(added);
  await adapter.request('',{body:JSON.stringify({site:next,revision:'r1'})});assert.ok(server.site().pages.some(p=>p.id===added.id));
  await adapter.request('',{body:JSON.stringify({site:original,revision:adapter.state.revision})});assert.ok(!server.site().pages.some(p=>p.id===added.id));assert.ok(server.calls.at(-1).deletePageIds.includes(added.id));
});

test('lost deletion response is acknowledged even when the removed page was loaded last',async()=>{
  const server=backend(),adapter=new EditorSession(server.session(),server.fetcher);await adapter.load(server.site().pages[1].id);
  const queue=new DesignerSaveQueue(adapter.state,()=>{},adapter.request);
  try{const next=structuredClone(adapter.state.site);next.pages[1].deleted=true;server.loseNextCommit();queue.update(next);assert.equal(await queue.flush(),true);assert.equal(queue.pending,false);assert.equal(server.site().pages.length,1);assert.equal(adapter.state.site.pages[1].deleted,true);
  }finally{queue.dispose();}
});

test('stale page saves stop at CAS conflict without changing the server',async()=>{
  const server=backend(),first=new EditorSession(server.session(),server.fetcher),second=new EditorSession(server.session(),server.fetcher);
  const remote=structuredClone(first.state.site);remote.pages[0].name='Remote winner';await first.request('',{body:JSON.stringify({site:remote,revision:'r1'})});
  const statuses=[],queue=new DesignerSaveQueue(second.state,s=>statuses.push(s),second.request);
  try{const local=structuredClone(second.state.site);local.pages[0].name='Local retained';queue.update(local);assert.equal(await queue.flush(),false);assert.equal(statuses.at(-1).phase,'conflict');assert.equal(queue.pending,true);assert.equal(server.site().pages[0].name,'Remote winner');const writes=server.calls.length;await queue.flush();assert.equal(server.calls.length,writes);
  }finally{queue.dispose();}
});

test('adopting a homepage response refreshes already loaded nonhome bodies and keeps them editable',async()=>{
  const server=backend(),adapter=new EditorSession(server.session(),server.fetcher),id=server.site().pages[1].id;
  await adapter.load(id);
  const other=new EditorSession(server.session(),server.fetcher);await other.load(id);
  const changed=structuredClone(other.state.site);changed.pages[1].blocks[0].elements[0].text='Restored remote content';
  await other.request('',{body:JSON.stringify({site:changed,revision:'r1'})});
  const result=server.session();assert.notEqual(result.page.id,id);
  const adopted=await adapter.adopt(result),page=adopted.site.pages.find(p=>p.id===id);
  assert.deepEqual(page,server.site().pages[1]);assert.equal(adapter.loadedPages.has(id),true);
  const edited=structuredClone(adopted.site);edited.pages[1].name='Still editable';
  await adapter.request('',{body:JSON.stringify({site:edited,revision:adopted.revision})});
  assert.equal(server.site().pages[1].name,'Still editable');assert.equal(server.site().pages[1].blocks[0].elements[0].text,'Restored remote content');
});

test('hydrating cross-page undo preserves redirects omitted from summaries and complete historical bodies',async()=>{
  const server=backend();server.site().pages[1].redirectFrom=['/old-work'];
  const adapter=new EditorSession(server.session(),server.fetcher),original=structuredClone(adapter.state.site),id=original.pages[1].id;
  assert.equal(original.pages[1].redirectFrom,undefined);assert.equal(original.pages[1].blocks.length,0);
  const edited=structuredClone(original);edited.pages[0].name='Edited home';
  let history=pushHistory(createHistory(original),edited);
  await adapter.request('',{body:JSON.stringify({site:edited,revision:'r1'})});
  const loaded=await adapter.load(id),body=loaded.site.pages.find(p=>p.id===id);
  const complete=structuredClone(loaded.site);complete.pages[1].blocks[0].elements[0].text='Earlier historical text';complete.pages[1].redirectFrom=['/historical-alias'];
  history.future=[complete];const before=structuredClone(history);
  const hydrated=hydrateHistoryPage(history,body);
  assert.deepEqual(history,before,'hydration must not mutate existing history');
  assert.deepEqual(hydrated.future[0],complete,'complete older content must remain intact');
  assert.equal(hydrated.present.pages[0].name,'Edited home');
  const reverted=undo({...hydrated,present:loaded.site}).present;
  assert.deepEqual(reverted.pages[1].redirectFrom,['/old-work']);
  await adapter.request('',{body:JSON.stringify({site:reverted,revision:loaded.revision})});
  assert.equal(server.site().pages[0].name,original.pages[0].name);assert.deepEqual(server.site().pages[1].redirectFrom,['/old-work']);
  assert.ok(server.site().pages[1].blocks.length>0);
});


test('linked new page and shared link commit together and survive lost commit response',async()=>{
 const server=backend(),adapter=new EditorSession(server.session(),server.fetcher),queue=new DesignerSaveQueue(adapter.state,()=>{},adapter.request);
 try{
  const next=structuredClone(adapter.state.site),created=copyPage(next.pages[0],'/linked-target'),nav=next.header.blocks[0].elements.find(e=>e.role==='navigation');
  next.pages.push(created);nav.link={pageId:created.id,newTab:true};server.loseNextCommit();queue.update(next);
  assert.equal(await queue.flush(),true);assert.equal(queue.pending,false);
  assert.equal(server.calls.filter(c=>c.action==='commit').length,1);
  assert.equal(server.site().header.blocks[0].elements.find(e=>e.id===nav.id).link.pageId,created.id);
  assert.ok(server.site().pages.some(p=>p.id===created.id));
 }finally{queue.dispose();}
});


test('failed linked-page commit preserves the previous link and can retry the same candidate',async()=>{
 const server=backend(),adapter=new EditorSession(server.session(),server.fetcher),queue=new DesignerSaveQueue(adapter.state,()=>{},adapter.request);
 try{
  const next=structuredClone(adapter.state.site),created=copyPage(next.pages[0],'/retry-linked-target'),nav=next.header.blocks[0].elements.find(e=>e.role==='navigation'),old=structuredClone(nav.link);
  next.pages.push(created);nav.link={pageId:created.id};server.failNextCommit();queue.update(next);
  assert.equal(await queue.flush(),false);assert.deepEqual(server.site().header.blocks[0].elements.find(e=>e.id===nav.id).link,old);assert.equal(server.site().pages.some(p=>p.id===created.id),false);
  assert.equal(await queue.flush(),true);assert.ok(server.site().pages.some(p=>p.id===created.id));
 }finally{queue.dispose();}
});
