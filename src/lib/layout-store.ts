import type { SanityClient, Mutation } from '@sanity/client';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { emptyPageLayout, validatePageLayout, type PageLayout } from './page-layout.ts';
import { UploadError } from './uploads.ts';

type Client = Pick<SanityClient,'getDocument'|'mutate'>;
export type LayoutStorage = { BACKUPS: R2Bucket; UPLOADS: D1Database };
export const layoutDocumentId='page-layout-home';
const draftId=`drafts.${layoutDocumentId}`;
function canonical(value:unknown):string { if(value&&typeof value==='object'&&!Array.isArray(value)) return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;return JSON.stringify(value); }
export function validLayoutRevision(value: unknown): value is string|null { return value===null||(typeof value==='string'&&/^[a-zA-Z0-9_-]{1,256}$/.test(value)); }
export function validLayoutSnapshotId(value:unknown):value is string { return typeof value==='string'&&/^(?:\d{13}-)?[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value); }
async function read(client: Pick<Client,'getDocument'>, id: string) {
  const doc=await client.getDocument(id);
  if(!doc) return {layout:emptyPageLayout(),revision:null};
  if(!validLayoutRevision(doc._rev)||doc._rev===null) throw new UploadError(409,'布局版本异常。');
  return {layout:validatePageLayout(doc.layout),revision:doc._rev};
}
export async function readPublishedLayout(client: Pick<Client,'getDocument'>) { return (await read(client,layoutDocumentId)).layout; }
export async function readPageLayouts(client: Pick<Client,'getDocument'>) {
  const [draft,published]=await Promise.all([read(client,draftId),read(client,layoutDocumentId)]);
  return {layout:draft.revision?draft.layout:published.layout,revision:draft.revision,publishedLayout:published.layout,publishedRevision:published.revision};
}
function mutation(id: string,layout:PageLayout,revision:string|null): Mutation {
  return revision===null?{create:{_id:id,_type:'pageLayout',layout}}:{patch:{id,ifRevisionID:revision,set:{layout}}};
}
async function mutate(client: Client, mutations: Mutation[]) {
  try {await client.mutate(mutations,{visibility:'sync',returnDocuments:false});}
  catch(error) {const conflict=error instanceof Error&&'statusCode' in error&&error.statusCode===409; throw new UploadError(conflict?409:503,conflict?'布局已被另一窗口修改，请重新读取后比较。':'写入结果未确认，请重新读取核对，不要盲目重试。');}
}
export async function saveLayoutDraft(client: Client, input:unknown,revision:unknown) {
  if(!validLayoutRevision(revision)) throw new UploadError(400,'布局版本无效。');
  const layout=validatePageLayout(input);
  await mutate(client,[mutation(draftId,layout,revision)]);
  const result=await readPageLayouts(client);
  if(canonical(result.layout)!==canonical(layout)) throw new UploadError(409,'保存后版本已变化，请重新读取比较。');
  return result;
}
type Snapshot = {id:string;createdAt:string;owner:string;kind:'publish'|'preserve';layout:PageLayout;revision:string|null;previousLayout:PageLayout;previousRevision:string|null};
async function digest(text:string) { const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''); }
async function ownerPrefix(owner:string) { return `snapshots/layouts/${await digest(owner)}/`; }
async function snapshot(storage:LayoutStorage,owner:string,entry:Omit<Snapshot,'id'|'createdAt'|'owner'>) {
  if(!storage.BACKUPS) throw new UploadError(503,'布局备份存储未配置。');
  const now=Date.now();
  // R2 lists keys ascending; invert the timestamp so each page starts with newest snapshots.
  const record:Snapshot={...entry,owner,id:`${String(9999999999999-now).padStart(13,'0')}-${crypto.randomUUID()}`,createdAt:new Date(now).toISOString()};
  const key=`${await ownerPrefix(owner)}${record.id}.json`, text=JSON.stringify(record);
  await storage.BACKUPS.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256:await digest(text)},httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  const saved=await storage.BACKUPS.get(key);
  if(!saved||await saved.text()!==text||saved.customMetadata?.sha256!==await digest(text)||(await storage.BACKUPS.head(key))?.version!==saved.version) throw new UploadError(503,'布局快照未通过读回校验，未执行内容写入。');
  return record.id;
}
async function readSnapshot(storage:LayoutStorage,owner:string,id:string):Promise<Snapshot> {
  if(!validLayoutSnapshotId(id)) throw new UploadError(400,'快照标识无效。');
  const key=`${await ownerPrefix(owner)}${id}.json`;
  const saved=await storage.BACKUPS.get(key); if(!saved) throw new UploadError(404,'找不到可访问的布局快照。');
  if(saved.size>1153434) {await saved.body.cancel();throw new UploadError(409,'布局快照过大。');}
  const text=await saved.text();
  if(saved.customMetadata?.sha256!==await digest(text)) throw new UploadError(409,'布局快照完整性校验失败。');
  const result=JSON.parse(text) as Snapshot;
  if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(key=>!['id','createdAt','owner','kind','layout','revision','previousLayout','previousRevision'].includes(key))) throw new UploadError(409,'布局快照字段无效。');
  if(result.owner!==owner||result.id!==id||!['publish','preserve'].includes(result.kind)||typeof result.createdAt!=='string'||!Number.isFinite(Date.parse(result.createdAt))||!validLayoutRevision(result.revision)||!validLayoutRevision(result.previousRevision)||(await storage.BACKUPS.head(key))?.version!==saved.version) throw new UploadError(409,'布局快照校验失败。');
  return {...result,layout:validatePageLayout(result.layout),previousLayout:validatePageLayout(result.previousLayout)};
}
export async function readLayoutHistory(storage:LayoutStorage,owner:string,cursor?:string,snapshotId?:string) {
  const prefix=await ownerPrefix(owner);
  const page=snapshotId?null:await storage.BACKUPS.list({prefix,limit:20,cursor});
  const snapshots=[];
  for(const id of snapshotId?[snapshotId]:page!.objects.map(entry=>entry.key.slice(prefix.length,-5))) {
    const record=await readSnapshot(storage,owner,id);
    const {owner:privateOwner,...safe}=record; void privateOwner; snapshots.push(safe);
  }
  snapshots.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return {snapshots,nextCursor:page?.truncated?page.cursor:null};
}
export async function publishLayout(storage:LayoutStorage,client:Client,owner:string,input:{revision:string|null;publishedRevision:string|null;confirmed:boolean}) {
  if(input.confirmed!==true||!validLayoutRevision(input.revision)||!validLayoutRevision(input.publishedRevision)) throw new UploadError(400,'请确认布局发布及有效版本。');
  const current=await readPageLayouts(client);
  if(!current.revision||current.revision!==input.revision||current.publishedRevision!==input.publishedRevision) throw new UploadError(409,'草稿或公开布局已变化，请重新比较。');
  const snapshotId=await snapshot(storage,owner,{kind:'publish',layout:current.layout,revision:current.revision,previousLayout:current.publishedLayout,previousRevision:current.publishedRevision});
  // Both guards execute in one transaction; no media document is touched.
  await mutate(client,[{patch:{id:draftId,ifRevisionID:current.revision,set:{layout:current.layout}}},mutation(layoutDocumentId,current.layout,current.publishedRevision)]);
  const result=await readPageLayouts(client);
  if(canonical(result.publishedLayout)!==canonical(current.layout)) throw new UploadError(409,'发布后布局已变化，请重新核对。');
  return {...result,snapshotId};
}
export async function restoreLayoutDraft(storage:LayoutStorage,client:Client,owner:string,input:{snapshotId:string;revision:string|null;confirmed:boolean;version?:'candidate'|'previous'}) {
  if(input.confirmed!==true||!validLayoutRevision(input.revision)||(input.version!==undefined&&!['candidate','previous'].includes(input.version))) throw new UploadError(400,'请确认恢复为草稿。');
  const target=await readSnapshot(storage,owner,input.snapshotId), current=await readPageLayouts(client);
  if(current.revision!==input.revision) throw new UploadError(409,'草稿已变化，请重新比较。');
  const preservedSnapshot=await snapshot(storage,owner,{kind:'preserve',layout:current.layout,revision:current.revision,previousLayout:current.publishedLayout,previousRevision:current.publishedRevision});
  return {...await saveLayoutDraft(client,input.version==='previous'?target.previousLayout:target.layout,current.revision),preservedSnapshot};
}
