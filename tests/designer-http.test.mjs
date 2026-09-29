import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {handleDesigner,designJson} from '../src/lib/designer/http.ts';
import {designAssetIds,freezeLegacyMedia,verifyPublishedResources,verifyDesignReferences,designerMedia} from '../src/lib/designer/resources.ts';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createDefaultSite} from '../src/lib/designer/defaults.ts';

test('500 private assets and 40 fonts use bounded owner-scoped D1 reads; previews exclude foreign and pending assets',async()=>{
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,cf:false,compatibilityDate:'2026-09-19',script:'export default {fetch(){return new Response(null)}}',d1Databases:['UPLOADS']}));
  try{
    const db=await runtime.getD1Database('UPLOADS');
    for(const file of ['0001_uploads.sql','0003_processing.sql','0004_processing_result.sql','0005_processing_verified.sql','0009_designer_fonts.sql']){
      const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    }
    const ids=Array.from({length:500},()=>crypto.randomUUID()),site=createDefaultSite();
    site.pages=[site.pages[0]];site.header.blocks=[];site.footer.blocks=[];site.pages[0].blocks=[site.pages[0].blocks[0]];
    site.pages[0].blocks[0].elements=ids.map(id=>({id:`element-${id}`,type:'image',assetId:id}));
    site.fonts=Array.from({length:40},()=>({id:crypto.randomUUID(),sha256:'a'.repeat(64),family:'Test',weight:400,style:'normal'}));
    for(let i=0;i<ids.length;i+=50)await db.batch(ids.slice(i,i+50).flatMap(id=>[
      db.prepare("INSERT INTO upload_sessions(id,owner,filename,mimeType,size,kind,objectKey,status,createdAt,expiresAt) VALUES (?,'owner','a.png','image/png',1,'image',?,'processing_pending',1,2)").bind(id,id),
      db.prepare("INSERT INTO processing_jobs(assetId,status,createdAt,resultManifest,verifiedObjects) VALUES (?,'ready',1,'{}','{}')").bind(id),
    ]));
    await db.batch(site.fonts.map(f=>db.prepare("INSERT INTO designer_fonts VALUES (?,'owner',?,'Test',400,'normal',1,'ready',1)").bind(f.id,f.sha256)));
    let queries=0;const storage={UPLOADS:{prepare(sql){queries++;return db.prepare(sql);}}};
    await verifyDesignReferences(storage,'owner',site);assert.equal(queries,7);
    await db.prepare("UPDATE upload_sessions SET owner='other' WHERE id=?").bind(ids[0]).run();
    await db.prepare("UPDATE processing_jobs SET status='pending' WHERE assetId=?").bind(ids[1]).run();
    queries=0;const media=await designerMedia(site,{},undefined,{storage,owner:'owner'});assert.equal(queries,6);
    assert.equal(media[ids[0]],null);assert.equal(media[ids[1]],null);assert.ok(media[ids[2]].src.startsWith('/api/admin/media?'));
    await assert.rejects(()=>verifyDesignReferences(storage,'owner',site),e=>e.status===404);
    await assert.rejects(()=>verifyDesignReferences(storage,'owner',site,['invalid-id']),e=>e.status===400);
  }finally{await runtime.dispose();}
});

test('designer authentication, origin, JSON validation and rate limits fail before content mutation',async()=>{
  const env={ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'test',ADMIN_EMAILS:'owner@example.test',ADMIN_ORIGIN:'https://admin.example.test'};
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
  const token=await new SignJWT({email:env.ADMIN_EMAILS}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(env.ACCESS_ISSUER).setAudience('test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let serviceCalls=0,contentCalls=0;
  const forbidden=()=>{contentCalls++;throw new Error('no content access expected');};
  const services=async()=>{serviceCalls++;return {client:new Proxy({},{get:forbidden}),storage:{UPLOADS:{prepare:()=>({bind:()=>({first:async()=>null})})}}};};
  const request=(body,auth=true,origin=env.ADMIN_ORIGIN)=>new Request(`${env.ADMIN_ORIGIN}/api/admin/design`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...auth?{'Cf-Access-Jwt-Assertion':token}:{}},body:JSON.stringify(body)});
  assert.equal((await handleDesigner(request({},false),env,services,keys)).status,401);
  assert.equal((await handleDesigner(request({},true,'https://wrong.example'),env,services,keys)).status,403);
  assert.equal(serviceCalls,0);
  assert.equal((await handleDesigner(request({action:'save',unrecognized:true}),env,services,keys)).status,400);
  const limited=await handleDesigner(request({action:'commit',revision:null,receipts:[]}),env,services,keys);
  assert.equal(limited.status,429);assert.equal(limited.headers.get('cache-control'),'no-store');assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal(contentCalls,0);
  assert.equal((await handleDesigner(request({action:'previewPublication',scope:['home'],pageId:'home'}),env,services,keys)).status,400);
  assert.equal((await handleDesigner(request({action:'publish',scope:['home'],revision:'r1',publishedRevision:null,confirmed:true}),env,services,keys)).status,400);
  assert.equal(contentCalls,0);
  assert.equal((await handleDesigner(request({action:'save',revision:null,site:{}}),env,services,keys)).status,400);
  await assert.rejects(()=>designJson(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:'x'.repeat(832*1024)})})),e=>e.status===413);
  await assert.rejects(()=>designJson(new Request('https://example.test',{method:'POST',body:'x'})),e=>e.status===415);
  await assert.rejects(()=>designJson(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'})),e=>e.status===400);
});

test('resource ownership includes responsive backgrounds, video posters and sharing images',()=>{
  const site=createDefaultSite(),page=site.pages[0],block=page.blocks[0],ids=Array.from({length:5},()=>crypto.randomUUID());
  block.elements[0].assetId=ids[0];block.elements[0].posterAssetId=ids[1];block.styles.desktop.backgroundAssetId=ids[2];block.styles.mobile={backgroundAssetId:ids[3]};page.shareAssetId=ids[4];
  assert.deepEqual(new Set(designAssetIds(site,page.id)),new Set(ids));
  block.deleted=true;assert.deepEqual(designAssetIds(site,page.id),[ids[4]]);
});
test('legacy migration freezes even pending private IDs and does not follow later slot changes',async()=>{
  const id=crypto.randomUUID(),site=createDefaultSite(),docs=new Map([['drafts.placement-home.hero',{_rev:'r1',slotId:'home.hero',assetId:id,alt:'pending experiment',caption:''}]]);
  const client={getDocument:async id=>docs.get(id)};
  const frozen=await freezeLegacyMedia(site,client),hero=frozen.pages[0].blocks[0].elements[0];
  assert.equal(hero.assetId,id);assert.equal(hero.legacySlot,undefined);assert.ok(!JSON.stringify(frozen).includes('legacySlot'));
  docs.get('drafts.placement-home.hero').assetId=crypto.randomUUID();assert.equal(hero.assetId,id);
  const emptyPublic=await freezeLegacyMedia(site,client,true);assert.equal(emptyPublic.pages[0].blocks[0].elements[0].assetId,undefined);
  await assert.rejects(()=>verifyPublishedResources({},client,'owner',site),e=>e.status===409);
});


test('initial legacy migration batches every placement into one external request',async()=>{
  let queries=0,reads=0;
  const site=await freezeLegacyMedia(createDefaultSite(),{
    getDocument:async()=>{reads++;throw new Error('unexpected individual request');},
    fetch:async(query,{ids})=>{queries++;assert.equal(new Set(ids).size,48);return [];}
  });
  assert.equal(queries,1);assert.equal(reads,0);assert.equal(site.pages.length,16);
});
