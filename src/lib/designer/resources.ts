import type {D1Database} from '@cloudflare/workers-types';
import type {SanityClient} from '@sanity/client';
import type {DesignerSite,DesignerPage} from './model.ts';
import type {FontStorage} from './fonts.ts';
import type {SlotMedia} from '../public-content.ts';
import {readUpload,UploadError} from '../uploads.ts';
import {publicFontKey,type FontRecord} from './fonts.ts';
import {readPrivateVariant} from '../private-preview.ts';
import {copyPublishedVariant} from '../publish-media.ts';
import {publicMediaVariants} from '../processing-result.ts';
import {readPublishedPlacement} from '../published-placement.ts';
import {readPlacementDraft} from '../placement-draft.ts';
import {readEditorPage} from '../editor-page.ts';
import {mediaSlots,publishedPlacementId} from '../media.ts';

type Client=Pick<SanityClient,'getDocument'|'mutate'>&Partial<Pick<SanityClient,'fetch'>>;
type Reader=Pick<Client,'getDocument'|'fetch'>;
async function batchReader(client:Reader,ids:string[]):Promise<Pick<Client,'getDocument'>>{
  if(!client.fetch||!ids.length)return client;
  const documents=await client.fetch<{_id:string}[]>('*[_id in $ids]',{ids:[...new Set(ids)]});
  const byId=new Map(documents.map(d=>[d._id,d]));
  return {getDocument:async(id:string)=>byId.get(id)} as Pick<Client,'getDocument'>;
}
const uuid=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
async function ownedRecords<T extends {id:string}>(db:D1Database,table:'upload_sessions'|'designer_fonts',owner:string,ids:string[]){
  if(ids.some(id=>!uuid(id)))throw new UploadError(400,'素材标识无效。');
  const found=new Map<string,T>();for(let i=0;i<ids.length;i+=90){const batch=ids.slice(i,i+90),rows=await db.prepare(`SELECT * FROM ${table} WHERE owner = ? AND id IN (${batch.map(()=>'?').join(',')})`).bind(owner,...batch).all<T>();for(const row of rows.results)found.set(row.id,row);}
  if(ids.some(id=>!found.has(id)))throw new UploadError(404,'素材不存在或不属于当前账号。');return found;
}
export type DesignerMedia=Record<string,SlotMedia|null>;
// Resolve the old slots once. V2 documents retain immutable asset IDs, never live slot pointers.
export async function freezeLegacyMedia(site:DesignerSite,client:Reader,published=false){
  const copy=structuredClone(site),elements=activeElements(copy).filter(e=>e.legacySlot),reader=await batchReader(client,elements.flatMap(e=>[publishedPlacementId(e.legacySlot!),...published?[]:[`drafts.placement-${e.legacySlot}`]]));
  await Promise.all(elements.map(async element=>{
    const slot=element.legacySlot!;
    const live=await readPublishedPlacement(reader,slot),draft=published?null:await readPlacementDraft(reader,slot);
    const placement=draft?.placement??live?.placement;
    if(placement){element.assetId=placement.assetId;element.alt=placement.alt;if(live?.placement.assetId===placement.assetId)element.type=live.kind;}
    delete element.legacySlot;
  }));
  return copy;
}
async function legacyPublishedAsset(client:Pick<Client,'getDocument'>,id:string){
  for(const slot of mediaSlots){const record=await readPublishedPlacement(client,slot.id);if(record?.placement.assetId===id)return {kind:record.kind,variants:record.variants};}
  return null;
}
function activeElements(site:DesignerSite,pageId?:string){return [...site.pages.filter(p=>!p.deleted&&(!pageId||p.id===pageId)),site.header,site.footer].flatMap(p=>p.blocks.filter(b=>!b.deleted).flatMap(b=>b.elements.filter(e=>!e.deleted)));}
export function designAssetIds(site:DesignerSite,pageId?:string) {
  const pages=[...site.pages.filter(p=>!p.deleted&&(!pageId||p.id===pageId)),site.header,site.footer];
  return [...new Set(pages.flatMap(p=>[
    ...(p.shareAssetId?[p.shareAssetId]:[]),
    ...p.blocks.filter(b=>!b.deleted).flatMap(b=>[
      ...Object.values(b.styles).flatMap(s=>s.backgroundAssetId?[s.backgroundAssetId]:[]),
      ...b.elements.filter(e=>!e.deleted).flatMap(e=>[e.assetId,e.posterAssetId].filter((id):id is string=>!!id)),
    ]),
  ]))];
}
export async function readDesignAsset(client:Pick<Client,'getDocument'>,id:string) {
  if(!uuid(id))throw new UploadError(400,'素材标识无效。');
  const doc=await client.getDocument(`designer-media-${id}`);if(!doc)return null;
  if(doc.assetId!==id||!['image','video','model'].includes(doc.kind))throw new UploadError(409,'公开素材记录异常。');
  return {kind:doc.kind as 'image'|'video'|'model',variants:publicMediaVariants(id,doc.kind,doc.variants)};
}
function publicMedia(content:NonNullable<Awaited<ReturnType<typeof readDesignAsset>>>):SlotMedia {
  const url=(role:string)=>`/api/media?key=${encodeURIComponent(content.variants.find(v=>v.role===role)!.key)}`;
  return {kind:content.kind,src:url(content.kind==='model'?'model':content.kind==='image'?'detail':'video'),...(content.kind==='video'?{poster:url('poster')}:{}),alt:'',caption:''};
}
export async function verifyDesignReferences(storage:FontStorage,owner:string,site:DesignerSite,assetIds=designAssetIds(site)) {
  if(activeElements(site).some(e=>e.legacySlot))throw new UploadError(409,'旧素材引用尚未迁移，请重新读取设计器。');
  const assets=await ownedRecords<{id:string;kind:string}>(storage.UPLOADS,'upload_sessions',owner,assetIds);
  const model=(id?:string)=>!!id&&assets.get(id)?.kind==='model';
  for(const page of [...site.pages.filter(p=>!p.deleted),site.header,site.footer]){
    if(model(page.shareAssetId))throw new UploadError(409,'分享图片不能使用 3D 模型。');
    for(const block of page.blocks.filter(b=>!b.deleted)){
      if(Object.values(block.styles).some(s=>model(s.backgroundAssetId)))throw new UploadError(409,'背景不能使用 3D 模型。');
      for(const e of block.elements.filter(e=>!e.deleted)){
        if(model(e.posterAssetId)||(e.assetId&&assets.has(e.assetId)&&((e.type==='cad')!==model(e.assetId))))throw new UploadError(409,'3D 模型只能用于 3D 区块，模型区块也必须选择 STEP 模型素材。');
      }
    }
  }
  const fonts=await ownedRecords<FontRecord>(storage.UPLOADS,'designer_fonts',owner,site.fonts.map(f=>f.id));
  for(const font of site.fonts){const record=fonts.get(font.id)!;if(record.status==='reserved'||record.sha256!==font.sha256||record.family!==font.family||record.weight!==font.weight||record.style!==font.style)throw new UploadError(409,'字体元数据不匹配或尚未完成上传。');}
  return fonts;
}
export async function verifyPublishedResources(storage:FontStorage,client:Client,owner:string,site:DesignerSite,registerLegacy=false,assetIds=designAssetIds(site)) {
  const fonts=await verifyDesignReferences(storage,owner,site,assetIds);
  if(activeElements(site).some(e=>e.legacySlot))throw new UploadError(409,'旧素材引用尚未迁移，请重新读取设计器。');
  const ids=assetIds,registrations:{id:string;record:NonNullable<Awaited<ReturnType<typeof readDesignAsset>>>}[]=[],reader=await batchReader(client,ids.length?[...ids.map(id=>`designer-media-${id}`),...mediaSlots.map(s=>publishedPlacementId(s.id))]:[]);
  for(const id of ids){const existing=await readDesignAsset(reader,id),record=existing??await legacyPublishedAsset(reader,id);if(!record)throw new UploadError(409,`素材 ${id.slice(0,8)} 尚未发布，请先发布本次使用的新素材。`);for(const variant of record.variants){const object=await storage.PUBLISHED.head(variant.key);if(!object||object.size!==variant.size||!object.checksums.sha256||Buffer.from(object.checksums.sha256).toString('hex')!==variant.sha256)throw new UploadError(409,'公开素材校验失败，未发布页面。');}
    if(registerLegacy&&!existing)registrations.push({id,record});
  }
  if(registrations.length){await client.mutate(registrations.map(({id,record})=>({createIfNotExists:{_id:`designer-media-${id}`,_type:'designerMedia',assetId:id,...record}})),{visibility:'sync'});const confirmed=await batchReader(client,registrations.map(({id})=>`designer-media-${id}`));for(const {id,record} of registrations)if(JSON.stringify(await readDesignAsset(confirmed,id))!==JSON.stringify(record))throw new UploadError(409,'旧公开素材归档未确认。');}
  for(const font of site.fonts){const record=fonts.get(font.id)!,object=await storage.PUBLISHED.head(publicFontKey(record));if(record.status!=='published'||!object?.checksums.sha256||Buffer.from(object.checksums.sha256).toString('hex')!==record.sha256)throw new UploadError(409,`字体 ${font.family} 尚未发布。`);}
}
export async function publishDesignAsset(storage:FontStorage,client:Client,owner:string,id:string) {
  if(!uuid(id))throw new UploadError(400,'素材标识无效。');
  const upload=await readUpload(storage.UPLOADS,owner,id);
  if(upload.status!=='processing_pending')throw new UploadError(409,'素材未处理完成。');
  const roles=upload.kind==='model'?['model']:upload.kind==='image'?['thumbnail','detail']:['poster','video'];
  const privateVariants=[];
  for(const role of roles){const {object,mimeType,width,height}=await readPrivateVariant(storage.UPLOADS,storage.ORIGINALS,owner,id,role);privateVariants.push({role,key:object.key,version:object.version,etag:object.etag,size:object.size,mimeType,width,height});await object.body.cancel();}
  const key=`snapshots/designer-media/${id}/${crypto.randomUUID()}.json`,body=JSON.stringify({id,kind:upload.kind,privateVariants,createdAt:new Date().toISOString()});
  await storage.BACKUPS.put(key,body,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  if(await (await storage.BACKUPS.get(key))?.text()!==body)throw new UploadError(503,'素材发布快照读回失败。');
  const variants=[];for(const role of roles)variants.push(await copyPublishedVariant(storage.UPLOADS,storage.ORIGINALS,storage.PUBLISHED,owner,id,role));
  await client.mutate([{createIfNotExists:{_id:`designer-media-${id}`,_type:'designerMedia',assetId:id,kind:upload.kind,variants}}],{visibility:'sync'});
  const result=await readDesignAsset(client,id);if(!result||JSON.stringify(result.variants.map(v=>v.key))!==JSON.stringify(variants.map(v=>v.key)))throw new UploadError(409,'素材发布版本未确认，请重新读取。');
  return publicMedia(result);
}
export async function designerMedia(site:DesignerSite,client:Client,pageId?:string,privateContext?:{storage:FontStorage;owner:string}):Promise<DesignerMedia> {
  const elements=activeElements(site,pageId),result:DesignerMedia={};
  const slots=[...new Set(elements.flatMap(e=>e.legacySlot?[e.legacySlot]:[]))];
  if(privateContext){for(const path of new Set(slots.map(id=>mediaSlots.find(s=>s.id===id)!.path))){const page=await readEditorPage(privateContext.storage.UPLOADS,privateContext.storage.ORIGINALS,client,privateContext.owner,path);for(const id of slots)if(id in page.media)result[`legacy:${id}`]=page.media[id];}}
  else{await Promise.all(slots.map(async id=>{try{const placement=await readPublishedPlacement(client,id);result[`legacy:${id}`]=placement?{...publicMedia(placement),alt:placement.placement.alt,caption:placement.placement.caption}:null;}catch{result[`legacy:${id}`]=null;}}));}
  const assetIds=designAssetIds(site,pageId),reader=privateContext?client:await batchReader(client,assetIds.length?[...assetIds.map(id=>`designer-media-${id}`),...mediaSlots.map(s=>publishedPlacementId(s.id))]:[]);
  if(privateContext){
    for(const id of assetIds)result[id]=null;
    // Metadata is owner-scoped; each browser media request still verifies immutable bytes.
    for(let i=0;i<assetIds.length;i+=90){const batch=assetIds.slice(i,i+90),rows=await privateContext.storage.UPLOADS.prepare(`SELECT u.id,u.kind FROM upload_sessions u JOIN processing_jobs j ON j.assetId=u.id WHERE u.owner=? AND u.id IN (${batch.map(()=>'?').join(',')}) AND j.status='ready' AND j.resultManifest IS NOT NULL AND j.verifiedObjects IS NOT NULL`).bind(privateContext.owner,...batch).all<{id:string;kind:'image'|'video'|'model'}>();for(const {id,kind} of rows.results){const url=(role:string)=>`/api/admin/media?assetId=${id}&role=${role}`;result[id]={kind,src:url(kind==='model'?'model':kind==='image'?'detail':'video'),...(kind==='video'?{poster:url('poster')}:{}),alt:'',caption:''};}}
  }else for(const id of assetIds){result[id]=null;try{const content=await readDesignAsset(reader,id)??await legacyPublishedAsset(reader,id);result[id]=content?publicMedia(content):null;}catch{/* Keep an honest pending placeholder. */}}
  return result;
}
export function pageResources(site:DesignerSite,page:DesignerPage) {return designAssetIds({...site,pages:[page]});}
