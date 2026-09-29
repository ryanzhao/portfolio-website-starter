import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesignerSaveQueue} from '../src/lib/designer/save-queue.ts';
import {createDefaultSite} from '../src/lib/designer/defaults.ts';
const state=()=>({site:createDefaultSite(),revision:'r1',publishedSite:null,publishedRevision:null});
test('save queue serializes edits, holds IME/gestures and preserves newer edits',async()=>{
  const initial=state(),statuses=[],calls=[];let release;
  const queue=new DesignerSaveQueue(initial,s=>statuses.push(s),async(_url,options)=>{calls.push(JSON.parse(options.body));await new Promise(r=>release=r);return Response.json({...initial,site:calls.at(-1).site,revision:`r${calls.length+1}`});});
  try{const first=structuredClone(initial.site);first.pages[0].name='first';queue.hold(true);queue.update(first);assert.equal(await queue.flush(),false);assert.equal(calls.length,0);queue.hold(false);
    const run=queue.flush();queue.update(initial.site);assert.equal(queue.pending,true);assert.notEqual(statuses.at(-1).phase,'saved');const next=structuredClone(first);next.pages[0].name='next';queue.update(next);release();assert.equal(await run,false);assert.equal(queue.pending,true);assert.equal(calls.length,1);
    const second=queue.flush();release();assert.equal(await second,true);assert.equal(calls[1].revision,'r2');assert.equal(calls[1].site.pages[0].name,'next');assert.equal(statuses.at(-1).phase,'saved');
  }finally{queue.dispose();}
});
test('lost response is read back; conflicts stop writes, and 429 respects Retry-After',async()=>{
  for(const mode of ['lost','conflict','limited']){const initial=state(),local=structuredClone(initial.site);local.pages[0].name='local';const statuses=[];let calls=0;
    const queue=new DesignerSaveQueue(initial,s=>statuses.push(s),async(_url,options)=>{calls++;if(!options)return Response.json({...initial,site:mode==='lost'?local:initial.site,revision:'r9'});if(mode==='limited')return Response.json({error:'later'},{status:429,headers:{'Retry-After':'60'}});throw new Error('connection lost');});
    try{queue.update(local);await queue.flush();if(mode==='lost'){assert.equal(queue.pending,false);assert.equal(queue.versions.revision,'r9');}else if(mode==='conflict'){assert.equal(statuses.at(-1).phase,'conflict');assert.equal(queue.pending,true);await queue.flush();assert.equal(calls,2);}else{await queue.flush();assert.equal(calls,1);assert.ok(statuses.at(-1).retryAt>Date.now());assert.equal(queue.pending,true);}}finally{queue.dispose();}
  }
});
test('undo during an unknown write remains dirty when readback is offline',async()=>{
  const initial=state(),next=structuredClone(initial.site);next.pages[0].name='possibly committed';let release,calls=0;
  const queue=new DesignerSaveQueue(initial,()=>{},async(_url,options)=>{calls++;if(options)await new Promise(r=>release=r);throw new Error('offline');});
  try{queue.update(next);const saving=queue.flush();queue.update(initial.site);release();assert.equal(await saving,false);assert.equal(queue.pending,true);assert.equal(await queue.flush(),false);assert.equal(calls,3);assert.equal(queue.pending,true);}finally{queue.dispose();}
});
test('readback and retry share the same lock when manual and automatic saves coincide',async()=>{
  const initial=state(),next=structuredClone(initial.site);next.pages[0].name='next';let offline=true,active=0,max=0;
  const queue=new DesignerSaveQueue(initial,()=>{},async(_url,options)=>{if(offline)throw new Error('offline');active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return Response.json(options?{...initial,site:next,revision:'r2'}:initial);});
  try{queue.update(next);await queue.flush();offline=false;await Promise.all([queue.flush(),queue.flush()]);assert.equal(max,1);assert.equal(queue.pending,false);}finally{queue.dispose();}
});

test('HTML gateway responses preserve the local draft with an actionable retry message',async()=>{
  const initial=state(),local=structuredClone(initial.site),statuses=[];local.pages[0].name='Keep this edit';let html=true;
  const queue=new DesignerSaveQueue(initial,s=>statuses.push(s),async(_url,options)=>html?new Response('<!DOCTYPE html>login',{headers:{'content-type':'text/html'}}):Response.json(options?{...initial,site:local,revision:'r2'}:initial));
  try{queue.update(local);assert.equal(await queue.flush(),false);assert.equal(queue.pending,true);assert.match(statuses.at(-1).message,/请勿刷新/);html=false;assert.equal(await queue.flush(),true);assert.equal(queue.pending,false);}finally{queue.dispose();}
});
