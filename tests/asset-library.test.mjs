import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

async function database(run) {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules:true, cf:false, compatibilityDate:'2026-09-18',
    script:'export default {fetch(){return new Response(null)}}', d1Databases:['UPLOADS'] }));
  try {
    const db = await runtime.getD1Database('UPLOADS');
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f=>f.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');
      await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    }
    const insert = async (filename='原名.png', owner='owner', kind='image', createdAt=1, status='processing_pending') => {
      const id=crypto.randomUUID();
      await db.prepare('INSERT INTO upload_sessions (id,owner,filename,mimeType,size,kind,objectKey,status,createdAt,expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(id,owner,filename,kind==='image'?'image/png':'video/mp4',3,kind,`originals/${id}`,status,createdAt,createdAt+1000).run();
      return id;
    };
    await run(db,insert);
  } finally { await runtime.dispose(); }
}

test('library lists every owner upload, filters complete set and keeps same names independent',async()=>{
  const api=await import('../src/lib/asset-library.ts').catch(()=>({}));
  assert.equal(typeof api.listAssets,'function','private asset library must exist');
  await database(async(db,insert)=>{
    const oldest=await insert('100%_原名.png');
    const same=await insert('100%_原名.png');
    for(let n=0;n<55;n++) await insert(`recent-${n}.png`,'owner','image',n+2,n===0?'cancelled':'uploading');
    const video=await insert('film.mp4','owner','video',100);
    const other=await insert('100%_原名.png','other');
    await api.saveAssetTags(db,'owner',oldest,[' 中文 ','中文','','实验'],0);
    await api.saveAssetTags(db,'other',other,['机密'],0);
    await db.prepare("INSERT INTO processing_jobs(assetId,status,createdAt) VALUES (?,'ready',1)").bind(oldest).run();
    const first=await api.listAssets(db,'owner',{});
    assert.equal(first.items.length,50); assert.equal(first.nextOffset,50);
    assert.deepEqual(new Set(first.tags),new Set(['中文','实验']));
    const second=await api.listAssets(db,'owner',{offset:50});
    assert.equal(second.items.length,8); assert.equal(second.nextOffset,null);
    assert.equal(second.items.find(x=>x.id===oldest).processingStatus,'ready');
    assert.ok(second.items.some(x=>x.status==='cancelled'));
    const byName=await api.listAssets(db,'owner',{q:'%_'});
    assert.deepEqual(new Set(byName.items.map(x=>x.id)),new Set([oldest,same]));
    assert.deepEqual(byName.items.find(x=>x.id===same).tags,[]);
    assert.equal(byName.items.find(x=>x.id===same).tagRevision,0);
    assert.deepEqual((await api.listAssets(db,'owner',{tag:'中文'})).items.map(x=>x.id),[oldest]);
    assert.deepEqual((await api.listAssets(db,'owner',{kind:'video'})).items.map(x=>x.id),[video]);
    assert.equal((await api.listAssets(db,'owner',{kind:'video',tag:'中文'})).items.length,0);
    assert.deepEqual(Object.keys(first.items[0]).sort(),['id','filename','mimeType','size','kind','status','createdAt','expiresAt','processingStatus','processingError','leaseExpiresAt','tags','tagRevision'].sort());
    assert.equal((await db.prepare('SELECT filename, objectKey FROM upload_sessions WHERE id=?').bind(oldest).first()).filename,'100%_原名.png');
    for(const bad of [{offset:-1},{offset:0.5},{kind:'all'},{q:'x'.repeat(256)},{tag:'字'.repeat(31)},{owner:'other'}]) {
      await assert.rejects(api.listAssets(db,'owner',bad),e=>e.status===400);
    }
  });
});

test('tags enforce ownership, normalized limits and atomic revision conflicts',async()=>{
  const api=await import('../src/lib/asset-library.ts').catch(()=>({}));
  assert.equal(typeof api.saveAssetTags,'function','revision guarded tag writes must exist');
  await database(async(db,insert)=>{
    const id=await insert();
    await assert.rejects(api.saveAssetTags(db,'other',id,['x'],0),e=>e.status===404);
    for(const [tags,rev] of [[null,0],[[{}],0],[['字'.repeat(31)],0],[Array.from({length:13},(_,n)=>String(n)),0],[[], -1],[[], '0'],[['x'],Number.MAX_SAFE_INTEGER]]) {
      await assert.rejects(api.saveAssetTags(db,'owner',id,tags,rev),e=>e.status===400);
    }
    await assert.rejects(api.saveAssetTags(db,'owner',id,['x'],2),e=>e.status===409);
    const concurrent=await Promise.allSettled([api.saveAssetTags(db,'owner',id,['a'],0),api.saveAssetTags(db,'owner',id,['b'],0)]);
    assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(concurrent.find(x=>x.status==='rejected').reason.status,409);
    assert.deepEqual(await api.saveAssetTags(db,'owner',id,[' 中文 ','中文','','  '],1),{tags:['中文'],revision:2});
    await assert.rejects(api.saveAssetTags(db,'owner',id,['stale'],1),e=>e.status===409);
    assert.deepEqual(await api.saveAssetTags(db,'owner',id,[],2),{tags:[],revision:3});
  });
});

test('library HTTP authenticates first, validates exact origin and bounded input, and limits tag writes',async()=>{
  const api=await import('../src/lib/asset-library-http.ts').catch(()=>({}));
  assert.equal(typeof api.handleAssetLibrary,'function','authenticated library handler must exist');
  const env={ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'test',ADMIN_EMAILS:'owner@example.test',ADMIN_ORIGIN:'https://admin.example.test'};
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
  const token=await new SignJWT({email:env.ADMIN_EMAILS}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(env.ACCESS_ISSUER).setAudience('test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  await database(async(db,insert)=>{
    let serviceCalls=0;
    const run=(body,options={})=>api.handleAssetLibrary(new Request(`${env.ADMIN_ORIGIN}/api/admin/library${options.query??''}`,{
      method:options.method??'POST',headers:{'content-type':'application/json',origin:options.origin??env.ADMIN_ORIGIN,...(options.anonymous?{}:{'Cf-Access-Jwt-Assertion':token})},
      ...(options.method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
    }),env,async()=>{serviceCalls++;return db;},keys);
    const id=await insert(); const body={assetId:id,tags:[' 标签 '],revision:0};
    assert.equal((await run(body,{anonymous:true})).status,401);
    assert.equal((await run(body,{origin:'https://evil.test'})).status,403);
    assert.equal(serviceCalls,0);
    for(const bad of [{...body,owner:'other'},{...body,revision:undefined},{...body,tags:[42]}]) assert.equal((await run(bad)).status,400);
    assert.equal((await run('x'.repeat(131073))).status,413);
    for(const query of ['?offset=-1','?kind=audio','?owner=other','?tag=a&tag=b']) assert.equal((await run(null,{method:'GET',query})).status,400);
    const saved=await run(body); assert.equal(saved.status,200);
    assert.deepEqual(await saved.json(),{saved:true,tags:['标签'],revision:1});
    assert.equal((await run(body)).status,409);
    const listed=await run(null,{method:'GET'}); assert.equal(listed.status,200); assert.equal((await listed.json()).items[0].tagRevision,1);
    assert.equal((await run({...body,assetId:await insert('secret.png','other')})).status,404);
    await db.prepare("INSERT INTO admin_write_limits VALUES('owner','drafts',?,60) ON CONFLICT(owner,category) DO UPDATE SET window=excluded.window,count=60").bind(Math.floor(Date.now()/60000)+1).run();
    const limited=await run({...body,revision:1}); assert.equal(limited.status,429);
    assert.ok(Number(limited.headers.get('retry-after'))>0); assert.equal(limited.headers.get('cache-control'),'no-store');
    assert.equal((await db.prepare('SELECT revision FROM asset_tags WHERE assetId=?').bind(id).first()).revision,1);
  });
});

test('failed processing reports sanitized status and owner retry invalidates old leases',async()=>{
  const {failProcessing,retryProcessing,claimProcessingJob}=await import('../src/lib/processing.ts');
  await database(async(db,insert)=>{
    const id=await insert('cad.step','owner','model');
    await db.prepare("UPDATE upload_sessions SET storageVersion='v',storageEtag='e' WHERE id=?").bind(id).run();
    const job=await claimProcessingJob(db);
    await assert.rejects(failProcessing(db,id,crypto.randomUUID(),'failed'),e=>e.status===409);
    assert.deepEqual(await failProcessing(db,id,job.leaseToken,'private path must not be persisted'),{failed:true});
    const item=(await (await import('../src/lib/asset-library.ts')).listAssets(db,'owner',{kind:'model'})).items[0];
    assert.equal(item.processingStatus,'failed');assert.doesNotMatch(item.processingError,/private path/);
    await assert.rejects(retryProcessing(db,'other',id),e=>e.status===404);
    assert.deepEqual(await retryProcessing(db,'owner',id),{queued:true});
    await assert.rejects(retryProcessing(db,'owner',id),e=>e.status===409);
    const retry=await claimProcessingJob(db);assert.notEqual(retry.leaseToken,job.leaseToken);
    await assert.rejects(retryProcessing(db,'owner',id),e=>e.status===409);
    await assert.rejects(failProcessing(db,id,job.leaseToken,'stale'),e=>e.status===409);
    await db.prepare('UPDATE processing_jobs SET leaseExpiresAt=0 WHERE assetId=?').bind(id).run();
    assert.deepEqual(await retryProcessing(db,'owner',id),{queued:true});
  });
});
