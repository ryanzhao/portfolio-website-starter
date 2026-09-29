import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import ts from 'typescript';

test('D1 write limits are atomic, isolated, bounded and fail closed', async () => {
  const api = await import('../src/lib/admin-write-limit.ts').catch(() => ({}));
  assert.equal(typeof api.requireWriteAllowance, 'function', 'shared D1 limiter must exist');
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, cf: false,
    compatibilityDate: '2026-09-18', script: 'export default {fetch(){return new Response(null)}}', d1Databases: ['UPLOADS'] }));
  try {
    const db = await runtime.getD1Database('UPLOADS');
    const sql = await readFile(new URL('../migrations/0007_admin_write_limits.sql', import.meta.url), 'utf8');
    await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    const take = (owner='owner', category='publication', now=61000) => api.requireWriteAllowance(db, owner, category, now);
    const results = await Promise.allSettled(Array.from({length:15},()=>take()));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
    for(const result of results.filter(r=>r.status==='rejected')) {
      assert.equal(result.reason.status,429); assert.equal(result.reason.retryAfter,59);
    }
    await take('other'); await take('owner','drafts'); await take('owner','uploads');
    await take('owner','publication',120000);
    const row = await db.prepare("SELECT * FROM admin_write_limits WHERE owner='owner' AND category='publication'").first();
    assert.equal(row.count,1); assert.equal(row.window,2);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM admin_write_limits').first()).n,4);
    await take('owner','publication',61000);
    assert.equal((await db.prepare("SELECT window FROM admin_write_limits WHERE owner='owner' AND category='publication'").first()).window,2);
    await assert.rejects(api.requireWriteAllowance(undefined,'owner','uploads'),e=>e.status===503);
    await db.prepare('DROP TABLE admin_write_limits').run();
    await assert.rejects(take(),e=>e.status===503 && !e.message.includes('SQL'));
  } finally { await runtime.dispose(); }
});

test('upload client does not immediately retry 429', async () => {
  const {uploadFile} = await import('../src/lib/upload-client.ts');
  let calls=0;
  await assert.rejects(uploadFile(new File(['abc'],'test.png',{type:'image/png'}),crypto.randomUUID(),{
    fetch:async()=>{ calls++; return Response.json({error:'请求过于频繁，请稍后续传。'},{status:429,headers:{'Retry-After':'60'}}); }
  }),/稍后/);
  assert.equal(calls,1);
});

test('all admin write endpoints reject exhausted allowance before mutation', async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules:true,cf:false,compatibilityDate:'2026-09-18',
    script:'export default {fetch(){return new Response(null)}}',d1Databases:['UPLOADS'] }));
  try {
    const db=await runtime.getD1Database('UPLOADS');
    const sql=await readFile(new URL('../migrations/0007_admin_write_limits.sql',import.meta.url),'utf8');
    await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    // Newer window prevents the wall-clock boundary from making this test flaky.
    for(const [group,limit] of [['uploads',1200],['drafts',60],['publication',10]]) {
      await db.prepare('INSERT INTO admin_write_limits VALUES(?,?,?,?)').bind('owner',group,Math.floor(Date.now()/60000)+1,limit).run();
    }
    const env={ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'test',ADMIN_EMAILS:'owner@example.test',ADMIN_ORIGIN:'https://admin.example.test',PUBLICATION_ENABLED:'true'};
    const {privateKey,publicKey}=await generateKeyPair('RS256');
    const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
    const token=await new SignJWT({email:env.ADMIN_EMAILS}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(env.ACCESS_ISSUER).setAudience('test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    let mutations=0;
    const forbidden=()=>{mutations++;throw new Error('business access before rate check');};
    const storage={UPLOADS:db,ORIGINALS:new Proxy({}, {get:forbidden}),BACKUPS:new Proxy({}, {get:forbidden})};
    const client=new Proxy({}, {get:forbidden});
    const services=async()=>({storage,client});
    const auth=await import('../src/lib/admin-auth.ts');
    const imports={
      '@opennextjs/cloudflare':{getCloudflareContext:async()=>({env:{UPLOADS:db}})},
      '@/lib/admin-auth':{...auth,readAdminConfig:()=>auth.readAdminConfig(env),requireAdmin:(req,config)=>auth.requireAdmin(req,config,keys)},
      '@/lib/content-client':{contentClient:()=>client},
    };
    for(const name of ['media','placement-draft','published-placement','upload-http','uploads','admin-write-limit']) imports[`@/lib/${name}`]=await import(`../src/lib/${name}.ts`);
    const source=await readFile(new URL('../src/app/api/admin/placements/route.ts',import.meta.url),'utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    const route={exports:{}};
    new Function('require','module','exports',compiled)(name=>{assert.ok(imports[name],name);return imports[name];},route,route.exports);
    const {handleUploadRequest}=await import('../src/lib/upload-http.ts');
    const {handleHistory}=await import('../src/lib/history-http.ts');
    const {handlePublication}=await import('../src/lib/publication-http.ts');
    const placement={slotId:'home.hero',assetId:crypto.randomUUID(),alt:'test',caption:''};
    for(const [path,body,run] of [
      ['uploads',{action:'begin',id:placement.assetId,file:{filename:'test.png',mimeType:'image/png',size:3}},req=>handleUploadRequest(req,env,async()=>storage,keys)],
      ['placements',{placement,revision:null},req=>route.exports.POST(req)],
      ['history',{slotId:'home.hero',snapshotId:'a'.repeat(64),version:'v',revision:null,side:'candidate',confirmed:true},req=>handleHistory(req,env,services,keys)],
      ['publish',{slotId:'home.hero',revision:'v',previousRevision:null,confirmed:true},req=>handlePublication(req,env,services,keys)],
    ]) {
      const response=await run(new Request(`${env.ADMIN_ORIGIN}/api/admin/${path}`,{method:'POST',headers:{origin:env.ADMIN_ORIGIN,'content-type':'application/json','Cf-Access-Jwt-Assertion':token},body:JSON.stringify(body)}));
      assert.equal(response.status,429,path);
      assert.ok(Number(response.headers.get('retry-after'))>0,path);
      assert.equal(response.headers.get('cache-control'),'no-store');
    }
    assert.equal(mutations,0);
  } finally {await runtime.dispose();}
});

test('logout is an ordinary non-prefetched link with session scope warning',async()=>{
  const source=await readFile(new URL('../src/app/admin/advanced/page.tsx',import.meta.url),'utf8');
  assert.match(source,/<a\b[^>]*href="\/cdn-cgi\/access\/logout"[^>]*>退出 Access 登录<\/a>/);
  assert.match(source,/所有应用/);
  assert.match(source,/Sanity.*独立/);
});
