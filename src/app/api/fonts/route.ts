import {getCloudflareContext} from '@opennextjs/cloudflare';
import type {R2Bucket} from '@cloudflare/workers-types';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try{
    const sha=new URL(request.url).searchParams.get('sha');
    if(process.env.PUBLIC_MEDIA_ENABLED!=='true'||!sha||!/^[a-f0-9]{64}$/.test(sha))return new Response(null,{status:404,headers});
    const {env}=await getCloudflareContext({async:true}),bucket=(env as unknown as {PUBLISHED:R2Bucket}).PUBLISHED;
    const file=await bucket.get(`fonts/${sha}.woff2`);
    if(!file)return new Response(null,{status:404,headers});
    if(file.size>5242880||file.httpMetadata?.contentType!=='font/woff2'||!file.checksums.sha256||Buffer.from(file.checksums.sha256).toString('hex')!==sha){await file.body.cancel();return new Response(null,{status:409,headers});}
    return new Response(file.body as ReadableStream,{headers:{...headers,'Content-Type':'font/woff2','Cache-Control':'public, max-age=31536000, immutable','Content-Length':String(file.size)}});
  }catch{return new Response(null,{status:503,headers});}
}
