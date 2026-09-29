import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { inspectFont, fontByteLimit } from './font-format.ts';
import { UploadError } from '../uploads.ts';

export type FontStorage = {UPLOADS:D1Database; ORIGINALS:R2Bucket; PUBLISHED:R2Bucket; BACKUPS:R2Bucket};
export type FontRecord = {id:string;owner:string;sha256:string;family:string;weight:number;style:'normal'|'italic';size:number;status:'reserved'|'ready'|'published';createdAt:number};
export const fontIdValid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const hash=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
const privateKey=(font:FontRecord)=>`designer-fonts/${font.id}/${font.sha256}.woff2`;
export const publicFontKey=(font:Pick<FontRecord,'sha256'>)=>`fonts/${font.sha256}.woff2`;
export async function readFont(db:D1Database,owner:string,id:unknown) {
  if(!fontIdValid(id))throw new UploadError(400,'字体标识无效。');
  const font=await db.prepare('SELECT * FROM designer_fonts WHERE owner = ? AND id = ?').bind(owner,id).first<FontRecord>();
  if(!font)throw new UploadError(404,'字体不存在。');return font;
}
export async function saveFont(storage:FontStorage,owner:string,id:string,bytes:Uint8Array,weight:number,style:string,quota:number) {
  if(!fontIdValid(id)||![400,500,600,700].includes(weight)||!['normal','italic'].includes(style)||!Number.isSafeInteger(quota)||quota<=0)throw new UploadError(400,'字体参数或额度无效。');
  const inspected=inspectFont(bytes),sha256=await hash(bytes);
  await storage.UPLOADS.prepare(`INSERT INTO designer_fonts(id,owner,sha256,family,weight,style,size,status,createdAt)
    SELECT ?,?,?,?,?,?,?,'reserved',? WHERE COALESCE((SELECT SUM(size) FROM upload_sessions WHERE status != 'cancelled'),0)
    + COALESCE((SELECT SUM(size) FROM designer_fonts),0) + ? <= ? ON CONFLICT(id) DO NOTHING`)
    .bind(id,owner,sha256,inspected.family,weight,style,bytes.length,Date.now(),bytes.length,quota).run();
  const font=await readFont(storage.UPLOADS,owner,id).catch(()=>{throw new UploadError(413,'字体额度不足，未保存。');});
  if(font.sha256!==sha256||font.weight!==weight||font.style!==style)throw new UploadError(409,'此上传标识对应另一字体，请重新选择。');
  await storage.ORIGINALS.put(privateKey(font),bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256,httpMetadata:{contentType:'font/woff2',cacheControl:'no-store'}});
  const saved=await storage.ORIGINALS.get(privateKey(font));
  if(!saved||await hash(new Uint8Array(await saved.arrayBuffer()))!==sha256)throw new UploadError(503,'字体读回校验失败，请重试相同文件。');
  await storage.UPLOADS.prepare("UPDATE designer_fonts SET status = 'ready' WHERE id = ? AND owner = ? AND status = 'reserved'").bind(id,owner).run();
  return readFont(storage.UPLOADS,owner,id);
}
export async function fontBytes(storage:FontStorage,owner:string,id:unknown) {
  const font=await readFont(storage.UPLOADS,owner,id);
  if(font.status==='reserved')throw new UploadError(409,'字体上传未完成。');
  const saved=await storage.ORIGINALS.get(privateKey(font));
  if(!saved||saved.size!==font.size||saved.size>fontByteLimit)throw new UploadError(409,'字体记录与原件不一致。');
  const bytes=new Uint8Array(await saved.arrayBuffer());
  if(await hash(bytes)!==font.sha256)throw new UploadError(409,'字体完整性校验失败。');
  return {font,bytes};
}
export async function publishFont(storage:FontStorage,owner:string,id:unknown) {
  if(storage.ORIGINALS===storage.PUBLISHED||storage.BACKUPS===storage.PUBLISHED)throw new UploadError(503,'字体存储未隔离。');
  const {font,bytes}=await fontBytes(storage,owner,id);inspectFont(bytes);
  const snapshot=JSON.stringify({kind:'font-publication',font,createdAt:new Date().toISOString()});
  const key=`snapshots/fonts/${font.id}/${crypto.randomUUID()}.json`;
  await storage.BACKUPS.put(key,snapshot,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  if(await (await storage.BACKUPS.get(key))?.text()!==snapshot)throw new UploadError(503,'字体备份校验失败，未发布。');
  await storage.PUBLISHED.put(publicFontKey(font),bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256:font.sha256,httpMetadata:{contentType:'font/woff2',cacheControl:'public, max-age=31536000, immutable'}});
  const saved=await storage.PUBLISHED.get(publicFontKey(font));
  if(!saved||await hash(new Uint8Array(await saved.arrayBuffer()))!==font.sha256)throw new UploadError(503,'字体公开副本未通过校验。');
  await storage.UPLOADS.prepare("UPDATE designer_fonts SET status = 'published' WHERE id = ? AND owner = ? AND sha256 = ?").bind(font.id,owner,font.sha256).run();
  return readFont(storage.UPLOADS,owner,font.id);
}
