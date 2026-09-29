import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';

test('history authenticates and validates confirmation before accessing private services',async()=>{
  const api = await import('../src/lib/history-http.ts').catch(()=>({}));
  assert.equal(typeof api.handleHistory,'function');
  const env = { ACCESS_ISSUER:'https://test.cloudflareaccess.com', ACCESS_AUDIENCE:'test', ADMIN_EMAILS:'owner@example.test', ADMIN_ORIGIN:'https://admin.example.test' };
  const {privateKey,publicKey} = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
  const token = await new SignJWT({email:env.ADMIN_EMAILS}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(env.ACCESS_ISSUER).setAudience('test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let calls=0;
  const services=async()=>{calls++;throw new Error('private secret');};
  const request=(method,jwt,origin,body)=>new Request(`${env.ADMIN_ORIGIN}/api/admin/history?slotId=home.hero`,{method,headers:{'content-type':'application/json','Cf-Access-Jwt-Assertion':jwt,origin},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  for(const [req,status] of [[request('GET','',env.ADMIN_ORIGIN),401],[request('POST',token,'https://other.test',{}),403],
    [request('POST',token,env.ADMIN_ORIGIN,{}),400],[request('POST',token,env.ADMIN_ORIGIN,{confirmed:false}),400],
    [request('DELETE',token,env.ADMIN_ORIGIN),405]]){
    const result=await api.handleHistory(req,env,services,keys);
    assert.equal(result.status,status); assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal((await result.text()).includes('private secret'),false);
  }
  assert.equal(calls,0);
});
