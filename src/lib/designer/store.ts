import type { SanityClient, Mutation } from '@sanity/client';
import type { R2Bucket } from '@cloudflare/workers-types';
import { validateSite, resolveLink, resolveStyle, type DesignerSite, type DesignerPage } from './model.ts';
import {blockCanvasSize,intentionalHeroBleed,rotatedBounds} from './geometry.ts';
import { UploadError } from '../uploads.ts';

export type DesignerClient = Pick<SanityClient,'getDocument'|'fetch'|'mutate'>;
export type DesignerState = {site:DesignerSite;revision:string|null;publishedSite:DesignerSite|null;publishedRevision:string|null};
const draftId='drafts.designer-site', publicId='designer-site';
export const designerRequestLimit=12*1024*1024;
const hash=async(text:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
export {canonical} from './model.ts';
import {canonical} from './model.ts';
export const revisionValid=(v:unknown):v is string|null=>v===null||typeof v==='string'&&/^[\w-]{1,256}$/.test(v);
type Manifest={schemaVersion:2;pages:string[];header:string;footer:string;meta:string};
function manifest(value:unknown):Manifest {
  const m=value as Manifest;
  if(!m||typeof m!=='object'||Object.keys(m).some(k=>!['schemaVersion','pages','header','footer','meta'].includes(k))||m.schemaVersion!==2||!Array.isArray(m.pages)||![...m.pages,m.header,m.footer,m.meta].every(id=>typeof id==='string'&&/^(designer-part-|designerPrivate\.)[a-f0-9]{64}$/.test(id)))throw new UploadError(409,'站点版本清单异常。');
  return m;
}
async function readVersion(client:DesignerClient,id:string) {
  const root=await client.getDocument(id);if(!root)return {site:null,revision:null};
  if(!revisionValid(root._rev)||!root._rev)throw new UploadError(409,'站点版本异常。');
  const m=manifest(root.manifest),ids=[...m.pages,m.header,m.footer,m.meta];
  if(id===publicId&&ids.some(v=>v.startsWith('designerPrivate.')))throw new UploadError(409,'公开清单不能引用私有草稿。');
  const parts=await client.fetch<{_id:string;payload:unknown}[]>('*[_id in $ids]{_id,payload}',{ids});
  const lookup=new Map(parts.map(p=>[p._id,p.payload]));
  for(const partId of ids)if(!lookup.has(partId)||!partId.endsWith(await hash(canonical(lookup.get(partId)))))throw new UploadError(409,'站点内容版本缺失或校验失败。');
  const meta=lookup.get(m.meta) as Pick<DesignerSite,'theme'|'fonts'>;
  return {site:validateSite({schemaVersion:2,pages:m.pages.map(p=>lookup.get(p)),header:lookup.get(m.header),footer:lookup.get(m.footer),theme:meta.theme,fonts:meta.fonts}),revision:root._rev};
}
type Fallback=(published?:boolean)=>Promise<DesignerSite>;
export async function readDesignerState(client:DesignerClient,fallback:Fallback):Promise<DesignerState> {
  const [draft,published]=await Promise.all([readVersion(client,draftId),readVersion(client,publicId)]);
  return {site:draft.site??published.site??await fallback(),revision:draft.revision,publishedSite:published.site,publishedRevision:published.revision};
}
export async function readPublishedSite(client:DesignerClient) {return (await readVersion(client,publicId)).site;}
async function prepareVersion(site:DesignerSite,published:boolean) {
  validateSite(site);
  if(new TextEncoder().encode(JSON.stringify(site)).length>designerRequestLimit-65536)throw new UploadError(413,'本次站点版本超过传输容量，请拆分内容后保存。');
  const docs=new Map<string,Mutation>();
  const part=async(payload:unknown)=>{const id=`${published?'designer-part-':'designerPrivate.'}${await hash(canonical(payload))}`;docs.set(id,{createIfNotExists:{_id:id,_type:'designerPart',payload}});return id;};
  const m:Manifest={schemaVersion:2,pages:[],header:await part(site.header),footer:await part(site.footer),meta:await part({theme:site.theme,fonts:site.fonts})};
  for(const page of site.pages)m.pages.push(await part(page));
  return {manifest:m,mutations:[...docs.values()]};
}
const rootMutation=(id:string,m:Manifest,revision:string|null):Mutation=>revision?{patch:{id,ifRevisionID:revision,set:{manifest:m}}}:{create:{_id:id,_type:'designerSite',manifest:m}};
async function mutate(client:DesignerClient,mutations:Mutation[]) {
  // Sanity's mutation API limit is 4,000,000 bytes; never split a publication transaction.
  if(new TextEncoder().encode(JSON.stringify({mutations})).length>3_950_000)throw new UploadError(413,'本次修改超过内容服务单次事务容量。请缩小发布范围；草稿和线上版本均未被截断。');
  try{await client.mutate(mutations,{visibility:'sync',returnDocuments:false});}
  catch(error){throw new UploadError(error&&typeof error==='object'&&'statusCode'in error&&error.statusCode===409?409:503,'站点写入未确认或版本冲突，请读回比较，未自动覆盖。');}
}
async function missingParts(client:DesignerClient,mutations:Mutation[]){
  const ids=mutations.flatMap(m=>'createIfNotExists'in m?[m.createIfNotExists._id!]:[]);
  const existing=await client.fetch<{_id:string}[]>('*[_id in $ids]{_id}',{ids}),known=new Set(existing.map(d=>d._id));
  return mutations.filter(m=>!('createIfNotExists'in m)||!known.has(m.createIfNotExists._id!));
}
export async function saveDesigner(client:DesignerClient,input:unknown,revision:unknown,fallback:Fallback) {
  if(!revisionValid(revision))throw new UploadError(400,'草稿版本无效。');
  const site=validateSite(input),prepared=await prepareVersion(site,false);
  // Private immutable parts can be staged independently; only the final CAS activates a version.
  const missing=await missingParts(client,prepared.mutations);let batch:Mutation[]=[],size=0;
  for(const part of missing){const bytes=new TextEncoder().encode(JSON.stringify(part)).length;if(size+bytes>3_900_000){await mutate(client,batch);batch=[];size=0;}batch.push(part);size+=bytes;}
  if(batch.length)await mutate(client,batch);
  await mutate(client,[rootMutation(draftId,prepared.manifest,revision)]);
  const confirmed=await readDesignerState(client,fallback);
  if(canonical(confirmed.site)!==canonical(site))throw new UploadError(409,'保存后草稿已变化，请比较远程版本。');
  return confirmed;
}
type Snapshot={id:string;owner:string;createdAt:string;kind:'publish'|'restore'|'migration';draft:DesignerSite;published:DesignerSite|null;candidate:DesignerSite;};
const snapshotIdValid=(id:unknown):id is string=>typeof id==='string'&&/^\d{13}-[a-f0-9-]{36}$/.test(id);
async function prefix(owner:string){return `snapshots/designer/${await hash(owner)}/`;}
async function backup(bucket:R2Bucket,owner:string,state:DesignerState,candidate:DesignerSite,kind:Snapshot['kind']) {
  const id=`${String(9999999999999-Date.now()).padStart(13,'0')}-${crypto.randomUUID()}`;
  const snapshot:Snapshot={id,owner,kind,createdAt:new Date().toISOString(),draft:state.site,published:state.publishedSite,candidate};
  const body=JSON.stringify(snapshot),key=`${await prefix(owner)}${id}.json`,digest=await hash(body);
  await bucket.put(key,body,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256:digest},httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  const object=await bucket.get(key);
  if(!object||await object.text()!==body||object.customMetadata?.sha256!==digest||(await bucket.head(key))?.version!==object.version)throw new UploadError(503,'站点快照校验失败，未执行发布或恢复。');
  return id;
}
async function snapshot(bucket:R2Bucket,owner:string,id:unknown) {
  if(!snapshotIdValid(id))throw new UploadError(400,'快照标识无效。');
  const key=`${await prefix(owner)}${id}.json`,object=await bucket.get(key);
  if(!object)throw new UploadError(404,'快照不存在。');
  if(object.size>designerRequestLimit*3+65536){await object.body.cancel();throw new UploadError(409,'快照超过容量。');}
  const body=await object.text();if(await hash(body)!==object.customMetadata?.sha256||(await bucket.head(key))?.version!==object.version)throw new UploadError(409,'快照完整性校验失败。');
  const record=JSON.parse(body) as Snapshot;
  if(record.id!==id||record.owner!==owner||!['publish','restore','migration'].includes(record.kind))throw new UploadError(409,'快照归属异常。');
  validateSite(record.draft);validateSite(record.candidate);if(record.published)validateSite(record.published);return record;
}
export async function designerHistory(bucket:R2Bucket,owner:string,cursor?:string,id?:string) {
  if(id){const {owner:privateOwner,...record}=await snapshot(bucket,owner,id);void privateOwner;return {snapshot:record};}
  const root=await prefix(owner),page=await bucket.list({prefix:root,limit:10,cursor});
  // List metadata only; comparison fetches one verified snapshot on demand.
  return {items:page.objects.map(o=>({id:o.key.slice(root.length,-5),createdAt:o.uploaded.toISOString()})),nextCursor:page.truncated?page.cursor:null};
}
export async function backupDesignerMigration(client:DesignerClient,bucket:R2Bucket,owner:string,candidate:DesignerSite,fallback:Fallback){
  const current=await readDesignerState(client,fallback);
  if(!current.revision)await backup(bucket,owner,current,candidate,'migration');
}
export function publicationIssues(site:DesignerSite):string[] {
  const issues:string[]=[];
  for(const page of [...site.pages.filter(p=>!p.deleted),site.header,site.footer])for(const block of page.blocks.filter(b=>!b.deleted&&!b.hidden))for(const e of block.elements.filter(e=>!e.deleted&&!e.hidden)) {
    const link=e.link;
    if(link&&(!resolveLink(site,link)||'pageId'in link&&link.anchor&&!site.pages.find(p=>p.id===link.pageId)?.blocks.some(b=>!b.deleted&&b.id===link.anchor)))issues.push(`${page.name} / ${e.name}：链接目标不存在或未发布`);
    if(e.type==='button'&&!e.text?.trim())issues.push(`${page.name} / ${e.name}：按钮文字为空`);
    if(['image','video'].includes(e.type)&&e.assetId&&!e.alt?.trim())issues.push(`${page.name} / ${e.name}：请填写媒体说明`);
    for(const width of [390,768,1024,1440,1920]){const view=width<768?'mobile':width<1024?'tablet':'desktop',style=resolveStyle(e.styles,view);if(style.hidden)continue;const bounds=rotatedBounds(style,blockCanvasSize(block,view,width));if(!intentionalHeroBleed(page,block,e,bounds)&&(style.x!==undefined&&(bounds.left<-.1||bounds.right>100.1)||style.y!==undefined&&(bounds.top<-.1||bounds.bottom>100.1)))issues.push(`${page.name} / ${e.name}：元素超出区块（${width}px）`);}
  }
  return [...new Set(issues)];
}
export function selectedPublication(state:DesignerState,scope:string[],fallback:DesignerSite) {
  const target=structuredClone(state.publishedSite??fallback),draft=state.site;
  if(!scope.length||scope.length>204||new Set(scope).size!==scope.length||scope.some(id=>!['header','footer','theme','fonts',...draft.pages.map(p=>p.id)].includes(id)))throw new UploadError(400,'请选择有效的发布范围。');
  for(const key of ['header','footer','theme','fonts'] as const)if(scope.includes(key))Object.assign(target,{[key]:structuredClone(draft[key])});
  for(const id of scope){const page=draft.pages.find(p=>p.id===id);if(!page)continue;const index=target.pages.findIndex(p=>p.id===id);if(index<0)target.pages.push(structuredClone(page));else target.pages[index]=structuredClone(page);}
  validateSite(target);const issues=publicationIssues(target);if(issues.length)throw new UploadError(409,issues.slice(0,8).join('；'));
  // Public-dataset documents must never include the contents of a recycle bin.
  const clean=(page:DesignerPage):DesignerPage=>page.deleted?{id:page.id,path:page.path,name:'Removed page',title:'',description:'',deleted:true,showHeader:false,showFooter:false,blocks:[],...(page.redirectFrom?{redirectFrom:page.redirectFrom}:{})}:{...page,blocks:page.blocks.filter(b=>!b.deleted).map(b=>({...b,elements:b.elements.filter(e=>!e.deleted)}))};
  target.pages=target.pages.map(clean);target.header=clean(target.header);target.footer=clean(target.footer);return target;
}
export async function publishDesigner(client:DesignerClient,bucket:R2Bucket,owner:string,input:{revision:string|null;publishedRevision:string|null;scope:string[];confirmed:boolean},fallback:Fallback,verifyResources:(site:DesignerSite)=>Promise<void>) {
  if(input.confirmed!==true||!revisionValid(input.revision)||!revisionValid(input.publishedRevision))throw new UploadError(400,'请确认发布版本。');
  const state=await readDesignerState(client,fallback);
  if(!state.revision||state.revision!==input.revision||state.publishedRevision!==input.publishedRevision)throw new UploadError(409,'草稿或公开站点已变化，请重新比较。');
  const candidate=selectedPublication(state,input.scope,await fallback(true));await verifyResources(candidate);
  const snapshotId=await backup(bucket,owner,state,candidate,'publish'),prepared=await prepareVersion(candidate,true);
  const draftRoot=await client.getDocument(draftId);
  await mutate(client,[...await missingParts(client,prepared.mutations),{patch:{id:draftId,ifRevisionID:state.revision,set:{manifest:draftRoot!.manifest}}},rootMutation(publicId,prepared.manifest,state.publishedRevision)]);
  const confirmed=await readDesignerState(client,fallback);if(canonical(confirmed.publishedSite)!==canonical(candidate))throw new UploadError(409,'发布结果已变化，请重新读取核对。');
  return {...confirmed,snapshotId};
}
export async function restoreDesigner(client:DesignerClient,bucket:R2Bucket,owner:string,input:{id:string;revision:string|null;version:'draft'|'published'|'candidate';scope:string[];confirmed:boolean},fallback:Fallback) {
  if(input.confirmed!==true||!revisionValid(input.revision)||!['draft','published','candidate'].includes(input.version))throw new UploadError(400,'恢复请求无效。');
  const current=await readDesignerState(client,fallback);if(current.revision!==input.revision)throw new UploadError(409,'当前草稿已变化。');
  const record=await snapshot(bucket,owner,input.id),source=record[input.version];if(!source)throw new UploadError(409,'该快照没有此版本。');
  let candidate:DesignerSite;
  if(!input.scope.length)candidate=source;
  else{candidate=structuredClone(current.site);for(const id of input.scope){if(['header','footer','theme','fonts'].includes(id)){const key=id as 'header'|'footer'|'theme'|'fonts';Object.assign(candidate,{[key]:structuredClone(source[key])});}else{const page=source.pages.find(p=>p.id===id);if(!page)throw new UploadError(400,'历史页面不存在。');const index=candidate.pages.findIndex(p=>p.id===id);if(index<0)candidate.pages.push(page);else candidate.pages[index]=page;}}validateSite(candidate);}
  await backup(bucket,owner,current,candidate,'restore');return saveDesigner(client,candidate,current.revision,fallback);
}
