import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

test('layout authenticates and validates confirmation before accessing private services',async()=>{
  const api = await import('../src/lib/layout-http.ts').catch(()=>({}));
  assert.equal(typeof api.handleLayout,'function');
  const env = { ACCESS_ISSUER:'https://test.cloudflareaccess.com', ACCESS_AUDIENCE:'test', ADMIN_EMAILS:'owner@example.test', ADMIN_ORIGIN:'https://admin.example.test' };
  const {privateKey,publicKey} = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
  const token = await new SignJWT({email:env.ADMIN_EMAILS}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(env.ACCESS_ISSUER).setAudience('test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let calls=0;
  const services=async()=>{calls++;throw new Error('private secret');};
  const request=(method,jwt,origin,body)=>new Request(`${env.ADMIN_ORIGIN}/api/admin/layout`,{method,headers:{'content-type':'application/json','Cf-Access-Jwt-Assertion':jwt,origin},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  for(const [req,status] of [[request('GET','',env.ADMIN_ORIGIN),401],[request('POST',token,'https://other.test',{}),403],
    [request('POST',token,env.ADMIN_ORIGIN,{}),400],[request('POST',token,env.ADMIN_ORIGIN,{confirmed:false}),400],
    [request('DELETE',token,env.ADMIN_ORIGIN),405]]){
    const result=await api.handleLayout(req,env,services,keys);
    assert.equal(result.status,status); assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal((await result.text()).includes('private secret'),false);
  }
  assert.equal(calls,0);
  const invalidVersion=await api.handleLayout(request('POST',token,env.ADMIN_ORIGIN,{action:'restore',snapshotId:`8000000000000-${crypto.randomUUID()}`,revision:null,confirmed:true,version:'other'}),env,services,keys);
  assert.equal(invalidVersion.status,400);assert.equal(calls,0);
  const invalidLayout=JSON.parse('{"schemaVersion":1,"blocks":{"hero":{"elements":{"__proto__":{"text":"polluted"}}}}}');
  const invalid=await api.handleLayout(request('POST',token,env.ADMIN_ORIGIN,{action:'save',revision:null,layout:invalidLayout}),env,services,keys);
  assert.equal(invalid.status,400);assert.equal({}.text,undefined);assert.equal(calls,0);
  let cancelled=false;
  const oversized=new Request(`${env.ADMIN_ORIGIN}/api/admin/layout`,{method:'POST',duplex:'half',headers:{'content-type':'application/json','Cf-Access-Jwt-Assertion':token,origin:env.ADMIN_ORIGIN},body:new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(200000).fill(32));},cancel(){cancelled=true;}})});
  const result=await api.handleLayout(oversized,env,services,keys);
  assert.equal(result.status,413);assert.equal(cancelled,true);assert.equal(calls,0);
});
