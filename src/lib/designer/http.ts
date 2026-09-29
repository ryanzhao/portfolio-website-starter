import type {JWTVerifyGetKey} from 'jose';
import {requireAdmin,readAdminConfig,AdminAuthError} from '../admin-auth.ts';
import {requireWriteAllowance} from '../admin-write-limit.ts';
import {UploadError} from '../uploads.ts';
import {DesignerValidationError} from './model.ts';
import {createDefaultSite} from './defaults.ts';
import {readPageLayouts} from '../layout-store.ts';
import type {DesignerClient} from './store.ts';
import {verifyPublicationBatch,requirePublicationVerification,snapshotCatalogSession,catalogResources,readCatalogSession,initializeCatalog,seedCatalogSession,stageCatalogPart,commitCatalog,catalogRecycle,catalogHistory,previewCatalog,publishCatalog,restoreCatalog,sessionSite,pagedRequestLimit} from './catalog.ts';
import {designerMedia,verifyDesignReferences,verifyPublishedResources,publishDesignAsset,freezeLegacyMedia} from './resources.ts';
import type {FontStorage} from './fonts.ts';
export type DesignerServices={client:DesignerClient;storage:FontStorage};
export async function designJson(request:Request) {
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new UploadError(415,'请使用 JSON 请求。');
 const reader=request.body?.getReader();if(!reader)throw new UploadError(400,'请求为空。');let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>pagedRequestLimit){await reader.cancel();throw new UploadError(413,'设计内容请求过大，请逐页暂存。');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>;}catch{throw new UploadError(400,'JSON 内容无效。');}
}
export async function designerFallback(client:DesignerClient,published=false){const old=await readPageLayouts(client);return freezeLegacyMedia(createDefaultSite(published?old.publishedLayout:old.layout),client,published);}
export async function handleDesigner(request:Request,env:Record<string,string|undefined>,services:()=>Promise<DesignerServices>,keys?:JWTVerifyGetKey){
 const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
 try{
  const {subject:owner}=await requireAdmin(request,readAdminConfig(env),keys),{client,storage}=await services(),fallback=(published=false)=>designerFallback(client,published),params=new URL(request.url).searchParams;
  if(request.method==='GET'){
   if([...params.keys()].some(k=>!['pageId','revision','version','recycle','history','cursor','snapshot','publishedMedia','mediaPage'].includes(k))||[...params.keys()].some(k=>params.getAll(k).length!==1))throw new UploadError(400,'设计器查询无效。');
   const cursor=params.get('cursor')??undefined;if(cursor&&(cursor.length>2048||/[\x00-\x20]/.test(cursor)))throw new UploadError(400,'游标无效。');
   if(params.get('history')==='1'&&params.has('version')){const snapshotId=params.get('snapshot'),pageId=params.get('pageId');if(!snapshotId||!pageId)throw new UploadError(400,'请选择快照页面。');const result=await snapshotCatalogSession(storage.BACKUPS,owner,snapshotId,params.get('version'),pageId);return Response.json({...result,...(result.session?{media:await designerMedia(sessionSite(result.session),client,pageId,{storage,owner})}:{})},{headers});}
   if(params.get('history')==='1')return Response.json(await catalogHistory(storage.BACKUPS,owner,cursor,params.get('snapshot')??undefined),{headers});
   if(params.get('recycle')==='1')return Response.json(await catalogRecycle(client,owner,cursor),{headers});
   const pageId=params.get('pageId')??params.get('mediaPage')??undefined,session=await readCatalogSession(client,pageId,params.has('revision')?params.get('revision'):undefined)??await seedCatalogSession(fallback,pageId);
   return Response.json({...session,media:await designerMedia(sessionSite(session),client,session.page.id,params.get('publishedMedia')==='1'?undefined:{storage,owner})},{headers});
  }
  if(request.method!=='POST')throw new UploadError(405,'请求方法无效。');const body=await designJson(request);
  const fields:Record<string,string[]>={resources:['action','scope'],initialize:['action'],stagePage:['action','revision','page'],stageShared:['action','revision','key','value'],commit:['action','revision','receipts','deletePageIds','restoreIds','restorePaths','order'],verifyPublication:['action','revision','publishedRevision','scope','verification'],previewPublication:['action','scope','pageId','verification'],publish:['action','revision','publishedRevision','scope','confirmed','verification'],restore:['action','id','revision','version','scope','confirmed'],publishAsset:['action','id','confirmed']};
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.action!=='string'||!Object.hasOwn(fields,body.action)||Object.keys(body).some(k=>!fields[body.action as string].includes(k)))throw new UploadError(400,'设计器操作无效。');
  if(['previewPublication','publish'].includes(body.action)&&(typeof body.verification!=='string'||!/^designerVerification\.[a-f0-9-]{36}$/.test(body.verification)))throw new UploadError(400,'请先完成本次发布资源校验。');
  if(body.action==='resources')return Response.json(await catalogResources(client,body.scope),{headers});
  if(body.action==='previewPublication'){
   if(!Array.isArray(body.scope)||body.scope.some(v=>typeof v!=='string')||typeof body.pageId!=='string')throw new UploadError(400,'预览范围无效。');
   const session=await previewCatalog(client,body.scope,body.pageId,fallback,(_site,_assets,binding)=>requirePublicationVerification(client,owner,body.verification,binding));return Response.json({...session,media:await designerMedia(sessionSite(session),client,session.page.id)},{headers});
  }
  await requireWriteAllowance(storage.UPLOADS,owner,['stagePage','stageShared','verifyPublication'].includes(body.action)?'uploads':['initialize','commit'].includes(body.action)?'drafts':'publication');
  if(body.action==='verifyPublication'){if(!Array.isArray(body.scope)||body.scope.length>104||body.scope.some(v=>typeof v!=='string'))throw new UploadError(400,'校验范围无效。');return Response.json(await verifyPublicationBatch(client,owner,body as unknown as Parameters<typeof verifyPublicationBatch>[2],fallback,(site,assets)=>verifyPublishedResources(storage,client,owner,site,true,assets)),{headers});}
  if(body.action==='initialize'){await initializeCatalog(client,storage.BACKUPS,owner,fallback);return Response.json(await readCatalogSession(client),{headers});}
  if(body.action==='stagePage'){const id=(body.page as {id?:unknown})?.id;if(typeof id!=='string')throw new UploadError(400,'页面标识无效。');return Response.json(await stageCatalogPart(client,owner,body.revision,id,body.page,async site=>{await verifyDesignReferences(storage,owner,site);},storage.BACKUPS),{headers});}
  if(body.action==='stageShared'){if(!['header','footer','meta'].includes(body.key as string))throw new UploadError(400,'共享组件无效。');return Response.json(await stageCatalogPart(client,owner,body.revision,body.key as string,body.value,async site=>{await verifyDesignReferences(storage,owner,site);},storage.BACKUPS),{headers});}
  if(body.action==='commit')return Response.json(await commitCatalog(client,owner,body as unknown as Parameters<typeof commitCatalog>[2]),{headers});
  if(body.confirmed!==true)throw new UploadError(400,'请明确确认本次操作。');
  if(body.action==='publishAsset'){if(env.PUBLICATION_ENABLED!=='true'||typeof body.id!=='string')throw new UploadError(403,'素材发布未启用。');return Response.json({media:await publishDesignAsset(storage,client,owner,body.id)},{headers});}
  if(!Array.isArray(body.scope)||body.scope.length>104||body.scope.some(v=>typeof v!=='string'))throw new UploadError(400,'操作范围无效。');
  if(body.action==='publish'){if(env.PUBLICATION_ENABLED!=='true')throw new UploadError(403,'页面发布未启用。');return Response.json(await publishCatalog(client,storage.BACKUPS,owner,body as unknown as Parameters<typeof publishCatalog>[3],fallback,(_site,_assets,binding)=>requirePublicationVerification(client,owner,body.verification,binding)),{headers});}
  return Response.json(await restoreCatalog(client,storage.BACKUPS,owner,body as unknown as Parameters<typeof restoreCatalog>[3]),{headers});
 }catch(error){const status=error instanceof AdminAuthError||error instanceof UploadError?error.status:error instanceof DesignerValidationError?400:503;return Response.json({error:status===503?'设计器操作未确认，请保留输入并重新读取。':(error as Error).message},{status,headers:{...headers,...(error instanceof UploadError&&error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}});}
}
export async function readDesignerSession(client:DesignerClient,pageId?:string,revision?:string|null){const fallback=(published=false)=>designerFallback(client,published);return await readCatalogSession(client,pageId,revision)??await seedCatalogSession(fallback,pageId);}
