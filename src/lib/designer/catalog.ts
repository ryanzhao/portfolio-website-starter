import type {Mutation} from '@sanity/client';
import type {R2Bucket} from '@cloudflare/workers-types';
import {validatePage,validateSite,isSafePath,resolveStyle,type DesignerPage,type DesignerSite,type DesignerLink} from './model.ts';
import {blockCanvasSize,intentionalHeroBleed,rotatedBounds} from './geometry.ts';
import {layoutFonts} from '../page-layout.ts';
import {UploadError} from '../uploads.ts';
import {canonical,revisionValid,type DesignerClient} from './store.ts';

export type PartRef={part:string;index:string};
export type PageSummary=Omit<DesignerPage,'blocks'|'deleted'|'redirectFrom'>&PartRef;
export type DesignerCatalog={schemaVersion:3;pages:PageSummary[];header:PartRef;footer:PartRef;meta:string};
type PageIssue={id:string;codes:string[];widths:number[]};
export type PageIndex={redirects:string[];ids:string[];anchors:string[];links:DesignerLink[];fonts:string[];assets:string[];issues:PageIssue[]};
export type DesignerSession={catalog:DesignerCatalog;publishedCatalog:DesignerCatalog|null;revision:string|null;publishedRevision:string|null;page:DesignerPage;header:DesignerPage;footer:DesignerPage;theme:DesignerSite['theme'];fonts:DesignerSite['fonts']};
type Root={catalog:DesignerCatalog;revision:string};
type Receipt={owner:string;revision:string|null;key:string;summary?:PageSummary;ref?:PartRef|string};
const draftId='drafts.designer-site',publicId='designer-site';
export const pagedRequestLimit=768*1024+64*1024;
export const digest=async(value:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const bad=(message:string):never=>{throw new UploadError(409,message);};
const validPart=(id:unknown):id is string=>typeof id==='string'&&/^(designer-part-|designerPrivate\.)[a-f0-9]{64}$/.test(id);
// Keep each response bounded; 20 maximum-size parts stay below 17 MiB of JSON.
const partBatchSize=20;
const stagedPayloads=new WeakMap<DesignerClient,Map<string,unknown>>();
async function documents<T extends {_id:string}>(client:DesignerClient,ids:string[]):Promise<Map<string,T>>{if(!ids.length)return new Map();const docs=await client.fetch<T[]>('*[_id in $ids]',{ids:[...new Set(ids)]});return new Map(docs.map(doc=>[doc._id,doc]));}
export async function* iterateParts<T>(client:DesignerClient,ids:string[]):AsyncGenerator<{id:string;payload:T}>{
 const unique=[...new Set(ids)];for(let offset=0;offset<unique.length;offset+=partBatchSize){const batch=unique.slice(offset,offset+partBatchSize);if(batch.some(id=>!validPart(id)))bad('内容引用无效。');const docs=await documents<{_id:string;payload:T}>(client,batch);for(const id of batch){const doc=docs.get(id);if(!doc||!id.endsWith(await digest(canonical(doc.payload))))bad('内容版本缺失或完整性校验失败。');yield {id,payload:doc!.payload};}}
}
async function sharedParts(client:DesignerClient,catalog:DesignerCatalog){const docs=new Map<string,unknown>();for await(const part of iterateParts(client,[catalog.meta,catalog.header.part,catalog.footer.part]))docs.set(part.id,part.payload);return {header:validatePage(docs.get(catalog.header.part)),footer:validatePage(docs.get(catalog.footer.part)),...docs.get(catalog.meta) as Pick<DesignerSite,'theme'|'fonts'>};}
function privateWriter(client:DesignerClient){let pending:Mutation[]=[],size=0;const flush=async()=>{if(pending.length){await catalogMutate(client,pending);pending=[];size=0;}};return {flush,add:async(mutations:Mutation[])=>{for(const mutation of mutations){const length=bytes(mutation);if(size+length>3_900_000)await flush();pending.push(mutation);size+=length;}}};}
export async function catalogMutate(client:DesignerClient,mutations:Mutation[]){
 if(bytes({mutations})>3_950_000)throw new UploadError(413,'本次事务超过容量，请缩小操作范围。');
 try{await client.mutate(mutations,{visibility:'sync',returnDocuments:false});}catch(e){throw new UploadError(e&&typeof e==='object'&&'statusCode'in e&&e.statusCode===409?409:503,'版本冲突或写入未确认，请重新读取。');}
}
export async function readPart<T>(client:DesignerClient,id:string):Promise<T>{
 if(!validPart(id))bad('内容引用无效。');const doc=await client.getDocument(id);
 if(!doc||!id.endsWith(await digest(canonical(doc.payload))))bad('内容版本缺失或完整性校验失败。');return doc!.payload as T;
}
export async function partMutation(payload:unknown,published=false){const id=`${published?'designer-part-':'designerPrivate.'}${await digest(canonical(payload))}`;return {id,mutation:{createIfNotExists:{_id:id,_type:'designerPart',payload}} as Mutation};}
export function pageIndex(page:DesignerPage):PageIndex{
 const issues:PageIssue[]=[];
 for(const block of page.blocks.filter(b=>!b.deleted&&!b.hidden))for(const e of block.elements.filter(e=>!e.deleted&&!e.hidden)){
  const issue:PageIssue={id:e.id,codes:[],widths:[]};if(e.type==='button'&&!e.text?.trim())issue.codes.push('empty-button');if(['image','video'].includes(e.type)&&e.assetId&&!e.alt?.trim())issue.codes.push('missing-alt');
  for(const width of [390,768,1024,1440,1920]){const view=width<768?'mobile':width<1024?'tablet':'desktop',style=resolveStyle(e.styles,view);if(style.hidden)continue;const bounds=rotatedBounds(style,blockCanvasSize(block,view,width));if(!intentionalHeroBleed(page,block,e,bounds)&&(style.x!==undefined&&(bounds.left<-.1||bounds.right>100.1)||style.y!==undefined&&(bounds.top<-.1||bounds.bottom>100.1)))issue.widths.push(width);}
  if(issue.codes.length||issue.widths.length)issues.push(issue);
 }
 return {redirects:page.redirectFrom??[],assets:[...new Set([...(page.shareAssetId?[page.shareAssetId]:[]),...page.blocks.filter(b=>!b.deleted).flatMap(b=>[...Object.values(b.styles).flatMap(s=>s.backgroundAssetId?[s.backgroundAssetId]:[]),...b.elements.filter(e=>!e.deleted).flatMap(e=>[e.assetId,e.posterAssetId].filter((id):id is string=>!!id))])])],issues,ids:[page.id,...page.blocks.flatMap(b=>[b.id,...b.elements.map(e=>e.id)])],anchors:page.blocks.filter(b=>!b.deleted).map(b=>b.id),links:page.blocks.filter(b=>!b.deleted&&!b.hidden).flatMap(b=>b.elements.filter(e=>!e.deleted&&!e.hidden&&e.link).map(e=>e.link!)),fonts:[...new Set(page.blocks.flatMap(b=>b.elements.flatMap(e=>Object.values(e.styles).flatMap(s=>s.font?[s.font]:[]))))]};
}
export async function pageParts(page:DesignerPage,published=false){
 const body=await partMutation(page,published),index=await partMutation(pageIndex(page),published);const {blocks,deleted,redirectFrom,...summary}=page;void blocks;void deleted;void redirectFrom;
 return {summary:{...summary,part:body.id,index:index.id} as PageSummary,mutations:[body.mutation,index.mutation]};
}
export function parseCatalog(value:unknown):DesignerCatalog{
 const m=value as DesignerCatalog;
 if(!m||m.schemaVersion!==3||!Array.isArray(m.pages)||m.pages.length>100||Object.keys(m).some(k=>!['schemaVersion','pages','header','footer','meta'].includes(k))||!validPart(m.meta))bad('站点目录无效。');
 for(const ref of [...m.pages,m.header,m.footer])if(!ref||!validPart(ref.part)||!validPart(ref.index))bad('站点目录引用无效。');
 const seen=new Set<string>(),paths=new Set<string>();
 for(const p of m.pages){if(typeof p.id!=='string'||seen.has(p.id))bad('页面标识重复。');seen.add(p.id);for(const path of [p.path]){if(!isSafePath(path)||paths.has(path)||['/global-header','/global-footer'].includes(path))bad('页面网址冲突。');paths.add(path);}}
 if(m.pages.filter(p=>p.path==='/').length!==1)bad('网站必须保留唯一首页。');return structuredClone(m);
}
export async function readCatalogRoot(client:DesignerClient,published=false):Promise<Root|null>{
 const doc=await client.getDocument(published?publicId:draftId);if(!doc)return null;
 if(!revisionValid(doc._rev)||!doc._rev)bad('站点版本无效。');const catalog=parseCatalog(doc.manifest);
 if(published&&[catalog.meta,...[...catalog.pages,catalog.header,catalog.footer].flatMap(p=>[p.part,p.index])].some(id=>!id.startsWith('designer-part-')))bad('公开目录引用了私有内容。');return {catalog,revision:doc._rev};
}
export function catalogRootMutation(catalog:DesignerCatalog,revision:string|null,published=false):Mutation {const id=published?publicId:draftId;return revision?{patch:{id,ifRevisionID:revision,set:{manifest:catalog}}}:{create:{_id:id,_type:'designerSite',manifest:catalog}};}
export async function validateCatalog(client:DesignerClient,catalog:DesignerCatalog,publication=false,assets?:Set<string>){
 parseCatalog(catalog);const {header,footer,...meta}=await sharedParts(client,catalog);
 // Existing model remains the authority for shared configuration and reserved routes.
 validateSite({schemaVersion:2,pages:catalog.pages.map(({part,index,...p})=>{void part;void index;return {...p,blocks:[]};}),header,footer,...meta});
 const paths=new Set([...catalog.pages.map(p=>p.path),'/global-header','/global-footer']),ids=new Set<string>(),anchors=new Map<string,Set<string>>(),links:{pageId:string;anchor?:string}[]=[],fonts=new Set([...Object.keys(layoutFonts),...meta.fonts.map(f=>f.id)]);
 for await(const {payload:index} of iterateParts<PageIndex>(client,[...catalog.pages,catalog.header,catalog.footer].map(ref=>ref.index))){for(const asset of index.assets)assets?.add(asset);for(const path of index.redirects){if(!isSafePath(path)||paths.has(path))bad('网址或重定向冲突。');paths.add(path);}for(const id of index.ids){if(ids.has(id))bad('全站内容 ID 重复。');ids.add(id);}for(const font of index.fonts)if(!fonts.has(font))bad('字体未登记。');if(publication){anchors.set(index.ids[0],new Set(index.anchors));links.push(...index.links.filter((link):link is {pageId:string;anchor?:string}=>'pageId'in link));if(index.issues?.length)bad(index.issues.slice(0,8).map(issue=>issue.id+': '+issue.codes.join(',')+(issue.widths.length?' 元素超出区块 '+issue.widths.join('/')+'px':'')).join('；'));}}
 if(publication)for(const link of links)if(!catalog.pages.some(p=>p.id===link.pageId)||link.anchor&&!anchors.get(link.pageId)?.has(link.anchor))bad(`链接目标 ${link.pageId}${link.anchor?' / 区块 '+link.anchor:''} 不存在或尚未发布。请先编辑目标页面，并明确选择需要发布的页面版本。`);
 return {header,footer,...meta};
}
export async function readCatalogSession(client:DesignerClient,pageId?:string,revision?:string|null,published=false):Promise<DesignerSession|null>{
 const root=await readCatalogRoot(client,published);if(!root)return null;if(revision!==undefined&&root.revision!==revision)bad('页面版本已变化，请重新读取目录。');
 return readCatalogVersion(client,root,pageId,published?root:await readCatalogRoot(client,true));
}
export async function readCatalogVersion(client:DesignerClient,root:Root,pageId?:string,live:Root|null=null):Promise<DesignerSession>{
 const selected=(pageId==='global-header'?root.catalog.header:pageId==='global-footer'?root.catalog.footer:root.catalog.pages.find(p=>p.id===pageId))??(!pageId?root.catalog.pages.find(p=>p.path==='/'):undefined);if(!selected)throw new UploadError(404,'页面不存在。');
 const parts=new Map<string,unknown>();for await(const part of iterateParts(client,[selected.part,root.catalog.header.part,root.catalog.footer.part,root.catalog.meta]))parts.set(part.id,part.payload);
 return {catalog:root.catalog,publishedCatalog:live?.catalog??null,revision:root.revision,publishedRevision:live?.revision??null,page:validatePage(parts.get(selected.part)),header:validatePage(parts.get(root.catalog.header.part)),footer:validatePage(parts.get(root.catalog.footer.part)),...parts.get(root.catalog.meta) as Pick<DesignerSite,'theme'|'fonts'>};
}
export async function stageCatalogPart(client:DesignerClient,owner:string,revision:unknown,key:string,value:unknown,verify:(site:DesignerSite)=>Promise<void>,bucket?:R2Bucket){
 if(!revisionValid(revision))throw new UploadError(400,'草稿版本无效。');const root=await readCatalogRoot(client);if(!root)bad('请先初始化站点。');if(root!.revision!==revision)bad('草稿版本已变化。');
 let receipt:Receipt,mutations:Mutation[];
 if(key==='meta'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['theme','fonts'].includes(k)))throw new UploadError(400,'共享配置字段无效。');const meta=value as Pick<DesignerSite,'theme'|'fonts'>;if(!root)bad('请先初始化站点。');const empty={name:'',title:'',description:'',showHeader:false,showFooter:false,blocks:[]};const sample=validateSite({schemaVersion:2,pages:[{...empty,id:'validation-home',path:'/'}],header:{...empty,id:'global-header',path:'/global-header'},footer:{...empty,id:'global-footer',path:'/global-footer'},...meta});await verify(sample);
  const part=await partMutation(meta);mutations=[part.mutation];receipt={owner,revision,key,ref:part.id};
 }else{
  const page=validatePage(value);if(page.deleted)throw new UploadError(400,'删除页面请使用回收站操作。');
  if(['header','footer'].includes(key)){if(page.id!==`global-${key}`||page.path!==`/global-${key}`)bad('全站组件身份无效。');}else if(key!==page.id)bad('页面标识不匹配。');
  const meta=root?await readPart<Pick<DesignerSite,'theme'|'fonts'>>(client,root.catalog.meta):{theme:{background:'#fff',color:'#000',accent:'#000',font:'sans'},fonts:[]};
  // Resource verification only needs the supplied page; no other page body is loaded.
  await verify({schemaVersion:2,pages:[page],header:{...page,blocks:[],shareAssetId:undefined},footer:{...page,blocks:[],shareAssetId:undefined},...meta});
  const prepared=await pageParts(page);mutations=prepared.mutations;receipt={owner,revision,key,...(['header','footer'].includes(key)?{ref:{part:prepared.summary.part,index:prepared.summary.index}}:{summary:prepared.summary})};
 }
 const id=`designerStage.${crypto.randomUUID()}`;
 if(bucket){const prepared=[...mutations];for(const mutation of mutations)if('createIfNotExists'in mutation&&mutation.createIfNotExists.payload&&typeof mutation.createIfNotExists.payload==='object'&&'blocks'in mutation.createIfNotExists.payload)prepared.push(...(await pageParts(cleanPage(mutation.createIfNotExists.payload as DesignerPage))).mutations);const seen=new Set<string>();for(const mutation of prepared)if('createIfNotExists'in mutation){const hash=mutation.createIfNotExists._id!.slice(-64);if(seen.has(hash))continue;seen.add(hash);await snapshotObject(bucket,objectPrefix+hash+'.json',mutation.createIfNotExists.payload);}}
 await catalogMutate(client,[...mutations,{create:{_id:id,_type:'designerStage',...receipt}}]);return {receipt:id,...(receipt.summary?{summary:receipt.summary}:{ref:receipt.ref})};
}
export async function commitCatalog(client:DesignerClient,owner:string,input:{revision:unknown;receipts:unknown;deletePageIds?:unknown;restoreIds?:unknown;restorePaths?:unknown;order?:unknown}){
 if(!revisionValid(input.revision)||!Array.isArray(input.receipts)||input.receipts.length>103||input.receipts.some(id=>typeof id!=='string'||!/^designerStage\.[a-f0-9-]{36}$/.test(id)))throw new UploadError(400,'提交凭据无效。');
 const root=await readCatalogRoot(client);if(!root||root.revision!==input.revision)bad('草稿版本已变化。');const catalog=structuredClone(root!.catalog),mutations:Mutation[]=[],keys=new Set<string>();
 const receipts=await documents<Receipt&{_id:string}>(client,input.receipts);for(const id of input.receipts){const r=receipts.get(id);if(!r||r.owner!==owner||r.revision!==input.revision||keys.has(r.key))bad('暂存凭据归属、版本或内容无效。');keys.add(r!.key);if(r!.key==='meta')catalog.meta=r!.ref as string;else if(r!.key==='header'||r!.key==='footer')catalog[r!.key]=r!.ref as PartRef;else{const page=r!.summary!;const existing=catalog.pages.findIndex(p=>p.id===page.id);if(existing<0)catalog.pages.push(page);else catalog.pages[existing]=page;}}
 const deletes=input.deletePageIds??[],restores=input.restoreIds??[];
 if(!Array.isArray(deletes)||!Array.isArray(restores)||deletes.length>100||restores.length>100||[...deletes,...restores].some(id=>typeof id!=='string'))throw new UploadError(400,'回收站操作无效。');
 const restorePaths=input.restorePaths??{};
 if(!restorePaths||typeof restorePaths!=='object'||Array.isArray(restorePaths)||Object.keys(restorePaths).length>100||Object.entries(restorePaths).some(([id,path])=>!restores.includes(id)||!isSafePath(path)))throw new UploadError(400,'恢复网址无效或不属于选中页面。');
 for(const id of deletes){const page=catalog.pages.find(p=>p.id===id);if(!page||keys.has(id))bad('删除页面不存在或重复操作。');catalog.pages=catalog.pages.filter(p=>p.id!==id);mutations.push({create:{_id:`designerRecycle.${crypto.randomUUID()}`,_type:'designerRecycle',owner,summary:page,deletedAt:new Date().toISOString(),active:true}});}
 if(restores.some(id=>!/^designerRecycle\.[a-f0-9-]{36}$/.test(id)))bad('回收站标识无效。');const recycled=await documents<{_id:string;_rev:string;owner:string;active:boolean;summary:PageSummary}>(client,restores),writer=privateWriter(client),overrides=new Map<string,{id:string;summary:PageSummary}>();
 for(const id of restores){const doc=recycled.get(id);if(!doc||doc.owner!==owner||doc.active!==true||catalog.pages.some(p=>p.id===doc.summary.id))bad('回收站页面不可恢复。');const summary=doc!.summary;catalog.pages.push(summary);if(Object.hasOwn(restorePaths,id))overrides.set(summary.part,{id,summary});mutations.push({patch:{id,ifRevisionID:doc!._rev,set:{active:false}}});}
 for await(const {id,payload} of iterateParts<DesignerPage>(client,[...overrides.keys()])){const selected=overrides.get(id)!,page=validatePage(payload);page.path=(restorePaths as Record<string,string>)[selected.id];page.redirectFrom=[];const prepared=await pageParts(validatePage(page));await writer.add(prepared.mutations);catalog.pages[catalog.pages.findIndex(p=>p.id===selected.summary.id)]=prepared.summary;}await writer.flush();
 if(input.order!==undefined){if(!Array.isArray(input.order)||input.order.length!==catalog.pages.length||new Set(input.order).size!==catalog.pages.length||input.order.some(id=>!catalog.pages.some(p=>p.id===id)))throw new UploadError(400,'页面排序无效。');catalog.pages=input.order.map(id=>catalog.pages.find(p=>p.id===id)!);}
 await validateCatalog(client,catalog);await catalogMutate(client,[...mutations,catalogRootMutation(catalog,input.revision)]);return confirmedCatalogSession(client,catalog);
}
export async function catalogRecycle(client:DesignerClient,owner:string,cursor=''){
 if(cursor&&!/^designerRecycle\.[a-f0-9-]{36}$/.test(cursor))throw new UploadError(400,'回收站游标无效。');
 const items=await client.fetch<{_id:string;summary:PageSummary;deletedAt:string}[]>('*[_type == "designerRecycle" && owner == $owner && active == true && _id > $cursor] | order(_id asc)[0...51]{_id,summary,deletedAt}',{owner,cursor});return {items:items.slice(0,50).map(d=>({...d.summary,recycleId:d._id,deletedAt:d.deletedAt})),nextCursor:items.length>50?items[49]._id:null};
}
export function sessionSite(session:DesignerSession):DesignerSite{return {schemaVersion:2,pages:[session.page],header:session.header,footer:session.footer,theme:session.theme,fonts:session.fonts};}
export async function initializeCatalog(client:DesignerClient,bucket:R2Bucket,owner:string,fallback:(published?:boolean)=>Promise<DesignerSite>){
 if(await readCatalogRoot(client))return;const site=validateSite(await fallback()),catalog:DesignerCatalog={schemaVersion:3,pages:[],header:{part:'',index:''},footer:{part:'',index:''},meta:''},writer=privateWriter(client);
 for(const page of [...site.pages,site.header,site.footer]){const p=await pageParts(page);await writer.add(p.mutations);if(page===site.header)catalog.header={part:p.summary.part,index:p.summary.index};else if(page===site.footer)catalog.footer={part:p.summary.part,index:p.summary.index};else if(!page.deleted)catalog.pages.push(p.summary);}
 const meta=await partMutation({theme:site.theme,fonts:site.fonts});await writer.add([meta.mutation]);await writer.flush();catalog.meta=meta.id;await validateCatalog(client,catalog);await backupCatalog(client,bucket,owner,{draft:catalog,published:null,candidate:catalog},'migration');await catalogMutate(client,[catalogRootMutation(catalog,null)]);
}
type CatalogSnapshot={id:string;owner:string;createdAt:string;kind:string;draft:DesignerCatalog;published:DesignerCatalog|null;candidate:DesignerCatalog};
type SnapshotManifest=Omit<CatalogSnapshot,'draft'|'published'|'candidate'>&{draft:string;published:string|null;candidate:string};
const snapshotPrefix=async(owner:string)=>`snapshots/designer-paged/${await digest(owner)}/`;
const objectPrefix='snapshots/designer-objects/';
const catalogPrefix='snapshots/designer-catalogs/';
const catalogRefs=(m:DesignerCatalog)=>[m.meta,...[...m.pages,m.header,m.footer].flatMap(p=>[p.part,p.index])];
async function snapshotObject(bucket:R2Bucket,key:string,value:unknown){const text=canonical(value),sha256=await digest(text);await bucket.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256},httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});const read=await bucket.get(key);if(!read||await read.text()!==text||read.customMetadata?.sha256!==sha256)throw new UploadError(503,'快照写入校验失败。');}
export async function backupCatalog(client:DesignerClient,bucket:R2Bucket,owner:string,roots:Pick<CatalogSnapshot,'draft'|'published'|'candidate'>,kind:string){
 const unique=new Map<string,string>();for(const root of [roots.draft,roots.published,roots.candidate])if(root)for(const ref of catalogRefs(root))unique.set(ref.slice(-64),ref);
 const missing:string[]=[];for(const [hash,ref] of unique){const key=`${objectPrefix}${hash}.json`,object=await bucket.get(key);if(!object){const staged=stagedPayloads.get(client);if(staged?.has(ref))await snapshotObject(bucket,key,staged.get(ref));else missing.push(ref);continue;}if(object.size>pagedRequestLimit){await object.body.cancel();bad('快照内容超出容量。');}const text=await object.text();if(await digest(text)!==hash||object.customMetadata?.sha256!==hash)bad('快照完整性校验失败。');}
 for await(const {id,payload} of iterateParts(client,missing))await snapshotObject(bucket,`${objectPrefix}${id.slice(-64)}.json`,payload);
 const refs={} as Pick<SnapshotManifest,'draft'|'published'|'candidate'>;
 for(const key of ['draft','published','candidate'] as const){const catalog=roots[key];if(!catalog){refs.published=null;continue;}const hash=await digest(canonical(catalog));await snapshotObject(bucket,`${catalogPrefix}${hash}.json`,catalog);refs[key]=hash;}
 const id=`${String(9999999999999-Date.now()).padStart(13,'0')}-${crypto.randomUUID()}`,record:SnapshotManifest={id,owner,createdAt:new Date().toISOString(),kind,...refs};await snapshotObject(bucket,`${await snapshotPrefix(owner)}${id}.json`,record);return id;
}
async function readSnapshotObject<T>(bucket:R2Bucket,key:string):Promise<T>{const o=await bucket.get(key);if(!o)throw new UploadError(404,'快照内容不存在。');if(o.size>(key.startsWith(objectPrefix)?pagedRequestLimit:3_950_000)){await o.body.cancel();bad('快照内容超出容量。');}const text=await o.text();if(await digest(text)!==o.customMetadata?.sha256)bad('快照完整性校验失败。');return JSON.parse(text) as T;}
export async function catalogHistory(bucket:R2Bucket,owner:string,cursor?:string,id?:string){const prefix=await snapshotPrefix(owner);if(id){if(!/^\d{13}-[a-f0-9-]{36}$/.test(id))throw new UploadError(400,'快照标识无效。');const stored=await readSnapshotObject<SnapshotManifest>(bucket,`${prefix}${id}.json`);if(stored.owner!==owner||stored.id!==id)bad('快照归属异常。');const roots={} as Pick<CatalogSnapshot,'draft'|'published'|'candidate'>;for(const key of ['draft','published','candidate'] as const){const ref=stored[key];if(key==='published'&&ref===null){roots.published=null;continue;}if(typeof ref!=='string'||! /^[a-f0-9]{64}$/.test(ref))bad('快照目录引用无效。');const catalog=await readSnapshotObject<DesignerCatalog>(bucket,`${catalogPrefix}${ref}.json`);if(await digest(canonical(catalog))!==ref)bad('快照目录校验失败。');roots[key]=parseCatalog(catalog);}return {snapshot:{...stored,...roots}};}const list=await bucket.list({prefix,limit:10,cursor});return {items:list.objects.map(o=>({id:o.key.slice(prefix.length,-5),createdAt:o.uploaded.toISOString()})),nextCursor:list.truncated?list.cursor:null};}
async function preparedCatalog(site:DesignerSite,published=false){
 const mutations:Mutation[]=[],catalog:DesignerCatalog={schemaVersion:3,pages:[],header:{part:'',index:''},footer:{part:'',index:''},meta:''};
 for(const page of [...site.pages.filter(p=>!p.deleted),site.header,site.footer]){const prepared=await pageParts(page,published);mutations.push(...prepared.mutations);if(page===site.header)catalog.header={part:prepared.summary.part,index:prepared.summary.index};else if(page===site.footer)catalog.footer={part:prepared.summary.part,index:prepared.summary.index};else catalog.pages.push(prepared.summary);}
 const meta=await partMutation({theme:site.theme,fonts:site.fonts},published);catalog.meta=meta.id;mutations.push(meta.mutation);return {catalog,mutations};
}
function overlayClient(client:DesignerClient,mutations:Mutation[]):DesignerClient {const pending=new Map(mutations.flatMap(m=>'createIfNotExists'in m?[[m.createIfNotExists._id,m.createIfNotExists] as const]:[]));const overlaid={...client,getDocument:async(id:string)=>pending.get(id)??await client.getDocument(id),fetch:async(query:string,params:{ids?:string[]})=>{if(!Array.isArray(params?.ids))return client.fetch(query,params);const remote=params.ids.filter(id=>!pending.has(id));return [...(remote.length?await client.fetch<unknown[]>(query,{...params,ids:remote}):[]),...params.ids.filter(id=>pending.has(id)).map(id=>pending.get(id))];}} as DesignerClient;stagedPayloads.set(overlaid,new Map([...pending].map(([id,doc])=>[id!,doc.payload])));return overlaid;}
const cleanPage=(page:DesignerPage):DesignerPage=>({...page,blocks:page.blocks.filter(b=>!b.deleted).map(b=>({...b,elements:b.elements.filter(e=>!e.deleted)}))});
export async function publicationCandidate(client:DesignerClient,scope:string[],fallback:(published?:boolean)=>Promise<DesignerSite>){
 const draft=await readCatalogRoot(client),published=await readCatalogRoot(client,true);if(!draft)bad('请先保存草稿。');
 if(!Array.isArray(scope)||!scope.length||scope.length>104||new Set(scope).size!==scope.length||scope.some(id=>!['header','footer','theme','fonts',...draft!.catalog.pages.map(p=>p.id),...published?.catalog.pages.map(p=>p.id)??[]].includes(id)))throw new UploadError(400,'发布范围无效。');
 const mutations:Mutation[]=[],active=new Set(published?catalogRefs(published.catalog):[]);let catalog:DesignerCatalog,mutationBytes=0,pending:Mutation[]=[],pendingBytes=0;
 const flush=async()=>{if(!pending.length)return;const ids=pending.flatMap(m=>'createIfNotExists'in m?[m.createIfNotExists._id!]:[]),known=new Set((await client.fetch<{_id:string}[]>('*[_id in $ids]{_id}',{ids})).map(d=>d._id));for(const mutation of pending){if('createIfNotExists'in mutation&&known.has(mutation.createIfNotExists._id!))continue;mutationBytes+=bytes(mutation);if(mutationBytes>3_900_000)throw new UploadError(413,'选中发布内容超过单次原子事务容量，请缩小发布范围。');mutations.push(mutation);}pending=[];pendingBytes=0;};
 const append=async(parts:Mutation[])=>{for(const mutation of parts){if('createIfNotExists'in mutation&&active.has(mutation.createIfNotExists._id!))continue;const length=bytes(mutation);if(pendingBytes+length>3_500_000)await flush();pending.push(mutation);pendingBytes+=length;}};
 if(published)catalog=structuredClone(published.catalog);else{const initial=await preparedCatalog(await fallback(true),true);catalog=initial.catalog;await append(initial.mutations);}
 const selected=new Map<string,string>();for(const id of scope){if(['theme','fonts'].includes(id))continue;const ref=id==='header'||id==='footer'?draft!.catalog[id]:draft!.catalog.pages.find(p=>p.id===id);if(id!=='header'&&id!=='footer')catalog.pages=catalog.pages.filter(p=>p.id!==id);if(ref)selected.set(ref.part,id);}
 for await(const {id:part,payload} of iterateParts<DesignerPage>(client,[...selected.keys()])){const id=selected.get(part)!,prepared=await pageParts(cleanPage(payload),true);if(id==='header'||id==='footer')catalog[id]={part:prepared.summary.part,index:prepared.summary.index};else catalog.pages.push(prepared.summary);await append(prepared.mutations);}await flush();
 if(scope.includes('theme')||scope.includes('fonts')){const existing=await readPart<Pick<DesignerSite,'theme'|'fonts'>>(overlayClient(client,mutations),catalog.meta),source=await readPart<Pick<DesignerSite,'theme'|'fonts'>>(client,draft!.catalog.meta);for(const key of ['theme','fonts'] as const)if(scope.includes(key))Object.assign(existing,{[key]:source[key]});const part=await partMutation(existing,true);catalog.meta=part.id;await append([part.mutation]);}
 await flush();const reader=overlayClient(client,mutations),assets=new Set<string>(),shared=await validateCatalog(reader,catalog,true,assets);return {draft:draft!,published,catalog,mutations,reader,shared,assets:[...assets]};
}
export type PublicationBinding={revision:string;publishedRevision:string|null;scope:string[];candidateHash:string;resourcesHash:string};
type PublicationVerifier=(site:DesignerSite,assetIds?:string[],binding?:PublicationBinding)=>Promise<void>;
type VerificationReceipt={owner:string;binding:PublicationBinding;verified:number;total:number;expiresAt:number};
const verificationBatchSize=100,verificationTtl=10*60*1000;
// Published asset manifests use createIfNotExists and their hash-addressed R2 bytes
// use conditional puts. Receipts carry those integrity checks across bounded requests.
async function publicationBinding(candidate:Awaited<ReturnType<typeof publicationCandidate>>,scope:string[]):Promise<PublicationBinding>{return {revision:candidate.draft.revision,publishedRevision:candidate.published?.revision??null,scope:[...scope].sort(),candidateHash:await digest(canonical(candidate.catalog)),resourcesHash:await digest(canonical({assets:[...candidate.assets].sort(),fonts:candidate.shared.fonts}))};}
async function verificationReceipt(client:DesignerClient,owner:string,id:unknown,binding:PublicationBinding|undefined){
 if(typeof id!=='string'||!/^designerVerification\.[a-f0-9-]{36}$/.test(id)||!binding)throw new UploadError(400,'请先完成本次发布资源校验。');const receipt=await client.getDocument(id) as unknown as VerificationReceipt|undefined;
 if(!receipt||receipt.owner!==owner||canonical(receipt.binding)!==canonical(binding)||!Number.isSafeInteger(receipt.verified)||!Number.isSafeInteger(receipt.total)||receipt.verified<0||receipt.verified>receipt.total||!Number.isSafeInteger(receipt.expiresAt)||receipt.expiresAt<=Date.now())bad('资源校验已过期、版本或范围已变化，请重新生成发布预览。');return receipt!;
}
export async function requirePublicationVerification(client:DesignerClient,owner:string,id:unknown,binding:PublicationBinding|undefined){const receipt=await verificationReceipt(client,owner,id,binding);if(receipt.verified!==receipt.total)bad('发布资源尚未全部校验。');}
export async function verifyPublicationBatch(client:DesignerClient,owner:string,input:{revision:unknown;publishedRevision:unknown;scope:string[];verification?:unknown},fallback:(published?:boolean)=>Promise<DesignerSite>,verify:PublicationVerifier){
 if(!revisionValid(input.revision)||!revisionValid(input.publishedRevision))throw new UploadError(400,'校验版本无效。');const candidate=await publicationCandidate(client,input.scope,fallback),binding=await publicationBinding(candidate,input.scope);if(input.revision!==binding.revision||input.publishedRevision!==binding.publishedRevision)bad('草稿或线上版本已变化，请重新生成发布预览。');
 const assets=[...candidate.assets].sort(),previous=input.verification===undefined?null:await verificationReceipt(client,owner,input.verification,binding);if(previous&&previous.total!==assets.length)bad('资源校验范围不匹配。');if(previous&&previous.verified===previous.total)return {verification:input.verification as string,complete:true,verified:previous.verified,total:previous.total,expiresAt:previous.expiresAt};
 const start=previous?.verified??0,verified=Math.min(start+verificationBatchSize,assets.length),expiresAt=previous?.expiresAt??Date.now()+verificationTtl;
 await verify({schemaVersion:2,pages:[],...candidate.shared},assets.slice(start,verified),binding);
 if(expiresAt<=Date.now())bad('资源校验已过期，请重新开始。');const id=`designerVerification.${crypto.randomUUID()}`;await catalogMutate(client,[{create:{_id:id,_type:'designerVerification',owner,binding,verified,total:assets.length,expiresAt}}]);return {verification:id,complete:verified===assets.length,verified,total:assets.length,expiresAt};
}
export async function previewCatalog(client:DesignerClient,scope:string[],pageId:string,fallback:(published?:boolean)=>Promise<DesignerSite>,verify:PublicationVerifier){const candidate=await publicationCandidate(client,scope,fallback),shared=candidate.shared,summary=pageId==='global-header'?candidate.catalog.header:pageId==='global-footer'?candidate.catalog.footer:candidate.catalog.pages.find(p=>p.id===pageId);if(!summary)throw new UploadError(404,'预览页面不在发布范围。');const page=await readPart<DesignerPage>(candidate.reader,summary.part);const session:DesignerSession={catalog:candidate.catalog,publishedCatalog:candidate.published?.catalog??null,revision:candidate.draft.revision,publishedRevision:candidate.published?.revision??null,page,...shared};await verify(sessionSite(session),candidate.assets,await publicationBinding(candidate,scope));return session;}
export async function publishCatalog(client:DesignerClient,bucket:R2Bucket,owner:string,input:{revision:string|null;publishedRevision:string|null;scope:string[];confirmed:boolean;verification?:unknown},fallback:(published?:boolean)=>Promise<DesignerSite>,verify:PublicationVerifier){
 if(input.confirmed!==true||!revisionValid(input.revision)||!revisionValid(input.publishedRevision))throw new UploadError(400,'请确认发布版本。');const candidate=await publicationCandidate(client,input.scope,fallback);
 if(candidate.draft.revision!==input.revision||(candidate.published?.revision??null)!==input.publishedRevision)bad('草稿或公开版本已变化。');
 const binding=await publicationBinding(candidate,input.scope);await verify({schemaVersion:2,pages:[],...candidate.shared},candidate.assets,binding);
 const ids=candidate.mutations.flatMap(m=>'createIfNotExists'in m?[m.createIfNotExists._id!]:[]),known=new Set((await client.fetch<{_id:string}[]>('*[_id in $ids]{_id}',{ids})).map(d=>d._id));const mutations=candidate.mutations.filter(m=>!('createIfNotExists'in m)||!known.has(m.createIfNotExists._id!));
 mutations.push(catalogRootMutation(candidate.draft.catalog,input.revision),catalogRootMutation(candidate.catalog,input.publishedRevision,true));if(bytes({mutations})>3_950_000)throw new UploadError(413,'选中发布内容超过单次原子事务容量，请缩小发布范围。');
 const snapshotId=await backupCatalog(candidate.reader,bucket,owner,{draft:candidate.draft.catalog,published:candidate.published?.catalog??null,candidate:candidate.catalog},'publish');if(input.verification!==undefined)await requirePublicationVerification(client,owner,input.verification,binding);await catalogMutate(client,mutations);const confirmed=await confirmedCatalogSession(client,candidate.draft.catalog);if(canonical(confirmed.publishedCatalog)!==canonical(candidate.catalog))bad('发布后版本已变化，请重新读取比较。');return {...confirmed,snapshotId};
}
export async function restoreCatalog(client:DesignerClient,bucket:R2Bucket,owner:string,input:{id:string;revision:string|null;version:'draft'|'published'|'candidate';scope:string[];confirmed:boolean}){
 if(input.confirmed!==true||!revisionValid(input.revision)||!['draft','published','candidate'].includes(input.version)||!Array.isArray(input.scope)||input.scope.length>104)throw new UploadError(400,'恢复请求无效。');
 const current=await readCatalogRoot(client),published=await readCatalogRoot(client,true);if(!current||current.revision!==input.revision)bad('草稿已变化。');const history=await catalogHistory(bucket,owner,undefined,input.id),record=('snapshot'in history?history.snapshot:null),source=record?.[input.version];if(!source)bad('快照没有所选版本。');parseCatalog(source);
 const catalog=structuredClone(current!.catalog),scope=input.scope.length?input.scope:[...source!.pages.map(p=>p.id),'header','footer','theme','fonts'],writer=privateWriter(client);if(!input.scope.length)catalog.pages=[];
 const load=async(ref:string)=>{const payload=await readSnapshotObject<unknown>(bucket,`${objectPrefix}${ref.slice(-64)}.json`);if(await digest(canonical(payload))!==ref.slice(-64))bad('快照内容引用校验失败。');return payload;};
 for(const id of scope){if(['theme','fonts'].includes(id))continue;const ref=id==='header'||id==='footer'?source![id]:source!.pages.find(p=>p.id===id);if(!ref)throw new UploadError(400,'快照页面不存在。');const page=validatePage(await load(ref.part));await load(ref.index);const prepared=await pageParts(page);await writer.add(prepared.mutations);if(id==='header'||id==='footer')catalog[id]={part:prepared.summary.part,index:prepared.summary.index};else{catalog.pages=catalog.pages.filter(p=>p.id!==id);catalog.pages.push(prepared.summary);}}
 if(scope.includes('theme')||scope.includes('fonts')){const meta=await readPart<Pick<DesignerSite,'theme'|'fonts'>>(client,catalog.meta),historical=await load(source!.meta) as typeof meta;for(const key of ['theme','fonts'] as const)if(scope.includes(key))Object.assign(meta,{[key]:historical[key]});const part=await partMutation(meta);catalog.meta=part.id;await writer.add([part.mutation]);}await writer.flush();
 const reader=client;await validateCatalog(reader,catalog);await backupCatalog(reader,bucket,owner,{draft:current!.catalog,published:published?.catalog??null,candidate:catalog},'restore');
 // Private immutable pieces are harmless until the final CAS; no body accumulator is sent over HTTP.
 const recycled:Mutation[]=current!.catalog.pages.filter(p=>!catalog.pages.some(next=>next.id===p.id)).map(summary=>({create:{_id:'designerRecycle.'+crypto.randomUUID(),_type:'designerRecycle',owner,summary,deletedAt:new Date().toISOString(),active:true}}));await catalogMutate(client,[...recycled,catalogRootMutation(catalog,input.revision)]);return confirmedCatalogSession(client,catalog);
}
export async function seedCatalogSession(fallback:(published?:boolean)=>Promise<DesignerSite>,pageId?:string):Promise<DesignerSession&{needsInitialization:true}>{const site=await fallback(),prepared=await preparedCatalog(site),page=(pageId==='global-header'?site.header:pageId==='global-footer'?site.footer:site.pages.find(p=>p.id===pageId))??(!pageId?site.pages.find(p=>p.path==='/'):undefined);if(!page)throw new UploadError(404,'页面不存在。');return {needsInitialization:true,catalog:prepared.catalog,publishedCatalog:null,revision:null,publishedRevision:null,page,header:site.header,footer:site.footer,theme:site.theme,fonts:site.fonts};}


export async function catalogResources(client:DesignerClient,scope:unknown){
 const root=await readCatalogRoot(client),published=await readCatalogRoot(client,true);if(!root)bad('请先初始化站点。');if(!Array.isArray(scope)||scope.length>104||scope.some(id=>typeof id!=='string'||!['header','footer','theme','fonts',...root!.catalog.pages.map(p=>p.id),...published?.catalog.pages.map(p=>p.id)??[]].includes(id)))throw new UploadError(400,'素材查询范围无效。');
 const assets=new Set<string>(),fontIds=new Set<string>(),refs=(scope as string[]).flatMap(id=>{if(['theme','fonts'].includes(id))return [];const ref=id==='header'||id==='footer'?root!.catalog[id]:root!.catalog.pages.find(p=>p.id===id);return ref?[ref.index]:[];});for await(const {payload:index} of iterateParts<PageIndex>(client,refs)){for(const asset of index.assets)assets.add(asset);for(const font of index.fonts)fontIds.add(font);}
 const meta=await readPart<Pick<DesignerSite,'theme'|'fonts'>>(client,root!.catalog.meta);if(scope.includes('theme'))fontIds.add(meta.theme.font);return {assets:[...assets],fonts:meta.fonts.filter(f=>scope.includes('fonts')||fontIds.has(f.id))};
}






async function confirmedCatalogSession(client:DesignerClient,catalog:DesignerCatalog){const session=await readCatalogSession(client);if(!session||canonical(session.catalog)!==canonical(catalog))bad('保存后版本已变化，请重新读取比较。');return session!;}




export async function snapshotCatalogSession(bucket:R2Bucket,owner:string,id:string,version:unknown,pageId:string){
 if(!['draft','published','candidate'].includes(version as string))throw new UploadError(400,'快照版本无效。');const result=await catalogHistory(bucket,owner,undefined,id),snapshot='snapshot'in result?result.snapshot:null;if(!snapshot)bad('快照不存在。');const catalog=snapshot![version as 'draft'|'published'|'candidate'];if(!catalog)return {snapshot,session:null};const ref=pageId==='global-header'?catalog.header:pageId==='global-footer'?catalog.footer:catalog.pages.find(p=>p.id===pageId);if(!ref)return {snapshot,session:null};
 const load=async<T>(part:string)=>{const value=await readSnapshotObject<T>(bucket,objectPrefix+part.slice(-64)+'.json');if(await digest(canonical(value))!==part.slice(-64))bad('快照内容引用校验失败。');return value;};
 const page=validatePage(await load(ref.part)),header=validatePage(await load(catalog.header.part)),footer=validatePage(await load(catalog.footer.part)),meta=await load<Pick<DesignerSite,'theme'|'fonts'>>(catalog.meta);const session:DesignerSession={catalog,publishedCatalog:snapshot!.published,revision:null,publishedRevision:null,page,header,footer,...meta};return {snapshot,session};
}
