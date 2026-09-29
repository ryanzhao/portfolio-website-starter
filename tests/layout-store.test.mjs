import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveLayoutDraft,readPageLayouts,publishLayout,restoreLayoutDraft,readLayoutHistory} from '../src/lib/layout-store.ts';
function fixture() {
  let rev=0;const docs=new Map(),objects=new Map();let broken=false;
  const client={getDocument:async id=>structuredClone(docs.get(id)),mutate:async mutations=>{
    const next=new Map(docs);
    for(const mutation of mutations) {
      const id=mutation.create?._id??mutation.patch.id,old=next.get(id);
      if(mutation.create?old:!old||old._rev!==mutation.patch.ifRevisionID) throw Object.assign(new Error('conflict'),{statusCode:409});
      next.set(id,{...(mutation.create??{...old,...mutation.patch.set}),_rev:`r${++rev}`});
    }
    docs.clear();for(const entry of next) docs.set(...entry);
  }};
  const storage={BACKUPS:{put:async(key,text,options)=>{if(broken)throw new Error('backup unavailable');if(!objects.has(key))objects.set(key,{text,customMetadata:options.customMetadata,version:crypto.randomUUID()});},get:async key=>{const entry=objects.get(key);return entry?{size:entry.text.length,customMetadata:entry.customMetadata,version:entry.version,text:async()=>entry.text}:null;},head:async key=>objects.get(key),list:async({prefix,limit,cursor})=>{const keys=[...objects.keys()].filter(key=>key.startsWith(prefix)).sort();const offset=Number(cursor||0);return {objects:keys.slice(offset,offset+limit).map(key=>({key})),truncated:offset+limit<keys.length,cursor:String(offset+limit)};}}};
  return {client,storage,docs,objects,breakBackup:()=>{broken=true;}};
}
const layout=text=>({schemaVersion:1,blocks:{hero:{elements:{title:{text}}}}});
test('layout draft uses CAS; publication snapshots before atomic guards; restore preserves draft without changing published',async()=>{
 const f=fixture();let current=await saveLayoutDraft(f.client,layout('first'),null);
 await assert.rejects(()=>saveLayoutDraft(f.client,layout('stale'),null),error=>error.status===409);
 const published=await publishLayout(f.storage,f.client,'owner',{revision:current.revision,publishedRevision:null,confirmed:true});
 assert.deepEqual(published.publishedLayout,layout('first'));
 const publicBefore=structuredClone(f.docs.get('page-layout-home'));
 current=await saveLayoutDraft(f.client,layout('edited'),published.revision);
 await assert.rejects(()=>publishLayout(f.storage,f.client,'owner',{revision:current.revision,publishedRevision:null,confirmed:true}),error=>error.status===409);
 assert.equal((await readLayoutHistory(f.storage,'other')).snapshots.length,0);
 await assert.rejects(()=>restoreLayoutDraft(f.storage,f.client,'other',{snapshotId:published.snapshotId,revision:current.revision,confirmed:true}),error=>error.status===404);
 const restored=await restoreLayoutDraft(f.storage,f.client,'owner',{snapshotId:published.snapshotId,revision:current.revision,confirmed:true});
 assert.deepEqual(restored.layout,layout('first'));assert.deepEqual(f.docs.get('page-layout-home'),publicBefore);
 assert.ok((await readLayoutHistory(f.storage,'owner')).snapshots.some(entry=>entry.kind==='preserve'&&entry.layout.blocks.hero.elements.title.text==='edited'));
 f.breakBackup();await assert.rejects(()=>publishLayout(f.storage,f.client,'owner',{revision:restored.revision,publishedRevision:restored.publishedRevision,confirmed:true}));
 assert.deepEqual(f.docs.get('page-layout-home'),publicBefore);
 assert.deepEqual((await readPageLayouts(f.client)).layout,layout('first'));
});
test('layout history rejects modified snapshot bytes even if object version is unchanged',async()=>{
 const f=fixture();const draft=await saveLayoutDraft(f.client,layout('first'),null);
 await publishLayout(f.storage,f.client,'owner',{revision:draft.revision,publishedRevision:null,confirmed:true});
 const entry=[...f.objects.values()][0];entry.text=entry.text.replace('first','altered');
 await assert.rejects(()=>readLayoutHistory(f.storage,'owner'),error=>error.status===409);
});
test('publication draft guard rejects a racing edit without changing the public document',async()=>{
 const f=fixture();const draft=await saveLayoutDraft(f.client,layout('first'),null);
 const original=f.client.mutate;
 f.client.mutate=async mutations=>{if(mutations.length===2)f.docs.get('drafts.page-layout-home')._rev='raced';return original(mutations);};
 await assert.rejects(()=>publishLayout(f.storage,f.client,'owner',{revision:draft.revision,publishedRevision:null,confirmed:true}),error=>error.status===409);
 assert.equal(f.docs.has('page-layout-home'),false);
});



test('previous snapshot version restores only the draft and preserves its current edits',async()=>{
 const f=fixture();let state=await saveLayoutDraft(f.client,layout('older published'),null);
 state=await publishLayout(f.storage,f.client,'owner',{revision:state.revision,publishedRevision:null,confirmed:true});
 state=await saveLayoutDraft(f.client,layout('new published'),state.revision);
 state=await publishLayout(f.storage,f.client,'owner',{revision:state.revision,publishedRevision:state.publishedRevision,confirmed:true});
 const publicBefore=structuredClone(f.docs.get('page-layout-home'));
 await assert.rejects(()=>restoreLayoutDraft(f.storage,f.client,'owner',{snapshotId:state.snapshotId,revision:state.revision,confirmed:false,version:'previous'}),error=>error.status===400);
 await assert.rejects(()=>restoreLayoutDraft(f.storage,f.client,'owner',{snapshotId:state.snapshotId,revision:state.revision,confirmed:true,version:'invalid'}),error=>error.status===400);
 const restored=await restoreLayoutDraft(f.storage,f.client,'owner',{snapshotId:state.snapshotId,revision:state.revision,confirmed:true,version:'previous'});
 assert.deepEqual(restored.layout,layout('older published'));assert.deepEqual(f.docs.get('page-layout-home'),publicBefore);
 const preserved=(await readLayoutHistory(f.storage,'owner',undefined,restored.preservedSnapshot)).snapshots[0];
 assert.deepEqual(preserved.layout,layout('new published'));
});
test('new layout snapshot keys preserve newest-first chronology across R2 pages',async context=>{
 const f=fixture();let now=Date.parse('2026-09-20T12:00:00Z');context.mock.method(Date,'now',()=>now);
 let state=await saveLayoutDraft(f.client,layout('start'),null);
 for(let i=0;i<23;i++) {now+=1000;state=await saveLayoutDraft(f.client,layout(String(i)),state.revision);state=await publishLayout(f.storage,f.client,'owner',{revision:state.revision,publishedRevision:state.publishedRevision,confirmed:true});}
 const first=await readLayoutHistory(f.storage,'owner');assert.equal(first.snapshots.length,20);assert.ok(first.nextCursor);
 const second=await readLayoutHistory(f.storage,'owner',first.nextCursor);assert.equal(second.snapshots.length,3);assert.equal(second.nextCursor,null);
 const all=[...first.snapshots,...second.snapshots];assert.deepEqual(all.map(entry=>entry.layout.blocks.hero.elements.title.text),Array.from({length:23},(_,index)=>String(22-index)));
 assert.ok(all.every(entry=>/^\d{13}-/.test(entry.id)));
});
