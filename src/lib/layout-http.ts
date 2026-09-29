import type { JWTVerifyGetKey } from 'jose';
import { AdminAuthError, readAdminConfig, requireAdmin } from './admin-auth.ts';
import { requireWriteAllowance } from './admin-write-limit.ts';
import { UploadError } from './uploads.ts';
import { LayoutValidationError, validatePageLayout } from './page-layout.ts';
import { readPageLayouts, readLayoutHistory, saveLayoutDraft, publishLayout, restoreLayoutDraft, validLayoutRevision, validLayoutSnapshotId } from './layout-store.ts';

async function readLayoutJson(request:Request):Promise<unknown> {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new UploadError(415,'请使用 JSON 请求。');
  const reader=request.body?.getReader(); if(!reader) throw new UploadError(400,'请求内容为空。');
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>786432){await reader.cancel();throw new UploadError(413,'布局请求过大。');}chunks.push(value);}}
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new UploadError(400,'JSON 格式无效。');}
}

export async function handleLayout(request:Request,env:Record<string,string|undefined>,services:()=>Promise<{storage:Parameters<typeof publishLayout>[0];client:Parameters<typeof publishLayout>[1]}>,keys?:JWTVerifyGetKey) {
  const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'};
  try {
    const identity=await requireAdmin(request,readAdminConfig(env),keys);
    if(request.method==='GET') {
      const query=new URL(request.url).searchParams;
      if([...query.keys()].some(key=>!['history','cursor','snapshotId'].includes(key))||(query.has('history')&&query.get('history')!=='1')||(!query.has('history')&&(query.has('cursor')||query.has('snapshotId')))) throw new UploadError(400,'布局查询无效。');
      const cursor=query.get('cursor')??undefined,id=query.get('snapshotId')??undefined;
      if((cursor!==undefined&&(cursor.length>2048||/[\x00-\x20\x7f]/.test(cursor)))||(id!==undefined&&!validLayoutSnapshotId(id))) throw new UploadError(400,'历史查询无效。');
      const {storage,client}=await services();
      return Response.json(query.has('history')?await readLayoutHistory(storage,identity.subject,cursor,id):await readPageLayouts(client),{headers});
    }
    if(request.method!=='POST') throw new UploadError(405,'请求方法无效。');
    const body=await readLayoutJson(request) as Record<string,unknown>;
    if(!body||typeof body!=='object'||Array.isArray(body)||!validLayoutRevision(body.revision)) throw new UploadError(400,'布局请求无效。');
    const allowed=body.action==='save'?['action','layout','revision']:body.action==='publish'?['action','revision','publishedRevision','confirmed']:body.action==='restore'?['action','snapshotId','revision','confirmed','version']:[];
    if(!allowed.length||Object.keys(body).some(key=>!allowed.includes(key))) throw new UploadError(400,'布局操作无效。');
    if(body.action==='save') validatePageLayout(body.layout);
    else if(body.confirmed!==true||(body.action==='publish'&&!validLayoutRevision(body.publishedRevision))||(body.action==='restore'&&(!validLayoutSnapshotId(body.snapshotId)||(body.version!==undefined&&body.version!=='candidate'&&body.version!=='previous')))) throw new UploadError(400,'请明确确认有效的布局操作。');
    if(body.action==='publish'&&env.PUBLICATION_ENABLED!=='true') throw new UploadError(403,'布局发布尚未启用。');
    const {storage,client}=await services();
    await requireWriteAllowance(storage.UPLOADS,identity.subject,body.action==='save'?'drafts':'publication');
    const result=body.action==='save'?await saveLayoutDraft(client,body.layout,body.revision):body.action==='publish'?await publishLayout(storage,client,identity.subject,{revision:body.revision,publishedRevision:body.publishedRevision as string|null,confirmed:true}):await restoreLayoutDraft(storage,client,identity.subject,{snapshotId:body.snapshotId as string,revision:body.revision,confirmed:true,version:body.version as 'candidate'|'previous'|undefined});
    return Response.json(result,{headers});
  } catch(error) {
    const expected=error instanceof AdminAuthError||error instanceof UploadError;
    return Response.json({error:expected||error instanceof LayoutValidationError?error.message:'布局操作未确认，请重新读取核对，勿盲目重试。'},{status:expected?error.status:error instanceof LayoutValidationError?400:503,headers:{...headers,...(error instanceof UploadError&&error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}});
  }
}
